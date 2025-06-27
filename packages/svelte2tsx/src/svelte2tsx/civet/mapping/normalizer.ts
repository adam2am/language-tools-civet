import { GenMapping, toEncodedMap, addMapping, setSourceContent } from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import { Anchor, collectAnchorsFromTs } from './tsAnchorCollector';
import { decode } from '@jridgewell/sourcemap-codec';

// Define local types to avoid dependency issues
export interface SvelteFile {
    getText(): string;
    filename: string;
}
export type CivetCompileOptions = Record<string, any>;

const DEBUG_DENSE_MAP = false;
const logFullDenseMap = (..._args: any[]) => {}; // No-op for now

function locateTokenInCivetLine(
  civetLineText: string,
    searchText: string,
    kind: Anchor['kind'],
    consumedCount: number
): number | undefined {
  let foundIndex = -1;
    let searchOffset = 0;

    for (let i = 0; i <= consumedCount; i++) {
        if (kind === 'identifier') {
            const regex = new RegExp(`(?<![\\p{L}\\p{N}_$])${searchText}(?![\\p{L}\\p{N}_$])`, 'u');
            const match = civetLineText.substring(searchOffset).match(regex);
            if (match) {
                foundIndex = (match.index ?? 0) + searchOffset;
                searchOffset = foundIndex + match[0].length;
            } else {
        foundIndex = -1;
        break;
      }
        } else {
            const index = civetLineText.indexOf(searchText, searchOffset);
            if (index !== -1) {
                foundIndex = index;
                searchOffset = index + searchText.length;
            } else {
        foundIndex = -1;
        break;
      }
        }
  }

  return foundIndex !== -1 ? foundIndex : undefined;
}

export function normalize(
    civetMap: any,
    tsCode: string,
    svelteFile: SvelteFile,
    _options: CivetCompileOptions,
    civetContentStartLine: number,
    indentLen: number,
): EncodedSourceMap {
    // --- Start of logging additions ---
    const log = (msg: string) => console.log(`[MAP_DEBUG] ${msg}`);
    const tsxLinesForLog = tsCode.split('\n');
    const problemLineIdx = tsxLinesForLog.findIndex(l => l.includes('if (abc === query)'));
    const shouldLog = problemLineIdx !== -1;

    if (shouldLog) log('Normalization started for file with "abc = if..."');
    // --- End of logging additions ---

    if (!civetMap) {
        return {
            version: 3,
            file: svelteFile.filename,
            sources: [],
            sourcesContent: [],
            mappings: '',
            names: [],
        };
    }

    const civetSource = svelteFile.filename;
    const civetContent = civetMap.source || '';

    const civetLines = civetContent.split('\n');
    
    const anchors = collectAnchorsFromTs(tsCode, svelteFile.filename);

    if (shouldLog) {
        log(`Found ${anchors.length} anchors. Anchors on problem line (${problemLineIdx + 1}):`);
        anchors.forEach(a => {
            if (a.start.line === problemLineIdx) {
                log(`  - "${a.text}" (kind: ${a.kind}) at col ${a.start.character}`);
            }
        });
    }

    // Prepare helper structures for pruning unwanted mappings
    const skipColumnsByLine = new Map<number, Set<number>>();
    const tsLines = tsCode.split('\n');

    // --- Filter out compiler-generated identifiers ---
    const generatedIdentifiers = new Set<string>();
    const civetCodeText = civetLines.join('\n');
    for (const anchor of anchors) {
        if (anchor.kind === 'identifier') {
    if (anchor.text.length === 1 && /^[ijkn]$/.test(anchor.text)) {
      generatedIdentifiers.add(anchor.text);

                // Record columns for this generated identifier before continuing
                const { line: genLine, character: genCol } = anchor.start;
                let cols = skipColumnsByLine.get(genLine);
                if (!cols) {
                    cols = new Set<number>();
                    skipColumnsByLine.set(genLine, cols);
                }
                cols.add(genCol);
                // Preceding whitespace
                if (genCol > 0 && /\s/.test(tsLines[genLine]?.[genCol - 1] || '')) {
                    cols.add(genCol - 1);
                }
                // Trailing whitespace
                if (/\s/.test(tsLines[genLine]?.[genCol + 1] || '')) {
                    cols.add(genCol + 1);
                }

      continue;
    }
    const escapedText = anchor.text.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&');
    const wordRegex = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapedText}(?![\\p{L}\\p{N}_$])`, 'u');
            if (!wordRegex.test(civetCodeText)) {
      generatedIdentifiers.add(anchor.text);
            }

            // Record columns of generated identifiers (and surrounding whitespace) to prune
            const { line: genLine, character: genCol } = anchor.start;
            let cols = skipColumnsByLine.get(genLine);
            if (!cols) {
                cols = new Set<number>();
                skipColumnsByLine.set(genLine, cols);
            }
            for (let i = 0; i < anchor.text.length; i++) {
                cols.add(genCol + i);
            }
            // Include preceding whitespace if present
            if (genCol > 0 && /\s/.test(tsLines[genLine]?.[genCol - 1] || '')) {
                cols.add(genCol - 1);
            }
            // Include trailing whitespace if present
            const afterIdx = genCol + anchor.text.length;
            if (/\s/.test(tsLines[genLine]?.[afterIdx] || '')) {
                cols.add(afterIdx);
            }
        }
    }

    // ----------------------------------------------------------------------------
    // Seed phase: create a GenMapping either from standard V3 map or raw `lines`
    // ----------------------------------------------------------------------------
    // Track which generated positions we have already seeded to avoid duplicates that
    // could cause "bleed" (multiple Civet columns mapping to the same TS position).
    const usedGenPositions = new Map<number, Set<number>>();

    let gen: GenMapping;
    if (typeof civetMap.mappings === 'string') {
        // Standard V3 map – manually seed to allow pruning of generated identifiers
        gen = new GenMapping();
        setSourceContent(gen, civetSource, civetContent);

        const decoded = decode(civetMap.mappings);

        if (shouldLog) {
            log('Seeding from standard V3 map.');
            if (problemLineIdx < decoded.length) {
                const problemLineRawSegs = decoded[problemLineIdx];
                log(`Raw segments for TSX line ${problemLineIdx + 1} (len ${problemLineRawSegs?.length}): ${JSON.stringify(problemLineRawSegs)}`);
            }
        }

        // First pass: seed all segments from raw map except those we'll overwrite
        decoded.forEach((lineSegs: number[][], tsLineIdx: number) => {
            lineSegs.forEach((seg) => {
                if (seg.length >= 4) {
                    const [genCol, , srcLine0, srcCol0] = seg;
                    const skipCols = skipColumnsByLine.get(tsLineIdx);
                    if (skipCols && skipCols.has(genCol)) {
                        if (shouldLog && tsLineIdx === problemLineIdx) {
                            log(`    [SEED] Skipping genCol ${genCol} on TSX L${tsLineIdx+1} due to generated-identifier prune`);
                        }
                        return; // prune
                    }

                    const ch = tsLines[tsLineIdx]?.[genCol] || '';
                    const isWs = /\s/.test(ch);

                    let usedCols = usedGenPositions.get(tsLineIdx);
                    if (!usedCols) {
                        usedCols = new Set<number>();
                        usedGenPositions.set(tsLineIdx, usedCols);
                    }

                    // Stricter: only allow the first mapping to a genCol, null-map the rest
                    if (!isWs && usedCols.has(genCol)) {
                        // Instead of mapping, add a null mapping for this generated position
                        addMapping(gen, {
                            generated: { line: tsLineIdx + 1, column: genCol }
                        });
                        return;
                    }
                    if (!isWs) usedCols.add(genCol);

                    if (isWs) {
                        // Skip seeding whitespace – will add explicit null mapping later
                        if (shouldLog && tsLineIdx === problemLineIdx) {
                            log(`    [SEED] Skipping initial whitespace mapping for genCol ${genCol} on TSX L${tsLineIdx+1}`);
                        }
                    } else {
                        addMapping(gen, {
                            generated: { line: tsLineIdx + 1, column: genCol },
                            source: civetSource,
                            original: { line: srcLine0 + 1, column: srcCol0 },
                            name: undefined // Explicitly clear name for raw map segments
                        });
                    }
                }
            });
        });
    } else if (Array.isArray(civetMap.lines)) {
        // Raw Civet `lines` map – seed manually
        gen = new GenMapping();
        setSourceContent(gen, civetSource, civetContent);

        civetMap.lines.forEach((lineSegs: number[][], tsLineIdx: number) => {
            lineSegs.forEach((seg) => {
                if (seg.length >= 4) {
                    const [genCol, , srcLine0, srcCol0] = seg;
                    const skipCols = skipColumnsByLine.get(tsLineIdx);
                    if (skipCols && skipCols.has(genCol)) {
                        if (shouldLog && tsLineIdx === problemLineIdx) {
                            log(`    [SEED-RAW] Skipping genCol ${genCol} on TSX L${tsLineIdx+1} due to generated-identifier prune`);
                        }
                        return; // prune
                    }

                    const ch = tsLines[tsLineIdx]?.[genCol] || '';
                    const isWs = /\s/.test(ch);

                    let usedCols = usedGenPositions.get(tsLineIdx);
                    if (!usedCols) {
                        usedCols = new Set<number>();
                        usedGenPositions.set(tsLineIdx, usedCols);
                    }

                    // --- FIRST-WINS LOGIC: Only map the first Civet source to each TSX position ---
                    if (usedCols.has(genCol)) {
                        if (shouldLog && tsLineIdx === problemLineIdx) {
                            log(`[PRUNE_DEBUG] SKIPPING mapping to already-used TSX L${tsLineIdx+1}:C${genCol}. Raw source was L${srcLine0+1}:C${srcCol0}.`);
                        }
                        return;
                    }
                    usedCols.add(genCol);
                    addMapping(gen, {
                        generated: { line: tsLineIdx + 1, column: genCol },
                        source: civetSource,
                        original: { line: srcLine0 + 1, column: srcCol0 },
                        name: undefined
                    });
                }
            });
        });
    } else {
        // Fallback: empty GenMapping
        gen = new GenMapping();
        setSourceContent(gen, civetSource, civetContent);
    }

    const tsLineToCivetLineMap = new Map<number, number>();
    if (civetMap.mappings) {
        const decoded = typeof civetMap.mappings === 'string' ? decode(civetMap.mappings) : civetMap.mappings;
        decoded.forEach((line: any[], tsLineIdx: number) => {
            for (const seg of line) {
                if (seg.length >= 4) {
                    tsLineToCivetLineMap.set(tsLineIdx, seg[2]);
                    return;
                }
            }
        });
    } else if (Array.isArray(civetMap.lines)) {
        civetMap.lines.forEach((lineSegs: number[][], tsLineIdx: number) => {
            for (const seg of lineSegs) {
                if (seg.length >= 4) {
                    tsLineToCivetLineMap.set(tsLineIdx, seg[2]);
                    return;
                }
            }
        });
    }

    // Second pass: process anchors to overwrite identifier mappings with precise character positions
  const consumedMatchCount = new Map<string, number>();

    for (const anchor of anchors) {
        const { line: genLine, character: genCol } = anchor.start;

        if (generatedIdentifiers.has(anchor.text)) {
            // For generated identifiers like loop variable "i" or keywords like 'let', 'const', etc., ensure that both the identifier
            // itself and the whitespace directly surrounding it do NOT map back to Civet.
            // We do this by explicitly adding mappings that point to { line: -1, column: -1 } which
            // SourceMap consumers interpret as "no mapping".

            const lineText = tsLines[genLine] || '';

            // Overwrite the identifier characters with an explicit null mapping
            for (let i = 0; i < anchor.text.length; i++) {
                addMapping(gen, {
                    generated: { line: genLine + 1, column: genCol + i }
                });
            }

            // Also overwrite the immediate preceding whitespace so that a test which
            // probes the string " i " does not pick up an old mapping.
            if (genCol > 0 && /\s/.test(lineText[genCol - 1])) {
                addMapping(gen, {
                    generated: { line: genLine + 1, column: genCol - 1 }
                });
            }

            // And the whitespace right after the identifier, if any.
            const afterIdx = genCol + anchor.text.length;
            if (afterIdx < lineText.length && /\s/.test(lineText[afterIdx])) {
                addMapping(gen, {
                    generated: { line: genLine + 1, column: afterIdx }
                });
            }

            continue;
        }

        // Only process identifier anchors - let raw map handle operators and whitespace
        if (anchor.kind !== 'identifier') continue;

        const civetLineIndex = tsLineToCivetLineMap.get(genLine);
        if (civetLineIndex === undefined) continue;

        const civetLineText = civetLines[civetLineIndex];
        const searchText = anchor.text;
        const cacheKey = `${civetLineIndex}:${searchText}`;
        const consumedCount = consumedMatchCount.get(cacheKey) || 0;

        const civetColumn = locateTokenInCivetLine(civetLineText, searchText, anchor.kind, consumedCount);
        if (civetColumn === undefined) continue;

        if (shouldLog && genLine === problemLineIdx) {
            const origLine = civetLineIndex + civetContentStartLine -1;
            const origCol = civetColumn + indentLen;
            log(`Processing anchor "${anchor.text}" (kind: ${anchor.kind}) on problem line.`);
            log(`  TSX Pos: L${genLine + 1}:C${genCol}`);
            log(`  Mapped to Civet: L${origLine + 1}:C${origCol}`);
        }

        consumedMatchCount.set(cacheKey, consumedCount + 1);

        const { text } = anchor;
        const origLine = civetLineIndex + civetContentStartLine -1;
        const origCol = civetColumn + indentLen;

        // For identifiers, we want precise per-character mappings
        for (let i = 0; i < text.length; i++) {
            if (shouldLog && genLine === problemLineIdx) {
                log(`    -> Overwriting TSX L${genLine + 1}:C${genCol + i}  ==>  Svelte L${origLine + 1}:C${origCol + i}`);
            }
            addMapping(gen, {
                generated: { line: genLine + 1, column: genCol + i },
                source: civetSource,
                original: { line: origLine + 1, column: origCol + i },
                name: anchor.text
            });
        }

        const lineText = tsLines[genLine] || '';
        // After the identifier: map the next symbol (whitespace, comma, semicolon, etc.) to the next Svelte column if available
        const afterIdx = genCol + text.length;
        const origAfterIdx = origCol + text.length;
        if (afterIdx < lineText.length) {
            addMapping(gen, {
                generated: { line: genLine + 1, column: afterIdx },
                source: civetSource,
                original: { line: origLine + 1, column: origAfterIdx },
                name: undefined
            });
        }
      }

    // ---------------------------------------------------------------------
    // Final pass: Insert explicit null mappings for characters
    // that still do not have a mapping. This prevents range-bleed where the
    // mapping of a preceding token continues over trailing whitespace or operators.
    // ---------------------------------------------------------------------
    tsLines.forEach((lineText, tsLineIdx) => {
        let usedCols = usedGenPositions.get(tsLineIdx);
        if (!usedCols) {
            usedCols = new Set<number>();
            usedGenPositions.set(tsLineIdx, usedCols);
        }

        for (let col = 0; col < lineText.length; col++) {
            const ch = lineText[col];
            if (usedCols.has(col)) continue; // already mapped

            addMapping(gen, {
                generated: { line: tsLineIdx + 1, column: col }
            });
            if (shouldLog && tsLineIdx === problemLineIdx) {
                log(`    [NULL-MAP] Added null mapping for unmapped TSX L${tsLineIdx+1}:C${col}`);
            }
            usedCols.add(col);
        }
    });

    const map = toEncodedMap(gen);
    map.sourcesContent = civetMap.sourcesContent;

    // === FINAL DEDUPLICATION SWEEP ===
    // For each generated (line, column), keep only the first mapping; null-map the rest
    if (map.mappings && Array.isArray(map.mappings)) {
        // Defensive: if already decoded
        const seen = new Set<string>();
        for (let lineIdx = 0; lineIdx < map.mappings.length; lineIdx++) {
            const line = map.mappings[lineIdx];
            if (!Array.isArray(line)) continue;
            for (let i = 0; i < line.length; i++) {
                const seg = line[i];
                if (seg.length < 1) continue;
                const genCol = seg[0];
                const key = `${lineIdx}:${genCol}`;
                if (seen.has(key)) {
                    // Null-map: keep only the generated position
                    map.mappings[lineIdx][i] = [genCol];
                } else {
                    seen.add(key);
                }
            }
        }
    } else if (typeof map.mappings === 'string') {
        // If still encoded, decode, deduplicate, then re-encode
        const { decode, encode } = require('@jridgewell/sourcemap-codec');
        let decoded = decode(map.mappings);
        const seen = new Set<string>();
        for (let lineIdx = 0; lineIdx < decoded.length; lineIdx++) {
            const line = decoded[lineIdx];
            for (let i = 0; i < line.length; i++) {
                const seg = line[i];
                if (seg.length < 1) continue;
                const genCol = seg[0];
                const key = `${lineIdx}:${genCol}`;
                if (seen.has(key)) {
                    // Null-map: keep only the generated position
                    decoded[lineIdx][i] = [genCol];
                } else {
                    seen.add(key);
                }
            }
        }
        map.mappings = encode(decoded);
    }

    if (DEBUG_DENSE_MAP) {
      logFullDenseMap(map, tsCode, civetContent);
    }

    return map;
}
