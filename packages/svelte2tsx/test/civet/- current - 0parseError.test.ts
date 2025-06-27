import { svelte2tsx } from '../../src/svelte2tsx';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { TraceMap, originalPositionFor, generatedPositionFor } from '@jridgewell/trace-mapping';
import { compileCivet } from '../../src/svelte2tsx/civet/compile/compiler';
import { normalize } from '../../src/svelte2tsx/civet/mapping/normalizer';
//import { decode } from '@jridgewell/sourcemap-codec';

describe('Complex sourcemap validation for generated code #current', () => {
    const fixturePath = path.join(__dirname, 'fixtures', '0complexCompile copy.svelte');
    const svelte = fs.readFileSync(fixturePath, 'utf-8');
    const filename = '0complexCompile copy.svelte';

    console.log('\n=== Input Svelte/Civet Code ===\n');
    console.log(svelte.split('\n').map((line, i) => `${String(i + 1).padStart(3, ' ')}| ${line}`).join('\n'));

    const { code: tsxCode, map: sourceMap } = svelte2tsx(svelte, { filename });

    console.log('\n=== FINAL OUTPUT: GENERATED TSX CODE (from svelte2tsx) ===\n');
    console.log(tsxCode.split('\n').map((line, i) => `${String(i + 1).padStart(3, ' ')}| ${line}`).join('\n'));

    // --- LOGGING FOR PRE-INTEGRATION NORMALIZED MAP ---
    const scriptRegex = /<script lang="civet">([\s\S]*?)<\/script>/;
    const match = svelte.match(scriptRegex);
    if (match && match[1]) {
        let civetContent = match[1];
        // Remove leading and trailing newline, but preserve indentation
        if (civetContent.startsWith('\n')) {
            civetContent = civetContent.substring(1);
        }
        if (civetContent.endsWith('\n')) {
            civetContent = civetContent.slice(0, -1);
        }

        const svelteLines = svelte.split('\n');
        const scriptLineIndex = svelteLines.findIndex(line => line.includes('<script'));
        const scriptLine = svelteLines[scriptLineIndex];
        const indentLen = scriptLine.match(/^\s*/)?.[0].length ?? 0;

        const { code: rawTsCode, rawMap } = compileCivet(civetContent, filename, {});
        console.log('\n=== STAGE 1: RAW TYPESCRIPT FROM CIVET COMPILER (pre-svelte2tsx integration) ===\n');
        console.log(rawTsCode.split('\n').map((line, i) => `${String(i + 1).padStart(3, ' ')}| ${line}`).join('\n'));

        const preIntegrationMap = normalize(
            rawMap,
            rawTsCode,
            { getText: () => civetContent, filename },
            {},
            scriptLineIndex + 1, // 1-based
            indentLen
        );
        const { decode: decodeForLog } = require('@jridgewell/sourcemap-codec');
        const decodedMappings = decodeForLog(preIntegrationMap.mappings);
        console.log('\n=== STAGE 2: NORMALIZED SOURCEMAP (Civet-TS -> Svelte File) (pre-svelte2tsx integration) ===');
        console.log('// This is the array-style sourcemap after the raw Civet map is normalized to point to the .svelte file.');
        decodedMappings.forEach((line, i) => {
            console.log(`line ${i + 1}: ${JSON.stringify(line)}`);
        });
        console.log('=== END PRE-INTEGRATION MAP ===\n');

        // Also show the raw TS code and its line numbers for easier correlation
        console.log('\n=== STAGE 2 CORRELATION: Raw TS lines with their mappings ===');
        const rawTsLines = rawTsCode.split('\n');
        const civetLinesArr = civetContent.split('\n');
        rawTsLines.forEach((line, i) => {
            console.log(`${String(i + 1).padStart(3, ' ')}| ${line}`);
            if (i < decodedMappings.length) {
                const segs = decodedMappings[i];
                if (segs.length === 0) {
                    console.log('    (no mappings)');
                } else {
                    segs.forEach((seg: number[]) => {
                        const genCol = seg[0];
                        if (seg.length >= 4) {
                            const [, srcIdx, srcLine0, srcCol0] = seg;
                            const srcLine = srcLine0 + 1;
                            const srcCol = srcCol0;
                            const srcChar = civetLinesArr[srcLine0]?.[srcCol0] || '';
                            const name = seg.length === 5 ? preIntegrationMap.names[seg[4]] : '';
                            console.log(`      [col ${genCol}] -> Svelte L${srcLine}:C${srcCol} '${srcChar}' ${name ? `(name: ${name})` : ''}`);
                        } else {
                            console.log(`      [col ${genCol}] -> (null mapping)`);
                        }
                    });
                }
            }
        });
        console.log('=== END STAGE 2 CORRELATION ===\n');
    }
    // --- END LOGGING ---

    // Log sourcemap summary
    console.log('\n=== Sourcemap Summary ===');
    console.log(`Sources: ${sourceMap.sources.join(', ')}`);
    console.log(`Mappings length: ${sourceMap.mappings.length} chars`);
    console.log(`Number of lines mapped: ${sourceMap.mappings.split(';').length}`);

    const tracer = new TraceMap({
        version: 3,
        file: sourceMap.file,
        sources: sourceMap.sources,
        sourcesContent: sourceMap.sourcesContent,
        names: sourceMap.names,
        mappings: sourceMap.mappings,
    });
    
    // === FULL SHOWCASE OF NORMALIZED MAP ===
    const { decode } = require('@jridgewell/sourcemap-codec');
    const decodedMap = decode(sourceMap.mappings);
    console.log('\n=== FINAL OUTPUT ANALYSIS: FULL SOURCEMAP (FINAL TSX -> SVELTE) IN ARRAY FORMAT ===');
    decodedMap.forEach((line, i) => {
        console.log(`line ${i + 1}: ${JSON.stringify(line)}`);
    });
    console.log('=== END FULL NORMALIZED MAP ===\n');

    // Helper to find an identifier and check its mapping
    const assertIdentifierMapping = (
        identifier: string,
        occurrence: number, // 1-based
        shouldMap: boolean,
        expectedSvelteLine?: number,
        expectedSvelteColumn?: number
    ) => {
        const tsxLines = tsxCode.split('\n');
        let occurrencesFound = 0;
        let lineIdx = -1;
        let col = -1;

        for (let i = 0; i < tsxLines.length; i++) {
            let fromIndex = 0;
            while (true) {
                const foundCol = tsxLines[i].indexOf(identifier, fromIndex);
                if (foundCol === -1) break;

                occurrencesFound++;
                if (occurrencesFound === occurrence) {
                    lineIdx = i;
                    col = foundCol;
                    break;
                }
                fromIndex = foundCol + identifier.length;
            }
            if (lineIdx !== -1) break;
        }

        assert.ok(lineIdx >= 0, `Could not find occurrence ${occurrence} of "${identifier}" in generated code.`);
        
        // Use the start of the identifier for mapping check
        const trace = originalPositionFor(tracer, { line: lineIdx + 1, column: col });

        console.log(`\n=== Checking mapping for "${identifier}" (occurrence #${occurrence}) ===`);
        console.log(`Found in TSX at L${lineIdx + 1}:C${col}`);
        console.log(`Maps back to Svelte: ${trace.line ? `L${trace.line}:C${trace.column}` : 'No mapping'}`);

        if (shouldMap) {
            assert.ok(trace.line, `Expected "${identifier}" to have a valid mapping.`);
            if (expectedSvelteLine) {
                assert.equal(trace.line, expectedSvelteLine, `"${identifier}" should map to Svelte line ${expectedSvelteLine}`);
            }
            if (expectedSvelteColumn) {
                // Note: column matching can be tricky due to tabs/spaces.
                // This assertion is useful but might need adjustment.
                assert.equal(trace.column, expectedSvelteColumn, `"${identifier}" should map to Svelte column ${expectedSvelteColumn}`);
            }
        } else {
            assert.strictEqual(
                trace.line,
                null,
                `Generated identifier "${identifier}" should not map back to source, but it mapped to Svelte L${trace.line}:C${trace.column}`
            );
        }
    };

    it('>>> [DELTA_CHECK] Dynamically calculate identifier deltas', () => {
        const civetVars = ['abc', 'queryFun2', 'a', 'b'];
        const svelteLines = svelte.split('\n');

        for (const v of civetVars) {
            const lineIdx = svelteLines.findIndex(l => l.includes(v));
            const colIdx = svelteLines[lineIdx].indexOf(v);

            const tsLineIdx = tsxCode.split('\n').findIndex(l => l.includes(v));
            const tsColIdx = tsxCode.split('\n')[tsLineIdx]?.indexOf(v) ?? -1;

            const trace = originalPositionFor(tracer, { line: tsLineIdx + 1, column: tsColIdx });

            console.log(`\n--- DELTA_CHECK for "${v}" ---`);
            console.log(`  - Civet Source:  L${lineIdx + 1}:${colIdx}`);
            console.log(`  - Predicted TS:    L${tsLineIdx + 1}:${tsColIdx} (via simple indexOf)`);
            console.log(`  - Actual from Map: L${trace.line}:${trace.column}`);
            console.log(`  - DELTA (L/C):     ${trace.line - (lineIdx + 1)} / ${trace.column - colIdx}`);
        }
        // This is a logging-only test, it should not fail.
        assert.ok(true);
    });

    it('should NOT map compiler-generated helper "ref"', () => {
        assertIdentifierMapping('ref', 1, false);
    });

    it('should NOT map compiler-generated loop variable "i"', () => {
        assertIdentifierMapping(' i ', 1, false);
    });


    // it('should correctly map "index" in the for-loop definition', () => {
    //     // Civet: for fruit, index of fruits
    //     // TSX:   for (const [fruit, index] of Object.entries(fruits)) {
    //     // The first occurrence of "index" in TSX should map to line 8 in Svelte.
    //     // Assuming tab width of 4, "index" starts at column 12 (0-indexed)
    //     assertIdentifierMapping('index', 1, true, 8, 12);
    // });

    it('should correctly map user-defined variable "abc"', () => {
        // Civet: abc = if abc is query then null else query
        // We'll check the first usage of `abc =`
        assertIdentifierMapping('abc =', 1, true, 4);
    });

    // it('should show detailed mapping for the for-loop', () => {
    //     const tsxLines = tsxCode.split('\n');
    //     const svelteLines = svelte.split('\n');

    //     // --- FORWARD MAPPING (NORMALIZED) ---
    //     const forLoopTSXLine = tsxLines.find(l => l.includes('let i = 0;for (const fruit'));
    //     assert.ok(forLoopTSXLine, 'Could not find the TSX line with the for loop');
    //     const forLoopTSXLineIdx = tsxLines.indexOf(forLoopTSXLine);
    //     const forLoopSvelteLineInfo = svelteLines.map((l, i) => ({ l, i })).find(({ l }) => l.includes('for fruit, index of fruits'));
    //     assert.ok(forLoopSvelteLineInfo, 'Could not find svelte line with for loop');

    //     console.log('\n=== DETAILED MAPPING ANALYSIS (FOR LOOP) ===');
    //     console.log(`Original Civet line (L${forLoopSvelteLineInfo.i + 1}): ${forLoopSvelteLineInfo.l.trim()}`);
    //     console.log(`Generated TSX line (L${forLoopTSXLineIdx + 1}): ${forLoopTSXLine}`);

    //     for (let col = 0; col < forLoopTSXLine.length; col++) {
    //         const char = forLoopTSXLine[col];
    //         const trace = originalPositionFor(tracer, { line: forLoopTSXLineIdx + 1, column: col });
    //         console.log(`TSX Col ${col.toString().padStart(2)}: '${char}' -> ${trace.line ? `Svelte L${trace.line}:C${trace.column}` : 'null'} ${trace.name ? `(name: ${trace.name})` : ''}`);
    //     }

    //     // --- REVERSE MAPPING (RAW CIVET) ---
    //     const scriptTagLineIndex = svelteLines.findIndex(l => l.includes('<script'));
    //     const scriptEndTagLineIndex = svelteLines.findIndex(l => l.includes('</script'));
    //     const civetSnippet = svelteLines.slice(scriptTagLineIndex + 1, scriptEndTagLineIndex).join('\n');

    //     const { rawMap: rawCivetMap } = compileCivet(civetSnippet, filename, { outputStandardV3Map: true });
        
    //     if (rawCivetMap && 'mappings' in rawCivetMap) {
    //         const decoded = {
    //             ...rawCivetMap,
    //             mappings: decode(rawCivetMap.mappings),
    //             // The TraceMap constructor expects mutable arrays
    //             sources: [...rawCivetMap.sources],
    //             names: [...rawCivetMap.names],
    //             sourcesContent: rawCivetMap.sourcesContent ? [...rawCivetMap.sourcesContent] : undefined,
    //             ignoreList: rawCivetMap.ignoreList ? [...rawCivetMap.ignoreList] : undefined,
    //         };
    //         const rawTracer = new TraceMap(decoded);

    //         console.log('\n=== RAW CIVET COMPILER REVERSE MAPPING (FOR LOOP) ===');
    //         const svelteLineToAnalyze = forLoopSvelteLineInfo.l;
    //         const lineInSnippet = forLoopSvelteLineInfo.i - scriptTagLineIndex; // 1-based line in snippet

    //         console.log(`Analyzing Svelte line ${forLoopSvelteLineInfo.i + 1}: "${svelteLineToAnalyze.trim()}" (as line ${lineInSnippet} of snippet)`);
            
    //         for (let col = 0; col < svelteLineToAnalyze.length; col++) {
    //             const char = svelteLineToAnalyze[col];
    //             const genPos = generatedPositionFor(rawTracer, {
    //                 source: filename,
    //                 line: lineInSnippet, 
    //                 column: col,
    //             });
    //             console.log(`Svelte Col ${col.toString().padStart(2)}: '${char}' -> ${genPos.line !== null ? `Raw TS L${genPos.line}:C${genPos.column}` : 'null'}`);
    //         }
    //     }

    //     // --- REVERSE MAPPING (NORMALIZED SVELTE -> TSX) ---
    //     console.log('\n=== NORMALIZED REVERSE MAPPING (SVELTE -> TSX) ===');
    //     const svelteLineToAnalyze = forLoopSvelteLineInfo.l;
    //     const svelteLineToAnalyzeIdx = forLoopSvelteLineInfo.i;

    //     console.log(`Analyzing Svelte line ${svelteLineToAnalyzeIdx + 1}: "${svelteLineToAnalyze.trim()}"`);

    //     for (let col = 0; col < svelteLineToAnalyze.length; col++) {
    //         const char = svelteLineToAnalyze[col];
    //         const genPos = generatedPositionFor(tracer, {
    //             source: sourceMap.sources[0],
    //             line: svelteLineToAnalyzeIdx + 1,
    //             column: col,
    //         });
    //         console.log(`Svelte Col ${col.toString().padStart(2)}: '${char}' -> ${genPos.line !== null ? `TSX L${genPos.line}:C${genPos.column}` : 'null'}`);
    //     }
    //     assert.ok(true); // This test is for logging only
    // });

    it('should NOT map compiler-generated helper variables', () => {
        // This test assumes the civet compiler might output helper variables
        // that shouldn't be mapped. For example, if it created a helper
        // function or an iterator variable. We add a placeholder test.
        // If we find a generated variable, e.g., `_i`, we would test it:
        // assertIdentifierMapping('_i', 1, false);
        assert.ok(true, "Placeholder for testing unmapped generated variables.");
    });

    it('should NOT map whitespace after a token to the token itself (range check)', () => {
        const tsxLines = tsxCode.split('\n');
        const lineWithAbc = tsxLines.find(l => l.includes('if (abc === query)'));
        assert.ok(lineWithAbc, 'Could not find the TSX line with "if (abc === query)"');
        const lineIdx = tsxLines.indexOf(lineWithAbc);

        console.log('\n=== FINAL OUTPUT ANALYSIS: REVERSE MAPPING (CHARACTER-BY-CHARACTER) FROM FINAL TSX TO SVELTE SOURCE ===');
        console.log('// This shows mapping from the final generated TSX code (after svelte2tsx) back to the original Svelte file.');
        console.log('Original Civet line: abc = if abc is query then null else query');
        console.log(`Generated TSX line: ${lineWithAbc}`);
        
        // Analyze mapping for each character position
        for (let col = 0; col < lineWithAbc.length; col++) {
            const char = lineWithAbc[col];
            const trace = originalPositionFor(tracer, { line: lineIdx + 1, column: col });
            console.log(`TSX Col ${col.toString().padStart(2)}: '${char}' -> ${trace.line ? `Svelte L${trace.line}:C${trace.column}` : 'null'} ${trace.name ? `(name: ${trace.name})` : ''}`);
        }

        console.log('\n=== FINAL OUTPUT ANALYSIS: FORWARD MAPPING (CHARACTER-BY-CHARACTER) FROM SVELTE SOURCE TO FINAL TSX ===');
        console.log('// This shows mapping from the original Svelte file to the final generated TSX code.');
        const svelteLines = svelte.split('\n');
        const svelteLineToAnalyze = svelteLines[3]; // line 4, 0-indexed
        const svelteLineToAnalyzeIdx = 3;

        console.log(`Analyzing Svelte line ${svelteLineToAnalyzeIdx + 1}: "${svelteLineToAnalyze.trim()}"`);

        for (let col = 0; col < svelteLineToAnalyze.length; col++) {
            const char = svelteLineToAnalyze[col];
            const genPos = generatedPositionFor(tracer, {
                source: sourceMap.sources[0],
                line: svelteLineToAnalyzeIdx + 1,
                column: col,
            });
            console.log(`Svelte Col ${col.toString().padStart(2)}: '${char}' -> ${genPos.line !== null ? `TSX L${genPos.line}:C${genPos.column}` : 'null'}`);
        }

        const scriptTagLineIndex = svelteLines.findIndex(l => l.includes('<script'));
        const scriptEndTagLineIndex = svelteLines.findIndex(l => l.includes('</script'));
        const civetSnippet = svelteLines.slice(scriptTagLineIndex + 1, scriptEndTagLineIndex).join('\n');

        console.log('\n=== INTERMEDIATE ANALYSIS: FORWARD MAPPING FROM SVELTE SOURCE TO NORMALIZED CIVET-TS (pre-svelte2tsx integration) ===');
        console.log('// This shows mapping from the Svelte file to the intermediate, normalized TS code before it gets merged by svelte2tsx.');
        const scriptRegex = /<script lang="civet">([\s\S]*?)<\/script>/;
        const match = svelte.match(scriptRegex);
        if (match && match[1]) {
            let civetContent = match[1];
            // Remove leading and trailing newline, but preserve indentation
            if (civetContent.startsWith('\n')) {
                civetContent = civetContent.substring(1);
            }
            if (civetContent.endsWith('\n')) {
                civetContent = civetContent.slice(0, -1);
            }

            const scriptLine = svelteLines[scriptTagLineIndex];
            const indentLen = scriptLine.match(/^\s*/)?.[0].length ?? 0;

            const { code: rawTsCode, rawMap } = compileCivet(civetContent, filename, {});
            const preIntegrationMap = normalize(
                rawMap,
                rawTsCode,
                { getText: () => civetContent, filename },
                {},
                scriptTagLineIndex + 1, // 1-based
                indentLen
            );

            // Create a tracer for the pre-integration map
            const preIntegrationTracer = new TraceMap({
                version: 3,
                file: preIntegrationMap.file || null,
                sourceRoot: preIntegrationMap.sourceRoot || null,
                sources: [...preIntegrationMap.sources],
                sourcesContent: preIntegrationMap.sourcesContent ? [...preIntegrationMap.sourcesContent] : null,
                names: [...(preIntegrationMap.names || [])],
                mappings: decode(preIntegrationMap.mappings),
                ignoreList: preIntegrationMap.ignoreList ? [...preIntegrationMap.ignoreList] : null
            });

            console.log(`Analyzing Svelte line ${svelteLineToAnalyzeIdx + 1}: "${svelteLineToAnalyze.trim()}"`);

            for (let col = 0; col < svelteLineToAnalyze.length; col++) {
                const char = svelteLineToAnalyze[col];
                const genPos = generatedPositionFor(preIntegrationTracer, {
                    source: filename,
                    line: svelteLineToAnalyzeIdx + 1,
                    column: col,
                });
                if (genPos.line !== null) {
                    const tsxChar = rawTsCode.split('\n')[genPos.line - 1]?.[genPos.column] || '';
                    console.log(`Svelte Col ${col.toString().padStart(2)}: '${char}' -> Normalized TS L${genPos.line}:C${genPos.column} ('${tsxChar}')`);
                } else {
                    console.log(`Svelte Col ${col.toString().padStart(2)}: '${char}' -> No mapping`);
                }
            }
        }

        const { rawMap: rawCivetMap } = compileCivet(civetSnippet, filename, { outputStandardV3Map: true });
        
        if (rawCivetMap && 'mappings' in rawCivetMap) {
            const decoded = {
                ...rawCivetMap,
                mappings: decode(rawCivetMap.mappings),
                // The TraceMap constructor expects mutable arrays
                sources: [...rawCivetMap.sources],
                names: [...rawCivetMap.names],
                sourcesContent: rawCivetMap.sourcesContent ? [...rawCivetMap.sourcesContent] : undefined,
                ignoreList: rawCivetMap.ignoreList ? [...rawCivetMap.ignoreList] : undefined,
            };
            const rawTracer = new TraceMap(decoded);

            console.log('\n=== RAW COMPILER ANALYSIS: FORWARD MAPPING FROM SVELTE SOURCE TO RAW CIVET-TS (pre-normalization) ===');
            console.log('// This shows mapping from the Svelte file to the raw, un-normalized TS produced directly by the Civet compiler.');
            const civetLineNumberForRaw = 4; // The line `abc = if abc is query then null else query`
            const lineInSnippet = civetLineNumberForRaw - (scriptTagLineIndex + 1);
            const civetLineToAnalyze = svelteLines[civetLineNumberForRaw - 1];

            console.log(`Analyzing Svelte line ${civetLineNumberForRaw}: "${civetLineToAnalyze}" (as line ${lineInSnippet} of snippet)`);
            
            for (let col = 0; col < civetLineToAnalyze.length; col++) {
                const char = civetLineToAnalyze[col];
                const genPos = generatedPositionFor(rawTracer, {
                    source: filename,
                    line: lineInSnippet,
                    column: col,
                });
                console.log(`Svelte Col ${col.toString().padStart(2)}: '${char}' -> ${genPos.line !== null ? `Raw TS L${genPos.line}:C${genPos.column}` : 'null'}`);
            }
        }

        // Find the 'abc' within `(abc === query)`
        const col = lineWithAbc.indexOf('abc');

        // 1. The 'a' in 'abc' should map to the 'abc' token.
        const startTrace = originalPositionFor(tracer, { line: lineIdx + 1, column: col });
        console.log(`\n=== Checking range for "abc" in "if (abc === query)" ===`);
        console.log(`Checking "a" in "abc" at TSX L${lineIdx + 1}:C${col}`);
        console.log(`It maps to Svelte: L${startTrace.line}:C${startTrace.column} (name: ${startTrace.name})`);
        assert.equal(startTrace.name, 'abc', 'The start of "abc" should map to the "abc" token.');

        // 2. The '===' operator should NOT map to 'abc'.
        const operatorCol = lineWithAbc.indexOf('===');
        const operatorTrace = originalPositionFor(tracer, { line: lineIdx + 1, column: operatorCol });
        console.log(`Checking operator "===" at TSX L${lineIdx + 1}:C${operatorCol}`);
        console.log(`It maps to Svelte: ${operatorTrace.line ? `Svelte L${operatorTrace.line}:C${operatorTrace.column} (name: ${operatorTrace.name})` : 'No mapping'}`);
        assert.notEqual(operatorTrace.name, 'abc', 'The "===" operator should NOT map to "abc".');

        // 3. The whitespace immediately AFTER the '===' operator should not map to any named token.
        const wsAfterEqCol = operatorCol + '==='.length; // space after the operator
        const wsAfterEqTrace = originalPositionFor(tracer, { line: lineIdx + 1, column: wsAfterEqCol });
        console.log(`Checking whitespace after "===" at TSX L${lineIdx + 1}:C${wsAfterEqCol}`);
        console.log(`It maps to Svelte: ${wsAfterEqTrace.line ? `L${wsAfterEqTrace.line}:C${wsAfterEqTrace.column} (name: ${wsAfterEqTrace.name})` : 'No mapping'}`);
        assert.strictEqual(wsAfterEqTrace.name, null, 'Whitespace after the "===" operator should not map to a named token.');
    });

    it('should correctly handle mapping ranges around the assignment `abc`', () => {
        const tsxLines = tsxCode.split('\n');
        const lineWithAbc = tsxLines.find(l => l.includes('return abc = ref'));
        assert.ok(lineWithAbc, 'Could not find the TSX line with "return abc = ref"');
        const lineIdx = tsxLines.indexOf(lineWithAbc);

        // Find the 'abc' within `return abc = ref`
        const col = lineWithAbc.lastIndexOf('abc');

        console.log(`\n=== Checking range for "abc" in "return abc = ref" ===`);
        // 1. Check the space *before* 'abc'. It should not have a named mapping.
        const beforeTrace = originalPositionFor(tracer, { line: lineIdx + 1, column: col - 1 });
        console.log(`Checking space before "abc" at TSX L${lineIdx + 1}:C${col - 1}`);
        console.log(`It maps to Svelte: ${beforeTrace.line ? `L${beforeTrace.line}:C${beforeTrace.column} (name: ${beforeTrace.name})` : 'No mapping'}`);
        assert.strictEqual(beforeTrace.name, null, 'The space before "abc" should not have a named mapping.');

        // 2. Check the 'a' in 'abc'. It should map to 'abc'.
        const startTrace = originalPositionFor(tracer, { line: lineIdx + 1, column: col });
        console.log(`Checking "a" in "abc" at TSX L${lineIdx + 1}:C${col}`);
        console.log(`It maps to Svelte: L${startTrace.line}:C${startTrace.column} (name: ${startTrace.name})`);
        assert.equal(startTrace.name, 'abc', 'The start of "abc" should map to the "abc" token.');
        
        // 3. Check the space *after* 'abc'. It should not have a named mapping.
        const afterCol = col + 'abc'.length;
        const afterTrace = originalPositionFor(tracer, { line: lineIdx + 1, column: afterCol });
        console.log(`Checking space after "abc" at TSX L${lineIdx + 1}:C${afterCol}`);
        console.log(`It maps to Svelte: ${afterTrace.line ? `L${afterTrace.line}:C${afterTrace.column} (name: ${afterTrace.name})` : 'No mapping'}`);
        assert.strictEqual(afterTrace.name, null, 'The space after "abc" should not have a named mapping.');

        // 4. Check the '=' after 'abc'. It should not have a named mapping.
        const equalsCol = lineWithAbc.indexOf('=', afterCol);
        const equalsTrace = originalPositionFor(tracer, { line: lineIdx + 1, column: equalsCol });
        console.log(`Checking "=" after "abc" at TSX L${lineIdx + 1}:C${equalsCol}`);
        console.log(`It maps to Svelte: ${equalsTrace.line ? `L${equalsTrace.line}:C${equalsTrace.column} (name: ${equalsTrace.name})` : 'No mapping'}`);
        assert.strictEqual(equalsTrace.name, null, 'The "=" after "abc" should not have a named mapping.');
    });

    it('>>> [BLEED_CHECK] Showcase mapping bleed for " = if" and "then null else" segments', () => {
        const svelteLinesArr = svelte.split('\n');
        const abcLineIdx = svelteLinesArr.findIndex(l => l.includes('abc = if abc'));
        assert.ok(abcLineIdx !== -1, 'Could not find the line with "abc = if" in Svelte');
        const abcLine = svelteLinesArr[abcLineIdx];

        console.log('\n=== BLEED_CHECK: "= if" segment ===');
        console.log(`Analyzing Svelte line ${abcLineIdx + 1}: "${abcLine.trim()}"`);

        const bleedCols = [7, 8, 9, 10];  // Start after '=' to check space and 'if'
        const seenGenCoords = new Set<string>();
        bleedCols.forEach(col => {
            const genPos = generatedPositionFor(tracer, {
                source: sourceMap.sources[0],
                line: abcLineIdx + 1,
                column: col
            });
            const coord = genPos.line === null ? 'null' : `${genPos.line}:${genPos.column}`;
            console.log(`Svelte Col ${String(col).padStart(2)} ('${abcLine[col]}') -> ${coord}`);
            // Assertion: whitespace should either be unmapped (null) OR each char map to a distinct TS position.
            if (coord !== 'null') {
                assert.ok(!seenGenCoords.has(coord), `Bleed detected: multiple Civet columns map to the same TS position ${coord}`);
                seenGenCoords.add(coord);
            }
        });

        console.log('\n=== BLEED_CHECK: "then null else" whitespace ===');
        const thenStartCol = abcLine.indexOf('then');
        const endCol = thenStartCol + 'then null else'.length;
        const seenGenCoords2 = new Set<string>();
        for (let col = thenStartCol; col < endCol; col++) {
            const genPos = generatedPositionFor(tracer, {
                source: sourceMap.sources[0],
                line: abcLineIdx + 1,
                column: col
            });
            const coord = genPos.line === null ? 'null' : `${genPos.line}:${genPos.column}`;
            console.log(`Svelte Col ${String(col).padStart(2)} ('${abcLine[col]}') -> ${coord}`);
            if (coord !== 'null') {
                assert.ok(!seenGenCoords2.has(coord), `Bleed detected in 'then null else': Civet columns share TS position ${coord}`);
                seenGenCoords2.add(coord);
            }
        }
    });
});
