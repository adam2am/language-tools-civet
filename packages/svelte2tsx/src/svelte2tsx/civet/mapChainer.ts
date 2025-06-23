// Define the source map interface locally
import { decode, encode } from '@jridgewell/sourcemap-codec';
import { TraceMap, traceSegment } from '@jridgewell/trace-mapping';

export interface EncodedSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourcesContent?: string[];
}

// A mapping block from a Civet-generated map to apply
export interface ChainBlock {
  map: EncodedSourceMap;
  tsSnippet: {
      startOffset: number;
      endOffset: number;
      startLine: number;
      startCol: number;
      endLine: number;
  };
  civet: {
      lineCount: number;
  };
  ts: {
      lineCount: number;
  };
  svelte: {
      civetStartLine: number;
      civetStartIndex: number;
  };
  sourceIndent: {
      commonLength: number;
      perLineLengths?: number[];
  };
}

const chainCivetDebug = false; // Debug enabled for pipeline inspection

class LineCalc {
  private lineOffsets: number[];
  constructor(content: string) {
      this.lineOffsets = [0]; // First line starts at offset 0
      for (let i = 0; i < content.length; i++) {
          if (content[i] === '\n') {
              this.lineOffsets.push(i + 1);
          }
      }
  }

  getOffset(line1Based: number, col0Based: number): number {
      if (line1Based < 1 || line1Based > this.lineOffsets.length) {
          if (chainCivetDebug) console.warn(`[LineOffsetCalculator] Line ${line1Based} out of bounds (1-${this.lineOffsets.length}). Clamping.`);
          line1Based = Math.max(1, Math.min(line1Based, this.lineOffsets.length));
      }
      const lineStartOffset = this.lineOffsets[line1Based - 1];
      return lineStartOffset + col0Based;
  }
}

/**
 * Chain multiple Civet-generated source maps into a base map.
 * This runs synchronously using trace-mapping and sourcemap-codec.
 * This new version correctly handles line shifts for template content.
 */
export function chainMaps(
  baseMap: EncodedSourceMap,
  blocks: ChainBlock[], // Assumed sorted by tsSnippet.startOffset
  originalSvelteContent: string,
  svelteWithTsContent: string // Content to which baseMap's original_lines/cols refer
): EncodedSourceMap {
  if (chainCivetDebug) {
    console.log('[CHAIN_MAPS] Starting refactored chaining.');
    console.log('[CHAIN_MAPS] BaseMap sources:', baseMap.sources);
    console.log('[CHAIN_MAPS] Number of blocks:', blocks.length);
    blocks.forEach((block, i) => console.log(`[CHAIN_MAPS] Block ${i}: originalLines=${block.civet.lineCount}, compiledLines=${block.ts.lineCount}, tsStartChar=${block.tsSnippet.startOffset}, tsEndChar=${block.tsSnippet.endOffset}, tsStartLine=${block.tsSnippet.startLine}, svelteOffset_0_based=${block.svelte.civetStartIndex}, removedIndent=${block.sourceIndent.commonLength}, mapFile=${block.map.file}, mapSources=${JSON.stringify(block.map.sources)}`));
  }

  const preprocessedLineCalc = new LineCalc(svelteWithTsContent);
  const baseLines = decode(baseMap.mappings);
  if (chainCivetDebug) console.log('[CHAIN_MAPS] Decoded baseMap segments (first 5 lines):', JSON.stringify(baseLines.slice(0,5)));
  if (chainCivetDebug) console.log(`[CHAIN_MAPS] Decoded baseMap (Svelte->TSX) has ${baseLines.length} lines of mappings.`);

  const tracers = blocks.map((block, i) => {
    if (chainCivetDebug) console.log(`[CHAIN_MAPS] Initializing TraceMap for Block ${i} (Civet-TS -> Svelte). Map sources: ${JSON.stringify(block.map.sources)}, Map file: ${block.map.file}`);
    if (chainCivetDebug) console.log(`[CHAIN_MAPS] Block ${i} map mappings (first 3 lines): ${block.map.mappings.split(';').slice(0,3).join(';')}`);
    return new TraceMap({
    version: 3,
    sources: block.map.sources,
    names: block.map.names,
    mappings: block.map.mappings,
    file: block.map.file,
    sourcesContent: block.map.sourcesContent
    });
  });

  const lineDeltas: number[] = [0]; 
  let currentCumulativeDelta = 0;
  for (let i = 0; i < blocks.length; i++) {
    // Note: This delta is calculated based on line counts passed from preprocessCivet.
    // It reflects the change in line count from original Civet to compiled TS for that block.
    currentCumulativeDelta += (blocks[i].ts.lineCount - blocks[i].civet.lineCount);
    lineDeltas.push(currentCumulativeDelta);
  }

  const finalLines: number[][][] = [];

  for (const lineSegments of baseLines) {
    // Pre-filter baseMap segments
    const codeSegs: { segment: number[]; charOffset: number; blockIndex: number }[] = [];
    const tmplSegs: { segment: number[]; charOffset: number }[] = [];

    const currentGeneratedTSXLine_1based = finalLines.length + 1;
    if (chainCivetDebug) console.log(`\n[CHAIN_MAPS] Processing BaseMap segments for generated TSX line: ${currentGeneratedTSXLine_1based}`);

    for (const segment of lineSegments) {
      const [generatedCol, , preprocessedLine, preprocessedCol] = segment;
      const charOffset = preprocessedLineCalc.getOffset(preprocessedLine + 1, preprocessedCol);
      if (chainCivetDebug) console.log(`[CHAIN_MAPS] TSX L${currentGeneratedTSXLine_1based}C${generatedCol}: BaseMap segment maps to svelteWithTs L${preprocessedLine+1}C${preprocessedCol} (char offset ${charOffset})`);

      // Find which block, if any, this offset belongs to
      let blockIndex = -1;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (charOffset >= b.tsSnippet.startOffset && charOffset < b.tsSnippet.endOffset) {
          blockIndex = i;
          break;
        }
      }
      if (blockIndex >= 0) {
        codeSegs.push({ segment, charOffset, blockIndex });
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Segment is SCRIPT (Block ${blockIndex})`);
      } else {
        tmplSegs.push({ segment, charOffset });
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Segment is TEMPLATE`);
      }
    }
    // Remap script segments via trace-mapping
    const codeLines: number[][] = [];
    for (const { segment, blockIndex } of codeSegs) {
      const [generatedCol, , preprocessedLine, preprocessedCol, nameIndex] = segment;
      const block = blocks[blockIndex];
      const tracer = tracers[blockIndex];
      // Calculate relative line/col *within the compiled TS snippet* that block.map refers to.
      // preprocessedLine is 0-based line in the svelteWithTs content (where the <script> tag content starts)
      // block.tsSnippet.startLine is 1-based line where the <script> tag content starts in svelteWithTs
      const tracerLine = (preprocessedLine + 1) - block.tsSnippet.startLine;
      // The tracer (normalized Civet map) expects columns relative to the dedented TS snippet.
      // We need to subtract the amount of indent that was artificially re-added when the TS
      // code was inserted back into the <script> block.  Most of the time this is the
      // uniform `removedCivetContentIndentLength`, but if a per-line table is provided we
      // use that for higher accuracy / uneven indents.
      const indentRemovedForThisLine =
        (block.sourceIndent.perLineLengths &&
         tracerLine < block.sourceIndent.perLineLengths.length)
          ? block.sourceIndent.perLineLengths[tracerLine]
          : block.sourceIndent.commonLength;

      const tracerCol = preprocessedCol - indentRemovedForThisLine;

      let traced: readonly number[] | null = null;
      try {
        traced = traceSegment(tracer, tracerLine, Math.max(0, tracerCol));
      } catch (e) {
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Error during traceSegment: ${(e as Error).message}`);
      }

      if (!(traced && traced.length >= 4)) {
        /* ---------------------------------------------------------
         * Backtrack leftward on the same line until we
         * find a column that traces, then shift the original column
         * by the delta between our target and the traced-column.
         * ------------------------------------------------------- */
        let backtrackCol = tracerCol - 1;
        let tracedPrev: readonly number[] | null = null;
        while (backtrackCol >= 0) {
          try {
            tracedPrev = traceSegment(tracer, tracerLine, backtrackCol);
          } catch {
            tracedPrev = null;
          }
          if (tracedPrev && tracedPrev.length >= 4) {
            break;
          }
          backtrackCol--;
        }

        if (tracedPrev && tracedPrev.length >= 4) {
          const deltaCol = tracerCol - backtrackCol;
          const adjustedOrigCol = tracedPrev[3] + deltaCol;
          codeLines.push([generatedCol, 0, tracedPrev[2], adjustedOrigCol, nameIndex].filter(n => n !== undefined));
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Trace FAILED at exact col. Used backtrack to col ${backtrackCol}. New segment: [${generatedCol}, 0, ${tracedPrev[2]}, ${adjustedOrigCol}${nameIndex !== undefined ? ', '+nameIndex : ''}]`);
        } else {
          // Still no luck – fall back to script start
          codeLines.push([generatedCol, 0, block.svelte.civetStartIndex, 0, nameIndex].filter(n => n !== undefined));
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Trace FAILED after backtrack. Fallback to Svelte L${block.svelte.civetStartIndex + 1}C0. Final segment: [${generatedCol}, 0, ${block.svelte.civetStartIndex}, 0${nameIndex !== undefined ? ', '+nameIndex : ''}]`);
        }
      } else {
        // Normal successful trace path
        codeLines.push([generatedCol, 0, traced[2], traced[3], nameIndex].filter(n => n !== undefined));
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Traced OK. Final segment: [${generatedCol}, 0, ${traced[2]}, ${traced[3]}${nameIndex !== undefined ? ', '+nameIndex : ''}]`);
      }
    }
    // Remap template segments by adjusting line delta
    const tmplLines: number[][] = [];
    for (const { segment, charOffset } of tmplSegs) {
      const [generatedCol, , preprocessedLine, preprocessedCol, nameIndex] = segment;
      let delta = 0;
      for (let k = 0; k < blocks.length; k++) {
        if (charOffset < blocks[k].tsSnippet.startOffset) {
          delta = lineDeltas[k];
          break;
        }
        delta = lineDeltas[k + 1];
      }
      tmplLines.push([generatedCol, 0, preprocessedLine - delta, preprocessedCol, nameIndex]);
    }
    // Merge and sort segments by generated column
    const merged = codeLines.concat(tmplLines).sort((a, b) => a[0] - b[0]);
    if (chainCivetDebug && merged.length > 0 && currentGeneratedTSXLine_1based <=5) {
        console.log(`[CHAIN_MAPS] TSX L${currentGeneratedTSXLine_1based} MERGED segments: ${JSON.stringify(merged)}`);
    }
    finalLines.push(merged);
  }

  if (chainCivetDebug) console.log('[chainMaps] Remapped segments (first 5 lines):', JSON.stringify(finalLines.slice(0,5)));
  if (chainCivetDebug) {
    console.log('[chainMaps] Remapped summary (first 5 lines):');
    finalLines.slice(0,5).forEach((line, i) => console.log(`  Line ${i+1}: ${JSON.stringify(line)}`));
  }
  
  const finalEncodedMappings = encode(finalLines as any);
  if (chainCivetDebug) console.log('[chainMaps] Final encoded mappings:', finalEncodedMappings.slice(0,100) + "...");

  if (chainCivetDebug) {
    const decodedFinal = decode(finalEncodedMappings);
    console.log('[CHAIN_MAPS] Final decoded mappings (first 5 lines):', JSON.stringify(decodedFinal.slice(0,5), null, 2));
  }

  return {
    version: 3,
    sources: [baseMap.sources[0]], 
    sourcesContent: [originalSvelteContent],
    names: baseMap.names,
    mappings: finalEncodedMappings,
    file: baseMap.file 
  };
}