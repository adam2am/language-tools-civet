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

//const DEBUG_DENSE_MAP = false;
//const logFullDenseMap = (..._args: any[]) => {}; // No-op for now

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
    const log = (_msg: string) => {}; // console.log(`[MAP_DEBUG] ${msg}`);
    const shouldLog = false;

    if (!civetMap) return createEmptySourceMap(svelteFile.filename);

    const civetSource = svelteFile.filename;
    const civetContent = civetMap.source || '';
    const civetLines = civetContent.split('\n');
    const tsLines = tsCode.split('\n');

    const gen = new GenMapping();
    setSourceContent(gen, civetSource, civetContent);

    const consumedMatchCount = new Map<string, number>();
    const lastMappedGenCol = new Map<number, number>();

    const anchors = collectAnchorsFromTs(tsCode, svelteFile.filename);
    anchors.sort((a, b) => {
        if (a.start.line !== b.start.line) return a.start.line - b.start.line;
        return a.start.character - b.start.character;
    });

    for (const anchor of anchors) {
        if (anchor.text.trim() === '') continue;

        if (isGeneratedIdentifier(anchor.text, anchor.kind)) {
            if (shouldLog) log(`Skipping generated identifier: ${anchor.text}`);
            continue;
        }

        const { line: tsLine, character: tsCol } = anchor.start;
        const tsLen = anchor.text.length;
        const tsEndCol = tsCol + tsLen;

        let civetLineIndex: number | undefined;
        if (typeof civetMap.mappings === 'string') {
            const decoded = decode(civetMap.mappings);
            const lineMapping = decoded[tsLine] || [];
            if (lineMapping.length > 0 && lineMapping[0].length >= 4) {
                civetLineIndex = lineMapping[0][2];
            }
        } else if (Array.isArray(civetMap.lines)) {
            const lineMapping = civetMap.lines[tsLine] || [];
            if (lineMapping.length > 0 && lineMapping[0].length >= 4) {
                civetLineIndex = lineMapping[0][2];
            }
        }

        if (civetLineIndex === undefined) {
            addMapping(gen, {
                generated: { line: tsLine + 1, column: tsCol },
                source: null as any,
                original: null as any,
            });
            lastMappedGenCol.set(tsLine, tsEndCol);
            continue;
        }
        
        const origLine = civetLineIndex + civetContentStartLine - 1;

        const lastCol = lastMappedGenCol.get(tsLine) ?? -1;
        if (tsCol > lastCol + 1) {
            // Gap before anchor: map to null so it doesn't point to Civet col 0
            addMapping(gen, {
                generated: { line: tsLine + 1, column: lastCol + 1 },
                source: null as any,
                original: null as any,
            });
        }

        const civetLineText = civetLines[civetLineIndex];
        const cacheKey = `${civetLineIndex}:${anchor.text}:${anchor.kind}`;
        const consumed = consumedMatchCount.get(cacheKey) || 0;

        const searchTokens = [anchor.text, ...(TS_TO_CIVET_ALIASES[anchor.text] ?? [])];
        let position: { startIndex: number; length: number } | undefined;
        let usedSearchText = anchor.text;

        for (const token of searchTokens) {
            position = locateTokenInCivetLine(civetLineText, token, anchor.kind, consumed);
            if (position) {
                usedSearchText = token;
                break;
            }
        }
        
        if (!position) {
            // Anchor text not found in Civet line: treat as generated (null mapping)
            addMapping(gen, {
                generated: { line: tsLine + 1, column: tsCol },
                source: null as any,
                original: null as any,
            });
            lastMappedGenCol.set(tsLine, tsEndCol);
            continue;
        }
        
        const actualCacheKey = `${civetLineIndex}:${usedSearchText}:${anchor.kind}`;
        consumedMatchCount.set(actualCacheKey, (consumedMatchCount.get(actualCacheKey) || 0) + 1);

        const origCol = indentLen + position.startIndex;

        // Map token start
        addMapping(gen, {
            generated: { line: tsLine + 1, column: tsCol },
            source: civetSource,
            original: { line: origLine + 1, column: origCol },
            name: anchor.text,
        });

        // Map token end (inclusive) so tooling knows exact range
        const origEndCol = origCol + position.length - 1;
        addMapping(gen, {
            generated: { line: tsLine + 1, column: tsEndCol - 1 },
            source: civetSource,
            original: { line: origLine + 1, column: origEndCol },
            name: anchor.text
        });

        // Map the whitespace character in Civet AFTER the token to TS column 0.
        // This provides a stable "default" mapping for any unmapped sections of the TS line.
        const afterOrigCol = origCol + position.length;
        addMapping(gen, {
            generated: { line: tsLine + 1, column: 0 },
            source: civetSource,
            original: { line: origLine + 1, column: afterOrigCol },
        });

        lastMappedGenCol.set(tsLine, tsEndCol);
    }

    for (let lineIdx = 0; lineIdx < tsLines.length; lineIdx++) {
        const lineText = tsLines[lineIdx];
        if (lineText.length === 0) continue;

        const lastCol = lastMappedGenCol.get(lineIdx) ?? -1;
        if (lastCol < lineText.length) {
            // Tail gap: always null-map instead of pointing to Civet col 0
            addMapping(gen, {
                generated: { line: lineIdx + 1, column: lastCol + 1 },
                source: null as any,
                original: null as any,
            });
        }
    }

    return toEncodedMap(gen);
}
