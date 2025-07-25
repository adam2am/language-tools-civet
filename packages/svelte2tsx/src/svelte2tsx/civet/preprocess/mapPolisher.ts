import { decode, encode } from '@jridgewell/sourcemap-codec';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
// Lightweight on-demand use of the TypeScript compiler API for deep inspection
import { SourceInspector } from './helpers/sourceInspector'; // NEW: Import SourceInspector

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
// const sourceFileCache = new Map<string, ts.SourceFile>(); // REMOVED: Replaced by SourceInspector
// Replace simple map with bounded LRU cache so long-lived processes don't leak memory
// const sanitizedSourceCache: Map<string, string[]> = new Map(); // REMOVED: Replaced by SourceInspector
// const MAX_CACHE_ENTRIES = 50; // todo: expose via config/env in future

/** Moves key to newest position in LRU map */
// function touchLRU<T>(cache: Map<string, T>, key: string, value: T) { // REMOVED: Replaced by SourceInspector
//     if (cache.has(key)) cache.delete(key);
//     cache.set(key, value);
//     if (cache.size > MAX_CACHE_ENTRIES) {
//         // delete oldest entry
//         const oldestKey = cache.keys().next().value;
//         if (oldestKey !== undefined) cache.delete(oldestKey);
//     }
// }

// REMOVED: getSanitizedLines function - functionality moved to SourceInspector
// REMOVED: getOrCreateSourceFile remains as is for now since it directly uses ts
// REMOVED: identifierAt remains as is for now since it directly uses ts

// REMOVED: findAstGuidedMapping will be updated later

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

// REMOVED: LineByLineWhitelist type and related functions (buildWhitelistFromSanitizedSource, isTokenInLocalWhitelist)
// REMOVED: SourceGuardMask class

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

        const civetInspector = new SourceInspector(civetCode, { civet: true, civetParseOptions: civetCompileOptions });
        const tsInspector = new SourceInspector(tsCode, { civet: false });
        const tracer = new TraceMap(rawMap);
        const tsLines = tsCode.split('\n');
        // Use civetInspector.lines for line content, build whitelist inline
        // Use civetInspector.isPositionMasked and tsInspector.isPositionMasked for masking
        // Remove all calls to non-existent methods
        // const civetLines = civetCode.split('\n'); // REMOVED: civetLines

        // --- ADDED LOG: Dump whitelist after build ---
        // for (const [line, tokens] of lineWhitelist.entries()) { // REMOVED: Whitelist dumping
        //     logPM('*WHITELIST-DUMP*', `[polishMap] Whitelist line ${line + 1}: tokens = ${Array.from(tokens).join(', ')}`);
        // }
        logPM('*PM02*', `Polishing map for file: ${rawMap.file}`);

        for (let genLine = 0; genLine < decoded.length; genLine++) {
            const line = decoded[genLine];
            for (let i = 0; i < line.length; i++) {
                const seg = line[i];
                if (seg.length === 1) {
                    const genCol = seg[0];
                    logPM('*SEG-START*', `[Segment] Considering unmapped segment at genLine ${genLine+1}, genCol ${genCol}`);

                    const token = tsLines[genLine]?.slice(genCol).match(/^\w+/)?.[0];
                    let shouldBlock = false;

                    if (token) {
                        logPM('*TOKEN-FOUND*', `[Token] Found token '${token}' at genLine ${genLine+1}, genCol ${genCol}`);
                        // NEW LOGIC: Prioritize whitelist check for tokens
                        const surroundingMapping = findLastMappingOnLineBefore(genLine, genCol, decoded) ?? findFirstMappingOnLineAfter(genLine, genCol, decoded);
                        if (surroundingMapping) {
                            logPM('*SURROUND-HINT*', `[Hint] Using surrounding mapping at original line ${surroundingMapping.originalLine + 1}`);
                            const SEARCH_RADIUS = 2;
                            if (!civetInspector.findToken(token, surroundingMapping.originalLine, SEARCH_RADIUS)) {
                                logPM('*GATE-FAIL-LOCAL*', `[Gatekeeper] Token "${token}" not found in local context around line ${surroundingMapping.originalLine + 1}. BLOCK.`);
                                shouldBlock = true; // Block if not in whitelist
                            }
                        } else {
                            logPM('*GATE-FAIL-NOHINT*', `[Gatekeeper] No surrounding mapping for "${token}", cannot check local context. BLOCK.`);
                            shouldBlock = true; // Block if no hint
                        }
                    } else {
                        logPM('*TOKEN-NONE*', `[Token] No token found at genLine ${genLine+1}, genCol ${genCol}`);
                        // For non-tokens, apply the generated guard as before
                        if (tsInspector.isPositionMasked(genLine, genCol)) {
                            logPM('*GEN-GUARD*', `[Generated Guard] Blocking mapping for segment inside a TS comment at ${genLine+1}:${genCol}`);
                            shouldBlock = true;
                        }
                    }

                    if (shouldBlock) {
                        continue; // Skip to next segment if blocked by any condition
                    }

                    // If we reached here, it means the segment is not blocked by initial checks.
                    // Now, for tokens that passed the whitelist, we still need to check the generatedMask
                    // to avoid mapping to compiler artifacts IF they are not whitelisted.
                    // This specific segment of logic (the `generatedMask` check) is now inside the token branch above,
                    // and will only apply to non-tokens.
                    // For tokens that passed the whitelist, we proceed directly to TraceMap/heuristics.

                    logPM('*PM04*', `[Unmapped] Found unmapped segment at genLine ${genLine+1}, genCol ${genCol}. Attempting to polish.`);
                    const pos = originalPositionFor(tracer, { line: genLine + 1, column: genCol });

                    if (pos.line !== null && pos.column !== null && pos.source !== null) {
                        // --- NEW: Source Guard for TraceMap ---
                        // Verify that the mapping from TraceMap doesn't land in a source comment.
                        if (civetInspector.isPositionMasked(pos.line - 1, pos.column)) {
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
                        civetInspector, // Pass the civet inspector
                        tsInspector // Pass the ts inspector
                    );
                    if (heu) {
                        logPM('*PM07*', `[Heuristic] Succeeded: found mapping to original line ${heu.line+1}, col ${heu.column}`);
                        const newSeg: [number, number, number, number] = [seg[0], 0, heu.line, heu.column];
                        line[i] = newSeg;
                    } else {
                        // Deep-dive using TypeScript AST as a last resort
                        logPM('*PM08*', `[Heuristic] Failed. Trying AST fallback.`);
                        const ast = findAstGuidedMapping();
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
    civetInspector: SourceInspector, // Add civetInspector
    tsInspector: SourceInspector // Add tsInspector
) {
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
            // const tokensOnLine = lineWhitelist.get(surroundingMapping.originalLine); // REMOVED: Whitelist check
            logPM('*GATE-LOCAL-DEBUG*', `[Gatekeeper] About to check token '${token}' on original line ${surroundingMapping.originalLine + 1}. Whitelist tokens: (not applicable)`);
        }
        // if (surroundingMapping && !isTokenInLocalWhitelist(token, surroundingMapping.originalLine, 2, lineWhitelist)) { // REMOVED: Whitelist check
        //     // This is a redundant check now handled by the main gatekeeper, but kept for safety.
        //     return null;
        // }

        logPM('*TOK1*', `[Token Analysis] Found token "${token}" at position.`);
        logPM('*MP09*', `[Heuristic 1] Using tokenIndex search for "${token}"`);
        
        if (surroundingMapping) {
            logPM('*SRCH*', `[Search Context] Looking near original line ${surroundingMapping.originalLine+1}, which maps to generated col ${surroundingMapping.generatedColumn}`);
            const searchLine = surroundingMapping.originalLine;
            const searchRadius = 5;
            logPM('*PM15*', `[Heuristic 1a] Found surrounding mapping. Searching for token near original line ${searchLine + 1} (radius: ${searchRadius}).`);
            for (let i = 0; i <= searchRadius; i++) {
                const upLine = searchLine - i;
                if (upLine >= 0 && upLine < civetInspector.getLineCount()) { // Ensure upLine is within civetLines bounds
                    const tokPos = civetInspector.findToken(token, upLine, 1); // Search for token at upLine
                    if (tokPos) {
                        if (tsInspector.isPositionMasked(upLine, tokPos.column)) {
                            logPM('*SRC-GUARD*', `[Source Guard] Heuristic result for "${token}" rejected. Lands in source comment at ${upLine+1}:${tokPos.column}.`);
                        } else {
                            logPM('*PM16*', `[Heuristic 1a] Found token "${token}" in sanitized original at line ${upLine+1}, col ${tokPos.column}.`);
                            return { line: upLine, column: tokPos.column };
                        }
                    }
                }
                const downLine = searchLine + i;
                if (i > 0 && downLine < civetInspector.getLineCount()) { // Ensure downLine is within civetLines bounds
                    const tokPos = civetInspector.findToken(token, downLine, 1); // Search for token at downLine
                    if (tokPos) {
                        if (tsInspector.isPositionMasked(downLine, tokPos.column)) {
                             logPM('*SRC-GUARD*', `[Source Guard] Heuristic result for "${token}" rejected. Lands in source comment at ${downLine+1}:${tokPos.column}.`);
                        } else {
                            logPM('*PM17*', `[Heuristic 1a] Found token "${token}" in sanitized original at line ${downLine+1}, col ${tokPos.column}.`);
                            return { line: downLine, column: tokPos.column };
                        }
                    }
                }
            }
        }
        logPM('*PM18*', `[Heuristic 1b] No luck with focused search. Falling back to global search.`);
        for (let i = 0; i < civetInspector.getLineCount(); i++) {
            const tokPos = civetInspector.findToken(token, i, 1); // Search for token at line i
            if (tokPos) {
                if (tsInspector.isPositionMasked(i, tokPos.column)) {
                    logPM('*SRC-GUARD*', `[Source Guard] Heuristic result for "${token}" rejected. Lands in source comment at ${i+1}:${tokPos.column}.`);
                    continue;
                }
                logPM('*PM19*', `[Heuristic 1b] Found token "${token}" in sanitized original at line ${i+1}, col ${tokPos.column}.`);
                return { line: i, column: tokPos.column };
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

            if (tsInspector.isPositionMasked(newLine, newColumn)) {
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
// class SourceGuardMask { // REMOVED: Replaced by SourceInspector
//     // A set of strings, where each string is "line:startCol:endCol"
//     private commentSpans = new Map<number, { start: number; end: number }[]>();
//     private stringSpans = new Map<number, { start: number; end: number }[]>();

//     private constructor() {}

//     /**
//      * Checks if the given line/column position is inside a known comment or string span.
//      */
//     isMasked(line: number, col: number): boolean {
//         const lineCommentSpans = this.commentSpans.get(line);
//         if (lineCommentSpans?.some(span => col >= span.start && col < span.end)) {
//             return true;
//         }
//         const lineStringSpans = this.stringSpans.get(line);
//         return lineStringSpans?.some(span => col >= span.start && col < span.end) ?? false;
//     }

//     /**
//      * Creates a mask by parsing TypeScript source and identifying all comment trivia.
//      */
//     static fromTypeScript(tsCode: string): SourceGuardMask {
//         const mask = new SourceGuardMask();
//         const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false, ts.LanguageVariant.Standard, tsCode);
//         const lines = tsCode.split('\n');

//         // Pre-calculate line starts once for reliability and performance
//         const lineStarts: number[] = [0];
//         for (let i = 0; i < lines.length - 1; i++) {
//             lineStarts.push(lineStarts[i] + lines[i].length + 1); // +1 for the '\n'
//         }

//         while (true) {
//             const token = scanner.scan();
//             if (token === ts.SyntaxKind.EndOfFileToken) break;

//             const isComment = token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
//             const isString = (token >= ts.SyntaxKind.FirstLiteralToken && token <= ts.SyntaxKind.LastLiteralToken) ||
//                              (token >= ts.SyntaxKind.FirstTemplateToken && token <= ts.SyntaxKind.LastTemplateToken);

//             if (isComment || isString) {
//                 const spans = isComment ? mask.commentSpans : mask.stringSpans;
//                 const start = scanner.getTokenStart();
//                 const end = scanner.getTokenEnd();
                
//                 const startLine = tsCode.substring(0, start).split('\n').length - 1;
//                 const endLine = tsCode.substring(0, end).split('\n').length - 1;
                
//                 for (let line = startLine; line <= endLine; line++) {
//                     // Use the reliable, pre-calculated value for lineStartPos
//                     const lineStartPos = lineStarts[line];
                    
//                     const spanStart = (line === startLine) ? start - lineStartPos : 0;
//                     const spanEnd = (line === endLine) ? end - lineStartPos : lines[line].length;
                    
//                     if (!spans.has(line)) {
//                         spans.set(line, []);
//                     }
//                     spans.get(line)!.push({ start: spanStart, end: spanEnd });
//                 }
//             }
//         }
//         return mask;
//     }

//     /**
//      * Creates a mask by parsing Civet source and identifying all comments.
//      * It correctly ignores comment characters that appear inside string literals.
//      * It uses the provided compile options to determine the correct comment syntax.
//      */
//     static fromCivet(civetCode: string, options: Record<string, any>): SourceGuardMask {
//         const mask = new SourceGuardMask();
//         const lines = civetCode.split('\n');
//         const coffeeComments = options.parseOptions?.coffeeComments ?? true;
//         const commentChar = coffeeComments ? '#' : '//';

//         for (let i = 0; i < lines.length; i++) {
//             const line = lines[i];
//             let inString: false | "'" | '"' | '`' = false;
//             let stringStart = -1;

//             for (let j = 0; j < line.length; j++) {
//                 const char = line[j];

//                 if (inString) {
//                     // Check for end of string, ignoring escaped quotes
//                     if (char === inString && line[j - 1] !== '\\') {
//                         inString = false;
//                         const spans = mask.stringSpans;
//                         if (!spans.has(i)) spans.set(i, []);
//                         spans.get(i)!.push({ start: stringStart, end: j + 1 });
//                     }
//                 } else {
//                     // Check for start of string
//                     if (char === "'" || char === '"' || char === '`') {
//                         inString = char;
//                         stringStart = j;
//                     } else if (line.startsWith(commentChar, j) || line.startsWith('//', j)) {
//                         // We found a comment, mark the rest of the line
//                         if (!mask.commentSpans.has(i)) mask.commentSpans.set(i, []);
//                         mask.commentSpans.get(i)!.push({ start: j, end: line.length });
//                         break; // Move to next line
//                     }
//                 }
//             }
//         }
//         return mask;
//     }
// } 

// REMOVED: isTokenInLocalWhitelist function - functionality moved to SourceInspector

// Add this helper function before its first use
function findAstGuidedMapping() {
    return null;
} 