// import { GenMapping, setSourceContent, addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
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

  // ---------------------------------------------------------------------------
  // Phase 2: AST-Driven Dense Map Generation
  //
  // This strategy abandons "post-processing" in favor of building a correct,
  // dense sourcemap in a single pass. It iterates through the collected TS
  // anchors and, for every token, explicitly decides whether to map it to the
  // original source or to null. Gaps between tokens are also filled with null
  // mappings. This prevents "fall-through" errors in chained sourcemap consumers.
  // ---------------------------------------------------------------------------
  const debugDenseMap = true; // Toggle for verbose dense-map generation logs

  let outputMap: EncodedSourceMap = {
    version: 3,
    file: svelteFilePath,
    sources: [svelteFilePath],
    sourcesContent: [svelteFileContent],
    mappings: '',
    names: [],
  };

  if (!tsCode || !civetMap.lines) {
    return outputMap;
  }

  const civetCodeLines = (civetMap.source || '').split('\n');
  const tsLines = tsCode.split('\n');

  // Create a quick lookup to find the approximate Civet snippet line for a given TS line.
  const tsLineToCivetLineMap = new Map<number, number>();
  civetMap.lines.forEach((segments, tsLineIdx) => {
    for (const seg of segments) {
      if (seg.length >= 4) {
        tsLineToCivetLineMap.set(tsLineIdx, seg[2]);
        return;
      }
    }
  });

  // Collect identifiers that are compiler-generated to map them to null.
  const generatedIdentifiers = new Set<string>();
  for (const anchor of tsAnchors) {
    if (anchor.kind !== 'identifier') continue;
    const wordRegex = new RegExp(`\\b${anchor.text}\\b`);
    if (!civetCodeLines.some(line => wordRegex.test(line))) {
      generatedIdentifiers.add(anchor.text);
    }
  }

  // Group all anchors by their line number for sequential processing.
  const anchorsByLine = new Map<number, Anchor[]>();
  for (const anchor of tsAnchors) {
    if (!anchorsByLine.has(anchor.start.line)) {
      anchorsByLine.set(anchor.start.line, []);
    }
    anchorsByLine.get(anchor.start.line)!.push(anchor);
  }
  // Sort anchors within each line by column to process them in order.
  for (const lineAnchors of anchorsByLine.values()) {
    lineAnchors.sort((a, b) => a.start.character - b.start.character);
  }

  const names = Array.from(new Set(tsAnchors.filter(a => a.kind === 'identifier').map(a => a.text)));
  const decoded: number[][][] = [];
  const consumedMatchCount = new Map<string, number>();

  for (let i = 0; i < tsLines.length; i++) {
    const lineAnchors = anchorsByLine.get(i) || [];
    const lineSegments: number[][] = [];
    let lastGenCol = 0;

    for (const anchor of lineAnchors) {
      // --- Fill gap before this token with a null mapping ---
      if (anchor.start.character > lastGenCol) {
        if (debugDenseMap) console.log(`[DENSE_MAP_NULL] Gap filler at ${i}:${lastGenCol}`);
        lineSegments.push([lastGenCol]);
      }

      // --- Determine mapping for the current token ---
      let isGenerated = false;
      if (anchor.kind === 'identifier' && generatedIdentifiers.has(anchor.text)) {
        isGenerated = true;
      }

      if (isGenerated) {
        if (debugDenseMap) console.log(`[DENSE_MAP_NULL] Generated token '${anchor.text}' at ${i}:${anchor.start.character}`);
        lineSegments.push([anchor.start.character]);
        lastGenCol = anchor.end.character;
        continue;
      }

      // It's not a known generated token, so try to find its original position.
      const civetLineIndex = tsLineToCivetLineMap.get(i);
      if (civetLineIndex === undefined) {
        if (debugDenseMap) console.log(`[DENSE_MAP_NULL] No civet line for TS line ${i}, null mapping token '${anchor.text}'`);
        lineSegments.push([anchor.start.character]);
        lastGenCol = anchor.end.character;
        continue;
      }

      const civetLineText = civetCodeLines[civetLineIndex] || '';
      let civetColumn: number | undefined;
      const searchText = anchor.kind === 'operator' ? (OPERATOR_MAP[anchor.text] || anchor.text) : anchor.text;
      const cacheKey = `${civetLineIndex}:${searchText}`;
      const consumedCount = consumedMatchCount.get(cacheKey) || 0;
      let foundIndex = -1;
      let searchOffset = 0;
      for (let j = 0; j <= consumedCount; j++) {
        foundIndex = civetLineText.indexOf(searchText, searchOffset);
        if (foundIndex === -1) break;
        searchOffset = foundIndex + searchText.length;
      }

      if (foundIndex !== -1) {
        civetColumn = foundIndex;
        consumedMatchCount.set(cacheKey, consumedCount + 1);
      }

      if (civetColumn !== undefined) {
        const sourceSvelteLine = (civetBlockStartLine - 1) + civetLineIndex;
        const sourceSvelteCol = civetColumn + indentation;
        const nameIdx = anchor.kind === 'identifier' ? names.indexOf(anchor.text) : -1;
        const segment = [anchor.start.character, 0, sourceSvelteLine, sourceSvelteCol];
        if (nameIdx > -1) segment.push(nameIdx);
        
        lineSegments.push(segment);
        if (debugDenseMap) console.log(`[DENSE_MAP_SEG] Mapped '${anchor.text}' at ${i}:${anchor.start.character} to Svelte L${sourceSvelteLine}:${sourceSvelteCol}`);
        if (debugDenseMap) console.log(`[SOURCE_LINE_FIX] Mapped '${anchor.text}' civetLineIdx=${civetLineIndex} -> svelteLine=${sourceSvelteLine}`);
      } else {
        // Could not find in original line, treat as generated.
        if (debugDenseMap) console.log(`[DENSE_MAP_NULL] Could not find '${anchor.text}' in Civet line, null mapping at ${i}:${anchor.start.character}`);
        lineSegments.push([anchor.start.character]);
      }

      lastGenCol = anchor.end.character;
    }

    // --- Fill final gap from last token to end of line ---
    if (lastGenCol < tsLines[i].length) {
      if (debugDenseMap) console.log(`[DENSE_MAP_NULL] EOL Gap filler at ${i}:${lastGenCol}`);
      lineSegments.push([lastGenCol]);
    }

    if (lineSegments.length > 0) {
      if (debugDenseMap) console.log(`[DENSE_LINE_DONE] Final segments for TS line ${i}: ${JSON.stringify(lineSegments)}`);
      decoded.push(lineSegments);
    } else {
      // For completely empty lines, push an empty segment array
      decoded.push([]);
    }
  }

  const { encode } = require('@jridgewell/sourcemap-codec');
  outputMap.mappings = encode(decoded);
  outputMap.names = names;

  return outputMap;
}
