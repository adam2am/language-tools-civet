import MagicString from 'magic-string';
import { parseHtmlx as parseHtmlxOriginal } from '../../../utils/htmlxparser';
import { parse as svelteParse } from 'svelte/compiler';
import { compileCivet } from '../compiler';
import { getAttributeValue, getActualContentStartLine } from '../htmlx';
import { offsetToPosition } from './string';
import { loadCompileOpts } from '../config';
import type { ProcessResult as ProcessResultType, CompileResult, Transformation } from '../types';
import { countLogicalLines } from '../chainer/coordinates';
import { polishMap } from './map-polisher';

export type { ProcessResultType as ProcessResult };

const COMPILE_CACHE = new Map<string, CompileResult>();
const PREPEND_NL = true; // toggle for experiment

/**
 * Preprocess a Svelte document, compiling any <script lang="civet"> blocks
 * into TypeScript and normalizing their sourcemaps.
 */
export function preprocessCivet(
    svelteCode: string,
    filename: string,
    svelte5Plus: boolean,
    parse: typeof svelteParse = svelteParse,
    civetModule?: typeof import('@danielx/civet')
): ProcessResultType {
  const magic = new MagicString(svelteCode);
  const { tags } = parseHtmlxOriginal(svelteCode, parse, { emitOnTemplateError: false, svelte5Plus });
  const result: ProcessResultType = {
    code: svelteCode,
    transformations: [],
  };

  let offsetShift = 0;
  // Hoist config loading out of the loop to avoid redundant fs calls
  const civetCompileOptions = loadCompileOpts(filename);

  for (const tag of tags) {
    if (tag.type !== 'Script') continue;
    const lang = getAttributeValue((tag).attributes, 'lang');
    if (lang !== 'civet') continue;

    const start = tag.content.start; // Offset in the *original* svelte string.
    const end = tag.content.end;
    
    // --- FIX: Use regex to preserve indentation, not aggressive .trim() ---
    const rawSnippet = svelteCode.slice(start, end);
    // Remove leading blank lines, but not leading indentation on the first line of code.
    const contentForCompiler = rawSnippet.replace(/^(\s*[\r\n])+/, '');
    
    try {
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

      let civetCompilationResult: CompileResult | undefined = COMPILE_CACHE.get(contentForCompiler);

      if (!civetCompilationResult) {
        // Cache miss: compile the Civet code
        civetCompilationResult = compileCivet(
          contentForCompiler,
          filename,
          {
            civetModule,
            civetCompileOptions
          }
        );
        COMPILE_CACHE.set(contentForCompiler, civetCompilationResult);
      }
      
      // --- FIX: Destructure the correct 'map' object, not the 'rawMap' ---
      const { code: tsCode, map: civetMap } = civetCompilationResult;
    
      // --- FIX: Check for the presence of the correct map and its mappings ---
      if (!civetMap || !civetMap.mappings) {
          // Skip any mutation of this <script> block so that the original source
          // (including the original indent/whitespace) stays intact. This
          // avoids accidental position shifts when Civet compilation fails or
          // returns no usable sourcemap.
          continue;
      }

      // --- NEW: Polish the sourcemap ---
      const polishedMap = polishMap(civetMap, contentForCompiler, tsCode, civetCompileOptions);

      // Compute line offset for snippet within the Svelte file dynamically by finding first content line
      const civetContentStartLine = getActualContentStartLine(svelteCode, start);

      // --- adding <script lang=ts> tag + content back ---
      // We normalize to remove any trailing newlines from the compiler, then add our own back
      // to ensure the closing </script> tag is on a new line.
      const tsCodeNormalized = tsCode.replace(/\r?\n+$/g, '');
      const finalTsCode = (PREPEND_NL ? '\n' : '') + tsCodeNormalized + '\n';
      
      const langAttrLengthChange = (langValueStart !== -1) ? ('ts'.length - (langValueEnd - langValueStart)) : 0;
      const contentLengthChange = finalTsCode.length - (end - start);
      
      // Perform overwrites now that all calculations are done.
      if (langValueStart !== -1) {
          magic.overwrite(langValueStart, langValueEnd, 'ts');
      }
      magic.overwrite(start, end, finalTsCode);

      // --- Calculate final positions and build block data ---
      // The start of the script block in the *final string* is its original `start`
      // plus all shifts from previous blocks.
      const blockStartInOutput = start + offsetShift;

      // Accurate original-line count: use rawSnippet which has original whitespace.
      const civetLineCount = countLogicalLines(rawSnippet);
      const finalTsLineCount = countLogicalLines(finalTsCode);

      const transformation: Transformation = {
        sourceRange: { start, end },
        outputRange: { start: blockStartInOutput, end: blockStartInOutput + finalTsCode.length },
        map: polishedMap, // Use the polished map
        sourceLineCount: civetLineCount,
        outputLineCount: finalTsLineCount,
        sourceStartLine: civetContentStartLine,
      };
      result.transformations.push(transformation);

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

            // --- If the failing character is whitespace (space, tab, newline, CR), walk left until non-whitespace or start of file.
            let adjustedOffset = err.offset;
            const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
            if (isWs(contentForCompiler[adjustedOffset])) {
                while (adjustedOffset > 0 && isWs(contentForCompiler[adjustedOffset])) {
                    adjustedOffset--;
                }
            }

            const { line: relLine, column: relCol } = offsetToPosition(contentForCompiler, adjustedOffset);

            // Where did the snippet actually start in the Svelte file?
            const civetContentStartLineForError = getActualContentStartLine(svelteCode, tag.content.start); // 1-based

            const absoluteLine   = civetContentStartLineForError + relLine  - 1; // 1-based
            const absoluteColumn = relCol - 1;    // No indent to add back

            const width = 4; // highlight up to four characters for visibility
            
            // Efficiently get the line's text without splitting the whole file
            const lineStartOffset = svelteCode.lastIndexOf('\n', tag.content.start + err.offset) + 1;
            const lineEndOffset = svelteCode.indexOf('\n', lineStartOffset);
            const lineText = svelteCode.substring(lineStartOffset, lineEndOffset > -1 ? lineEndOffset : undefined);

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

  // If the MagicString never mutated, return the original input string 
  result.code = magic.hasChanged() ? magic.toString() : svelteCode;
  return result;
}