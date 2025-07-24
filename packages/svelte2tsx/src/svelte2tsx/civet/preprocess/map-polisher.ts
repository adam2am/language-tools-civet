import { decode, encode } from '@jridgewell/sourcemap-codec';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
// Lightweight on-demand use of the TypeScript compiler API for deep inspection
import ts from 'typescript';

type DecodedMap = ReturnType<typeof decode>;

type SourceMap = {
    version: 3;
    sources: string[];
    names: string[];
    mappings: string;
    file: string;
    sourcesContent?: string[];
};

// ---------------------------------------------------------------------------
//  AST helpers (only invoked on the rare "couldn't map" edge-cases)
// ---------------------------------------------------------------------------

// Cache parsed SourceFiles by the *exact* TS code string so we parse once per file.
const sourceFileCache = new Map<string, ts.SourceFile>();

function getOrCreateSourceFile(tsCode: string): ts.SourceFile {
    let sf = sourceFileCache.get(tsCode);
    if (!sf) {
        sf = ts.createSourceFile('generated.ts', tsCode, ts.ScriptTarget.Latest, /*setParentNodes*/ false);
        sourceFileCache.set(tsCode, sf);
    }
    return sf;
}

function identifierAt(sf: ts.SourceFile, line: number, col: number): string | null {
    const pos = sf.getPositionOfLineAndCharacter(line, col);

    // Walk the tree to find the smallest node that contains the position
    let found: ts.Node | undefined;
    const visit = (node: ts.Node) => {
        if (pos >= node.getFullStart() && pos < node.getEnd()) {
            ts.forEachChild(node, visit);
            if (!found) {
                found = node;
            }
        }
    };
    visit(sf);

    if (found && ts.isIdentifier(found)) {
        const { line: startLine, character: startChar } = sf.getLineAndCharacterOfPosition(found.getStart(sf));
        const { line: endLine, character: endChar } = sf.getLineAndCharacterOfPosition(found.getEnd());
        if (line === startLine && col >= startChar && (line === endLine ? col < endChar : true)) {
            return found.getText(sf);
        }
    }
    return null;
}

function findAstGuidedMapping(
    genLine: number,
    genCol: number,
    civetLines: string[],
    decoded: DecodedMap,
    sourceFile: ts.SourceFile
) {
    const ident = identifierAt(sourceFile, genLine, genCol);
    if (!ident) return null;

    // Use neighbouring mapping as search hint (same strategy as heuristic 1a)
    const hint = findLastMappingOnLineBefore(genLine, genCol, decoded) ??
                 findFirstMappingOnLineAfter(genLine, genCol, decoded);

    const searchRadius = 5;
    if (hint) {
        for (let i = 0; i <= searchRadius; i++) {
            const up = hint.originalLine - i;
            if (up >= 0) {
                const col = civetLines[up].indexOf(ident);
                if (col !== -1) return { line: up, column: col };
            }
            const down = hint.originalLine + i;
            if (i && down < civetLines.length) {
                const col = civetLines[down].indexOf(ident);
                if (col !== -1) return { line: down, column: col };
            }
        }
    }

    // Fallback: global search (last resort)
    for (let i = 0; i < civetLines.length; i++) {
        const col = civetLines[i].indexOf(ident);
        if (col !== -1) return { line: i, column: col };
    }

    return null;
}

function withStringHelpers<T extends { file?: string }>(map: T): T & { file: string; toString(): string; toUrl(): string } {
    const m: any = map;
    if (!('file' in m) || m.file == null) {
        m.file = '';
    }
    if (typeof m.toString !== 'function') {
        m.toString = function () { return JSON.stringify(this); };
    }
    if (typeof m.toUrl !== 'function') {
        m.toUrl = function () { return 'data:application/json;charset=utf-8,' + encodeURIComponent(this.toString()); };
    }
    return m;
}

// --- LOGGING CONTROL FOR PLAYTESTING ---
const LOGS_ENABLED = true; // Set to false to disable all logs
function logPM(marker: string, msg: string) {
    if (LOGS_ENABLED) {
        // marker: e.g. *PM01* map-polisher.ts 150
        console.log(`${marker} map-polisher.ts`, msg);
    }
}

// ---------------------------------------------------------------------------
//  Source-map helpers (ported from ts-diagnostic.civet)
// ---------------------------------------------------------------------------

// Using the same tuple-shape that @jridgewell/sourcemap-codec returns.
type SourceMapping = [number] | [number, number, number, number];
export type SourcemapLines = SourceMapping[][];

export interface Position {
    line: number;
    character: number;
}
export interface Range {
    start: Position;
    end: Position;
}

/**
 * Reverse-map a position in generated TS back to Civet source coordinates.
 * Mirrors the algorithm in ts-diagnostic.civet – see that file for details.
 */
export function remapPosition(position: Position, sourcemapLines?: SourcemapLines): Position {
    if (!sourcemapLines) {
        // *MP01* No sourcemap provided -> passthrough
        logPM('*MP01*', '[remapPosition] No sourcemap; returning input position');
        return position;
    }

    const { line, character } = position;
    const textLine = sourcemapLines[line];
    if (!textLine?.length) {
        // *MP02* Line outside map -> passthrough
        logPM('*MP02*', `[remapPosition] No mappings for line ${line}`);
        return position;
    }

    let i = 0, p = 0, lastMapping: SourceMapping | undefined, lastMappingPos = 0;
    while (i < textLine.length) {
        const mapping = textLine[i]!;
        p += mapping[0]!;
        if (mapping.length === 4) {
            lastMapping = mapping;
            lastMappingPos = p;
        }
        if (p >= character) break;
        i++;
    }

    if (lastMapping) {
        const [, , srcLine, srcChar] = lastMapping as [number, number, number, number];
        const newChar = srcChar + character - lastMappingPos;
        const mapped: Position = { line: srcLine, character: newChar };
        logPM('*MP03*', `[remapPosition] Mapped (${line},${character}) -> (${mapped.line},${mapped.character})`);
        return mapped;
    }

    // Fallback – no suitable mapping; keep original
    logPM('*MP04*', `[remapPosition] No mapping segment before character ${character} on line ${line}`);
    return position;
}

/**
 * Remap both ends of a range using remapPosition.
 */
export function remapRange(range: Range, sourcemapLines?: SourcemapLines): Range {
    const mapped = {
        start: remapPosition(range.start, sourcemapLines),
        end: remapPosition(range.end, sourcemapLines)
    };
    logPM('*MP05*', `[remapRange] Mapped start (${range.start.line},${range.start.character}) and end (${range.end.line},${range.end.character})`);
    return mapped;
}

/**
 * Given a raw sourcemap from Civet, "polishes" it by applying heuristics
 * to fix common mapping inaccuracies.
 */
export function polishMap(
    rawMap: SourceMap,
    civetCode: string,
    tsCode: string
) {
    if (typeof rawMap.mappings !== 'string' || !rawMap.mappings) {
        logPM('*PM00*', '[polishMap] No mappings string present, returning rawMap');
        return withStringHelpers(rawMap);
    }

    try {
        const tracer = new TraceMap(rawMap);
        const decoded: DecodedMap = decode(rawMap.mappings);
        const civetLines = civetCode.split('\n');
        const tsLines = tsCode.split('\n');
        const sourceFile = getOrCreateSourceFile(tsCode);

        // Step 1: Create a whitelist of all valid identifiers from the source code.
        const idWhitelist = new Set(civetCode.match(/(?:[$_]||\p{ID_Start})(?:[$_]||\p{ID_Continue})*/gu) ?? []);
        logPM('*PM01*', `Whitelisted identifiers: ${Array.from(idWhitelist).join(', ')}`);
        logPM('*PM02*', `Polishing map for file: ${rawMap.file}`);

        for (let genLine = 0; genLine < decoded.length; genLine++) {
            const line = decoded[genLine];
            for (let i = 0; i < line.length; i++) {
                const seg = line[i];
                // If a segment has no source mapping, try to find one.
                if (seg.length === 1) {
                    const genCol = seg[0];

                    // Gatekeeper Pass (The "Bouncer") - Now with a precise whitelist.
                    const token = tsLines[genLine]?.slice(genCol).match(/^\w+/)?.[0];
                    if (token && !idWhitelist.has(token)) {
                        logPM('*PM03*', `[Gatekeeper] Token "${token}" not in whitelist. Skipping mapping. (genLine ${genLine+1}, genCol ${genCol})`);
                        continue; // This is a compiler-generated artifact, do not map it.
                    }

                    logPM('*PM04*', `[Unmapped] Found unmapped segment at genLine ${genLine+1}, genCol ${genCol}. Attempting to polish.`);
                    const pos = originalPositionFor(tracer, { line: genLine + 1, column: genCol });

                    if (pos.line !== null && pos.column !== null && pos.source !== null) {
                        // Found a precise mapping, create a new segment
                        logPM('*PM05*', `[TraceMap] Precise mapping found: original line ${pos.line}, col ${pos.column}`);
                        const newSeg: [number, number, number, number] = [
                            seg[0],
                            rawMap.sources.indexOf(pos.source),
                            pos.line - 1,
                            pos.column
                        ];
                        line[i] = newSeg;
                    } else {
                        // Heuristic fallback
                        logPM('*PM06*', `[TraceMap] Precise mapping failed. Falling back to heuristics.`);
                        const heu = findHeuristicMapping(genLine, genCol, decoded, civetLines, tsLines);
                        if (heu) {
                            logPM('*PM07*', `[Heuristic] Succeeded: found mapping to original line ${heu.line+1}, col ${heu.column}`);
                            const newSeg: [number, number, number, number] = [seg[0], 0, heu.line, heu.column];
                            line[i] = newSeg;
                        } else {
                            // Deep-dive using TypeScript AST as a last resort
                            logPM('*PM08*', `[Heuristic] Failed. Trying AST fallback.`);
                            const ast = findAstGuidedMapping(genLine, genCol, civetLines, decoded, sourceFile);
                            if (ast) {
                                logPM('*PM09*', `[AST] Fallback succeeded: original line ${ast.line+1}, col ${ast.column}`);
                                const newSeg: [number, number, number, number] = [seg[0], 0, ast.line, ast.column];
                                line[i] = newSeg;
                            } else {
                                logPM('*PM10*', `[AST] Fallback failed: No mapping found for genLine ${genLine+1}, genCol ${genCol}`);
                            }
                        }
                    }
                }
            }
        }
        const polishedMappings = encode(decoded);
        const polishedMap = {
            ...rawMap,
            mappings: polishedMappings
        };
        logPM('*PM11*', '[polishMap] Finished polishing, returning polished map.');
        return withStringHelpers(polishedMap);
    } catch (e) {
        logPM('*PM12*', `[ERROR] Failed to polish sourcemap: ${e}`);
        return withStringHelpers(rawMap); // Return original on failure
    }
}

function findHeuristicMapping(
    genLine: number,
    genCol: number,
    decoded: DecodedMap,
    civetLines: string[],
    tsLines: string[]
): { line: number; column: number } | null {
    logPM('*PM13*', `[findHeuristicMapping] Entered for genLine ${genLine+1}, genCol ${genCol}`);
    const tsLine = tsLines[genLine];
    if (!tsLine) return null;

    // Heuristic 1: Find the token at the generated position and search for it in the original code.
    const token = tsLine.slice(genCol).match(/^\w+/)?.[0];
    logPM('*PM14*', `[Heuristic 1] Searching for token "${token}" from generated line ${genLine+1}.`);
    if (token) {
        const surroundingMapping = findLastMappingOnLineBefore(genLine, genCol, decoded) ?? findFirstMappingOnLineAfter(genLine, genCol, decoded);
        if (surroundingMapping) {
            const searchLine = surroundingMapping.originalLine;
            const searchRadius = 5; // Search 5 lines up and down
            logPM('*PM15*', `[Heuristic 1a] Found surrounding mapping. Searching for token near original line ${searchLine + 1} (radius: ${searchRadius}).`);
            for (let i = 0; i <= searchRadius; i++) {
                const upLine = searchLine - i;
                if (upLine >= 0) {
                    const col = civetLines[upLine].indexOf(token);
                    if (col !== -1) {
                        logPM('*PM16*', `[Heuristic 1a] Found token "${token}" in original code at line ${upLine+1}, col ${col}.`);
                        return { line: upLine, column: col };
                    }
                }
                const downLine = searchLine + i;
                if (i > 0 && downLine < civetLines.length) {
                    const col = civetLines[downLine].indexOf(token);
                    if (col !== -1) {
                        logPM('*PM17*', `[Heuristic 1a] Found token "${token}" in original code at line ${downLine+1}, col ${col}.`);
                        return { line: downLine, column: col };
                    }
                }
            }
        }
        logPM('*PM18*', `[Heuristic 1b] No luck with focused search. Falling back to global search.`);
        for (let i = 0; i < civetLines.length; i++) {
            const col = civetLines[i].indexOf(token);
            if (col !== -1) {
                logPM('*PM19*', `[Heuristic 1b] Found token "${token}" in original code at line ${i+1}, col ${col}.`);
                return { line: i, column: col };
            }
        }
    }
    // Heuristic 2: Find the last valid mapping on the same line and use its source line.
    logPM('*PM20*', `[Heuristic 2] Token search failed. Looking for previous mapping on same generated line.`);
    const mapping = findLastMappingOnLineBefore(genLine, genCol, decoded);
    if (mapping) {
        // Interpolation: apply the column delta from the last mapping
        const delta = genCol - mapping.generatedColumn;
        const newColumn = mapping.originalColumn + delta;
        logPM('*PM21*', `[Heuristic 2] Found previous mapping. Interpolating: original col ${mapping.originalColumn} + delta ${delta} = new col ${newColumn}`);
        return { line: mapping.originalLine, column: newColumn };
    }
    logPM('*PM22*', `[Heuristic] All heuristics failed for genLine ${genLine+1}, genCol ${genCol}`);
    return null;
}

function findLastMappingOnLineBefore(line: number, column: number, decoded: DecodedMap) {
    const lineMappings = decoded[line];
    if (!lineMappings) return null;

    let lastMapping: { generatedColumn: number; originalLine: number; originalColumn: number } | null = null;
    for (const seg of lineMappings) {
        if (seg[0] <= column) {
            if (seg.length > 1) { // It must be a valid mapping
                lastMapping = {
                    generatedColumn: seg[0],
                    originalLine: seg[2],
                    originalColumn: seg[3],
                };
            }
        } else {
            // Segments are sorted by column, so we can stop searching.
            break;
        }
    }
    return lastMapping;
} 

function findFirstMappingOnLineAfter(line: number, column: number, decoded: DecodedMap) {
    const lineMappings = decoded[line];
    if (!lineMappings) return null;

    for (const seg of lineMappings) {
        if (seg[0] >= column) {
            if (seg.length > 1) { // It must be a valid mapping
                return {
                    generatedColumn: seg[0],
                    originalLine: seg[2],
                    originalColumn: seg[3],
                };
            }
        }
    }
    return null;
} 