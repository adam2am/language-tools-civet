import { performance } from 'perf_hooks';
import * as ts from 'typescript';
// import { GenMapping, setSourceContent, addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import type { LinesMap } from '../types';
import { collectAnchorsFromTs, Anchor } from './shared/tsAnchorCollector';
import { buildLookupTables, buildDenseMapLines } from './dense';
import { AST_CACHE_MAX, DEBUG_FLAGS } from './dense/constants';

const astCache = new Map<string, ts.SourceFile>();

/**
 * Normalize a Civet-specific sourcemap (CivetLinesSourceMap, from Civet snippet -> TS snippet)
 * to be a standard V3 RawSourceMap from Original Svelte File -> TS snippet.
 *
 * This function implements an "Anchor-Based" generation strategy. It discards the original
 * Civet `lines` map for mapping generation and instead builds a new map from scratch.
 * It uses identifiers found in the compiled TS AST as "anchors" and finds their
 * corresponding text in the original Civet snippet to create high-confidence mappings.
 * This ensures compiler-generated helper variables are never mapped.
 *
 * @param civetMap The CivetLinesSourceMap containing the `lines` array from `civet.compile()`.
 * @param svelteFileContent The full content of the original .svelte file.
 * @param civetBlockStartLine 1-based Svelte line where snippet starts
 * @param indentation number of spaces stripped from snippet indent
 * @param svelteFilePath The actual file path of the .svelte file (for the output sourcemap's `sources` and `
 * @returns A Standard V3 RawSourceMap that maps from the original .svelte file to the compiled TS snippet.
 */
export function normalizeCivetMap(
  civetMap: LinesMap,
  svelteFileContent: string,
  civetBlockStartLine: number, // 1-based Svelte line where snippet starts
  indentation: number,           // number of spaces stripped from snippet indent
  svelteFilePath: string,
  tsCode?: string                // optional TS snippet for AST-based enhancements
): EncodedSourceMap {
  const tStart = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;

  // Phase 1: Collect identifier anchors (and literals) from the TS AST.
  let tsAnchors: Anchor[] = [];
  if (tsCode) {
    try {
      let tsSourceFile = astCache.get(tsCode);
      if (!tsSourceFile) {
        tsSourceFile = ts.createSourceFile(
          `${svelteFilePath}-snippet.ts`,
          tsCode,
          ts.ScriptTarget.ESNext,
          true
        );
        // Insert with simple size bound eviction (FIFO)
        if (astCache.size >= AST_CACHE_MAX) {
          const oldestKey = astCache.keys().next().value;
          if (oldestKey !== undefined) astCache.delete(oldestKey);
        }
        astCache.set(tsCode, tsSourceFile);
      }
      tsAnchors = collectAnchorsFromTs(tsSourceFile);
    } catch (e) {
      console.error(`[MAP_TO_V3 ${svelteFilePath}] Error parsing compiled TS for AST: ${(e as Error).message}`);
    }
  }
  const tAnchorsCollected = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;

  // Early exit: if no anchors collected, return minimal sourcemap
  if (tsAnchors.length === 0) {
    if (DEBUG_FLAGS.BENCHMARK) {
      console.log('    [normalizeCivetMap] Skipped dense map build – no TS anchors.');
    }
    return {
      version: 3,
      file: svelteFilePath,
      sources: [svelteFilePath],
      sourcesContent: [svelteFileContent],
      mappings: '',
      names: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: AST-driven dense-map generation
  // ---------------------------------------------------------------------------

  const DEBUG_DENSE_MAP = false;
  
  const outputMap: EncodedSourceMap = {
    version: 3,
    file: svelteFilePath,
    sources: [svelteFilePath],
    sourcesContent: [svelteFileContent],
    mappings: '',
    names: [],
  };

  if (!tsCode || !civetMap.lines) {
    return outputMap;
  }

  const civetCodeLines = (civetMap.source || '').split('\n');
  const tsLines = tsCode.split('\n');

  const tBuildLookupsStart = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;
  const {
    tsLineToCivetLineMap,
    civetSegmentsByTsLine,
    generatedIdentifiers,
    anchorsByLine,
    names,
  } = buildLookupTables(tsAnchors, civetMap, civetCodeLines, tsLines);
  const tLookupsBuilt = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;

  const tBuildDenseMapStart = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;
  const decoded = buildDenseMapLines(
    tsLines,
    anchorsByLine,
    generatedIdentifiers,
    tsLineToCivetLineMap,
    civetSegmentsByTsLine,
    civetCodeLines,
    civetBlockStartLine,
    indentation,
    names,
    DEBUG_DENSE_MAP,
  );
  const tDenseMapBuilt = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;

  // Post-process: strip redundant nulls in a single pass.
  const tCleanStart = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;
  const cleanedDecoded = decoded.map((line) => {
    const out: number[][] = [];
    let prevHadMapping = false;
    for (const seg of line) {
      const isMapping = seg.length >= 4;
      if (isMapping || (seg.length === 1 && prevHadMapping)) {
        out.push(seg);
      }
      prevHadMapping = isMapping;
    }
    return out;
  });
  const tCleanEnd = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;

  const { encode } = require('@jridgewell/sourcemap-codec');
  outputMap.mappings = encode(cleanedDecoded);
  outputMap.names = names;

  if (DEBUG_FLAGS.BENCHMARK) {
    const tEnd = performance.now();
    console.log(`\n    --- [normalizeCivetMap] Sub-task Breakdown ---`);
    console.log(`    Total Time            : ${(tEnd - tStart).toFixed(1)} ms`);
    console.log(`      - TS Anchor Collection: ${(tAnchorsCollected - tStart).toFixed(1)} ms`);
    console.log(`      - Lookup Table Build  : ${(tLookupsBuilt - tBuildLookupsStart).toFixed(1)} ms`);
    console.log(`      - Dense Map Build     : ${(tDenseMapBuilt - tBuildDenseMapStart).toFixed(1)} ms`);
    console.log(`      - Post-process Clean  : ${(tCleanEnd - tCleanStart).toFixed(1)} ms`);
    console.log(`    ----------------------------------------------`);
  }

  return outputMap;
}