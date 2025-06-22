import MagicString from 'magic-string';
import { parseHtmlx as parseHtmlxOriginal } from '../../utils/htmlxparser';
import { parse as svelteParse } from 'svelte/compiler';
import { compileCivet } from './compiler';
import { normalizeCivetMap } from './sourcemap';
import { getAttributeValue, getActualContentStartLine, stripCommonIndent } from './helpers';
import type { PreprocessResult, CivetBlockInfo } from './types';
import { loadCivetCompileOptionsSync } from './config';

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
    svelte: string,
    filename: string,
    parse: typeof svelteParse = svelteParse,
    civetModule?: typeof import('@danielx/civet')
): PreprocessResult {
  const ms = new MagicString(svelte);
  const { tags } = parseHtmlxOriginal(svelte, parse, {
    emitOnTemplateError: false,
    svelte5Plus: true
  });
  const result: PreprocessResult = { code: svelte };

  let totalOffsetShift = 0;

  for (const tag of tags) {
    if (tag.type !== 'Script') continue;
    const lang = getAttributeValue((tag).attributes, 'lang');
    if (lang !== 'civet') continue;

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
      let currentTagAttributeOffsetShift = 0; // will be set only when overwrite actually happens
      if (langAttributeNode && Array.isArray(langAttributeNode.value) && langAttributeNode.value.length > 0) {
          const langValueNode = langAttributeNode.value[0]; // Text node
          langValueStart = langValueNode.start + 1; // skip opening quote
          langValueEnd   = langValueNode.end - 1;   // exclude closing quote
      }

      const start = tag.content.start; // Offset in the *original* svelte string.
      const end = tag.content.end;
      const snippet = svelte.slice(start, end).replace(/\s+$/, '');
      
      // Remove leading blank lines to avoid offset mismatches
      const snippetTrimmed = snippet.replace(/^(?:[ \t]*[\r\n])+/, '');

      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] Original Civet snippet before dedent:
${snippet}`);
      if (civetPreprocessorDebug) {
        console.log(`[preprocessCivet] Detected <script lang="civet"> (${isModule ? 'module' : 'instance'}) at offsets ${start}-${end}`);
        console.log(`[preprocessCivet] Original snippet content:\n${snippet}`);
      }

      // Dedent the trimmed snippet to strip common leading whitespace for accurate mapping
      const { dedented: dedentedSnippet, indent: removedIndentString } = stripCommonIndent(snippetTrimmed);
      const commonIndentLength = removedIndentString.length;
      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] Civet snippet after dedent:
${dedentedSnippet}`);
      if (civetPreprocessorDebug) console.log(`[preprocessCivet] Dedented snippet content:\n${dedentedSnippet}`);
      

      // Discover user Civet configuration synchronously so the LS respects parseOptions
      const civetCompileOptions = loadCivetCompileOptionsSync(filename);

      // Compile Civet to TS and get raw sourcemap from dedented snippet
      const { code: compiledTsCode, rawMap } = compileCivet(
        dedentedSnippet,
        filename,
        {
          civetModule,
          civetCompileOptions
        }
      );
      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] Compiled TS code from Civet:
${compiledTsCode}`);
      if (civetPreprocessorDebug) console.log(`[preprocessCivet] compileCivet output code length: ${compiledTsCode.length}, rawMap lines count: ${rawMap && 'lines' in rawMap ? rawMap.lines.length : 0}`);

      if (!rawMap || !('lines' in rawMap)) {
          // Civet compilation failed or returned no usable map.  Leave the original
          // <script lang="civet"> unchanged (no lang overwrite) and keep the original
          // snippet so that downstream tooling still sees valid Civet code.
          ms.overwrite(start, end, snippet);
          continue;
      }

      // Add a dummy trailing segment to each rawMap line to help IDE reference-boundary detection
      // This is a pure generated-column delta ([1]) and will not produce its own mapping.
      (rawMap.lines as number[][][]).forEach(lineSegments => {
        lineSegments.push([1]);
      });

      // Compute line offset for snippet within the Svelte file dynamically by finding first content line
      const originalContentStartLine_1based = getActualContentStartLine(svelte, start);
      const originalCivetSnippetLineOffset_0based = originalContentStartLine_1based - 1;

      if (civetPreprocessorDebug) console.log(`[preprocessCivet] Civet snippet offsets ${start}-${end} -> Svelte line ${originalContentStartLine_1based}`);

      if (civetPreprocessorDebug) console.log(`[preprocessCivet] originalContentStartLine_1based: ${originalContentStartLine_1based}, snippet offset (0-based): ${originalCivetSnippetLineOffset_0based}`);


      // Normalize the Civet sourcemap to a standard V3 map
      const mapFromNormalize = normalizeCivetMap(
        rawMap,
        svelte,
        originalContentStartLine_1based,
        commonIndentLength,
        filename,
        compiledTsCode
      );
      // Debug: log first segment of normalized map mappings
      if (civetPreprocessorDebug) console.log(`[civetPreprocessor.ts] normalized map first semicolon segment: ${mapFromNormalize.mappings.split(';')[0]}`);
      if (civetPreprocessorDebug) console.log(`[preprocessCivet] normalizeCivetMap returned map mappings length: ${mapFromNormalize.mappings.split(';').length}`);

      // At this point compilation succeeded.  Perform the delayed lang="ts" overwrite.
      if (langValueStart !== -1) {
          const originalLength = langValueEnd - langValueStart;
          ms.overwrite(langValueStart, langValueEnd, 'ts');
          currentTagAttributeOffsetShift = 'ts'.length - originalLength;
      }

      const indentString = removedIndentString;
      const trimmedCompiledTsCode = compiledTsCode.replace(/\r?\n+$/g, '');
      const reindentedTsCode = '\n' + trimmedCompiledTsCode.split('\n').map(line => `${indentString}${line}`).join('\n') + '\n';
      ms.overwrite(start, end, reindentedTsCode);

      const originalScriptBlockLineCount = svelte.slice(start, end).split('\n').length;
      const compiledTsLineCount = reindentedTsCode.split('\n').length;

      // Build per-line indent table (uniform for now but future-proof)
      const removedIndentPerLine = Array.from({ length: compiledTsLineCount }, () => commonIndentLength);

      const effectiveContentStartInFinalString = start + totalOffsetShift;
      const tsEndInSvelteWithTs = effectiveContentStartInFinalString + reindentedTsCode.length;

      // actualTsCodeStartOffset needs to be the offset in the *final string* (svelteWithTs)
      // where the TS code (after the \\n and indent added by reindentedTsCode) begins.
      // `start` is the offset of the original script content in the *original* svelte string.
      // After attributes like lang="civet" are changed to lang="ts", this `start` position shifts.
      // `effectiveContentStartInFinalString` accounts for previous blocks' changes.
      // `currentTagAttributeOffsetShift` accounts for the change in this block's lang attribute.
      // The actual code within reindentedTsCode begins after its leading '\\n' and its indent.
      const actualTsCodeStartOffset = effectiveContentStartInFinalString + currentTagAttributeOffsetShift + 1 + commonIndentLength;
      
      const blockData = {
        map: mapFromNormalize as any, // Cast to any to bypass complex type issue for now, assuming structure is EncodedSourceMap compatible
        tsStartInSvelteWithTs: actualTsCodeStartOffset,
        tsEndInSvelteWithTs,
        originalContentStartLine: originalContentStartLine_1based,
        originalCivetLineCount: originalScriptBlockLineCount,
        compiledTsLineCount,
        /** Include raw mapping lines from the Civet compiler */
        rawMapLines: rawMap.lines,
        originalCivetSnippetLineOffset_0based,
        removedCivetContentIndentLength: commonIndentLength,
        removedIndentPerLine
      } as CivetBlockInfo;

      if (isModule) {
        result.module = blockData;
      } else {
        result.instance = blockData;
      }

      totalOffsetShift += currentTagAttributeOffsetShift + (reindentedTsCode.length - (end - start));

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

            const rawSnippet = svelte.slice(tag.content.start, tag.content.end);
            const snippetTrimmed = rawSnippet.replace(/^(?:[ \t]*[\r\n])+/,'');
            const { dedented: dedentedSnippet, indent: removedIndentStr } = stripCommonIndent(snippetTrimmed);

            // --- Approach 2: If the failing character is whitespace (space, tab, newline, CR), walk left until non-whitespace or start of file.
            let adjustedOffset = err.offset;
            const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
            if (isWs(dedentedSnippet[adjustedOffset])) {
                while (adjustedOffset > 0 && isWs(dedentedSnippet[adjustedOffset])) {
                    adjustedOffset--;
                }
            }

            const { line: relLine, column: relCol } = offsetToPosition(dedentedSnippet, adjustedOffset);

            // Where did the snippet actually start in the Svelte file?
            const originalContentStartLine = getActualContentStartLine(svelte, tag.content.start); // 1-based

            const absoluteLine   = originalContentStartLine + relLine  - 1; // 1-based
            const absoluteColumn = removedIndentStr.length + relCol - 1;    // convert relCol (1-based) to 0-based within full Svelte file

            const width = 4; // highlight up to four characters for visibility
            const lineText = svelte.split(/\r?\n/)[absoluteLine - 1] || '';

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
            const visualOffset = originalContentStartLine - 1; // total lines above first Civet code
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

  result.code = ms.toString();
  return result;
} 