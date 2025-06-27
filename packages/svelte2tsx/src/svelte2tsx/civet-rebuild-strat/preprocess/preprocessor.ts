import MagicString from 'magic-string';
import { parseHtmlx as parseHtmlxOriginal } from '../../../utils/htmlxparser';
import { parse as svelteParse } from 'svelte/compiler';
import { compileCivet } from '../compile/compiler';
import { normalize } from '../mapping/normalizer';
import { getAttributeValue, getActualContentStartLine } from '../util/htmlx';
import { stripCommonIndent } from '../util/string';
import type { ProcessResult, BlockInfo } from '../types';
import { loadCompileOpts } from '../compile/config';

const civetPreprocessorDebug = false;

/**
 * Helper to convert a character offset to a 1-based line and column.
 */
function offsetToPosition(text: string, offset: number): { line: number; column: number } {
    let line = 1;
    let column = 1;
    for (let i = 0; i < offset; i++) {
        if (text[i] === '\n') {
            line++;
            column = 1;
        } else {
            column++;
        }
    }
    return { line, column };
}

/**
 * Preprocess a Svelte document, compiling any <script lang="civet"> blocks
 * into TypeScript and normalizing their sourcemaps.
 */
export function preprocessCivet(
    svelteCode: string,
    filename: string,
    parse: typeof svelteParse = svelteParse,
    civetModule?: typeof import('@danielx/civet')
): ProcessResult {
  const magic = new MagicString(svelteCode);
  const { tags } = parseHtmlxOriginal(svelteCode, parse, {
    emitOnTemplateError: false,
    svelte5Plus: true
  });
  const result: ProcessResult = { code: svelteCode };

  let offsetShift = 0;
  // Hoist config loading out of the loop to avoid redundant fs calls
  const civetCompileOptions = loadCompileOpts(filename);

  for (const tag of tags) {
    if (tag.type !== 'Script') continue;
    const lang = getAttributeValue((tag).attributes, 'lang');
    if (lang !== 'civet') continue;

    const start = tag.content.start; // Offset in the *original* svelte string.
    const end = tag.content.end;
    const snippet = svelteCode.slice(start, end).replace(/\s+$/, '');
    
    // Remove leading blank lines to avoid offset mismatches
    const trimmed = snippet.replace(/^(?:[ \t]*[\r\n])+/,'');
    const { dedented: content, indent: indentStr } = stripCommonIndent(trimmed);

    try {
      const context = getAttributeValue(tag.attributes, 'context');
      const hasModuleAttribute = tag.attributes.some(attr => attr.name === 'module');
      const isModule = context === 'module' || hasModuleAttribute;

      // We will only change lang="civet" → "ts" **after** successful compilation to avoid
      // leaving invalid TS code behind.  Capture the attribute value range now so we can
      // overwrite it later if compilation succeeds.
      const langAttributeNode = tag.attributes.find(attr => attr.name === 'lang' && attr.value !== true);
      let langValueStart = -1;
      let langValueEnd = -1;
      if (langAttributeNode && Array.isArray(langAttributeNode.value) && langAttributeNode.value.length > 0) {
          const langValueNode = langAttributeNode.value[0]; // Text node
          langValueStart = langValueNode.start + 1; // skip opening quote
          langValueEnd   = langValueNode.end - 1;   // exclude closing quote
      }

      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] Original Civet snippet before dedent:
${snippet}`);
      if (civetPreprocessorDebug) {
        console.log(`[preprocessCivet] Detected <script lang="civet"> (${isModule ? 'module' : 'instance'}) at offsets ${start}-${end}`);
        console.log(`[preprocessCivet] Original snippet content:\n${snippet}`);
      }

      // Dedent the trimmed snippet to strip common leading whitespace for accurate mapping
      const indentLen = indentStr.length;
      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] Civet snippet after dedent:
${content}`);
      if (civetPreprocessorDebug) console.log(`[preprocessCivet] Dedented snippet content:\n${content}`);
      
      // Compile Civet to TS and get raw sourcemap from dedented snippet
      const { code: tsCode, rawMap: civetMapRaw } = compileCivet(
        content,
        filename,
        {
          civetModule,
          civetCompileOptions
        }
      );
      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] Compiled TS code from Civet:
${tsCode}`);
      if (civetPreprocessorDebug) console.log(`[preprocessCivet] compileCivet output code length: ${tsCode.length}, rawMap lines count: ${civetMapRaw && 'lines' in civetMapRaw ? civetMapRaw.lines.length : 0}`);

      if (!civetMapRaw || !('lines' in civetMapRaw)) {
          // Skip any mutation of this <script> block so that the original source
          // (including the original indent/whitespace) stays intact. This
          // avoids accidental position shifts when Civet compilation fails or
          // returns no usable sourcemap.
          continue;
      }

      // Compute line offset for snippet within the Svelte file dynamically by finding first content line
      const civetContentStartLine = getActualContentStartLine(svelteCode, start);
      const civetSnippetStartLineIndex = civetContentStartLine - 1;

      if (civetPreprocessorDebug) console.log(`[preprocessCivet] Civet snippet offsets ${start}-${end} -> Svelte line ${civetContentStartLine}`);

      if (civetPreprocessorDebug) console.log(`[preprocessCivet] originalContentStartLine_1based: ${civetContentStartLine}, snippet offset (0-based): ${civetSnippetStartLineIndex}`);

      // Normalize the Civet sourcemap to a standard V3 map
      const mapFromNormalize = normalize(
        civetMapRaw,
        tsCode,
        { getText: () => svelteCode, filename },
        civetCompileOptions,
        civetContentStartLine,
        indentLen
      );
      // Debug: log first segment of normalized map mappings
      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] normalized map first semicolon segment: ${mapFromNormalize.mappings.split(';')[0]}`);
      if (civetPreprocessorDebug) console.log(`[preprocessCivet] normalizeCivetMap returned map mappings length: ${mapFromNormalize.mappings.split(';').length}`);

      // --- Rewrite the Svelte file content ---
      const indentString = indentStr;
      const trimmedCompiledTsCode = tsCode.replace(/\r?\n+$/g, '');
      const reindentedTsCode = '\n' + trimmedCompiledTsCode.split('\n').map(line => `${indentString}${line}`).join('\n') + '\n';
      
      const langAttrLengthChange = (langValueStart !== -1) ? ('ts'.length - (langValueEnd - langValueStart)) : 0;
      const contentLengthChange = reindentedTsCode.length - (end - start);
      
      // Perform overwrites now that all calculations are done.
      if (langValueStart !== -1) {
          magic.overwrite(langValueStart, langValueEnd, 'ts');
      }
      magic.overwrite(start, end, reindentedTsCode);

      // --- Calculate final positions and build block data ---
      // The start of the script block in the *final string* is its original `start`
      // plus all shifts from previous blocks.
      const blockStartInOutput = start + offsetShift;
      // The TS code content starts after the lang attribute has potentially changed length.
      const tsCodeStartInOutput = blockStartInOutput + langAttrLengthChange;

      const civetLineCount = svelteCode.slice(start, end).split('\n').length;
      const tsLineCount = reindentedTsCode.split('\n').length;

      // Build per-line indent table (uniform for now but future-proof)
      // const removedIndentPerLine = Array.from({ length: tsLineCount }, () => indentLen); <-- REMOVED: This is redundant as mapChainer falls back to commonLength.
      
      const blockData: BlockInfo = {
        map: mapFromNormalize,
        tsSnippet: {
            startOffset: tsCodeStartInOutput + 1 + indentLen,
            endOffset: tsCodeStartInOutput + reindentedTsCode.length,
        },
        civet: {
            lineCount: civetLineCount,
        },
        ts: {
            lineCount: tsLineCount,
        },
        svelte: {
            civetStartLine: civetContentStartLine,
            civetStartIndex: civetSnippetStartLineIndex,
        },
        sourceIndent: {
            commonLength: indentLen,
            perLineLengths: undefined
        },
      };

      if (isModule) {
        result.module = blockData;
      } else {
        result.instance = blockData;
      }

      offsetShift += langAttrLengthChange + contentLengthChange;

    } catch (err: any) {
        if (err.name === 'ParseError' && typeof err.offset === 'number') {
            /*
             * err.offset  → character index **inside the dedented snippet** that failed to parse.
             * We need to convert that to an absolute { line, column } in the *original* Svelte file.
             * Steps:
             *   1. Re-derive the same trimmed + dedented snippet that was sent to compileCivet.
             *   2. Translate offset → (relLine, relCol) in the dedented snippet.
             *   3. Map back to absolute Svelte coordinates:
             *        line   = originalContentStartLine + relLine  - 1
             *        column = removedIndentLength    + relColumn - 1  (indent was stripped)
             */

            // --- Approach 2: If the failing character is whitespace (space, tab, newline, CR), walk left until non-whitespace or start of file.
            let adjustedOffset = err.offset;
            const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
            if (isWs(content[adjustedOffset])) {
                while (adjustedOffset > 0 && isWs(content[adjustedOffset])) {
                    adjustedOffset--;
                }
            }

            const { line: relLine, column: relCol } = offsetToPosition(content, adjustedOffset);

            // Where did the snippet actually start in the Svelte file?
            const civetContentStartLineForError = getActualContentStartLine(svelteCode, tag.content.start); // 1-based

            const absoluteLine   = civetContentStartLineForError + relLine  - 1; // 1-based
            const absoluteColumn = indentStr.length + relCol - 1;    // convert relCol (1-based) to 0-based within full Svelte file

            const width = 4; // highlight up to four characters for visibility
            const lineText = svelteCode.split(/\r?\n/)[absoluteLine - 1] || '';

            let highlightStart = absoluteColumn;
            let highlightEnd   = Math.min(absoluteColumn + width, lineText.length);

            // If we couldn't fit full width on the right, extend to the left
            const actualWidth = highlightEnd - highlightStart;
            if (actualWidth < width) {
                const needLeft = width - actualWidth;
                highlightStart = Math.max(0, highlightStart - needLeft);
            }

            const startPos = { line: absoluteLine, column: highlightStart };
            const endPos   = { line: absoluteLine, column: highlightEnd };

            // Trim the gigantic "Expected:" section to 4 items for readability
            const rawMsg = err.message as string;
            let niceMsg = rawMsg;

            // Insert newline after the filename:line:column header for readability
            niceMsg = niceMsg.replace(/^(.*?:\d+:\d+)\s+/, '$1\n\n');

            const expectedIdx = rawMsg.indexOf('Expected:');
            if (expectedIdx !== -1) {
                const head = rawMsg.substring(0, expectedIdx + 'Expected:'.length);

                const tailLines = rawMsg
                    .substring(expectedIdx + 'Expected:'.length)
                    .split(/\r?\n/);

                const foundIdx = tailLines.findIndex((l) => l.trim().startsWith('Found:'));
                const expectedLines =
                    foundIdx === -1 ? tailLines : tailLines.slice(0, foundIdx);
                const foundAndAfter =
                    foundIdx === -1 ? [] : tailLines.slice(foundIdx);

                const expectedDisplayed = expectedLines
                    .filter((l) => l.trim() !== '')
                    .slice(0, 4);

                niceMsg = head + '\n' + expectedDisplayed.join('\n');

                if (expectedLines.filter((l) => l.trim() !== '').length > 4) {
                    niceMsg += '\n\t…';
                }

                if (foundAndAfter.length) {
                    niceMsg += '\n' + foundAndAfter.join('\n');
                }
            }

            // --- Final formatting for readability ---
            // Insert double newline after the filename:line:column header
            niceMsg = niceMsg.replace(/^(.*?:\d+:\d+)\s+/, '$1\n\n');
            // Remove trailing ts(-1) marker if present
            niceMsg = niceMsg.replace(/\s*ts\(-1\)\s*$/, '');

            // Adjust the displayed line number so that it counts from the <script> tag start (visual line)
            const visualOffset = civetContentStartLineForError - 1; // total lines above first Civet code
            if (visualOffset > 0) {
                // Add visualOffset to the displayed line number (message only)
                niceMsg = niceMsg.replace(/^(.*?:)(\d+)(:)(\d+)/, (_m, p1, ln, sep, col) => `${p1}${Number(ln) + visualOffset}${sep}${col}`);
            }

            throw {
                name: 'CivetParseError',
                message: `Civet: ${niceMsg}`,
                start: startPos,
                end:   endPos,
                frame: err.body || err.toString()
            };
        }
        // If it's not a Civet parse error we can handle, re-throw it as is
        throw err;
    }
  }

  result.code = magic.toString();
  return result;
} 