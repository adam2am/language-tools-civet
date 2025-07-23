import { decode, encode } from '@jridgewell/sourcemap-codec';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

type DecodedMap = ReturnType<typeof decode>;

type SourceMap = {
    version: 3;
    sources: string[];
    names: string[];
    mappings: string;
    file: string;
    sourcesContent?: string[];
};

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
 * Given a raw sourcemap from Civet, "polishes" it by applying heuristics
 * to fix common mapping inaccuracies.
 */
export function polishMap(
    rawMap: SourceMap,
    civetCode: string,
    tsCode: string
) {
    if (typeof rawMap.mappings !== 'string' || !rawMap.mappings) {
        return withStringHelpers(rawMap);
    }

    try {
        const tracer = new TraceMap(rawMap);
        const decoded: DecodedMap = decode(rawMap.mappings);
        const civetLines = civetCode.split('\n');
        const tsLines = tsCode.split('\n');

        console.log(`[*PM*] Polishing map for file: ${rawMap.file}`);

        for (let genLine = 0; genLine < decoded.length; genLine++) {
            const line = decoded[genLine];
            for (let i = 0; i < line.length; i++) {
                const seg = line[i];
                // If a segment has no source mapping, try to find one.
                if (seg.length === 1) {
                    const genCol = seg[0];

                    // Gatekeeper Pass (The "Bouncer")
                    const token = tsLines[genLine]?.slice(genCol).match(/^\w+/)?.[0];
                    if (token && !civetCode.includes(token)) {
                        console.log(`[*PM*] Gatekeeper: Token "${token}" not found in original source. Skipping mapping.`);
                        continue; // This is a compiler-generated artifact, do not map it.
                    }

                    console.log(`[*PM*] Found unmapped segment at genLine ${genLine+1}, genCol ${genCol}. Attempting to polish.`);
                    const pos = originalPositionFor(tracer, { line: genLine + 1, column: genCol });

                    if (pos.line !== null && pos.column !== null && pos.source !== null) {
                        // Found a precise mapping, create a new segment
                        console.log(`[*PM*]   └──> Precise mapping found via trace-mapping: original line ${pos.line}, col ${pos.column}`);
                        const newSeg: [number, number, number, number] = [
                            seg[0],
                            rawMap.sources.indexOf(pos.source),
                            pos.line - 1,
                            pos.column
                        ];
                        line[i] = newSeg;
                    } else {
                        // Heuristic fallback
                        console.log(`[*PM*]   └──> Precise mapping failed. Falling back to heuristics.`);
                        const heu = findHeuristicMapping(genLine, genCol, decoded, civetLines, tsLines);
                        if (heu) {
                            console.log(`[*PM*]   └──> Heuristic succeeded: found mapping to original line ${heu.line+1}, col ${heu.column}`);
                            const newSeg: [number, number, number, number] = [seg[0], 0, heu.line, heu.column];
                            line[i] = newSeg;
                        } else {
                            console.log(`[*PM*]   └──> Heuristic failed: No mapping found.`);
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

        return withStringHelpers(polishedMap);
    } catch (e) {
        console.error("Failed to polish sourcemap", e);
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
    const tsLine = tsLines[genLine];
    if (!tsLine) return null;

    // Heuristic 1: Find the token at the generated position and search for it in the original code.
    const token = tsLine.slice(genCol).match(/^\\w+/)?.[0];
    console.log(`[*PM*]     [Heuristic 1] Searching for token "${token}" from generated line ${genLine+1}.`);
    if (token) {
        for (let i = 0; i < civetLines.length; i++) {
            const col = civetLines[i].indexOf(token);
            if (col !== -1) {
                console.log(`[*PM*]       └──> Found token "${token}" in original code at line ${i+1}, col ${col}.`);
                return { line: i, column: col };
            }
        }
    }
    
    // Heuristic 2: Find the last valid mapping on the same line and use its source line.
    console.log(`[*PM*]     [Heuristic 2] Token search failed. Looking for previous mapping on same generated line.`);
    const mapping = findLastMappingOnLineBefore(genLine, genCol, decoded);
    if (mapping) {
        // Interpolation: apply the column delta from the last mapping
        const delta = genCol - mapping.generatedColumn;
        const newColumn = mapping.originalColumn + delta;
        console.log(`[*PM*]       └──> Found previous mapping. Interpolating: original col ${mapping.originalColumn} + delta ${delta} = new col ${newColumn}`);
        return { line: mapping.originalLine, column: newColumn };
    }

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