import { decode, encode } from '@jridgewell/sourcemap-codec';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
// Lightweight on-demand use of the TypeScript compiler API for deep inspection
import ts from 'typescript';
import { sanitizeSource } from './helpers/sourceSanitizer';

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
function getSanitizedLines(civetCode: string, options: Record<string, any> = {}): string[] {
    // Fast-path cache lookup
    const cached = sanitizedSourceCache.get(civetCode);
    if (cached) {
        logPM('*MP06*', '[Sanitizer] Cache HIT');
        return cached;
    }

    logPM('*MP07*', '[Sanitizer] Cache MISS, creating sanitized source via custom parser...');

    const text = civetCode;
    const length = text.length;
    let sanitized = '';
    
    let inString: false | "'" | '"' | '`' = false;
    let inComment = false;

    const coffeeComments = options.parseOptions?.coffeeComments ?? true;
    const singleLineCommentChar = coffeeComments ? '#' : '//';

    for (let i = 0; i < length; i++) {
        const char = text[i];

        if (inString) {
            sanitized += ' ';
            if (char === inString && text[i-1] !== '\\') {
                inString = false;
            }
        } else if (inComment) {
            sanitized += ' ';
            if (char === '\n') {
                inComment = false;
                sanitized = sanitized.slice(0, -1) + '\n';
            }
        } else {
            if (char === "'" || char === '"' || char === '`') {
                inString = char;
                sanitized += ' ';
            } else if (text.startsWith(singleLineCommentChar, i) || text.startsWith('//', i)) {
                inComment = true;
                sanitized += ' ';
            } else {
                sanitized += char;
            }
        }
    }
    
    console.log(`[DEBUG] Sanitized Source:\n---\n${sanitized}\n---`);
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
    sanitizedCivetLines: string[], // Now required
    sourceMask: SourceGuardMask
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
                if (col !== -1) {
                    if (sourceMask.isMasked(up, col)) {
                        logPM('*SRC-GUARD*', `[Source Guard] AST result for "${ident}" rejected. Lands in source comment at ${up+1}:${col}.`);
                    } else {
                        return { line: up, column: col };
                    }
                }
            }
            const down = hint.originalLine + i;
            if (i && down < sanitizedCivetLines.length) {
                const col = sanitizedCivetLines[down].indexOf(ident);
                if (col !== -1) {
                    if (sourceMask.isMasked(down, col)) {
                        logPM('*SRC-GUARD*', `[Source Guard] AST result for "${ident}" rejected. Lands in source comment at ${down+1}:${col}.`);
                    } else {
                        return { line: down, column: col };
                    }
                }
            }
        }
    }

    // Fallback: global search (last resort)
    logPM('*MP11*', `[AST] Hint-based search failed for "${ident}". Doing global search.`);
    for (let i = 0; i < sanitizedCivetLines.length; i++) {
        const col = sanitizedCivetLines[i].indexOf(ident);
        if (col !== -1) {
            if (sourceMask.isMasked(i, col)) {
                logPM('*SRC-GUARD*', `[Source Guard] AST result for "${ident}" rejected. Lands in source comment at ${i+1}:${col}.`);
                continue;
            }
            return { line: i, column: col };
        }
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

// --- NEW: Local line-by-line whitelist ---
type LineByLineWhitelist = Map<number, Set<string>>; // Map<OriginalLineNumber, Set<TokensOnThatLine>>

function buildWhitelistFromSanitizedSource(src: string, sourceMask: SourceGuardMask): LineByLineWhitelist {
    logPM('*WHITELIST-RESILIENT-START*', `[Resilient Whitelist] Fallback tokenizer STARTED. Source has ${src.split('\n').length} lines.`);
    const lineWhitelist: LineByLineWhitelist = new Map();
    const lines = src.split('\n');
    const tokenRegex = /[\p{L}_$][\p{L}\p{N}_$]*|\d+(?:\.\d*)?/gu;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        let match;
        while ((match = tokenRegex.exec(line)) !== null) {
            let tokenText = match[0];
            const col = match.index;
            logPM('*WHITELIST-RESILIENT-TOKEN*', `[Resilient Whitelist] Matched token '${tokenText}' at line ${lineNum + 1}, col ${col} | src = "${line}"`);
            if (sourceMask.isMasked(lineNum, col)) {
                logPM('*WHITELIST-RESILIENT-MASKED*', `[Resilient Whitelist] Skipping masked token '${tokenText}' at line ${lineNum + 1}, col ${col}`);
                continue;
            }

            // --- NEW NORMALIZATION LOGIC ---
            // If the token is a number that ends with a dot, strip it.
            if (/^\d+\.$/.test(tokenText)) {
                tokenText = tokenText.slice(0, -1); // '1.' -> '1'
            }
            // --- END NEW LOGIC ---

            if (!lineWhitelist.has(lineNum)) {
                lineWhitelist.set(lineNum, new Set());
            }
            lineWhitelist.get(lineNum)!.add(tokenText);
            logPM('*WHITELIST-RESILIENT-ADD*', `[Resilient Whitelist] ADDED token '${tokenText}' to line ${lineNum + 1}`);
        }
    }
    for (const [line, tokens] of lineWhitelist.entries()) {
        logPM('*WHITELIST-RESILIENT-LINE*', `[Resilient Whitelist] Line ${line + 1}: tokens = ${Array.from(tokens).join(', ')} | src = "${lines[line] ?? ''}"`);
    }
    logPM('*WHITELIST-RESILIENT-DONE*', `[Resilient Whitelist] Fallback tokenizer COMPLETE. Ledger created for ${lineWhitelist.size} lines.`);
    return lineWhitelist;
}

function isTokenInLocalWhitelist(
    token: string,
    originalLineHint: number,
    searchRadius: number,
    lineWhitelist: LineByLineWhitelist
): boolean {
    logPM('*GATE-LOCAL-CHECK*', `[Gatekeeper] Checking token '${token}' in local whitelist around line ${originalLineHint + 1} (radius ${searchRadius})`);
    for (let i = -searchRadius; i <= searchRadius; i++) {
        const lineToCheck = originalLineHint + i;
        const tokensOnLine = lineWhitelist.get(lineToCheck);
        logPM('*GATE-LOCAL-LINE*', `[Gatekeeper] Line ${lineToCheck + 1}: tokens = ${tokensOnLine ? Array.from(tokensOnLine).join(', ') : '(none)'}`);
        if (tokensOnLine && tokensOnLine.has(token)) {
            logPM('*GATE-PASS-LOCAL*', `[Gatekeeper] Token "${token}" found in local whitelist on line ${lineToCheck + 1}. PASS.`);
            return true;
        } else if (tokensOnLine) {
            logPM('*GATE-LOCAL-MISS*', `[Gatekeeper] Token "${token}" NOT found on line ${lineToCheck + 1}. Tokens present: ${Array.from(tokensOnLine).join(', ')}`);
        } else {
            logPM('*GATE-LOCAL-NOLINE*', `[Gatekeeper] No tokens recorded for line ${lineToCheck + 1}.`);
        }
    }
    logPM('*GATE-FAIL-LOCAL*', `[Gatekeeper] Token "${token}" not found in local whitelist within radius.`);
    return false;
}

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
    tsCode: string,
    civetCompileOptions: Record<string, any>
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

        const generatedMask = SourceGuardMask.fromTypeScript(tsCode);
        const sourceMask = SourceGuardMask.fromCivet(civetCode, civetCompileOptions);
        const tracer = new TraceMap(rawMap);
        const tsLines = tsCode.split('\n');
        const sourceFile = getOrCreateSourceFile(tsCode);
        const sanitizedCivetLines = getSanitizedLines(civetCode, civetCompileOptions);

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

        // --- Two-Map Technique ---
        const cleanCivetSource = sanitizeSource(civetCode);
        const lineWhitelist: LineByLineWhitelist = buildWhitelistFromSanitizedSource(cleanCivetSource, sourceMask);

        // --- ADDED LOG: Dump whitelist after build ---
        for (const [line, tokens] of lineWhitelist.entries()) {
            logPM('*WHITELIST-DUMP*', `[polishMap] Whitelist line ${line + 1}: tokens = ${Array.from(tokens).join(', ')}`);
        }
        logPM('*PM02*', `Polishing map for file: ${rawMap.file}`);

        for (let genLine = 0; genLine < decoded.length; genLine++) {
            const line = decoded[genLine];
            for (let i = 0; i < line.length; i++) {
                const seg = line[i];
                if (seg.length === 1) {
                    const genCol = seg[0];
                    logPM('*SEG-START*', `[Segment] Considering unmapped segment at genLine ${genLine+1}, genCol ${genCol}`);
                    // If a segment has no source mapping, try to find one.
                    if (generatedMask.isMasked(genLine, genCol)) {
                        logPM('*GEN-GUARD*', `[Generated Guard] Blocking mapping for segment inside a TS comment at ${genLine+1}:${genCol}`);
                        continue;
                    }

                    const token = tsLines[genLine]?.slice(genCol).match(/^\w+/)?.[0];
                    if (token) {
                        logPM('*TOKEN-FOUND*', `[Token] Found token '${token}' at genLine ${genLine+1}, genCol ${genCol}`);
                        // --- NEW: Use local whitelist with mapping hint ---
                        const surroundingMapping = findLastMappingOnLineBefore(genLine, genCol, decoded) ?? findFirstMappingOnLineAfter(genLine, genCol, decoded);
                        if (surroundingMapping) {
                            logPM('*SURROUND-HINT*', `[Hint] Using surrounding mapping at original line ${surroundingMapping.originalLine + 1}`);
                            const SEARCH_RADIUS = 2;
                            if (!isTokenInLocalWhitelist(token, surroundingMapping.originalLine, SEARCH_RADIUS, lineWhitelist)) {
                                logPM('*GATE-FAIL-LOCAL*', `[Gatekeeper] Token "${token}" not found in local context around line ${surroundingMapping.originalLine + 1}. BLOCK.`);
                                continue; // It's a compiler artifact, block it.
                            }
                        } else {
                            logPM('*GATE-FAIL-NOHINT*', `[Gatekeeper] No surrounding mapping for "${token}", cannot check local context. BLOCK.`);
                            continue;
                        }
                    } else {
                        logPM('*TOKEN-NONE*', `[Token] No token found at genLine ${genLine+1}, genCol ${genCol}`);
                        // No token here, this logic remains the same (for ']', '{', etc.)
                        // The artifact guard for non-token characters is still valuable here.
                    }

                    logPM('*PM04*', `[Unmapped] Found unmapped segment at genLine ${genLine+1}, genCol ${genCol}. Attempting to polish.`);
                    const pos = originalPositionFor(tracer, { line: genLine + 1, column: genCol });

                    if (pos.line !== null && pos.column !== null && pos.source !== null) {
                        // --- NEW: Source Guard for TraceMap ---
                        // Verify that the mapping from TraceMap doesn't land in a source comment.
                        if (sourceMask.isMasked(pos.line - 1, pos.column)) {
                            logPM('*SRC-GUARD*', `[Source Guard] TraceMap result for ${genLine+1}:${genCol} rejected. Lands in source comment at ${pos.line}:${pos.column}.`);
                            // Fall through to heuristics
                        } else {
                            // Found a valid, precise mapping, create a new segment
                            logPM('*PM05*', `[TraceMap] Precise mapping found: original line ${pos.line}, col ${pos.column}`);
                            const newSeg: [number, number, number, number] = [
                                seg[0],
                                rawMap.sources.indexOf(pos.source),
                                pos.line - 1,
                                pos.column
                            ];
                            line[i] = newSeg;
                            continue; // Skip to next segment
                        }
                    }

                    // Heuristic fallback
                    logPM('*PM06*', `[TraceMap] Precise mapping failed or was rejected. Falling back to heuristics.`);
                    const heu = findHeuristicMapping(
                        genLine,
                        genCol,
                        decoded,
                        tsLines,
                        sanitizedCivetLines,
                        tokenIndex,
                        // idWhitelist, // replaced by lineWhitelist
                        sourceMask, // Pass the source mask
                        lineWhitelist // Pass the pre-built whitelist
                    );
                    if (heu) {
                        logPM('*PM07*', `[Heuristic] Succeeded: found mapping to original line ${heu.line+1}, col ${heu.column}`);
                        const newSeg: [number, number, number, number] = [seg[0], 0, heu.line, heu.column];
                        line[i] = newSeg;
                    } else {
                        // Deep-dive using TypeScript AST as a last resort
                        logPM('*PM08*', `[Heuristic] Failed. Trying AST fallback.`);
                        const ast = findAstGuidedMapping(genLine, genCol, decoded, sourceFile, sanitizedCivetLines, sourceMask);
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
    tokenIndex: { text: string; col: number }[][],
    sourceMask: SourceGuardMask,
    lineWhitelist: LineByLineWhitelist
): { line: number; column: number } | null {
    const tsLine = tsLines[genLine];
    if (!tsLine) return null;

    const char_at_pos = tsLine[genCol];
    const next_5_chars = tsLine.slice(genCol, genCol + 5);
    logPM('*CTX*', `[Context] Character at ${genLine+1}:${genCol} is '${char_at_pos}', next few chars: "${next_5_chars}"`);

    const token = tsLine.slice(genCol).match(/^\w+/)?.[0];

    if (token) {
        const surroundingMapping = findLastMappingOnLineBefore(genLine, genCol, decoded) ?? findFirstMappingOnLineAfter(genLine, genCol, decoded);
        if (surroundingMapping) {
            // --- ADDED LOG ---
            const tokensOnLine = lineWhitelist.get(surroundingMapping.originalLine);
            logPM('*GATE-LOCAL-DEBUG*', `[Gatekeeper] About to check token '${token}' on original line ${surroundingMapping.originalLine + 1}. Whitelist tokens: ${tokensOnLine ? Array.from(tokensOnLine).join(', ') : '(none)'}`);
        }
        if (surroundingMapping && !isTokenInLocalWhitelist(token, surroundingMapping.originalLine, 2, lineWhitelist)) {
            // This is a redundant check now handled by the main gatekeeper, but kept for safety.
            return null;
        }

        logPM('*TOK1*', `[Token Analysis] Found token "${token}" at position.`);
        logPM('*MP09*', `[Heuristic 1] Using tokenIndex search for "${token}"`);
        
        if (surroundingMapping) {
            logPM('*SRCH*', `[Search Context] Looking near original line ${surroundingMapping.originalLine+1}, which maps to generated col ${surroundingMapping.generatedColumn}`);
            const searchLine = surroundingMapping.originalLine;
            const searchRadius = 5;
            logPM('*PM15*', `[Heuristic 1a] Found surrounding mapping. Searching for token near original line ${searchLine + 1} (radius: ${searchRadius}).`);
            for (let i = 0; i <= searchRadius; i++) {
                const upLine = searchLine - i;
                if (upLine >= 0 && upLine < tokenIndex.length) {
                    const tokPos = tokenIndex[upLine]?.find(t => t.text === token);
                    if (tokPos) {
                        if (sourceMask.isMasked(upLine, tokPos.col)) {
                            logPM('*SRC-GUARD*', `[Source Guard] Heuristic result for "${token}" rejected. Lands in source comment at ${upLine+1}:${tokPos.col}.`);
                        } else {
                            logPM('*PM16*', `[Heuristic 1a] Found token "${token}" in sanitized original at line ${upLine+1}, col ${tokPos.col}.`);
                            return { line: upLine, column: tokPos.col };
                        }
                    }
                }
                const downLine = searchLine + i;
                if (i > 0 && downLine < sanitizedCivetLines.length && downLine < tokenIndex.length) {
                    const tokPos = tokenIndex[downLine]?.find(t => t.text === token);
                    if (tokPos) {
                        if (sourceMask.isMasked(downLine, tokPos.col)) {
                             logPM('*SRC-GUARD*', `[Source Guard] Heuristic result for "${token}" rejected. Lands in source comment at ${downLine+1}:${tokPos.col}.`);
                        } else {
                            logPM('*PM17*', `[Heuristic 1a] Found token "${token}" in sanitized original at line ${downLine+1}, col ${tokPos.col}.`);
                            return { line: downLine, column: tokPos.col };
                        }
                    }
                }
            }
        }
        logPM('*PM18*', `[Heuristic 1b] No luck with focused search. Falling back to global search.`);
        for (let i = 0; i < sanitizedCivetLines.length && i < tokenIndex.length; i++) {
            const tokPos = tokenIndex[i]?.find(t => t.text === token);
            if (tokPos) {
                if (sourceMask.isMasked(i, tokPos.col)) {
                    logPM('*SRC-GUARD*', `[Source Guard] Heuristic result for "${token}" rejected. Lands in source comment at ${i+1}:${tokPos.col}.`);
                    continue;
                }
                logPM('*PM19*', `[Heuristic 1b] Found token "${token}" in sanitized original at line ${i+1}, col ${tokPos.col}.`);
                return { line: i, column: tokPos.col };
            }
        }

        logPM('*MP12*', `[Heuristic 1] FAILED. Token "${token}" found in generated code but not in sanitized source. Aborting mapping.`);
        return null;
    } else {
        logPM('*ART0*', `[Artifact Analysis] Starting check for '${char_at_pos}' at ${genLine+1}:${genCol}`);
        
        // Removed the check for prevTokenIsInWhitelist and nextTokenIsInWhitelist.
        // Punctuation and whitespace should always be allowed to interpolate.

        logPM('*PM20*', 
            `[Heuristic 2] No token at '${char_at_pos}'. Proceeding with interpolation.` +
            `\n    Context is clean (not adjacent to compiler artifacts)`
        );
        
        const mapping = findLastMappingOnLineBefore(genLine, genCol, decoded);
        if (mapping) {
            const delta = genCol - mapping.generatedColumn;

            // --- NEW PROXIMITY CHECK ---
            const MAX_INTERPOLATION_DISTANCE = 20; // Configurable threshold
            if (delta > MAX_INTERPOLATION_DISTANCE) {
                logPM('*HEURISTIC-REJECT*', `[Heuristic 2] Rejecting interpolation. Last mapping is too far away (delta: ${delta}).`);
                return null; // Reject this mapping and allow fallback to AST.
            }
            // --- END NEW LOGIC ---

            const newColumn = mapping.originalColumn + delta;
            const newLine = mapping.originalLine;

            if (sourceMask.isMasked(newLine, newColumn)) {
                logPM('*SRC-GUARD*', `[Source Guard] Interpolation result rejected. Lands in source comment at ${newLine+1}:${newColumn}.`);
                return null;
            }

            logPM('*PM21*', 
                `[Heuristic 2] Creating interpolated mapping` +
                `\n    Character: \'${char_at_pos}\'` +
                `\n    Context: \"${tsLine.slice(Math.max(0, genCol-10), genCol)}►${char_at_pos}◄${tsLine.slice(genCol+1, genCol+11)}\"` +
                `\n    Delta: ${delta} (from gen ${mapping.generatedColumn} to ${genCol})` +
                `\n    New column: ${newColumn}`
            );
            return { line: newLine, column: newColumn };
        }
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

/**
 * A utility to quickly check if a given position in a source file is inside a comment.
 * This is used to prevent mapping to/from comments.
 */
class SourceGuardMask {
    // A set of strings, where each string is "line:startCol:endCol"
    private commentSpans = new Map<number, { start: number; end: number }[]>();
    private stringSpans = new Map<number, { start: number; end: number }[]>();

    private constructor() {}

    /**
     * Checks if the given line/column position is inside a known comment or string span.
     */
    isMasked(line: number, col: number): boolean {
        const lineCommentSpans = this.commentSpans.get(line);
        if (lineCommentSpans?.some(span => col >= span.start && col < span.end)) {
            return true;
        }
        const lineStringSpans = this.stringSpans.get(line);
        return lineStringSpans?.some(span => col >= span.start && col < span.end) ?? false;
    }

    /**
     * Creates a mask by parsing TypeScript source and identifying all comment trivia.
     */
    static fromTypeScript(tsCode: string): SourceGuardMask {
        const mask = new SourceGuardMask();
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false, ts.LanguageVariant.Standard, tsCode);
        const lines = tsCode.split('\n');

        while (true) {
            const token = scanner.scan();
            if (token === ts.SyntaxKind.EndOfFileToken) break;

            const isComment = token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
            const isString = (token >= ts.SyntaxKind.FirstLiteralToken && token <= ts.SyntaxKind.LastLiteralToken) ||
                             (token >= ts.SyntaxKind.FirstTemplateToken && token <= ts.SyntaxKind.LastTemplateToken);

            if (isComment || isString) {
                const spans = isComment ? mask.commentSpans : mask.stringSpans;
                const start = scanner.getTokenPos();
                const end = scanner.getTextPos();
                
                // Add debug log for raw start/end positions
                logPM('*SG-DEBUG-RAW*', `[SourceGuardMask] Token: ${ts.SyntaxKind[token]} Start: ${start}, End: ${end}`);

                const startLine = tsCode.substring(0, start).split('\n').length - 1;
                const endLine = tsCode.substring(0, end).split('\n').length - 1;
                
                for (let line = startLine; line <= endLine; line++) {
                    const lineStartPos = tsCode.lastIndexOf('\n', tsCode.length - lines.slice(line).join('\n').length - 2) + 1;
                    
                    const spanStart = (line === startLine) ? start - lineStartPos : 0;
                    const spanEnd = (line === endLine) ? end - lineStartPos : lines[line].length;
                    
                    // Add debug logs for calculated span values
                    logPM('*SG-DEBUG-CALC*', `[SourceGuardMask] Line ${line+1}: lineStartPos=${lineStartPos}, spanStart=${spanStart}, spanEnd=${spanEnd}`);
                    
                    if (!spans.has(line)) {
                        spans.set(line, []);
                    }
                    spans.get(line)!.push({ start: spanStart, end: spanEnd });
                }
            }
        }
        // Add debug log for the final commentSpans map
        logPM('*SG-DEBUG-FINAL*', `[SourceGuardMask] Final commentSpans: ${JSON.stringify(Array.from(mask.commentSpans.entries()))}`);
        return mask;
    }

    /**
     * Creates a mask by parsing Civet source and identifying all comments.
     * It correctly ignores comment characters that appear inside string literals.
     * It uses the provided compile options to determine the correct comment syntax.
     */
    static fromCivet(civetCode: string, options: Record<string, any>): SourceGuardMask {
        const mask = new SourceGuardMask();
        const lines = civetCode.split('\n');
        const coffeeComments = options.parseOptions?.coffeeComments ?? true;
        const commentChar = coffeeComments ? '#' : '//';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let inString: false | "'" | '"' | '`' = false;
            let stringStart = -1;

            for (let j = 0; j < line.length; j++) {
                const char = line[j];

                if (inString) {
                    // Check for end of string, ignoring escaped quotes
                    if (char === inString && line[j - 1] !== '\\') {
                        inString = false;
                        const spans = mask.stringSpans;
                        if (!spans.has(i)) spans.set(i, []);
                        spans.get(i)!.push({ start: stringStart, end: j + 1 });
                    }
                } else {
                    // Check for start of string
                    if (char === "'" || char === '"' || char === '`') {
                        inString = char;
                        stringStart = j;
                    } else if (line.startsWith(commentChar, j) || line.startsWith('//', j)) {
                        // We found a comment, mark the rest of the line
                        if (!mask.commentSpans.has(i)) mask.commentSpans.set(i, []);
                        mask.commentSpans.get(i)!.push({ start: j, end: line.length });
                        break; // Move to next line
                    }
                }
            }
        }
        return mask;
    }
} 