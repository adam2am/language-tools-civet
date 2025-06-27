import { GenMapping, toEncodedMap, addMapping, setSourceContent } from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import type { Anchor } from './tsAnchorCollector';
import { collectAnchorsFromTs } from './tsAnchorCollector';
import { decode } from '@jridgewell/sourcemap-codec';

// Define local types to avoid dependency issues
export interface SvelteFile {
    getText(): string;
    filename: string;
}

export type CivetCompileOptions = Record<string, any>;

const DEBUG_DENSE_MAP = false;
const logFullDenseMap = (..._args: any[]) => {}; // No-op for now

// Mapping of TS operator/keyword representations to Civet equivalents
const TS_TO_CIVET_ALIASES: Record<string, string[]> = {
    '===': ['is'],
    '==': ['is'],
    '!==': ['isnt'],
    '!=': ['isnt'],
    '&&': ['and'],
    '||': ['or'],
    '!': ['not']
};

function locateTokenInCivetLine(
  civetLineText: string,
    searchText: string,
    kind: Anchor['kind'],
    consumedCount: number
): { startIndex: number; length: number } | undefined {
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

    return foundIndex !== -1 ? { startIndex: foundIndex, length: searchText.length } : undefined;
}

function isGeneratedIdentifier(text: string, kind: Anchor['kind']): boolean {
    // Common compiler-generated identifiers
    if (text.length === 1 && /^[ijkn]$/.test(text)) return true;
    
    // Only skip generated identifiers, not operators or keywords
    if (kind !== 'identifier') return false;
    
    // Skip compiler-generated variable names but NOT language keywords
    return text.length === 1 && /^[ijkn]$/.test(text);
}

function createEmptySourceMap(filename: string): EncodedSourceMap {
    return {
        version: 3,
        file: filename,
        sources: [],
        sourcesContent: [],
        mappings: '',
        names: [],
    };
}

export function normalize(
    civetMap: any,
    tsCode: string,
    svelteFile: SvelteFile,
    _options: CivetCompileOptions,
    civetContentStartLine: number,
    indentLen: number,
): EncodedSourceMap {
    // --- Debug logging setup ---
    const log = (msg: string) => console.log(`[MAP_DEBUG] ${msg}`);
    const shouldLog = tsCode.includes('if (abc === query)');
    if (shouldLog) log('Starting Two-Pass Rebuild normalization');

    if (!civetMap) return createEmptySourceMap(svelteFile.filename);

    const civetSource = svelteFile.filename;
    const civetContent = civetMap.source || '';
    const civetLines = civetContent.split('\n');
    const tsLines = tsCode.split('\n');

    // Initialize a fresh mapping
    const gen = new GenMapping();
    setSourceContent(gen, civetSource, civetContent);

    // Track mapped positions to avoid duplicates and for null-mapping
    const usedGenPositions = new Map<number, Set<number>>();
    const consumedMatchCount = new Map<string, number>();

    // --- PASS 1: Map High-Quality Anchors ---
    const anchors = collectAnchorsFromTs(tsCode, svelteFile.filename);
    if (shouldLog) log(`Found ${anchors.length} anchors for high-quality mapping`);

    // First, sort anchors by their position and prioritize non-whitespace
    anchors.sort((a, b) => {
        if (a.start.line !== b.start.line) return a.start.line - b.start.line;
        if (a.start.character !== b.start.character) return a.start.character - b.start.character;
        
        // Prioritize keywords and operators over whitespace
        const isHighPriorityA = ['keyword', 'operator'].includes(a.kind);
        const isHighPriorityB = ['keyword', 'operator'].includes(b.kind);
        if (isHighPriorityA !== isHighPriorityB) return isHighPriorityA ? -1 : 1;
        
        // For same kind, prioritize longer tokens
        return ((b as any).length || 0) - ((a as any).length || 0);
    });

    for (const anchor of anchors) {
        // Skip whitespace-only anchors, they are handled by the null-mapping pass
        if (anchor.text.trim() === '') {
      continue;
    }

        // Skip generated identifiers
        if (isGeneratedIdentifier(anchor.text, anchor.kind)) {
            if (shouldLog) log(`Skipping generated identifier: ${anchor.text}`);
            continue;
            }

        const { line: tsLine, character: tsCol } = anchor.start;
        
        // Find corresponding line in Civet source
        let civetLineIndex: number | undefined;
    if (typeof civetMap.mappings === 'string') {
        const decoded = decode(civetMap.mappings);
            for (const seg of decoded[tsLine] || []) {
                if (seg.length >= 4) {
                    civetLineIndex = seg[2];
                    break;
    }
            }
    } else if (Array.isArray(civetMap.lines)) {
            for (const seg of civetMap.lines[tsLine] || []) {
                if (seg.length >= 4) {
                    civetLineIndex = seg[2];
                    break;
            }
            }
        }

        if (civetLineIndex === undefined) continue;

        const civetLineText = civetLines[civetLineIndex];
        const cacheKey = `${civetLineIndex}:${anchor.text}:${anchor.kind}`;
        const consumedCount = consumedMatchCount.get(cacheKey) || 0;

        // Build list of search tokens (the TS text + any Civet aliases)
        const searchTokens = [anchor.text, ...(TS_TO_CIVET_ALIASES[anchor.text] ?? [])];
        let position: { startIndex: number; length: number } | undefined;
        let usedSearchText = anchor.text;
        for (const tokenCandidate of searchTokens) {
            position = locateTokenInCivetLine(civetLineText, tokenCandidate, anchor.kind, consumedCount);
            if (position) {
                usedSearchText = tokenCandidate;
                break;
            }
        }
        if (!position) continue;

        // Update consumed count keyed by the actual search token we matched
        const cacheKeyActual = `${civetLineIndex}:${usedSearchText}:${anchor.kind}`;
        consumedMatchCount.set(cacheKeyActual, (consumedMatchCount.get(cacheKeyActual) || 0) + 1);

        // Calculate final source positions
        const origLine = civetLineIndex + civetContentStartLine - 1;
        const origCol = position.startIndex + indentLen;

        // Track this position as used on the generated side
        let usedCols = usedGenPositions.get(tsLine);
        if (!usedCols) {
            usedCols = new Set<number>();
            usedGenPositions.set(tsLine, usedCols);
        }

        const tsLen = anchor.text.length;      // length in generated code
        const cvLen = position.length;         // matched length in Civet source

        // First map the whitespace to a position before the token to prevent hover extension
        const whitespaceCol = Math.max(0, tsCol - 1);  // Map to column before token, but not negative
        if (!usedCols.has(whitespaceCol)) {
            usedCols.add(whitespaceCol);
            // Add whitespace mapping before the token
            addMapping(gen, {
                generated: { line: tsLine + 1, column: whitespaceCol },
                source: civetSource,
                original: { line: origLine + 1, column: origCol + cvLen },
            });
        }

        for (let i = 0; i < tsLen; i++) {
            const genCol = tsCol + i;
            if (usedCols.has(genCol)) continue;
            usedCols.add(genCol);

            // Determine which Civet char this TS char should align to
            let srcOffset: number;
            if (cvLen === 1) {
                srcOffset = 0;
            } else {
                // Edge-pin & spread (floor): ensures last TS char maps to last CV char
                srcOffset = Math.floor((i * cvLen) / tsLen);
            }

            addMapping(gen, {
                generated: { line: tsLine + 1, column: genCol },
                source: civetSource,
                original: { line: origLine + 1, column: origCol + srcOffset },
                name: anchor.text
            });
        }

        // Reserve the next column after the anchor for whitespace
        const nextCol = tsCol + tsLen;
        if (!usedCols.has(nextCol)) {
            usedCols.add(nextCol);
            // Add an explicit mapping for the whitespace position
            addMapping(gen, {
                generated: { line: tsLine + 1, column: nextCol },
                source: civetSource,
                original: { line: origLine + 1, column: origCol + cvLen },
            });
        }
      }

    // --- PASS 2: Null-Map Everything Else ---
    if (shouldLog) log('Starting Pass 2: Null-mapping unmapped positions');

    for (let lineIdx = 0; lineIdx < tsLines.length; lineIdx++) {
        const lineText = tsLines[lineIdx];
        const usedCols = usedGenPositions.get(lineIdx) || new Set<number>();

        for (let col = 0; col < lineText.length; col++) {
            if (usedCols.has(col)) continue; // Skip positions that have high-quality mappings

            // Explicitly null-map this position
            addMapping(gen, {
                generated: { line: lineIdx + 1, column: col }
            });

            if (shouldLog && lineIdx === tsLines.findIndex(l => l.includes('if (abc === query)'))) {
                log(`Null-mapped TSX L${lineIdx + 1}:C${col} (char: "${lineText[col]}")`);
            }
        }
    }

    const map = toEncodedMap(gen);
    map.sourcesContent = [civetContent];

    if (DEBUG_DENSE_MAP) {
      logFullDenseMap(map, tsCode, civetContent);
    }

    return map;
}
