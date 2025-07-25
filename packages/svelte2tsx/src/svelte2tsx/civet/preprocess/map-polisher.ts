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

/**
 * Build a whitelist of all identifier-like tokens that appear in the source.
 * We include true Identifiers and keyword tokens so that constructs such as
 * "return" or "if" originating from user code are still whitelisted. This
 * avoids the fragile Unicode-heavy regex we used before.
 */
function buildIdentifierWhitelist(src: string, sourceMask: SourceGuardMask): Set<string> {
    const ids = new Set<string>();
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ true, ts.LanguageVariant.Standard, src);
    const lines = src.split('\\n');
    let line = 0;
    let lineStart = 0;
    
    while (true) {
        const token = scanner.scan();
        if (token === ts.SyntaxKind.EndOfFileToken) break;

        const pos = scanner.getTokenStart();
        // This loop logic is tricky. We need to find the correct line for the current token position.
        // It's possible for multiple newlines to exist between tokens.
        while (pos >= lineStart + lines[line].length + 1 && line < lines.length - 1) {
            lineStart += lines[line].length + 1;
            line++;
        }
        const col = pos - lineStart;
        
        if (sourceMask.isMasked(line, col)) {
            continue;
        }

        if (token === ts.SyntaxKind.Identifier) {
            ids.add(scanner.getTokenText());
        } else if (token === ts.SyntaxKind.NumericLiteral) {
            // TS scanner outputs "0." for the "0..." range syntax and likewise "42." for
            // a bare trailing-dot literal. We need to drop *one* trailing dot, if present,
            // and otherwise keep the literal exactly as written so floats/hex/etc stay intact.
            const raw = scanner.getTokenText();
            const normalized = raw.endsWith('.') ? raw.slice(0, -1) : raw;
            ids.add(normalized);
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

        // Step 1: Build whitelist with scanner so identifiers inside comments/strings are ignored
        const idWhitelist = buildIdentifierWhitelist(civetCode, sourceMask);
        logPM('*PM01*', `[Whitelist] Built from sanitized source (${idWhitelist.size} ids): ${Array.from(idWhitelist).join(', ')}`);
        logPM('*PM02*', `Polishing map for file: ${rawMap.file}`);

        for (let genLine = 0; genLine < decoded.length; genLine++) {
            const line = decoded[genLine];
            for (let i = 0; i < line.length; i++) {
                const seg = line[i];
                // If a segment has no source mapping, try to find one.
                if (seg.length === 1) {
                    const genCol = seg[0];

                    // --- NEW: Primary Guard ---
                    // If the segment is inside a comment in the *generated* code, it's an
                    // unmappable artifact. Skip it before any other logic.
                    if (generatedMask.isMasked(genLine, genCol)) {
                        logPM('*GEN-GUARD*', `[Generated Guard] Blocking mapping for segment inside a TS comment at ${genLine+1}:${genCol}`);
                        continue;
                    }

                    // Enhanced Gatekeeper logging
                    const token = tsLines[genLine]?.slice(genCol).match(/^\w+/)?.[0];
                    if (token) {
                        logPM('*GATE1*',
                            `[Gatekeeper] Found token "${token}" at ${genLine+1}:${genCol}` +
                            `\n    Context: "${tsLines[genLine].slice(Math.max(0, genCol-10), genCol)}►${tsLines[genLine][genCol]}◄${tsLines[genLine].slice(genCol+1, genCol+11)}"` +
                            `\n    In whitelist: ${idWhitelist.has(token)}`
                        );

                        if (!idWhitelist.has(token)) {
                            logPM('*GATE2*', `[Gatekeeper] Token "${token}" not in whitelist. Skipping mapping.`);
                        continue; // This is a compiler-generated artifact, do not map it.
                        }
                    } else {
                        logPM('*GATE3*',
                            `[Gatekeeper] No token at ${genLine+1}:${genCol}, found '${tsLines[genLine][genCol]}'` +
                            `\n    Context: "${tsLines[genLine].slice(Math.max(0, genCol-10), genCol)}►${tsLines[genLine][genCol]}◄${tsLines[genLine].slice(genCol+1, genCol+11)}"`
                        );
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
                        idWhitelist,
                        sourceMask // Pass the source mask
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
    idWhitelist: Set<string>,  // Add whitelist as parameter
    sourceMask: SourceGuardMask // Add sourceMask as parameter
): { line: number; column: number } | null {
    const tsLine = tsLines[genLine];
    if (!tsLine) return null;

    // Add context logging for what we're looking at
    const char_at_pos = tsLine[genCol];
    const next_5_chars = tsLine.slice(genCol, genCol + 5);
    logPM('*CTX*', `[Context] Character at ${genLine+1}:${genCol} is '${char_at_pos}', next few chars: "${next_5_chars}"`);

    // Heuristic 1: Find the token at the generated position
    const token = tsLine.slice(genCol).match(/^\w+/)?.[0];

    if (token) {
        logPM('*TOK1*', `[Token Analysis] Found token "${token}" at position. In whitelist: ${idWhitelist.has(token)}`);
        // A token exists at this position. We MUST find it in the source.
        // If we can't, it's a generated token and we should NOT map it.
        logPM('*MP09*', `[Heuristic 1] Using tokenIndex search for "${token}"`);

        const surroundingMapping = findLastMappingOnLineBefore(genLine, genCol, decoded) ?? findFirstMappingOnLineAfter(genLine, genCol, decoded);
        if (surroundingMapping) {
            // Log the context of where we're searching
            logPM('*SRCH*', `[Search Context] Looking near original line ${surroundingMapping.originalLine+1}, which maps to generated col ${surroundingMapping.generatedColumn}`);
            const searchLine = surroundingMapping.originalLine;
            const searchRadius = 5; // TODO: use SEARCH_RADIUS const
            logPM('*PM15*', `[Heuristic 1a] Found surrounding mapping. Searching for token near original line ${searchLine + 1} (radius: ${searchRadius}).`);
            for (let i = 0; i <= searchRadius; i++) {
                const upLine = searchLine - i;
                if (upLine >= 0 && upLine < tokenIndex.length) {
                    const tokPos = tokenIndex[upLine]?.find(t => t.text === token);
                    if (tokPos) {
                        // --- NEW: Source Guard for Heuristics ---
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
                        // --- NEW: Source Guard for Heuristics ---
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
                 // --- NEW: Source Guard for Heuristics ---
                if (sourceMask.isMasked(i, tokPos.col)) {
                    logPM('*SRC-GUARD*', `[Source Guard] Heuristic result for "${token}" rejected. Lands in source comment at ${i+1}:${tokPos.col}.`);
                    continue; // Check next line
                }
                logPM('*PM19*', `[Heuristic 1b] Found token "${token}" in sanitized original at line ${i+1}, col ${tokPos.col}.`);
                return { line: i, column: tokPos.col };
            }
        }

        // IMPORTANT: If we searched for a token and failed to find it, do not proceed.
        // It's a compiler-generated artifact. Return null to prevent a phantom mapping.
        logPM('*MP12*', `[Heuristic 1] FAILED. Token "${token}" found in generated code but not in sanitized source. Aborting mapping.`);
        return null;
    } else {
        // Enhanced artifact detection for non-token characters
        logPM('*ART0*', `[Artifact Analysis] Starting check for '${char_at_pos}' at ${genLine+1}:${genCol}`);
        
        // Look backwards for previous token
        const beforeText = tsLine.slice(0, genCol);
        const prevMatch = beforeText.match(/(\w+)\W*$/);
        const prevToken = prevMatch?.[1];
        const prevTokenIsInWhitelist = prevToken ? idWhitelist.has(prevToken) : true;
        
        if (prevToken) {
            logPM('*ART1*', 
                `[Artifact Check] Found previous token "${prevToken}"` +
                `\n    Distance: ${genCol - (beforeText.lastIndexOf(prevToken) ?? 0)}` +
                `\n    In whitelist: ${prevTokenIsInWhitelist}`
            );
        }

        // Look forwards for next token
        const afterText = tsLine.slice(genCol + 1);
        const nextMatch = afterText.match(/^[\W]*(\w+)/);
        const nextToken = nextMatch?.[1];
        const nextTokenIsInWhitelist = nextToken ? idWhitelist.has(nextToken) : true;
        
        if (nextToken) {
            logPM('*ART2*', 
                `[Artifact Check] Found next token "${nextToken}"` +
                `\n    Distance: ${(afterText.indexOf(nextToken) ?? 0) + 1}` +
                `\n    In whitelist: ${nextTokenIsInWhitelist}`
            );
        }

        // --- NEW: Artifact Guard Logic ---
        // If we're adjacent to a compiler artifact (non-whitelisted token),
        // do not attempt to map this punctuation/whitespace.
        if (!prevTokenIsInWhitelist || !nextTokenIsInWhitelist) {
            logPM('*ART3*', 
                `[Artifact Guard] Blocking interpolation for '${char_at_pos}'` +
                `\n    Context: "${tsLine.slice(Math.max(0, genCol-15), genCol)}►${char_at_pos}◄${tsLine.slice(genCol+1, genCol+16)}"` +
                `\n    Reason: Adjacent to compiler artifact(s):` +
                (prevToken && !prevTokenIsInWhitelist ? `\n      - Before: "${prevToken}"` : '') +
                (nextToken && !nextTokenIsInWhitelist ? `\n      - After: "${nextToken}"` : '')
            );
            return null;
        }

        // Only proceed with interpolation if we're not adjacent to artifacts
        logPM('*PM20*', 
            `[Heuristic 2] No token at '${char_at_pos}'. Proceeding with interpolation.` +
            `\n    Context is clean (not adjacent to compiler artifacts)`
        );
        
        const mapping = findLastMappingOnLineBefore(genLine, genCol, decoded);
        if (mapping) {
            // Interpolation: apply the column delta from the last mapping
            const delta = genCol - mapping.generatedColumn;
            const newColumn = mapping.originalColumn + delta;
            const newLine = mapping.originalLine;

            // --- NEW: Source Guard for Interpolation ---
            if (sourceMask.isMasked(newLine, newColumn)) {
                logPM('*SRC-GUARD*', `[Source Guard] Interpolation result rejected. Lands in source comment at ${newLine+1}:${newColumn}.`);
        return null;
    }

            // Log successful interpolation
            logPM('*PM21*', 
                `[Heuristic 2] Creating interpolated mapping` +
                `\n    Character: '${char_at_pos}'` +
                `\n    Context: "${tsLine.slice(Math.max(0, genCol-10), genCol)}►${char_at_pos}◄${tsLine.slice(genCol+1, genCol+11)}"` +
                `\n    Previous token (safe): ${prevToken || 'none'}` +
                `\n    Next token (safe): ${nextToken || 'none'}` +
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
                // This is not very performant, but it's only run once per file.
                const startLine = tsCode.substring(0, start).split('\n').length - 1;
                const endLine = tsCode.substring(0, end).split('\n').length - 1;
                
                for (let line = startLine; line <= endLine; line++) {
                    // This is also not very performant.
                    const lineStartPos = tsCode.lastIndexOf('\n', tsCode.length - lines.slice(line).join('\n').length - 2) + 1;
                    
                    const spanStart = (line === startLine) ? start - lineStartPos : 0;
                    const spanEnd = (line === endLine) ? end - lineStartPos : lines[line].length;
                    
                    if (!spans.has(line)) {
                        spans.set(line, []);
                    }
                    spans.get(line)!.push({ start: spanStart, end: spanEnd });
                }
            }
        }
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