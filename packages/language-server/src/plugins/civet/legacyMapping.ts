import type { Position, Range } from 'vscode-languageserver';
import type { SourceMapSegment } from '@jridgewell/sourcemap-codec';
import assert from 'assert';
import { civetLog } from './logger';

// The type for decoded sourcemap segments from @jridgewell/sourcemap-codec
export type DecodedSourcemap = SourceMapSegment[][];

/**
 * Maps a position from the original source to the generated code.
 * This is a heuristic that performs a linear scan through all mappings.
 */
export function forwardMap(segments: DecodedSourcemap, position: Position): Position {
    assert("line" in position, "position must have line");
    assert("character" in position, "position must have character");

    const { line: origLine, character: origOffset } = position;

    let col = 0;
    let bestLine = -1,
        bestOffset = -1,
        foundLine = -1,
        foundOffset = -1;

    segments.forEach((line, i) => {
        col = 0;
        line.forEach((segment) => {
            // segment = [genColDelta, sourcesIndex, sourceLine, sourceCol]
            const genColDelta = segment[0] ?? 0;
            col += genColDelta;

            if (segment.length >= 4) {
                const srcLine = segment[2];
                const srcOffset = segment[3];
                
                // Skip if we don't have valid source positions
                if (typeof srcLine !== 'number' || typeof srcOffset !== 'number') return;

                if (srcLine <= origLine) {
                    if (srcLine > bestLine && srcOffset <= origOffset || 
                        srcLine === bestLine && srcOffset <= origOffset && srcOffset >= bestOffset) {
                        bestLine = srcLine;
                        bestOffset = srcOffset;
                        foundLine = i;
                        foundOffset = col;
                    }
                }
            }
        });
    });

    if (foundLine >= 0 && bestLine >= 0 && bestOffset >= 0) {
        const genLine = foundLine + origLine - bestLine;
        
        // The original linear offset calculation is too simplistic for the complex
        // transformations done by svelte2tsx. This more robust heuristic only
        // applies the offset if the mapping is on the same line.
        let genOffset = foundOffset;
        if (origLine === bestLine) {
            genOffset += origOffset - bestOffset;
        }

        return { line: genLine, character: Math.max(0, genOffset) };
    }

    return position;
}

/**
 * Maps a position in generated code back to a position in source code.
 */
export function remapPosition(position: Position, segments?: DecodedSourcemap): Position {
    if (!segments) return position;

    const { line, character } = position;
    const textLine = segments[line];
    if (!textLine?.length) return position;

    let i = 0,
        p = 0,
        l = textLine.length,
        lastSegment: SourceMapSegment | undefined,
        lastSegmentPosition = 0;

    let iteration = 0;
    while (i < l) {
        const segment = textLine[i];
        if (!segment) break;

        const genColDelta = segment[0] ?? 0;
        p += genColDelta;

        if (segment.length >= 4) {
            lastSegment = segment;
            lastSegmentPosition = p;
        }

        if (iteration < 5) {
            // Log the first few steps of the segment search
            civetLog(
                'legacyMapping.ts',
                121,
                `remapPosition iter #${iteration}`,
                { currentPos: p, charToFind: character, segment }
            );
        }
        iteration++;

        if (p >= character) {
            break;
        }

        i++;
    }

    if (lastSegment && lastSegment.length >= 4) {
        const srcLine = lastSegment[2];
        const srcChar = lastSegment[3];
        
        if (typeof srcLine === 'number' && typeof srcChar === 'number') {
            let delta = character - lastSegmentPosition;
            if (delta < 0) delta = 0;
            const newChar = srcChar + delta;
            const finalPosition = { line: srcLine, character: newChar };

            civetLog(
                'legacyMapping.ts',
                105,
                'remapPosition final calculation',
                {
                    input: { line, character },
                    lastSegment,
                    lastSegmentPosition,
                    delta,
                    finalPosition
                }
            );

            return finalPosition;
        }
    }

    return position;
}

/**
 * Maps both ends of a range using remapPosition.
 */
export function remapRange(range: Range, segments?: DecodedSourcemap): Range {
    return {
        start: remapPosition(range.start, segments),
        end: remapPosition(range.end, segments)
    };
}
