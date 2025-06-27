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
  // Helper to escape regex metacharacters in searchText
  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let foundIndex = -1;
    let searchOffset = 0;

    for (let i = 0; i <= consumedCount; i++) {
        if (kind === 'identifier' || kind === 'keyword') {
            const escaped = escapeRegExp(searchText);
            const regex = new RegExp(`(?<![\\p{L}\\p{N}_$])${escaped}(?![\\p{L}\\p{N}_$])`, 'u');
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
        const origCol = indentLen + position.startIndex; // include outer <script> indent exactly once

        // Track this position as used on the generated side
        let usedCols = usedGenPositions.get(tsLine);
        if (!usedCols) {
            usedCols = new Set<number>();
            usedGenPositions.set(tsLine, usedCols);
        }

        const tsLen = anchor.text.length;      // length in generated code
        const cvLen = position.length;         // matched length in Civet source

        // We map ONLY the first generated column of the token. All following columns inherit this
        // mapping until the next segment. This keeps the map small while remaining accurate.
        const genColStart = tsCol;
        if (!usedCols.has(genColStart)) {
            usedCols.add(genColStart);
            addMapping(gen, {
                generated: { line: tsLine + 1, column: genColStart },
                source: civetSource,
                original: { line: origLine + 1, column: origCol },
                name: anchor.text
            });
        }

        // Mark the rest of the token columns as "already taken" so PASS-2 knows they are mapped,
        // but DON'T emit individual mappings for them.
        for (let i = 1; i < tsLen; i++) {
            usedCols.add(tsCol + i);
        }

        // Reserve the column _after_ the token as eligible for null-mapping so that whitespace does
        // not inherit the token mapping. We do **not** map it here – PASS-2 will place a single
        // null segment at the start of the whitespace run.

        // Map whitespace AFTER token
        const wsColAfterInCivet = indentLen + position.startIndex + cvLen; // char right after token
        const wsAfterChar = civetLineText[position.startIndex + cvLen];
        if (!usedCols.has(tsCol + tsLen) && wsAfterChar && /\s/.test(wsAfterChar)) {
            usedCols.add(tsCol + tsLen);
            addMapping(gen, {
                generated: { line: tsLine + 1, column: tsCol + tsLen },
                source: civetSource,
                original: { line: origLine + 1, column: wsColAfterInCivet },
            });
        }
    }

    // --- PASS 2: Null-Map Unmapped GENERATED positions ---
    if (shouldLog) log('Starting Pass 2: Null-mapping unmapped GENERATED positions');

    for (let lineIdx = 0; lineIdx < tsLines.length; lineIdx++) {
        const lineText = tsLines[lineIdx];
        const usedCols = usedGenPositions.get(lineIdx) || new Set<number>();

        let inUnmappedRun = false;
        for (let col = 0; col < lineText.length; col++) {
            const isMapped = usedCols.has(col);
            if (!isMapped && !inUnmappedRun) {
                // We just entered an unmapped run: emit ONE null segment
                addMapping(gen, {
                    generated: { line: lineIdx + 1, column: col }
                });
                inUnmappedRun = true;

                if (shouldLog && lineIdx === tsLines.findIndex(l => l.includes('if (abc === query)'))) {
                    log(`Null-mapped (run start) TSX L${lineIdx + 1}:C${col} (char: "${lineText[col]}")`);
                }
            } else if (isMapped && inUnmappedRun) {
                // Exiting unmapped run
                inUnmappedRun = false;
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
