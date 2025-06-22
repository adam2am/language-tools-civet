import { GenMapping, setSourceContent, addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import type { CivetLinesSourceMap } from './types';
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
 * @param originalFullSvelteContent The full content of the original .svelte file.
 * @param originalContentStartLine_1based 1-based Svelte line where snippet starts
 * @param removedIndentLength number of spaces stripped from snippet indent
 * @param svelteFilePath The actual file path of the .svelte file (for the output sourcemap's `sources` and `file` fields).
 * @param compiledTsCode optional TS snippet for AST-based enhancements
 * @returns A Standard V3 RawSourceMap that maps from the original .svelte file to the compiled TS snippet.
 */
export function normalizeCivetMap(
  civetMap: CivetLinesSourceMap,
  originalFullSvelteContent: string,
  originalContentStartLine_1based: number, // 1-based Svelte line where snippet starts
  removedIndentLength: number,           // number of spaces stripped from snippet indent
  svelteFilePath: string,
  compiledTsCode?: string                // optional TS snippet for AST-based enhancements
): EncodedSourceMap {
  // Phase 1: Collect identifier anchors *and* import string-literal anchors from TS AST.
  interface Anchor {
    text: string;              // identifier name or full literal (incl quotes or numeric text)
    start: ts.LineAndCharacter;
    end: ts.LineAndCharacter;
    kind: 'identifier' | 'stringLiteral' | 'numericLiteral' | 'operator';
  }

  const tsAnchors: Anchor[] = [];
  if (compiledTsCode) {
    try {
      const sourceFile = ts.createSourceFile(
        `${svelteFilePath}-snippet.ts`,
        compiledTsCode,
        ts.ScriptTarget.ESNext,
        true
      );

      function walk(node: ts.Node) {
        if (ts.isIdentifier(node)) {
          const name = node.text;
          const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
          const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
          tsAnchors.push({ text: name, start, end, kind: 'identifier' });
        }

        // Add anchor for "import 'path'" string literals
        if (
          ts.isStringLiteral(node) &&
          ts.isImportDeclaration(node.parent) &&
          node === node.parent.moduleSpecifier
        ) {
          const literalTextWithQuotes = node.getText(sourceFile); // includes quotes
          const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
          const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
          tsAnchors.push({ text: literalTextWithQuotes, start, end, kind: 'stringLiteral' });
        }

        // Numeric literals
        if (ts.isNumericLiteral(node)) {
          const numText = node.getText(sourceFile); // e.g., "3", "1", "10.5"
          const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
          const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
          tsAnchors.push({ text: numText, start, end, kind: 'numericLiteral' });
        }

        // Operators and Punctuation
        if (ts.isToken(node) && node.kind >= ts.SyntaxKind.FirstPunctuation && node.kind <= ts.SyntaxKind.LastPunctuation) {
            const operatorText = node.getText(sourceFile);
            const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
            const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
            tsAnchors.push({ text: operatorText, start, end, kind: 'operator' });
        }

        node.getChildren(sourceFile).forEach(walk);
      }
      walk(sourceFile);
    } catch (e) {
      console.error(`[MAP_TO_V3 ${svelteFilePath}] Error parsing compiled TS for AST: ${(e as Error).message}`);
    }
  }

  // Phase 2: Build a new sourcemap from scratch using the collected anchors.
  const gen = new GenMapping({ file: svelteFilePath });
  setSourceContent(gen, svelteFilePath, originalFullSvelteContent);

  if (!compiledTsCode || !civetMap.lines) {
    return toEncodedMap(gen);
  }

  const civetSnippetLines = (civetMap.source || '').split('\n');

  // To avoid re-searching the same Civet line, we cache found identifier positions.
  const civetLineIdMatchCache = new Map<number, { text: string, column: number }[]>();
  // Cache of numeric literal positions for each Civet line. Extracted once per line on demand.
  const civetLineNumMatchCache = new Map<number, { text: string; column: number }[]>();

  // Defines mappings from compiled TypeScript operators back to their original
  // Civet source text. This is necessary because the TS AST only sees the
  // compiled form (e.g., '==='), but we need to search for the original
  // text (e.g., ' is ') in the Civet snippet.
  const OPERATOR_MAP: Record<string, string> = {
      '===': ' is ',
      '!==': ' isnt ',
      '&&':  ' and ',
      '||':  ' or ',
      '!':   'not '
      // Add other mappings as needed
  };

  // Create a quick lookup to find the approximate Civet snippet line for a given TS line.
  const tsLineToCivetLine = new Map<number, number>();
  civetMap.lines.forEach((segments, tsLineIdx) => {
    for (const seg of segments) {
      if (seg.length >= 4) {
        tsLineToCivetLine.set(tsLineIdx, seg[2]);
        return; // Found the first mapping for this line, which is sufficient.
      }
    }
  });

  // Keep track of which matches on a Civet line have been "consumed" to handle multiple identical identifiers.
  const consumedMatches = new Map<string, number>();

  for (const anchor of tsAnchors) {
    const tsLineIdx = anchor.start.line;
    let civetSnippetLineIdx = tsLineToCivetLine.get(tsLineIdx);

    if (civetSnippetLineIdx === undefined) {
      // Heuristic fallback (Approach F): If the TS line has no mapping from the
      // `lines` array (common when there's a parse error), scan the original
      // Civet snippet for the first line containing the anchor's text. This
      // provides a "best-effort" mapping for identifiers on lines that Civet
      // omitted from its partial sourcemap.
      const foundLineIdx = civetSnippetLines.findIndex(line => line.includes(anchor.text));
      if (foundLineIdx !== -1) {
        civetSnippetLineIdx = foundLineIdx;
      } else {
        continue; // Still couldn't find it, skip this anchor
      }
    }

    const lineText = civetSnippetLines[civetSnippetLineIdx] || '';

    // Prepare or reuse cache for identifier matches only (string literals searched directly)
    if (anchor.kind === 'identifier' && !civetLineIdMatchCache.has(civetSnippetLineIdx)) {
      const matches: { text: string; column: number }[] = [];
      const idRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
      let m;
      while ((m = idRegex.exec(lineText)) !== null) {
        matches.push({ text: m[0], column: m.index });
      }
      civetLineIdMatchCache.set(civetSnippetLineIdx, matches);
    }

    let targetColumn: number | undefined;
    let cacheKey: string;

    if (anchor.kind === 'identifier') {
      // ---------------- Identifier ----------------
      const available = civetLineIdMatchCache.get(civetSnippetLineIdx)!;
      cacheKey = `${civetSnippetLineIdx}:${anchor.text}`;
      const consumedCount = consumedMatches.get(cacheKey) || 0;
      const potential = available.filter(m => m.text === anchor.text);
      const pick = potential[consumedCount];
      if (pick) {
        targetColumn = pick.column;
        consumedMatches.set(cacheKey, consumedCount + 1);
      }
    } else if (anchor.kind === 'numericLiteral') {
      // ---------------- Numeric Literal ----------------
      if (!civetLineNumMatchCache.has(civetSnippetLineIdx)) {
        const matches: { text: string; column: number }[] = [];
        const numRegex = /\b\d+(?:\.\d+)?\b/g; // standalone numeric tokens
        let m: RegExpExecArray | null;
        while ((m = numRegex.exec(lineText)) !== null) {
          matches.push({ text: m[0], column: m.index });
        }
        civetLineNumMatchCache.set(civetSnippetLineIdx, matches);
      }
      const available = civetLineNumMatchCache.get(civetSnippetLineIdx)!;
      cacheKey = `${civetSnippetLineIdx}:num:${anchor.text}`;
      const consumedCount = consumedMatches.get(cacheKey) || 0;
      const potential = available.filter(m => m.text === anchor.text);
      const pick = potential[consumedCount];
      if (pick) {
        targetColumn = pick.column;
        consumedMatches.set(cacheKey, consumedCount + 1);
      }
    } else if (anchor.kind === 'stringLiteral') {
      // ---------------- String Literal ----------------
      const searchText = anchor.text; // includes quotes
      cacheKey = `${civetSnippetLineIdx}:str:${searchText}`;
      const consumedCount = consumedMatches.get(cacheKey) || 0;
      let idx = -1;
      let searchFrom = 0;
      for (let found = 0; found <= consumedCount; found++) {
        idx = lineText.indexOf(searchText, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + searchText.length;
      }
      if (idx !== -1) {
        targetColumn = idx;
        consumedMatches.set(cacheKey, consumedCount + 1);
      }
    } else {
      // ---------------- Operator / punctuation ----------------
      const searchText = OPERATOR_MAP[anchor.text] || anchor.text;
      cacheKey = `${civetSnippetLineIdx}:op:${searchText}`;
      const consumedCount = consumedMatches.get(cacheKey) || 0;
      let idx = -1;
      let searchFrom = 0;
      for (let found = 0; found <= consumedCount; found++) {
        idx = lineText.indexOf(searchText, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + searchText.length;
      }
      if (idx !== -1) {
        targetColumn = idx;
        consumedMatches.set(cacheKey, consumedCount + 1);
      }
    }

    if (targetColumn === undefined) {
      continue; // Could not find anchor in Civet snippet line.
    }

    const originalSvelteLine = originalContentStartLine_1based + civetSnippetLineIdx;
    const originalSvelteCol = targetColumn + removedIndentLength;

    // Add mapping for start of anchor
    addMapping(gen, {
      source: svelteFilePath,
      generated: { line: anchor.start.line + 1, column: anchor.start.character },
      original: { line: originalSvelteLine, column: originalSvelteCol },
      name: anchor.kind === 'identifier' ? anchor.text : undefined,
    });

    // Add mapping for end of anchor
    const endColAdjustment = anchor.kind === 'stringLiteral' ? anchor.text.length - 1 : (OPERATOR_MAP[anchor.text]?.length ?? anchor.text.length)
    addMapping(gen, {
      source: svelteFilePath,
      generated: { line: anchor.end.line + 1, column: anchor.end.character - (anchor.kind === 'stringLiteral' ? 1 : 0) },
      original: { line: originalSvelteLine, column: originalSvelteCol + endColAdjustment },
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
  const generatedLinesWithMappings = new Set<number>();
  for (const anchor of tsAnchors) {
    generatedLinesWithMappings.add(anchor.start.line);
    generatedLinesWithMappings.add(anchor.end.line);
  }

  for (const line of generatedLinesWithMappings) {
    const blockStartLineInSvelte = originalContentStartLine_1based;
    const blockStartColInSvelte = removedIndentLength; // indent length

    // Column 0 – indent itself
    addMapping(gen, {
      source: svelteFilePath,
      generated: { line: line + 1, column: 0 },
      original: { line: blockStartLineInSvelte + line, column: blockStartColInSvelte },
    });

    // Column where the `import` keyword starts (after indent)
    addMapping(gen, {
      source: svelteFilePath,
      generated: { line: line + 1, column: removedIndentLength },
      original: { line: blockStartLineInSvelte + line, column: blockStartColInSvelte },
    });
  }

  /* --------------------------------------------------------------
   * (End-of-line anchor code removed – see commit reverting Approach A)
   * ------------------------------------------------------------ */

  // Finalize the map and return
  const outputMap = toEncodedMap(gen);
  outputMap.sources = [svelteFilePath];
  outputMap.sourcesContent = [originalFullSvelteContent];
  return outputMap;
}
