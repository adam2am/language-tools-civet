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
export interface EnhancedChainBlock {
  map: EncodedSourceMap;
  tsStartCharInSvelteWithTs: number;
  tsEndCharInSvelteWithTs: number;
  tsStartLineInSvelteWithTs: number; // 1-based
  tsStartColInSvelteWithTs: number;  // 0-based
  tsEndLineInSvelteWithTs: number;   // 1-based
  originalCivetLineCount: number;
  compiledTsLineCount: number;
  originalCivetSnippetLineOffset_0based: number; // Line offset of the Civet snippet in original Svelte file
  removedCivetContentIndentLength: number;    // How much leading indent was stripped from Civet code by preprocessor
  /** Optional per‐line indent values stripped by the preprocessor. Overrides the common indent length when present. */
  removedIndentPerLine?: number[];
  originalContentStartLine_Svelte_1based: number; // Where the actual Civet code started in the Svelte file (1-based)
}

const chainCivetDebug = false; // Debug enabled for pipeline inspection

class LineOffsetCalculator {
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
  blocks: EnhancedChainBlock[], // Assumed sorted by tsStartCharInSvelteWithTs
  originalSvelteContent: string,
  svelteWithTsContent: string // Content to which baseMap's original_lines/cols refer
): EncodedSourceMap {
  if (chainCivetDebug) {
    console.log('[CHAIN_MAPS] Starting refactored chaining.');
    console.log('[CHAIN_MAPS] BaseMap sources:', baseMap.sources);
    console.log('[CHAIN_MAPS] Number of blocks:', blocks.length);
    blocks.forEach((block, i) => console.log(`[CHAIN_MAPS] Block ${i}: originalLines=${block.originalCivetLineCount}, compiledLines=${block.compiledTsLineCount}, tsStartChar=${block.tsStartCharInSvelteWithTs}, tsEndChar=${block.tsEndCharInSvelteWithTs}, tsStartLine=${block.tsStartLineInSvelteWithTs}, svelteOffset_0_based=${block.originalCivetSnippetLineOffset_0based}, removedIndent=${block.removedCivetContentIndentLength}, mapFile=${block.map.file}, mapSources=${JSON.stringify(block.map.sources)}`));
  }

  const svelteWithTsLineOffsets = new LineOffsetCalculator(svelteWithTsContent);
  const decodedBaseMap = decode(baseMap.mappings);
  if (chainCivetDebug) console.log('[CHAIN_MAPS] Decoded baseMap segments (first 5 lines):', JSON.stringify(decodedBaseMap.slice(0,5)));
  console.log(`[CHAIN_MAPS] Decoded baseMap (Svelte->TSX) has ${decodedBaseMap.length} lines of mappings.`);

  const blockTracers = blocks.map((block, i) => {
    console.log(`[CHAIN_MAPS] Initializing TraceMap for Block ${i} (Civet-TS -> Svelte). Map sources: ${JSON.stringify(block.map.sources)}, Map file: ${block.map.file}`);
    console.log(`[CHAIN_MAPS] Block ${i} map mappings (first 3 lines): ${block.map.mappings.split(';').slice(0,3).join(';')}`);
    return new TraceMap({
    version: 3,
    sources: block.map.sources,
    names: block.map.names,
    mappings: block.map.mappings,
    file: block.map.file,
    sourcesContent: block.map.sourcesContent
    });
  });

  const cumulativeLineDeltas: number[] = [0]; 
  let currentCumulativeDelta = 0;
  for (let i = 0; i < blocks.length; i++) {
    // Note: This delta is calculated based on line counts passed from preprocessCivet.
    // It reflects the change in line count from original Civet to compiled TS for that block.
    currentCumulativeDelta += (blocks[i].compiledTsLineCount - blocks[i].originalCivetLineCount);
    cumulativeLineDeltas.push(currentCumulativeDelta);
  }

  const remappedLines: number[][][] = [];

  for (const lineSegments of decodedBaseMap) {
    // Pre-filter baseMap segments
    const scriptSegments: { segment: number[]; charOffset: number; blockIndex: number }[] = [];
    const templateSegments: { segment: number[]; charOffset: number }[] = [];

    const currentGeneratedTSXLine_1based = remappedLines.length + 1;
    if (chainCivetDebug) console.log(`\n[CHAIN_MAPS] Processing BaseMap segments for generated TSX line: ${currentGeneratedTSXLine_1based}`);

    for (const segment of lineSegments) {
      const [generatedCol, , origLine0_InSvelteWithTS, origCol0_InSvelteWithTS] = segment;
      const charOffset = svelteWithTsLineOffsets.getOffset(origLine0_InSvelteWithTS + 1, origCol0_InSvelteWithTS);
      if (chainCivetDebug) console.log(`[CHAIN_MAPS] TSX L${currentGeneratedTSXLine_1based}C${generatedCol}: BaseMap segment maps to svelteWithTs L${origLine0_InSvelteWithTS+1}C${origCol0_InSvelteWithTS} (char offset ${charOffset})`);

      // Find which block, if any, this offset belongs to
      let blockIndex = -1;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (charOffset >= b.tsStartCharInSvelteWithTs && charOffset < b.tsEndCharInSvelteWithTs) {
          blockIndex = i;
          break;
        }
      }
      if (blockIndex >= 0) {
        scriptSegments.push({ segment, charOffset, blockIndex });
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Segment is SCRIPT (Block ${blockIndex})`);
      } else {
        templateSegments.push({ segment, charOffset });
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Segment is TEMPLATE`);
      }
    }
    // Remap script segments via trace-mapping
    const remappedScript: number[][] = [];
    for (const { segment, blockIndex } of scriptSegments) {
      const [generatedCol, , origLine0_InSvelteWithTS, origCol0_InSvelteWithTS, nameIndex] = segment;
      const block = blocks[blockIndex];
      const tracer = blockTracers[blockIndex];
      // Calculate relative line/col *within the compiled TS snippet* that block.map refers to.
      // origLine0_InSvelteWithTS is 0-based line in the svelteWithTs content (where the <script> tag content starts)
      // block.tsStartLineInSvelteWithTs is 1-based line where the <script> tag content starts in svelteWithTs
      const relLine_0based_in_compiled_ts_snippet = (origLine0_InSvelteWithTS + 1) - block.tsStartLineInSvelteWithTs;
      // The tracer (normalized Civet map) expects columns relative to the dedented TS snippet.
      // We need to subtract the amount of indent that was artificially re-added when the TS
      // code was inserted back into the <script> block.  Most of the time this is the
      // uniform `removedCivetContentIndentLength`, but if a per-line table is provided we
      // use that for higher accuracy / uneven indents.
      const indentRemovedForThisLine =
        (block.removedIndentPerLine &&
         relLine_0based_in_compiled_ts_snippet < block.removedIndentPerLine.length)
          ? block.removedIndentPerLine[relLine_0based_in_compiled_ts_snippet]
          : block.removedCivetContentIndentLength;

      const relCol_0based_in_compiled_ts_snippet = origCol0_InSvelteWithTS - indentRemovedForThisLine;

      const isTwoFooFixture = block.map.file?.includes('twoFooUserRequest.svelte');
      // DYNAMIC LOG for foo1 target area in twoFooUserRequest
      // TSX L4C10 should be origLine0_InSvelteWithTS = 1 (for <script> content line 2), origCol0_InSvelteWithTS = 10 (approx, for foo1)
      // relLine should be 0, relCol should be around 8 for `foo1` in `function foo1()`
      if (isTwoFooFixture && chainCivetDebug && 
          currentGeneratedTSXLine_1based === 4 && generatedCol === 10 && blockIndex === 0) { // blockIndex 0 is usually instance script
          console.log(`[CHAIN_MAPS_DYN_DEBUG_FOO1_TRACE_INPUT ${block.map.file}] TSX L${currentGeneratedTSXLine_1based}C${generatedCol} (Block ${blockIndex}): Tracing with relLineInCompiledTS_0based=${relLine_0based_in_compiled_ts_snippet}, relColInCompiledTS_0based=${relCol_0based_in_compiled_ts_snippet}`);
      }

      if (chainCivetDebug) console.log(`[CHAIN_MAPS] TSX L${currentGeneratedTSXLine_1based}C${generatedCol} (SCRIPT): Tracing Block ${blockIndex}. RelLineInCompiledTS(0): ${relLine_0based_in_compiled_ts_snippet}, RelColInCompiledTS(0): ${Math.max(0, relCol_0based_in_compiled_ts_snippet)}. (origSvelteWithTsL0: ${origLine0_InSvelteWithTS}, origSvelteWithTsC0: ${origCol0_InSvelteWithTS}, blockStartL1: ${block.tsStartLineInSvelteWithTs}, blockStartC0: ${block.tsStartColInSvelteWithTs})`);

      let traced: readonly number[] | null = null;
      try {
        // Log the map being used by this tracer instance right before tracing critical segment
        if (chainCivetDebug && blockIndex === 0 && relLine_0based_in_compiled_ts_snippet === 0 && relCol_0based_in_compiled_ts_snippet === 6) {
            console.log(`[CHAIN_MAPS_CRITICAL_TRACE] Block ${blockIndex} Tracer (Normalized Civet-Svelte Map) Mappings (first 3 lines): ${block.map.mappings.split(';').slice(0,3).join(';')}`);
            console.log(`[CHAIN_MAPS_CRITICAL_TRACE]                      Full Map (if short): ${block.map.mappings}`);
        }
        traced = traceSegment(tracer, relLine_0based_in_compiled_ts_snippet, Math.max(0, relCol_0based_in_compiled_ts_snippet));
      } catch (e) {
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Error during traceSegment: ${(e as Error).message}`);
      }

      if (!(traced && traced.length >= 4)) {
        /* ---------------------------------------------------------
         * Approach C: Backtrack leftward on the same line until we
         * find a column that traces, then shift the original column
         * by the delta between our target and the traced-column.
         * ------------------------------------------------------- */
        let backtrackCol = relCol_0based_in_compiled_ts_snippet - 1;
        let tracedPrev: readonly number[] | null = null;
        while (backtrackCol >= 0) {
          try {
            tracedPrev = traceSegment(tracer, relLine_0based_in_compiled_ts_snippet, backtrackCol);
          } catch {
            tracedPrev = null;
          }
          if (tracedPrev && tracedPrev.length >= 4) {
            break;
          }
          backtrackCol--;
        }

        if (tracedPrev && tracedPrev.length >= 4) {
          const deltaCol = relCol_0based_in_compiled_ts_snippet - backtrackCol;
          const adjustedOrigCol = tracedPrev[3] + deltaCol;
          remappedScript.push([generatedCol, 0, tracedPrev[2], adjustedOrigCol, nameIndex].filter(n => n !== undefined));
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Trace FAILED at exact col. Used backtrack to col ${backtrackCol}. New segment: [${generatedCol}, 0, ${tracedPrev[2]}, ${adjustedOrigCol}${nameIndex !== undefined ? ', '+nameIndex : ''}]`);
        } else {
          // Still no luck – fall back to script start
          const fallbackOrigLine_0based = block.originalContentStartLine_Svelte_1based - 1;
          remappedScript.push([generatedCol, 0, fallbackOrigLine_0based, 0, nameIndex].filter(n => n !== undefined));
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Trace FAILED after backtrack. Fallback to Svelte L${fallbackOrigLine_0based+1}C0. Final segment: [${generatedCol}, 0, ${fallbackOrigLine_0based}, 0${nameIndex !== undefined ? ', '+nameIndex : ''}]`);
        }
      } else {
        // Normal successful trace path
        remappedScript.push([generatedCol, 0, traced[2], traced[3], nameIndex].filter(n => n !== undefined));
        if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Traced OK. Final segment: [${generatedCol}, 0, ${traced[2]}, ${traced[3]}${nameIndex !== undefined ? ', '+nameIndex : ''}]`);
      }
    }
    // Remap template segments by adjusting line delta
    const remappedTemplate: number[][] = [];
    for (const { segment, charOffset } of templateSegments) {
      const [generatedCol, , origLine0_InSvelteWithTS, origCol0_InSvelteWithTS, nameIndex] = segment;
      let delta = 0;
      for (let k = 0; k < blocks.length; k++) {
        if (charOffset < blocks[k].tsStartCharInSvelteWithTs) {
          delta = cumulativeLineDeltas[k];
          break;
        }
        delta = cumulativeLineDeltas[k + 1];
      }
      remappedTemplate.push([generatedCol, 0, origLine0_InSvelteWithTS - delta, origCol0_InSvelteWithTS, nameIndex]);
    }
    // Merge and sort segments by generated column
    const merged = remappedScript.concat(remappedTemplate).sort((a, b) => a[0] - b[0]);
    if (chainCivetDebug && merged.length > 0 && currentGeneratedTSXLine_1based <=5) {
        console.log(`[CHAIN_MAPS] TSX L${currentGeneratedTSXLine_1based} MERGED segments: ${JSON.stringify(merged)}`);
    }
    remappedLines.push(merged);
  }

  if (chainCivetDebug) console.log('[chainMaps] Remapped segments (first 5 lines):', JSON.stringify(remappedLines.slice(0,5)));
  if (chainCivetDebug) {
    console.log('[chainMaps] Remapped summary (first 5 lines):');
    remappedLines.slice(0,5).forEach((line, i) => console.log(`  Line ${i+1}: ${JSON.stringify(line)}`));
  }
  
  const finalEncodedMappings = encode(remappedLines as any);
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

// For backward compatibility: single-block chaining
// This function's old signature is insufficient for the new chainMaps logic.
// It would need full EnhancedChainBlock details.
// If svelte2tsx/index.ts is updated to call the main chainMaps directly, this might become obsolete.
// For now, it's updated to accept parts of EnhancedChainBlock, but it might not be practically callable
// without significant changes at its call sites if they don't have all this information.
export function chainSourceMaps(
  baseMap: EncodedSourceMap,
  blockDetails: Omit<EnhancedChainBlock, 'map'> & { map: EncodedSourceMap },
  originalSvelteContent: string,
  svelteWithTsContent: string
): EncodedSourceMap {
  const block: EnhancedChainBlock = {
    map: blockDetails.map,
    tsStartCharInSvelteWithTs: blockDetails.tsStartCharInSvelteWithTs,
    tsEndCharInSvelteWithTs: blockDetails.tsEndCharInSvelteWithTs,
    tsStartLineInSvelteWithTs: blockDetails.tsStartLineInSvelteWithTs,
    tsStartColInSvelteWithTs: blockDetails.tsStartColInSvelteWithTs,
    tsEndLineInSvelteWithTs: blockDetails.tsEndLineInSvelteWithTs,
    originalCivetLineCount: blockDetails.originalCivetLineCount,
    compiledTsLineCount: blockDetails.compiledTsLineCount,
    originalCivetSnippetLineOffset_0based: blockDetails.originalCivetSnippetLineOffset_0based,
    removedCivetContentIndentLength: blockDetails.removedCivetContentIndentLength,
    removedIndentPerLine: (blockDetails as any).removedIndentPerLine,
    originalContentStartLine_Svelte_1based: blockDetails.originalContentStartLine_Svelte_1based
  };
  return chainMaps(baseMap, [block], originalSvelteContent, svelteWithTsContent);
} 