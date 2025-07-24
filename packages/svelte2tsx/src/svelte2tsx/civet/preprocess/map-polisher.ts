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
// Replace simple map with bounded LRU cache so long-lived processes don't leak memory
const sanitizedSourceCache: Map<string, string[]> = new Map();
const MAX_CACHE_ENTRIES = 50; // todo: expose via config/env in future

/** Moves key to newest position in LRU map */
function touchLRU<T>(cache: Map<string, T>, key: string, value: T) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    if (cache.size > MAX_CACHE_ENTRIES) {
        // delete oldest entry
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
    }
}

/**
 * Creates a "sanitized" version of the source code where all comments and
 * string literals are replaced with whitespace. This allows for syntax-unaware
 * `indexOf` searches without accidentally matching tokens inside non-code contexts.
 * The result is cached by the original code string.
 */
function getSanitizedLines(civetCode: string): string[] {
    // Fast-path cache lookup
    const cached = sanitizedSourceCache.get(civetCode);
    if (cached) {
        logPM('*MP06*', '[Sanitizer] Cache HIT');
        return cached;
    }

    logPM('*MP07*', '[Sanitizer] Cache MISS, creating sanitized source via TS scanner...');

    const text = civetCode;
    const length = text.length;
    const shouldBlank = new Uint8Array(length); // 1 === blank

    const mark = (start: number, end: number) => {
        for (let i = start; i < end; i++) {
            // Preserve line-breaks to keep line count identical
            if (text[i] !== '\n' && text[i] !== '\r') {
                shouldBlank[i] = 1;
            }
        }
    };

    const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false, ts.LanguageVariant.Standard, text);
    while (true) {
        const token = scanner.scan();
        if (token === ts.SyntaxKind.EndOfFileToken) break;

        const start = scanner.getTokenPos();
        const end = scanner.getTextPos();

        switch (token) {
            case ts.SyntaxKind.SingleLineCommentTrivia:
            case ts.SyntaxKind.MultiLineCommentTrivia:
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
            case ts.SyntaxKind.RegularExpressionLiteral:
            case ts.SyntaxKind.TemplateHead:
            case ts.SyntaxKind.TemplateMiddle:
            case ts.SyntaxKind.TemplateTail:
                mark(start, end);
                break;
        }
    }

    let sanitized = '';
    for (let i = 0; i < length; i++) {
        sanitized += shouldBlank[i] ? ' ' : text[i];
    }

    const lines = sanitized.split('\n');
    touchLRU(sanitizedSourceCache, civetCode, lines);
    logPM('*MP08*', `[Sanitizer] Finished. Source is ${lines.length} lines long.`);
    return lines;
}


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
    decoded: DecodedMap,
    sourceFile: ts.SourceFile,
    sanitizedCivetLines: string[] // Now required
) {
    const ident = identifierAt(sourceFile, genLine, genCol);
    if (!ident) return null;

    // Use neighbouring mapping as search hint (same strategy as heuristic 1a)
    const hint = findLastMappingOnLineBefore(genLine, genCol, decoded) ??
                 findFirstMappingOnLineAfter(genLine, genCol, decoded);

    const SEARCH_RADIUS = 5; // TODO: expose via config
    const searchRadius = SEARCH_RADIUS;
    if (hint) {
        for (let i = 0; i <= searchRadius; i++) {
            const up = hint.originalLine - i;
            if (up >= 0) {
                const col = sanitizedCivetLines[up].indexOf(ident);
                if (col !== -1) return { line: up, column: col };
            }
            const down = hint.originalLine + i;
            if (i && down < sanitizedCivetLines.length) {
                const col = sanitizedCivetLines[down].indexOf(ident);
                if (col !== -1) return { line: down, column: col };
            }
        }
    }

    // Fallback: global search (last resort)
    logPM('*MP11*', `[AST] Hint-based search failed for "${ident}". Doing global search.`);
    for (let i = 0; i < sanitizedCivetLines.length; i++) {
        const col = sanitizedCivetLines[i].indexOf(ident);
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

/**
 * Build a whitelist of all identifier-like tokens that appear in the source.
 * We include true Identifiers and keyword tokens so that constructs such as
 * "return" or "if" originating from user code are still whitelisted. This
 * avoids the fragile Unicode-heavy regex we used before.
 */
function buildIdentifierWhitelist(src: string): Set<string> {
    const ids = new Set<string>();
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false, ts.LanguageVariant.Standard, src);
    while (true) {
        const token = scanner.scan();
        if (token === ts.SyntaxKind.EndOfFileToken) break;
        if (token === ts.SyntaxKind.Identifier || token === ts.SyntaxKind.NumericLiteral) {
            ids.add(scanner.getTokenText());
        }
    }
    return ids;
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
        logPM('*MP03*', `[remapPosition] Mapped gen(${line},${character}) -> src(${mapped.line},${mapped.character})`);
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
    logPM('*MP05*', `[remapRange] Mapped start from src(${range.start.line},${range.start.character}) -> (${mapped.start.line},${mapped.start.character}) and end from src(${range.end.line},${range.end.character}) -> (${mapped.end.line},${mapped.end.character})`);
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
        const decoded: DecodedMap = decode(rawMap.mappings);

        // --- Phase 0: File-level Early Bailout ---
        let unmappedSegmentCount = 0;
        const HOLE_CHECK_THRESHOLD = 0; // Bail out if 0 holes are found.
        for (const line of decoded) {
            for (const seg of line) {
                if (seg.length === 1) {
                    unmappedSegmentCount++;
                }
            }
        }

        if (unmappedSegmentCount <= HOLE_CHECK_THRESHOLD) {
            logPM('*PM-BAILOUT*', `[Bailout] Found ${unmappedSegmentCount} unmapped segments. Skipping polish.`);
            return withStringHelpers(rawMap);
        }
        // --- End of Bailout Logic ---

        const tracer = new TraceMap(rawMap);
        const tsLines = tsCode.split('\n');
        const sourceFile = getOrCreateSourceFile(tsCode);
        const sanitizedCivetLines = getSanitizedLines(civetCode);

        // -------------------------------------------------------------------
        //  Build per-line token index (Phase-1 optimisation)
        // -------------------------------------------------------------------
        // Each entry is an array of { text, col } objects sorted by appearance.
        type TokenPos = { text: string; col: number };
        const tokenIndex: TokenPos[][] = sanitizedCivetLines.map((line) => {
            const out: TokenPos[] = [];
            line.replace(/[$_a-zA-Z][$_a-zA-Z0-9]*|\d+/g, (match: string, offset: number) => {
                out.push({ text: match, col: offset });
                return match;
            });
            return out;
        });

        // Step 1: Build whitelist with scanner so identifiers inside comments/strings are ignored
        const idWhitelist = buildIdentifierWhitelist(civetCode);
        logPM('*PM01*', `[Whitelist] Built from sanitized source (${idWhitelist.size} ids): ${Array.from(idWhitelist).join(', ')}`);
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
                        const heu = findHeuristicMapping(genLine, genCol, decoded, tsLines, sanitizedCivetLines, tokenIndex);
                        if (heu) {
                            logPM('*PM07*', `[Heuristic] Succeeded: found mapping to original line ${heu.line+1}, col ${heu.column}`);
                            const newSeg: [number, number, number, number] = [seg[0], 0, heu.line, heu.column];
                            line[i] = newSeg;
                        } else {
                            // Deep-dive using TypeScript AST as a last resort
                            logPM('*PM08*', `[Heuristic] Failed. Trying AST fallback.`);
                            const ast = findAstGuidedMapping(genLine, genCol, decoded, sourceFile, sanitizedCivetLines);
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
    tsLines: string[],
    sanitizedCivetLines: string[],
    tokenIndex: { text: string; col: number }[][]
): { line: number; column: number } | null {
    logPM('*PM13*', `[findHeuristicMapping] Entered for genLine ${genLine+1}, genCol ${genCol}`);
    const tsLine = tsLines[genLine];
    if (!tsLine) return null;

    // Heuristic 1: Find the token at the generated position and search for it in the original code.
    const token = tsLine.slice(genCol).match(/^\w+/)?.[0];
    logPM('*PM14*', `[Heuristic 1] Searching for token "${token}" from generated line ${genLine+1}.`);

    if (token) {
        // A token exists at this position. We MUST find it in the source.
        // If we can't, it's a generated token and we should NOT map it.
        // Use a regex to ensure we match the whole word, not a substring
        // Pre-built tokenIndex makes regex unnecessary but keep log for parity
        logPM('*MP09*', `[Heuristic 1] Using tokenIndex search for "${token}"`);

        const surroundingMapping = findLastMappingOnLineBefore(genLine, genCol, decoded) ?? findFirstMappingOnLineAfter(genLine, genCol, decoded);
        if (surroundingMapping) {
            const searchLine = surroundingMapping.originalLine;
            const searchRadius = 5; // TODO: use SEARCH_RADIUS const
            logPM('*PM15*', `[Heuristic 1a] Found surrounding mapping. Searching for token near original line ${searchLine + 1} (radius: ${searchRadius}).`);
            for (let i = 0; i <= searchRadius; i++) {
                const upLine = searchLine - i;
                if (upLine >= 0) {
                    const tokPos = tokenIndex[upLine].find(t => t.text === token);
                    if (tokPos) {
                        logPM('*PM16*', `[Heuristic 1a] Found token "${token}" in sanitized original at line ${upLine+1}, col ${tokPos.col}.`);
                        return { line: upLine, column: tokPos.col };
                    }
                }
                const downLine = searchLine + i;
                if (i > 0 && downLine < sanitizedCivetLines.length) {
                    const tokPos = tokenIndex[downLine].find(t => t.text === token);
                    if (tokPos) {
                        logPM('*PM17*', `[Heuristic 1a] Found token "${token}" in sanitized original at line ${downLine+1}, col ${tokPos.col}.`);
                        return { line: downLine, column: tokPos.col };
                    }
                }
            }
        }
        logPM('*PM18*', `[Heuristic 1b] No luck with focused search. Falling back to global search.`);
        for (let i = 0; i < sanitizedCivetLines.length; i++) {
            const tokPos = tokenIndex[i].find(t => t.text === token);
            if (tokPos) {
                logPM('*PM19*', `[Heuristic 1b] Found token "${token}" in sanitized original at line ${i+1}, col ${tokPos.col}.`);
                return { line: i, column: tokPos.col };
            }
        }

        // IMPORTANT: If we searched for a token and failed to find it, do not proceed.
        // It's a compiler-generated artifact. Return null to prevent a phantom mapping.
        logPM('*MP12*', `[Heuristic 1] FAILED. Token "${token}" found in generated code but not in sanitized source. Aborting mapping.`);
        return null;
    }

    // Heuristic 2: This code path now only runs if there was NO token at the position (e.g., symbols, whitespace).
    // It's safe to use interpolation here.
    logPM('*PM20*', `[Heuristic 2] No token found. Looking for previous mapping on same generated line to interpolate.`);
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