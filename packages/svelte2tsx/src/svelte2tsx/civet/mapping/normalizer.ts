import { GenMapping, setSourceContent, addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
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
): number | undefined {
  const searchText = anchor.kind === 'operator' ? (operatorLookup[anchor.text] || anchor.text) : anchor.text;
  let foundIndex = -1;

  if (debug) {
    console.log(`[BUG_HUNT] Searching for "${searchText}" (anchor: "${anchor.text}", kind: ${anchor.kind}). Consumed: ${consumedCount}. Line content: "${civetLineText}"`);
  }

  if (anchor.kind === 'identifier') {
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
    const operatorRegex = new RegExp(`\\s*${searchText.trim()}\\s*`, 'g');
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

  return foundIndex !== -1 ? foundIndex : undefined;
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

const DEBUG_DENSE_MAP = true; // Toggle for verbose dense-map generation logs (disabled for production)

export function buildDenseMapLines(
  tsLines: string[],
  anchorsByLine: Map<number, Anchor[]>,
  generatedIdentifiers: Set<string>,
  tsLineToCivetLineMap: Map<number, number>,
  civetCodeLines: string[],
  operatorLookup: Record<string, string>,
  civetBlockStartLine: number,
  indentation: number,
  names: string[],
  DEBUG_TOKEN: boolean
) {
  const decoded: number[][][] = [];
  const consumedMatchCount = new Map<string, number>();

  for (let i = 0; i < tsLines.length; i++) {
    const lineAnchors = anchorsByLine.get(i) || [];
    const lineSegments: number[][] = [];
    let lastGenCol = 0;

    for (const anchor of lineAnchors) {
      if (DEBUG_DENSE_MAP) {
        const nameIdxForLog = anchor.kind === 'identifier' ? names.indexOf(anchor.text) : -1;
        console.log(`\n[ANCHOR_PROCESS] Line ${i}, Col ${anchor.start.character}: Processing anchor text='${anchor.text}', kind='${anchor.kind}'. Name index: ${nameIdxForLog}`);
        if (anchor.kind === 'identifier' && nameIdxForLog === -1) {
          console.log(`[ANCHOR_WARN] Identifier '${anchor.text}' was not found in the 'names' array. It will not be mapped with a name.`)
        }
      }

      // --- Determine mapping for the current token ---
      let isGenerated = false;
      if (anchor.kind === 'identifier' && generatedIdentifiers.has(anchor.text)) {
        isGenerated = true;
      }

      if (isGenerated) {
        if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] Generated token '${anchor.text}' at ${i}:${anchor.start.character}`);
        lineSegments.push([anchor.start.character]);
        lastGenCol = anchor.end.character;
        if (DEBUG_DENSE_MAP) console.log(`[RANGE_DEBUG] GEN-TOKEN: anchor='${anchor.text}', start=${anchor.start.character}, end=${anchor.end.character}. Updated lastGenCol to ${lastGenCol}.`);
        continue;
      }

      // It's not a known generated token, so try to find its original position.
      const civetLineIndex = tsLineToCivetLineMap.get(i);
      if (civetLineIndex === undefined) {
        if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] No civet line for TS line ${i}, null mapping token '${anchor.text}'`);
        lineSegments.push([anchor.start.character]);
        lastGenCol = anchor.end.character;
        continue;
      }

      const civetLineText = civetCodeLines[civetLineIndex] || '';
      const searchText = anchor.kind === 'operator' ? (operatorLookup[anchor.text] || anchor.text) : anchor.text;
      const cacheKey = `${civetLineIndex}:${searchText}`;
      const consumedCount = consumedMatchCount.get(cacheKey) || 0;
      
      const civetColumn = locateTokenInCivetLine(anchor, civetLineText, consumedCount, operatorLookup, DEBUG_DENSE_MAP);

      if (civetColumn !== undefined) {
        consumedMatchCount.set(cacheKey, consumedCount + 1);
      }

      if (civetColumn !== undefined) {
        const sourceSvelteLine = (civetBlockStartLine - 1) + civetLineIndex;
        const sourceSvelteStartCol = civetColumn + indentation;
        const nameIdx = anchor.kind === 'identifier' ? names.indexOf(anchor.text) : -1;
        
        const startSegment = [anchor.start.character, 0, sourceSvelteLine, sourceSvelteStartCol];
        if (nameIdx > -1) {
            startSegment.push(nameIdx);
        }
        lineSegments.push(startSegment);
        
        // Add a null mapping for the whitespace after the token
        lineSegments.push([anchor.end.character]);

        if (DEBUG_TOKEN && anchor.text === 'abc') {
            console.log(`\n[TOKEN_BOUNDARY_DEBUG] Token '${anchor.text}':`);
            console.log(`- Token length: ${anchor.text.length}`);
            console.log(`- TS Start: Column ${anchor.start.character}`);
            console.log(`- Svelte Start: Column ${sourceSvelteStartCol}`);
            console.log(`- Null whitespace mapping: [${anchor.end.character}]`);
            console.log(`- Generated segments: ${JSON.stringify([startSegment, [anchor.end.character]])}\n`);
        }
      } else {
        // Could not find in original line, treat as generated.
        if (DEBUG_DENSE_MAP) console.log(`[DENSE_MAP_NULL] Could not find '${anchor.text}' in Civet line, null mapping at ${i}:${anchor.start.character}`);
        lineSegments.push([anchor.start.character]);
      }

      lastGenCol = anchor.end.character;
      if (DEBUG_DENSE_MAP) console.log(`[RANGE_DEBUG] USER-TOKEN: anchor='${anchor.text}', start=${anchor.start.character}, end=${anchor.end.character}, finalEndCol=${anchor.end.character}. Updated lastGenCol to ${lastGenCol}.`);
    }

    if (lineSegments.length > 0) {
      if (DEBUG_DENSE_MAP) console.log(`[DENSE_LINE_DONE] Final segments for TS line ${i}: ${JSON.stringify(lineSegments)}`);
      decoded.push(lineSegments);
    } else {
      // For completely empty lines, push an empty segment array
      decoded.push([]);
    }
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

  // ------------------------ NEW GEN-MAPPING IMPLEMENTATION ------------------------
  const gen = new GenMapping({ file: svelteFilePath });
  setSourceContent(gen, svelteFilePath, svelteFileContent);

  const civetCodeLines = (civetMap.source || '').split('\n');
  const tsLines = tsCode.split('\n');

  const {
    tsLineToCivetLineMap,
    generatedIdentifiers,
    anchorsByLine,
    names
  } = buildLookupTables(tsAnchors, civetMap, civetCodeLines);

  // Iterate over each TS line and its anchors to build mappings
  for (let tsLineIdx = 0; tsLineIdx < tsLines.length; tsLineIdx++) {
    const lineAnchors = anchorsByLine.get(tsLineIdx) || [];
    for (let j = 0; j < lineAnchors.length; j++) {
      const anchor = lineAnchors[j];

      if (DEBUG_DENSE_MAP) {
        const nameIdxForLog = anchor.kind === 'identifier' ? anchor.text : '-';
        console.log(`\n[TOKEN_MAP] Line ${tsLineIdx}, Col ${anchor.start.character}:`);
        console.log(`- Token: '${anchor.text}' (${anchor.kind})`);
        console.log(`- Name: ${nameIdxForLog}`);
      }

      // Determine if the identifier is compiler generated
      const isGenerated = anchor.kind === 'identifier' && generatedIdentifiers.has(anchor.text);

      if (DEBUG_DENSE_MAP && isGenerated) {
        console.log(`- Status: Generated token`);
      }

      // Find corresponding Civet position if not generated
      let origLine: number | undefined;
      let origCol: number | undefined;
      if (!isGenerated) {
        const civetLineIndex = tsLineToCivetLineMap.get(tsLineIdx);
        if (civetLineIndex !== undefined) {
          const civetLineText = civetCodeLines[civetLineIndex] || '';
          const civetColumn = locateTokenInCivetLine(
            anchor,
            civetLineText,
            0,
            operatorLookup,
            false
          );
          if (civetColumn !== undefined) {
            origLine = (civetBlockStartLine - 1) + civetLineIndex; // 0-based
            origCol = civetColumn + indentation;

            if (DEBUG_DENSE_MAP) {
              console.log(`- Mapped to: Line ${origLine + 1}, Col ${origCol}`);
              console.log(`- Original context: "${civetLineText.trim()}"`);
            }
          } else if (DEBUG_DENSE_MAP) {
            console.log(`- Status: Not found in source`);
          }
        } else if (DEBUG_DENSE_MAP) {
          console.log(`- Status: No corresponding Civet line`);
        }
      }

      // 1) Mapping at the start of the token
      addMapping(gen, {
        generated: { line: tsLineIdx + 1, column: anchor.start.character },
        source: origLine !== undefined ? svelteFilePath : undefined,
        original:
          origLine !== undefined ? { line: origLine + 1, column: origCol! } : undefined,
        name: origLine !== undefined && anchor.kind === 'identifier' ? anchor.text : undefined,
      });

      if (DEBUG_DENSE_MAP) {
        console.log(`- Mapping: ${JSON.stringify({
          gen: { line: tsLineIdx + 1, col: anchor.start.character },
          orig: origLine !== undefined ? { line: origLine + 1, col: origCol } : 'null',
          name: origLine !== undefined && anchor.kind === 'identifier' ? anchor.text : undefined
        })}`);
      }

      // 2) Null-mapping at the first column *after* the token, but only if there's
      //    actual whitespace before the next token.
      const nextAnchorStart = j + 1 < lineAnchors.length ? lineAnchors[j + 1].start.character : undefined;
      if (nextAnchorStart === undefined || anchor.end.character < nextAnchorStart) {
        addMapping(gen, {
          generated: { line: tsLineIdx + 1, column: anchor.end.character },
        });
      }
    }
  }

  const finalMap = toEncodedMap(gen) as EncodedSourceMap;

  if (DEBUG_DENSE_MAP) {
    // Create a structured view of all mappings
    const decodedStructure = tsLines.map((_, lineIdx) => {
      const lineAnchors = anchorsByLine.get(lineIdx) || [];
      return lineAnchors.map(anchor => {
        const civetLineIndex = tsLineToCivetLineMap.get(lineIdx);
        const isGenerated = anchor.kind === 'identifier' && generatedIdentifiers.has(anchor.text);
        const origLine = !isGenerated && civetLineIndex !== undefined ? 
          (civetBlockStartLine - 1) + civetLineIndex : undefined;
        const origCol = origLine !== undefined ? 
          locateTokenInCivetLine(anchor, civetCodeLines[civetLineIndex!] || '', 0, operatorLookup, false) : undefined;

        return {
          token: anchor.text,
          kind: anchor.kind,
          genLine: lineIdx + 1,
          genCol: anchor.start.character,
          origLine: origLine !== undefined ? origLine + 1 : null,
          origCol: origCol !== undefined ? origCol + indentation : null,
          name: origLine !== undefined && anchor.kind === 'identifier' ? anchor.text : null
        };
      });
    });

    console.log('\n=== FULL MAPPING STRUCTURE ===');
    decodedStructure.forEach((line, idx) => {
      if (line.length > 0) {
        console.log(`\nLine ${idx + 1} Mappings:`);
        console.log(JSON.stringify(line, null, 2));
      }
    });

    // Show compact line-by-line structure
    console.log('\n=== COMPACT LINE STRUCTURE ===');
    decodedStructure.forEach((line, idx) => {
      const segments = line.map(m => 
        `[${m.token}${m.origLine ? `->${m.origLine}:${m.origCol}` : '->null'}]`
      );
      if (segments.length > 0) {
        console.log(`Line ${idx + 1}: ${segments.join(' ')}`);
      }
    });

    // Add raw decoded segments view
    console.log('\n=== RAW DECODED SEGMENTS ===');
    const rawSegments = tsLines.map((_, lineIdx) => {
      const lineAnchors = anchorsByLine.get(lineIdx) || [];
      const segments: number[][] = [];
      
      lineAnchors.forEach(anchor => {
        const civetLineIndex = tsLineToCivetLineMap.get(lineIdx);
        const isGenerated = anchor.kind === 'identifier' && generatedIdentifiers.has(anchor.text);
        
        if (isGenerated) {
          segments.push([anchor.start.character]);
        } else if (civetLineIndex !== undefined) {
          const origCol = locateTokenInCivetLine(anchor, civetCodeLines[civetLineIndex] || '', 0, operatorLookup, false);
          if (origCol !== undefined) {
            const origLine = (civetBlockStartLine - 1) + civetLineIndex;
            const nameIdx = anchor.kind === 'identifier' ? names.indexOf(anchor.text) : -1;
            const segment = [
              anchor.start.character,
              0,
              origLine,
              origCol + indentation
            ];
            if (nameIdx !== -1) {
              segment.push(nameIdx);
            }
            segments.push(segment);
          } else {
            segments.push([anchor.start.character]);
          }
        } else {
          segments.push([anchor.start.character]);
        }
        
        // Add terminator segment
        segments.push([anchor.end.character]);
      });
      
      return segments;
    });

    rawSegments.forEach((line, idx) => {
      if (line.length > 0) {
        console.log(`Line ${idx + 1}: ${line.map(seg => JSON.stringify(seg)).join(' ')}`);
      }
    });
  }

  return finalMap;
}
