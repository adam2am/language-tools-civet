// Define the source map interface locally
import { decode, encode } from '@jridgewell/sourcemap-codec';
import { TraceMap } from '@jridgewell/trace-mapping';
import { lineOffsetIndex } from '../shared/lineOffsetIndex';
import { mapScriptSegments } from './mapScriptSegments';
import { mapTemplateSegments } from './mapTemplateSegments';
import { performance } from 'perf_hooks';
import { DEBUG_FLAGS } from '../dense/constants';

export interface ChainedSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourcesContent?: string[];
}

// A mapping block from a Civet-generated map to apply
export interface ChainBlock {
  map: ChainedSourceMap;
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

/**
 * Chain multiple Civet-generated source maps into a base map.
 * This runs synchronously using trace-mapping and sourcemap-codec.
 * This new version correctly handles line shifts for template content.
 */
export function chainCivetMaps(
  baseMap: ChainedSourceMap,
  blocks: ChainBlock[], // Assumed sorted by tsSnippet.startOffset
  originalSvelteContent: string,
  svelteWithTsContent: string // Content to which baseMap's original_lines/cols refer
): ChainedSourceMap {
  // --- Perf timer start ---
  const tChainStart = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;

  if (DEBUG_FLAGS.CHAINER) {
    console.log('[CHAIN_MAPS] Starting refactored chaining.');
    console.log('[CHAIN_MAPS] BaseMap sources:', baseMap.sources);
    console.log('[CHAIN_MAPS] Number of blocks:', blocks.length);
    blocks.forEach((block, i) => console.log(`[CHAIN_MAPS] Block ${i}: originalLines=${block.civet.lineCount}, compiledLines=${block.ts.lineCount}, tsStartChar=${block.tsSnippet.startOffset}, tsEndChar=${block.tsSnippet.endOffset}, tsStartLine=${block.tsSnippet.startLine}, svelteOffset_0_based=${block.svelte.civetStartIndex}, removedIndent=${block.sourceIndent.commonLength}, mapFile=${block.map.file}, mapSources=${JSON.stringify(block.map.sources)}`));
  }

  const finalNames = [...baseMap.names];
  const nameOffsets: number[] = [];
  if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS_NAMES] Base map has ${baseMap.names.length} names.`);
  for (const block of blocks) {
      nameOffsets.push(finalNames.length);
      if (block.map.names) {
          finalNames.push(...block.map.names);
          if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS_NAMES] Added ${block.map.names.length} names. New total: ${finalNames.length}. Offset for this block: ${nameOffsets[nameOffsets.length - 1]}`);
      } else {
        if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS_NAMES] Block had no names. Total: ${finalNames.length}. Offset for this block: ${nameOffsets[nameOffsets.length - 1]}`);
      }
  }

  const preprocessedLineOffsetIndex = new lineOffsetIndex(svelteWithTsContent);
  const baseLines = decode(baseMap.mappings);
  if (DEBUG_FLAGS.CHAINER) console.log('[CHAIN_MAPS] Decoded baseMap segments (first 5 lines):', JSON.stringify(baseLines.slice(0,5)));
  if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS] Decoded baseMap (Svelte->TSX) has ${baseLines.length} lines of mappings.`);

  const tracers = blocks.map((block, i) => {
    if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS] Initializing TraceMap for Block ${i} (Civet-TS -> Svelte). Map sources: ${JSON.stringify(block.map.sources)}, Map file: ${block.map.file}`);
    if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS] Block ${i} map mappings (first 3 lines): ${block.map.mappings.split(';').slice(0,3).join(';')}`);
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
    if (DEBUG_FLAGS.CHAINER) console.log(`
[CHAIN_MAPS] Processing BaseMap segments for generated TSX line: ${currentGeneratedTSXLine_1based}`);

    for (const segment of lineSegments) {
      const [generatedCol, , preprocessedLine, preprocessedCol] = segment;
      const charOffset = preprocessedLineOffsetIndex.offsetOf(preprocessedLine + 1, preprocessedCol);
      if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS] TSX L${currentGeneratedTSXLine_1based}C${generatedCol}: BaseMap segment maps to svelteWithTs L${preprocessedLine+1}C${preprocessedCol} (char offset ${charOffset})`);

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
        if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS]   Segment is SCRIPT (Block ${blockIndex})`);
      } else {
        tmplSegs.push({ segment, charOffset });
        if (DEBUG_FLAGS.CHAINER) console.log(`[CHAIN_MAPS]   Segment is TEMPLATE`);
      }
    }
    // Remap script segments via trace-mapping
    const codeLines = mapScriptSegments(codeSegs, blocks, tracers, nameOffsets, DEBUG_FLAGS.CHAINER);
    
    // Remap template segments by adjusting line delta
    const tmplLines = mapTemplateSegments(tmplSegs, blocks, lineDeltas);
    
    // Merge and sort segments by generated column
    const merged: number[][] = [];
    let i = 0;
    let j = 0;
    while (i < codeLines.length || j < tmplLines.length) {
      if (j >= tmplLines.length || (i < codeLines.length && codeLines[i][0] < tmplLines[j][0])) {
        merged.push(codeLines[i++]);
      } else {
        merged.push(tmplLines[j++]);
      }
    }

    if (DEBUG_FLAGS.CHAINER && merged.length > 0 && currentGeneratedTSXLine_1based <=5) {
        console.log(`[CHAIN_MAPS] TSX L${currentGeneratedTSXLine_1based} MERGED segments: ${JSON.stringify(merged)}`);
    }
    finalLines.push(merged);
  }

  if (DEBUG_FLAGS.CHAINER) console.log('[chainCivetMaps] Remapped segments (first 5 lines):', JSON.stringify(finalLines.slice(0,5)));
  if (DEBUG_FLAGS.CHAINER) {
    console.log('[chainCivetMaps] Remapped summary (first 5 lines):');
    finalLines.slice(0,5).forEach((line, i) => console.log(`  Line ${i+1}: ${JSON.stringify(line)}`));
  }
  
  const finalEncodedMappings = encode(finalLines as any);
  if (DEBUG_FLAGS.CHAINER) console.log('[chainCivetMaps] Final encoded mappings:', finalEncodedMappings.slice(0,100) + "...");

  // --- Perf timer end & log ---
  if (DEBUG_FLAGS.BENCHMARK) {
    console.log(`      - Map Chaining        : ${(performance.now() - tChainStart).toFixed(1)} ms`);
  }

  if (DEBUG_FLAGS.CHAINER) {
    const decodedFinal = decode(finalEncodedMappings);
    console.log('[CHAIN_MAPS] Final decoded mappings (first 5 lines):', JSON.stringify(decodedFinal.slice(0,5), null, 2));
  }

  return {
    version: 3,
    sources: [baseMap.sources[0]], 
    sourcesContent: [originalSvelteContent],
    names: finalNames,
    mappings: finalEncodedMappings,
    file: baseMap.file 
  };
}
