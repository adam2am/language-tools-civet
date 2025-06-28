// import { GenMapping, setSourceContent, addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import type { LinesMap } from '../types';
import * as ts from 'typescript';
import { Anchor, collectAnchorsFromTs } from './tsAnchorCollector';
// avoid unused-import linter errors
if (ts) { /* noop */ }

function locateTokenInCivetLine(
  anchor: Anchor,
  civetLineText: string,
  consumedCount: number,
  operatorLookup: Record<string, string>,
  debug: boolean
): { startIndex: number; length: number } | undefined {
  const searchText = anchor.kind === 'operator' ? (operatorLookup[anchor.text] || anchor.text) : anchor.text;
  let foundIndex = -1;

  if (debug) {
    console.log(`[BUG_HUNT] Searching for "${searchText}" (anchor: "${anchor.text}", kind: ${anchor.kind}). Consumed: ${consumedCount}. Line content: "${civetLineText}"`);
  }

  if (anchor.kind === 'identifier' || (anchor.kind as string) === 'keyword') {
    if (debug) console.log(`[FIX_VERIFY] Using Unicode-aware word boundary search for identifier.`);
    const escapedSearchText = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapedSearchText}(?![\\p{L}\\p{N}_$])`, 'gu');
    if (debug) console.log(`[FIX_VERIFY] Constructed regex: ${searchRegex}`);

    for (let j = 0; j <= consumedCount; j++) {
      const match = searchRegex.exec(civetLineText);
      if (debug) {
        console.log(`[FIX_VERIFY_ITER] j=${j}: Match result: ${match ? `found at index ${match.index}` : 'null'}`);
      }
      if (!match) {
        foundIndex = -1;
        break;
      }
      foundIndex = match.index;
    }
  } else if (anchor.kind === 'operator') {
    if (debug) console.log(`[FIX_VERIFY] Using exact operator search for "${searchText}".`);
    const trimmedText = searchText.trim();
    if (!trimmedText) {
        foundIndex = -1;
    } else {
        const escapedOperator = trimmedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const operatorRegex = new RegExp(`\\s*${escapedOperator}\\s*`, 'g');
        let searchOffset = 0;
        for (let j = 0; j <= consumedCount; j++) {
          operatorRegex.lastIndex = searchOffset;
          const match = operatorRegex.exec(civetLineText);
          if (!match) {
            foundIndex = -1;
            break;
          }
          const fullMatch = match[0];
          const leadingSpace = fullMatch.match(/^\s*/)[0].length;
          foundIndex = match.index + leadingSpace;
          searchOffset = match.index + fullMatch.length;
        }
    }
  } else {
    if (debug) console.log(`[FIX_VERIFY] Using indexOf search for non-identifier token (kind: ${anchor.kind}).`);
    let searchOffset = 0;
    for (let j = 0; j <= consumedCount; j++) {
      foundIndex = civetLineText.indexOf(searchText, searchOffset);
      if (debug) {
          console.log(`[BUG_HUNT_ITER] j=${j}: searchOffset=${searchOffset}, foundIndex=${foundIndex}`);
      }
      if (foundIndex === -1) break;
      searchOffset = foundIndex + searchText.length;
    }
  }

  if (debug) {
    console.log(`[BUG_HUNT_RESULT] Final foundIndex for "${searchText}" is ${foundIndex}`);
  }
  
  if (foundIndex === -1) {
    return undefined;
  }

  const matchLength = anchor.kind === 'operator' ? searchText.trim().length : searchText.length;
  return { startIndex: foundIndex, length: matchLength };
}

function buildLookupTables(
  tsAnchors: Anchor[],
  civetMap: LinesMap,
  civetCodeLines: string[]
) {
  // Create a quick lookup to find the approximate Civet snippet line for a given TS line.
  const tsLineToCivetLineMap = new Map<number, number>();
  civetMap.lines.forEach((segments, tsLineIdx) => {
    for (const seg of segments) {
      if (seg.length >= 4) {
        tsLineToCivetLineMap.set(tsLineIdx, seg[2]);
        return;
      }
    }
  });

  // Collect identifiers that are compiler-generated to map them to null.
  const generatedIdentifiers = new Set<string>();
  for (const anchor of tsAnchors) {
    if (anchor.kind !== 'identifier') continue;
    const escapedText = anchor.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapedText}(?![\\p{L}\\p{N}_$])`, 'u');
    if (!civetCodeLines.some(line => wordRegex.test(line))) {
      generatedIdentifiers.add(anchor.text);
    }
  }

  // Group all anchors by their line number for sequential processing.
  const anchorsByLine = new Map<number, Anchor[]>();
  for (const anchor of tsAnchors) {
    if (!anchorsByLine.has(anchor.start.line)) {
      anchorsByLine.set(anchor.start.line, []);
    }
    anchorsByLine.get(anchor.start.line)!.push(anchor);
  }
  // Sort anchors within each line by column to process them in order.
  for (const lineAnchors of anchorsByLine.values()) {
    lineAnchors.sort((a, b) => a.start.character - b.start.character);
  }

  const names = Array.from(new Set(tsAnchors.filter(a => a.kind === 'identifier').map(a => a.text)));
  
  return { tsLineToCivetLineMap, generatedIdentifiers, anchorsByLine, names };
}

function buildDenseMapLines(
  tsLines: string[],
  anchorsByLine: Map<number, Anchor[]>,
  generatedIdentifiers: Set<string>,
  tsLineToCivetLineMap: Map<number, number>,
  civetCodeLines: string[],
  operatorLookup: Record<string, string>,
  civetBlockStartLine: number,
  indentation: number,
  names: string[],
  DEBUG_DENSE_MAP: boolean,
  DEBUG_TOKEN: boolean
) {
  const decoded: number[][][] = [];
  const consumedMatchCount = new Map<string, number>();

  for (let i = 0; i < tsLines.length; i++) {
    const lineAnchors = anchorsByLine.get(i) || [];
    const lineSegments: number[][] = [];
    let lastGenCol = 0;

    for (const anchor of lineAnchors) {
      // --- Fill gap before this token with a null mapping ---
      if (anchor.start.character > lastGenCol) {
        if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] Gap filler at ${i}:${lastGenCol} -> ${anchor.start.character}`);
        lineSegments.push([lastGenCol]);
      }

      // --- Determine mapping for the current token ---
      const isGenerated = anchor.kind === 'identifier' && generatedIdentifiers.has(anchor.text);
      const civetLineIndex = tsLineToCivetLineMap.get(i);

      if (isGenerated || civetLineIndex === undefined) {
        if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] Generated/unmappable token '${anchor.text}' at ${i}:${anchor.start.character}`);
        lineSegments.push([anchor.start.character]);
        lastGenCol = anchor.end.character;
        continue;
      }

      // It's not a known generated token, so try to find its original position.
      const civetLineText = civetCodeLines[civetLineIndex] || '';
      const searchText = anchor.kind === 'operator' ? (operatorLookup[anchor.text] || anchor.text) : anchor.text;
      const cacheKey = `${civetLineIndex}:${searchText}`;
      const consumedCount = consumedMatchCount.get(cacheKey) || 0;
      
      const locationInfo = locateTokenInCivetLine(anchor, civetLineText, consumedCount, operatorLookup, DEBUG_DENSE_MAP);

      if (locationInfo !== undefined) {
        consumedMatchCount.set(cacheKey, consumedCount + 1);
        const sourceSvelteLine = (civetBlockStartLine - 1) + civetLineIndex;
        const sourceSvelteStartCol = locationInfo.startIndex + indentation;
        const nameIdx = anchor.kind === 'identifier' ? names.indexOf(anchor.text) : -1;
        
        const tokenLength = locationInfo.length;
        const sourceSvelteEndColExclusive = sourceSvelteStartCol + tokenLength;

        // Point 2: Add an edge mapping at the column right after the token (unique per token).
        const genEdgeCol = anchor.end.character; // first char AFTER the token
        lineSegments.push([genEdgeCol, 0, sourceSvelteLine, sourceSvelteEndColExclusive]);

        // Point 1: Map token start
        const startSegment: number[] = [anchor.start.character, 0, sourceSvelteLine, sourceSvelteStartCol];
        if (nameIdx > -1) startSegment.push(nameIdx);
        lineSegments.push(startSegment);
        
        // Point 1: Map token end (inclusive) to ensure full token coverage
        const endSegment: number[] = [anchor.end.character - 1, 0, sourceSvelteLine, sourceSvelteEndColExclusive - 1];
        if (nameIdx > -1) endSegment.push(nameIdx);
        lineSegments.push(endSegment);

        if (DEBUG_TOKEN && anchor.text === 'abc') {
            console.log(`\n[TOKEN_BOUNDARY_DEBUG] Token '${anchor.text}':`);
            console.log(`- TS Start: ${anchor.start.character}, End: ${anchor.end.character}`);
            console.log(`- Svelte Start: ${sourceSvelteStartCol}, End: ${sourceSvelteEndColExclusive}`);
            console.log(`- Generated segments: ${JSON.stringify([startSegment, endSegment, [genEdgeCol]])}\n`);
        }
      } else {
        // Could not find in original line, treat as generated.
        if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] Could not find '${anchor.text}' in Civet line, null mapping at ${i}:${anchor.start.character}`);
        lineSegments.push([anchor.start.character]);
      }

      lastGenCol = anchor.end.character;
    }

    // --- Fill final gap from last token to end of line ---
    if (lastGenCol < tsLines[i].length) {
      if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] EOL Gap filler at ${i}:${lastGenCol} to EOL`);
      lineSegments.push([lastGenCol]);
    }

    const finalLineSegments = lineSegments.sort((a,b) => a[0] - b[0]);
    decoded.push(finalLineSegments);
  }
  return decoded;
}

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
 * @param svelteFilePath The actual file path of the .svelte file (for the output sourcemap's `sources` and `file` fields).
 * @param tsCode optional TS snippet for AST-based enhancements
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
  // Map TS operator tokens to their Civet equivalents. Defined up-front so the
  // AST walker and later search logic can reference it safely.
  const operatorLookup: Record<string, string> = {
    '=': '=',
    '===': ' is ',
    '!==': ' isnt ',
    '&&':  ' and ',
    '||':  ' or ',
    '!':   'not '
    // Extend as needed
  };

  // Phase 1: Collect identifier anchors *and* import string-literal anchors from TS AST.
  let tsAnchors: Anchor[] = [];
  if (tsCode) {
    try {
      tsAnchors = collectAnchorsFromTs(tsCode, svelteFilePath, operatorLookup);
    } catch (e) {
      console.error(`[MAP_TO_V3 ${svelteFilePath}] Error parsing compiled TS for AST: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: AST-Driven Dense Map Generation
  //
  // This strategy abandons "post-processing" in favor of building a correct,
  // dense sourcemap in a single pass. It iterates through the collected TS
  // anchors and, for every token, explicitly decides whether to map it to the
  // original source or to null. Gaps between tokens are also filled with null
  // mappings. This prevents "fall-through" errors in chained sourcemap consumers.
  // ---------------------------------------------------------------------------
  const DEBUG_DENSE_MAP = false; // Toggle for verbose dense-map generation logs (disabled for production)
  const DEBUG_TOKEN = false; // Token-level mapping debug flag disabled

  if (DEBUG_DENSE_MAP) {
    console.log(`\n--- [DEBUG] ORIGINAL CIVET COMPILER MAP (DECODED) ---`);
    if (civetMap.lines) {
        civetMap.lines.forEach((lineSegments, index) => {
            const segmentsStr = lineSegments.map(seg => `[${seg.join(',')}]`).join('');
            console.log(`Civet Original -> TS Line ${index}: ${segmentsStr}`);
        });
    } else {
        console.log("No 'lines' found in original Civet map.");
    }
    console.log(`--- END ORIGINAL CIVET MAP ---\n`);
  }

  let outputMap: EncodedSourceMap = {
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

  const {
    tsLineToCivetLineMap,
    generatedIdentifiers,
    anchorsByLine,
    names
  } = buildLookupTables(tsAnchors, civetMap, civetCodeLines);

  const decoded = buildDenseMapLines(
    tsLines,
    anchorsByLine,
    generatedIdentifiers,
    tsLineToCivetLineMap,
    civetCodeLines,
    operatorLookup,
    civetBlockStartLine,
    indentation,
    names,
    DEBUG_DENSE_MAP,
    DEBUG_TOKEN
  );

  if (DEBUG_DENSE_MAP) {
    console.log(`\n--- [DEBUG] FINAL NORMALIZED SVELTE->TS MAP (DECODED) ---`);
    decoded.forEach((lineSegments, index) => {
        const segmentsStr = lineSegments.map(seg => `[${seg.join(',')}]`).join('');
        console.log(`Svelte -> TS Line ${index}: ${segmentsStr}`);
    });
    console.log(`--- END FINAL NORMALIZED MAP ---\n`);
  }

  // Post-process: strip redundant nulls in a single pass (O(n))
  const cleanedDecoded = decoded.map(line => {
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

  if (DEBUG_DENSE_MAP) {
    console.log(`\n--- [DEBUG] CLEANED NORMALIZED MAP (WITH NULL TERMINATORS) ---`);
    cleanedDecoded.forEach((lineSegments, index) => {
        const segmentsStr = lineSegments.map(seg => `[${seg.join(',')}]`).join('');
        console.log(`Svelte -> TS Line ${index}: ${segmentsStr}`);
    });
    console.log(`--- END CLEANED MAP ---\n`);
  }

  const { encode } = require('@jridgewell/sourcemap-codec');
  outputMap.mappings = encode(cleanedDecoded);
  outputMap.names = names;

  return outputMap;
}
