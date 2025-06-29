// import { GenMapping, setSourceContent, addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import type { LinesMap } from '../types';
import { Anchor, collectAnchorsFromTs } from './tsAnchorCollector';

// ---------------------------------------------------------------------------
//  FAST PER-LINE LITERAL/COMMENT SPAN DETECTOR
//
//  Identifies runs of characters that belong to:
//    • single-quoted   string literals   '...'
//    • double-quoted   string literals   "..."
//    • back-tick       template literals  `...`
//    • line comments   // ...   and   # ...
//  (multi-line / block comments are not needed – Civet doesn't have them.)
//  These zones are cached per unique line string so we compute them once.
// ---------------------------------------------------------------------------

type Range = { start: number; end: number }; // end is inclusive
const literalCache = new Map<string, Range[]>();

function getLiteralRanges(line: string): Range[] {
  let cached = literalCache.get(line);
  if (cached) return cached;

  const ranges: Range[] = [];
  const len = line.length;

  let i = 0;
  const pushRange = (s: number, e: number) => {
    if (e >= s) ranges.push({ start: s, end: e });
  };

  while (i < len) {
    const ch = line[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      // String or template literal
      const quote = ch;
      const stringStart = i;
      let currentLiteralPartStart = stringStart;
      i++;

      while (i < len) {
        const c = line[i];
        if (c === '\\') {
          i += 2; // skip escaped char
          continue;
        }
        
        // Handle interpolation only for " and `
        if ((quote === '"' || quote === '`') && c === '#' && i + 1 < len && line[i + 1] === '{') {
            // End of the string part before interpolation.
            pushRange(currentLiteralPartStart, i - 1);

            // Skip over the interpolation block.
            i += 2; // Move past `#{`
            let braceLevel = 1;
            while (i < len && braceLevel > 0) {
                if (line[i] === '{') braceLevel++;
                else if (line[i] === '}') braceLevel--;
                i++;
            }
            // `i` is now at the character after the closing `}`.
            // This is the start of the next part of the string literal.
            currentLiteralPartStart = i;
            continue; // Back to the inner string-scanning loop.
        }

        if (c === quote) {
          pushRange(currentLiteralPartStart, i);
          i++; // move past closing quote
          break; // Exit the inner while loop
        }
        i++;
      }
      continue;
    }

    // Line comment detection (// or #, but not in string)
    if (ch === '/' && i + 1 < len && line[i + 1] === '/') {
      pushRange(i, len - 1);
      break;
    }
    if (ch === '#') {
      // Treat everything after # as comment if # is first non-space char
      const prefix = line.slice(0, i).trim();
      if (prefix === '') {
        pushRange(i, len - 1);
        break;
      }
    }

    i++;
  }

  literalCache.set(line, ranges);
  return ranges;
}

function isInsideLiteral(idx: number, ranges: Range[]): boolean {
  for (const r of ranges) {
    if (idx >= r.start && idx <= r.end) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
//  SIMPLE REGEX CACHE 
//  We compile at most one RegExp per unique token text, 
//  then reuse it across all anchors.
// ---------------------------------------------------------------------------
const identifierRegexCache = new Map<string, RegExp>();
const operatorRegexCache   = new Map<string, RegExp>();

/**
 * Helper to always return a string alias (defaults to first element if array).
 */
function pickFirstAlias(alias: string | string[] | undefined): string | undefined {
  if (alias === undefined) return undefined;
  return Array.isArray(alias) ? alias[0] : alias;
}

function locateTokenInCivetLine(
  anchor: Anchor,
  civetLineText: string,
  operatorLookup: Record<string, string | string[]>,
  debug: boolean,
  searchFrom = 0
): { startIndex: number; length: number } | undefined {
  // Hybrid override: If the token is a TS keyword that has a Civet alias in
  // `operatorLookup`, we want to search for that alias (".=" / ":=" / "->")
  // and treat the search behaviour like an operator rather than a word.

  const keywordOverrideRaw = (anchor.kind as string) === 'keyword' ? operatorLookup[anchor.text] : undefined;
  const keywordOverride = pickFirstAlias(keywordOverrideRaw);

  const opAliasRaw = anchor.kind === 'operator' ? operatorLookup[anchor.text] : undefined;
  const searchText = anchor.kind === 'operator'
    ? (pickFirstAlias(opAliasRaw) || anchor.text)
    : ((anchor.kind as string) === 'keyword' && keywordOverride !== undefined)
      ? keywordOverride
      : anchor.text;

  let foundIndex = -1;

  if (debug) {
    console.log(`[BUG_HUNT] Searching for "${searchText}" (anchor: "${anchor.text}", kind: ${anchor.kind}). Line content: "${civetLineText}"`);
  }

  const treatAsOperator = anchor.kind === 'operator' || keywordOverride !== undefined;

  if (anchor.kind === 'identifier' || ((anchor.kind as string) === 'keyword' && !treatAsOperator)) {
    if (debug) console.log(`[FIX_VERIFY] Using Unicode-aware word boundary search for identifier.`);
    let searchRegex = identifierRegexCache.get(searchText);
    if (!searchRegex) {
    const escapedSearchText = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchRegex = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapedSearchText}(?![\\p{L}\\p{N}_$])`, 'gu');
      identifierRegexCache.set(searchText, searchRegex);
    }
    searchRegex.lastIndex = searchFrom;
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(civetLineText))) {
        const candidateIdx = match.index;
        if (!isInsideLiteral(candidateIdx, getLiteralRanges(civetLineText))) {
          foundIndex = candidateIdx;
          break;
        }
        // otherwise continue searching after this match
        searchRegex.lastIndex = candidateIdx + 1;
    }
  } else if (treatAsOperator) {
    const aliasCandidates: string[] = [];

    // Keyword override takes precedence.
    if (keywordOverride) aliasCandidates.push(keywordOverride);

    if (anchor.kind === 'operator') {
      const opAlias = operatorLookup[anchor.text];
      if (Array.isArray(opAlias)) {
        aliasCandidates.push(...opAlias);
      } else if (opAlias) {
        aliasCandidates.push(opAlias);
      }
      // Fallback to literal operator text if no alias matched.
      aliasCandidates.push(anchor.text);
    }

    for (const candidate of aliasCandidates) {
      if (debug) console.log(`[FIX_VERIFY] Trying operator alias "${candidate}" for "${anchor.text}".`);
      const trimmedText = candidate.trim();
      if (!trimmedText) continue;

      let operatorRegex = operatorRegexCache.get(trimmedText);
      if (!operatorRegex) {
        const escapedOperator = trimmedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        operatorRegex = new RegExp(`\\s*${escapedOperator}\\s*`, 'g');
        operatorRegexCache.set(trimmedText, operatorRegex);
      }

      operatorRegex.lastIndex = searchFrom;
      let matchRes: RegExpExecArray | null;
      while ((matchRes = operatorRegex.exec(civetLineText))) {
        const fullMatch = matchRes[0];
        const leadingSpace = fullMatch.match(/^\s*/)[0].length;
        const candidateIdx = matchRes.index + leadingSpace;
        if (isInsideLiteral(candidateIdx, getLiteralRanges(civetLineText))) {
          operatorRegex.lastIndex = candidateIdx + 1;
          continue; // skip match inside literal
        }
        foundIndex = candidateIdx;
        // Map only the non-whitespace alias characters so the end maps to the last letter, not the space.
        const aliasLen = trimmedText.length;
        return { startIndex: foundIndex, length: aliasLen };
      }
    }
  } else {
    if (debug) console.log(`[FIX_VERIFY] Using indexOf search for non-identifier token (kind: ${anchor.kind}).`);
    let idx = civetLineText.indexOf(searchText, searchFrom);
    // Allow string literals to be found even if they are inside a "literal range"
    if ((anchor.kind as string) !== 'stringLiteral') {
      while (idx !== -1 && isInsideLiteral(idx, getLiteralRanges(civetLineText))) {
        idx = civetLineText.indexOf(searchText, idx + 1);
      }
    }
    foundIndex = idx;
  }

  if (debug) {
    console.log(`[BUG_HUNT_RESULT] Final foundIndex for "${searchText}" is ${foundIndex}`);
  }

  if (foundIndex === -1) {
    return undefined;
  }

  // Note: for treatAsOperator we already returned from inside the branch when matched.
  const matchLength = searchText.length;
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
  operatorLookup: Record<string, string | string[]>,
  civetBlockStartLine: number,
  indentation: number,
  names: string[],
  DEBUG_DENSE_MAP: boolean,
  DEBUG_TOKEN: boolean
) {
  const decoded: number[][][] = [];
  const nextSearchIndexCache = new Map<string, number>();
  const claimedRangesByLine = new Map<number, { start: number; end: number }[]>();

  for (let i = 0; i < tsLines.length; i++) {
    const lineAnchors = anchorsByLine.get(i) || [];
    const lineSegments: number[][] = [];
    let lastGenCol = 0;

    for (let aIdx = 0; aIdx < lineAnchors.length; aIdx++) {
      let anchor = lineAnchors[aIdx];
      let searchTextOverride: string | undefined;
      let consumedAnchors = 0;

      // --- Lookahead for `unless` pattern: `if (!` ---
      if (anchor.kind === 'keyword' && anchor.text === 'if') {
        const nextAnchor = lineAnchors[aIdx + 1];
        const afterNextAnchor = lineAnchors[aIdx + 2];

        // Check for the `if (...)` part
        if (nextAnchor?.text === '(' && afterNextAnchor?.text === '!') {
            // It's an `if (!` sequence. Treat it as a single `unless` keyword.
            searchTextOverride = 'unless';
            // Create a new synthetic anchor that spans from the start of `if` to the end of `!`
            anchor = {
                ...anchor,
                end: afterNextAnchor.end,
                text: 'unless' // For debugging and clarity
            };
            consumedAnchors = 2; // We are consuming the `(` and `!` anchors now
        }
      }

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
      const opLookupVal = operatorLookup[anchor.text];
      const primaryOpAlias = pickFirstAlias(opLookupVal);
      const searchText = searchTextOverride ?? (anchor.kind === 'operator'
        ? (primaryOpAlias || anchor.text)
        : ((anchor.kind as string) === 'keyword' && primaryOpAlias !== undefined)
          ? primaryOpAlias
          : anchor.text);
      const cacheKey = `${civetLineIndex}:${searchText}`;
      let locationInfo;
      
      while (true) {
        const searchFrom = nextSearchIndexCache.get(cacheKey) ?? 0;
        locationInfo = locateTokenInCivetLine(anchor, civetLineText, operatorLookup, DEBUG_DENSE_MAP, searchFrom);

        if (locationInfo === undefined) {
          break; // no further occurrence found
        }

        const newStart = locationInfo.startIndex;
        const newEndExclusive = newStart + locationInfo.length;
        
        nextSearchIndexCache.set(cacheKey, newEndExclusive);

        const existingRanges = claimedRangesByLine.get(civetLineIndex) || [];
        const overlaps = existingRanges.some(r => newStart < r.end && newEndExclusive > r.start);
        
        if (!overlaps) {
          // Reserve this range and exit loop
          existingRanges.push({ start: newStart, end: newEndExclusive });
          claimedRangesByLine.set(civetLineIndex, existingRanges);
          break;
        }
      }

      if (locationInfo !== undefined) {
        const sourceSvelteLine = (civetBlockStartLine - 1) + civetLineIndex;
        const sourceSvelteStartCol = locationInfo.startIndex + indentation;
        const nameIdx = anchor.kind === 'identifier' ? names.indexOf(anchor.text) : -1;
        
        const tokenLength = locationInfo.length;
        const sourceSvelteEndColExclusive = sourceSvelteStartCol + tokenLength;

        // Add an edge mapping only for identifiers (multi-char) or multi-char tokens.
        const lastMappedChar = civetLineText[locationInfo.startIndex + tokenLength - 1];
        const genEdgeCol = anchor.end.character; // first char AFTER the token in TS
        if (
          (anchor.kind === 'identifier' || anchor.kind === 'numericLiteral' || tokenLength > 1) &&
          !(lastMappedChar === ' ' || lastMappedChar === '\t')
        ) {
        lineSegments.push([genEdgeCol, 0, sourceSvelteLine, sourceSvelteEndColExclusive]);
        }

        // Point 1: Map token start
        const startSegment: number[] = [anchor.start.character, 0, sourceSvelteLine, sourceSvelteStartCol];
        if (nameIdx > -1) startSegment.push(nameIdx);
        lineSegments.push(startSegment);
        
        let endSegment: number[] | undefined;
        // Point 1: Map token end (inclusive) to ensure full token coverage, but
        // only if the token spans more than one character. For single-character
        // tokens (like '=' or ';') the start and end columns are identical and
        // emitting both would create a duplicate segment.
        if (tokenLength > 1) {
          endSegment = [anchor.end.character - 1, 0, sourceSvelteLine, sourceSvelteEndColExclusive - 1];
        if (nameIdx > -1) endSegment.push(nameIdx);
        lineSegments.push(endSegment);
        }

        if (DEBUG_TOKEN && anchor.text === 'abc') {
            console.log(`\n[TOKEN_BOUNDARY_DEBUG] Token '${anchor.text}':`);
            console.log(`- TS Start: ${anchor.start.character}, End: ${anchor.end.character}`);
            console.log(`- Svelte Start: ${sourceSvelteStartCol}, End: ${sourceSvelteEndColExclusive}`);
            console.log(`- Generated segments: ${JSON.stringify([startSegment, endSegment ?? [], [genEdgeCol]])}\n`);
        }
      } else {
        // Could not find in original line, treat as generated.
        if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] Could not find '${anchor.text}' in Civet line, null mapping at ${i}:${anchor.start.character}`);
        lineSegments.push([anchor.start.character]);
      }

      lastGenCol = anchor.end.character;
      aIdx += consumedAnchors; // Advance index to skip processed anchors
    }

    // --- Fill final gap from last token to end of line ---
    if (lastGenCol < tsLines[i].length) {
      if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] EOL Gap filler at ${i}:${lastGenCol} to EOL`);
      lineSegments.push([lastGenCol]);
    }

    // Sort by generated column and deduplicate identical segments (same genCol & mapping)
    const sorted = lineSegments.sort((a, b) => a[0] - b[0]);
    const deduped: number[][] = [];
    const seen = new Set<string>();
    for (const seg of sorted) {
      const key = seg.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(seg);
    }
    }
    decoded.push(deduped);
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
  const operatorLookup: Record<string, string | string[]> = {
    '=': '=',
    '===': ' is ',
    // `!==` can originate from both `isnt` _and_ `is not` in Civet.
    '!==': [' isnt ', ' is not '],
    '&&':  ' and ',
    '||':  ' or ',
    '!':   'not ',
    // --- Keyword override entries (Hybrid strategy) -------------------------
    // These map TS keywords back to their Civet equivalents so that the
    // normalizer can treat them like "pseudo-operators" when looking up the
    // original source location.
    //   let       -> .=
    //   const     -> :=
    //   function  -> ->
    // New keyword-operator aliases can be added here without touching the
    // rest of the normalization logic.
    'let': '.=',
    'const': ':=',
    'function': '->',
    'unless': 'unless'
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
