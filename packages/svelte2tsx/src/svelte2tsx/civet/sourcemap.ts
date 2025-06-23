import { GenMapping, setSourceContent, addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import type { LinesMap } from './types';
import * as ts from 'typescript';
// avoid unused-import linter errors
if (ts) { /* noop */ }

/**
 * Normalize a Civet-specific sourcemap (CivetLinesSourceMap, from Civet snippet -> TS snippet)
 * to be a standard V3 RawSourceMap from Original Svelte File -> TS snippet.
 *
 * This function implements an "Anchor-Based" generation strategy. It discards the original
 * Civet `lines` map for mapping generation and instead builds a new map from scratch.
 * It uses identifiers found in the compiled TS AST as "anchors" and finds their
 * corresponding text in the original Civet snippet to create high-confidence mappings.
 * This ensures compiler-generated helper variables are never mapped.
 *
 * @param civetMap The CivetLinesSourceMap containing the `lines` array from `civet.compile()`.
 * @param svelteFileContent The full content of the original .svelte file.
 * @param civetBlockStartLine 1-based Svelte line where snippet starts
 * @param indentation number of spaces stripped from snippet indent
 * @param svelteFilePath The actual file path of the .svelte file (for the output sourcemap's `sources` and `file` fields).
 * @param tsCode optional TS snippet for AST-based enhancements
 * @returns A Standard V3 RawSourceMap that maps from the original .svelte file to the compiled TS snippet.
 */
export function normalizeCivetMap(
  civetMap: LinesMap,
  svelteFileContent: string,
  civetBlockStartLine: number, // 1-based Svelte line where snippet starts
  indentation: number,           // number of spaces stripped from snippet indent
  svelteFilePath: string,
  tsCode?: string                // optional TS snippet for AST-based enhancements
): EncodedSourceMap {
  // Map TS operator tokens to their Civet equivalents. Defined up-front so the
  // AST walker and later search logic can reference it safely.
  const OPERATOR_MAP: Record<string, string> = {
    '===': ' is ',
    '!==': ' isnt ',
    '&&':  ' and ',
    '||':  ' or ',
    '!':   'not '
    // Extend as needed
  };

  // Phase 1: Collect identifier anchors *and* import string-literal anchors from TS AST.
  interface Anchor {
    text: string;              // identifier name or full literal (incl quotes or numeric text)
    start: ts.LineAndCharacter;
    end: ts.LineAndCharacter;
    kind: 'identifier' | 'stringLiteral' | 'numericLiteral' | 'operator';
  }

  const tsAnchors: Anchor[] = [];
  if (tsCode) {
    try {
      const tsSourceFile = ts.createSourceFile(
        `${svelteFilePath}-snippet.ts`,
        tsCode,
        ts.ScriptTarget.ESNext,
        true
      );

      function findAnchors(node: ts.Node) {
        if (ts.isIdentifier(node)) {
          const name = node.text;
          const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
          const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
          tsAnchors.push({ text: name, start, end, kind: 'identifier' });
        }

        // Add anchor for "import 'path'" string literals
        if (
          ts.isStringLiteral(node) &&
          ts.isImportDeclaration(node.parent) &&
          node === node.parent.moduleSpecifier
        ) {
          const modulePath = node.getText(tsSourceFile); // includes quotes
          const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
          const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
          tsAnchors.push({ text: modulePath, start, end, kind: 'stringLiteral' });
        }

        // Numeric literals
        if (ts.isNumericLiteral(node)) {
          const numText = node.getText(tsSourceFile); // e.g., "3", "1", "10.5"
          const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
          const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
          tsAnchors.push({ text: numText, start, end, kind: 'numericLiteral' });
        }

        // Operators and Punctuation
        if (ts.isToken(node) && node.kind >= ts.SyntaxKind.FirstPunctuation && node.kind <= ts.SyntaxKind.LastPunctuation) {
            const operatorText = node.getText(tsSourceFile);
            // Only collect operators we know how to map back to Civet text
            if (OPERATOR_MAP.hasOwnProperty(operatorText)) {
                const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
                const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
                tsAnchors.push({ text: operatorText, start, end, kind: 'operator' });
            }
        }

        node.getChildren(tsSourceFile).forEach(findAnchors);
      }
      findAnchors(tsSourceFile);
    } catch (e) {
      console.error(`[MAP_TO_V3 ${svelteFilePath}] Error parsing compiled TS for AST: ${(e as Error).message}`);
    }
  }

  // Phase 2: Build a new sourcemap from scratch using the collected anchors.
  const mapGenerator = new GenMapping({ file: svelteFilePath });
  setSourceContent(mapGenerator, svelteFilePath, svelteFileContent);

  if (!tsCode || !civetMap.lines) {
    return toEncodedMap(mapGenerator);
  }

  const civetCodeLines = (civetMap.source || '').split('\n');

  // To avoid re-searching the same Civet line, we cache found identifier positions.
  const identifierCacheByLine = new Map<number, { text: string, column: number }[]>();
  // Cache of numeric literal positions for each Civet line. Extracted once per line on demand.
  const numericLiteralCacheByLine = new Map<number, { text: string; column: number }[]>();

  // Create a quick lookup to find the approximate Civet snippet line for a given TS line.
  const tsLineToCivetLineMap = new Map<number, number>();
  civetMap.lines.forEach((segments, tsLineIdx) => {
    for (const seg of segments) {
      if (seg.length >= 4) {
        tsLineToCivetLineMap.set(tsLineIdx, seg[2]);
        return; // Found the first mapping for this line, which is sufficient.
      }
    }
  });

  // Keep track of which matches on a Civet line have been "consumed" to handle multiple identical identifiers.
  const consumedMatchCount = new Map<string, number>();

  for (const anchor of tsAnchors) {
    const tsLineIndex = anchor.start.line;
    let civetLineIndex = tsLineToCivetLineMap.get(tsLineIndex);

    if (civetLineIndex === undefined) {
      // Heuristic fallback (Approach F): If the TS line has no mapping from the
      // `lines` array (common when there's a parse error), scan the original
      // Civet snippet for the first line containing the anchor's text. This
      // provides a "best-effort" mapping for identifiers on lines that Civet
      // omitted from its partial sourcemap.
      const foundLineIndex = civetCodeLines.findIndex(line => line.includes(anchor.text));
      if (foundLineIndex !== -1) {
        civetLineIndex = foundLineIndex;
      } else {
        continue; // Still couldn't find it, skip this anchor
      }
    }

    const civetLineText = civetCodeLines[civetLineIndex] || '';

    // Prepare or reuse cache for identifier matches only (string literals searched directly)
    if (anchor.kind === 'identifier' && !identifierCacheByLine.has(civetLineIndex)) {
      const matches: { text: string; column: number }[] = [];
      const idRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
      let match;
      while ((match = idRegex.exec(civetLineText)) !== null) {
        matches.push({ text: match[0], column: match.index });
      }
      identifierCacheByLine.set(civetLineIndex, matches);
    }

    let civetColumn: number | undefined;
    let cacheKey: string;

    if (anchor.kind === 'identifier') {
      // ---------------- Identifier ----------------
      const availableMatches = identifierCacheByLine.get(civetLineIndex)!;
      cacheKey = `${civetLineIndex}:${anchor.text}`;
      const consumedCount = consumedMatchCount.get(cacheKey) || 0;
      const potentialMatches = availableMatches.filter(m => m.text === anchor.text);
      const selectedMatch = potentialMatches[consumedCount];
      if (selectedMatch) {
        civetColumn = selectedMatch.column;
        consumedMatchCount.set(cacheKey, consumedCount + 1);
      }
    } 
    else if (anchor.kind === 'numericLiteral') {
      // ---------------- Numeric Literal ----------------
      if (!numericLiteralCacheByLine.has(civetLineIndex)) {
        const matches: { text: string; column: number }[] = [];
        const numRegex = /\b\d+(?:\.\d+)?\b/g; // standalone numeric tokens
        let match: RegExpExecArray | null;
        while ((match = numRegex.exec(civetLineText)) !== null) {
          matches.push({ text: match[0], column: match.index });
        }
        numericLiteralCacheByLine.set(civetLineIndex, matches);
      }
      const availableMatches = numericLiteralCacheByLine.get(civetLineIndex)!;
      cacheKey = `${civetLineIndex}:num:${anchor.text}`;
      const consumedCount = consumedMatchCount.get(cacheKey) || 0;
      const potentialMatches = availableMatches.filter(m => m.text === anchor.text);
      const selectedMatch = potentialMatches[consumedCount];
      if (selectedMatch) {
        civetColumn = selectedMatch.column;
        consumedMatchCount.set(cacheKey, consumedCount + 1);
      }
    } 
    else if (anchor.kind === 'stringLiteral') {
      // ---------------- String Literal ----------------
      const searchText = anchor.text; // includes quotes
      cacheKey = `${civetLineIndex}:str:${searchText}`;
      const consumedCount = consumedMatchCount.get(cacheKey) || 0;
      let foundIndex = -1;
      let searchOffset = 0;
      for (let i = 0; i <= consumedCount; i++) {
        foundIndex = civetLineText.indexOf(searchText, searchOffset);
        if (foundIndex === -1) break;
        searchOffset = foundIndex + searchText.length;
      }
      if (foundIndex !== -1) {
        civetColumn = foundIndex;
        consumedMatchCount.set(cacheKey, consumedCount + 1);
      }
    } 
    else {
      // ---------------- Operator / punctuation ----------------
      const searchText = OPERATOR_MAP[anchor.text] || anchor.text;
      cacheKey = `${civetLineIndex}:op:${searchText}`;
      const consumedCount = consumedMatchCount.get(cacheKey) || 0;
      let foundIndex = -1;
      let searchOffset = 0;
      for (let i = 0; i <= consumedCount; i++) {
        foundIndex = civetLineText.indexOf(searchText, searchOffset);
        if (foundIndex === -1) break;
        searchOffset = foundIndex + searchText.length;
      }
      if (foundIndex !== -1) {
        civetColumn = foundIndex;
        consumedMatchCount.set(cacheKey, consumedCount + 1);
      }
    }

    if (civetColumn === undefined) {
      continue; // Could not find anchor in Civet snippet line.
    }

    const sourceSvelteLine = civetBlockStartLine + civetLineIndex;
    const sourceSvelteCol = civetColumn + indentation;

    // Add mapping for start of anchor
    addMapping(mapGenerator, {
      source: svelteFilePath,
      generated: { line: anchor.start.line + 1, column: anchor.start.character },
      original: { line: sourceSvelteLine, column: sourceSvelteCol },
      name: anchor.kind === 'identifier' ? anchor.text : undefined,
    });

    // Add mapping for end of anchor
    const endColAdjustment = anchor.kind === 'stringLiteral' ? anchor.text.length - 1 : (OPERATOR_MAP[anchor.text]?.length ?? anchor.text.length)
    addMapping(mapGenerator, {
      source: svelteFilePath,
      generated: { line: anchor.end.line + 1, column: anchor.end.character - (anchor.kind === 'stringLiteral' ? 1 : 0) },
      original: { line: sourceSvelteLine, column: sourceSvelteCol + endColAdjustment },
      name: anchor.kind === 'identifier' ? anchor.text : undefined,
    });

    // For string literals, no interior mappings – start & closing quote only (handled above)
  }

  /* --------------------------------------------------------------
   * Gap-filling: ensure there is **always** a column-0 mapping on any
   * TS line that originates from the Civet snippet.  This prevents
   * trace-mapping fallback from jumping to the previous line when a
   * diagnostic starts at col 0 (e.g. the `import` keyword).
   * ------------------------------------------------------------ */
  const mappedTsLines = new Set<number>();
  for (const anchor of tsAnchors) {
    mappedTsLines.add(anchor.start.line);
    mappedTsLines.add(anchor.end.line);
  }

  const addedMappings = new Set<string>();
  for (const tsLine of mappedTsLines) {
    const snippetStartLine = civetBlockStartLine;
    const snippetIndent = indentation; // indent length

    const addMappingIfNew = (col: number) => {
      const key = `${tsLine}:${col}`;
      if (addedMappings.has(key)) return;
      addedMappings.add(key);
      addMapping(mapGenerator, {
        source: svelteFilePath,
        generated: { line: tsLine + 1, column: col },
        original: { line: snippetStartLine + tsLine, column: snippetIndent },
      });
    };

    // Ensure at least col 0 and col indent mapping exist
    addMappingIfNew(0);
    if (indentation > 0) addMappingIfNew(indentation);
  }

  /* --------------------------------------------------------------
   * (End-of-line anchor code removed – see commit reverting Approach A)
   * ------------------------------------------------------------ */

  // Finalize the map and return
  const outputMap = toEncodedMap(mapGenerator);
  outputMap.sources = [svelteFilePath];
  outputMap.sourcesContent = [svelteFileContent];
  return outputMap;
}
