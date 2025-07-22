// Define the source map interface locally
import { decode, encode } from '@jridgewell/sourcemap-codec';
import type { SourceMapMappings } from '@jridgewell/sourcemap-codec';
import { lineOffsetIndex } from './text';
import type { Transformation } from '../types';
import { toZeroBased } from './coordinates';
import { traceSegment, TraceMap } from "@jridgewell/trace-mapping";

export interface ChainedSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourcesContent?: string[];
}

// A mapping block from a Civet-generated map to apply
export interface ChainBlock {
  map: ChainedSourceMap;
  tsSnippet: {
      startOffset: number;
      length: number;
      startLine: number;
      startCol: number;
      endLine: number;
  };
  civet: {
      lineCount: number;
  };
  ts: {
      lineCount: number;
  };
  svelte: {
      civetStartLine: number;
      civetStartIndex: number;
      civetStartColumn: number;
  };
}

/**
 * Chain multiple Civet-generated source maps into a base map.
 */
export function applyTransformations(
  baseMap: ChainedSourceMap,
  transformations: Transformation[], // Assumed sorted by tsSnippet.startOffset
  originalSvelteContent: string,
  svelteWithTsContent: string // Content to which baseMap's original_lines/cols refer
): ChainedSourceMap {
  // --- Perf timer start ---
  const preprocessedLineOffsetIndex = new lineOffsetIndex(svelteWithTsContent);
  const baseLines = decode(baseMap.mappings);

  const finalLines: number[][][] = [];

  for (const lineSegments of baseLines) {
    const codeSegs: { segment: number[]; charOffset: number; transformationIndex: number }[] = [];
    const tmplSegs: { segment: number[]; charOffset: number }[] = [];

    for (const seg of lineSegments) {
        const [, , preprocessedLine, preprocessedCol] = seg;
        const charOffset = preprocessedLineOffsetIndex.offsetOf(preprocessedLine + 1, preprocessedCol);

        let transformationIndex = -1;
        for (let i = 0; i < transformations.length; i++) {
            if (charOffset >= transformations[i].outputRange.start && charOffset < transformations[i].outputRange.end) {
                transformationIndex = i;
                break;
            }
        }
        if (transformationIndex !== -1) {
            codeSegs.push({ segment: seg, charOffset, transformationIndex });
        } else {
            tmplSegs.push({ segment: seg, charOffset });
        }
    }

    const codeLines = codeSegs.map(({ segment, transformationIndex }) => {
        const [generatedCol] = segment;
        const transformation = transformations[transformationIndex];
        const tracer = new TraceMap(transformation.map as any);

        const transformationStartLine = preprocessedLineOffsetIndex.positionFor(transformation.outputRange.start).line;
        const tsLine = segment[2] - toZeroBased(transformationStartLine);
        const tsCol = segment[3];

        const traced = traceSegment(tracer, tsLine, tsCol);

        if (traced && traced.length >= 4) {
            const [, , originalLine, originalCol, nameIdx] = traced;
            const finalLine = toZeroBased(transformation.sourceStartLine) + originalLine;
            return [generatedCol, 0, finalLine, originalCol, nameIdx].filter(n => n !== undefined) as number[];
        }
        return [generatedCol];
    });

    const tmplLines = tmplSegs.map(({ segment, charOffset }) => {
        const [generatedCol, , preprocessedLine, preprocessedCol, nameIndex] = segment;
        let cumulativeDelta = 0;
        for (let i = 0; i < transformations.length; i++) {
            if (charOffset > transformations[i].outputRange.end) {
                cumulativeDelta += transformations[i].outputLineCount - transformations[i].sourceLineCount;
            }
        }
        const finalLine = preprocessedLine - cumulativeDelta;
        return [generatedCol, 0, finalLine, preprocessedCol, nameIndex].filter(n => n !== undefined) as number[];
    });
    
    // O(N) merge of two sorted arrays
    const merged: number[][] = [];
    let i = 0;
    let j = 0;
    while (i < codeLines.length || j < tmplLines.length) {
        if (j >= tmplLines.length || (i < codeLines.length && codeLines[i][0] < tmplLines[j][0])) {
            merged.push(codeLines[i++]);
        } else {
            merged.push(tmplLines[j++]);
        }
    }
    finalLines.push(merged);
  }

  
  const finalEncodedMappings = encode(finalLines as unknown as SourceMapMappings);

  return {
    version: 3,
    sources: [baseMap.sources[0]], 
    sourcesContent: [originalSvelteContent],
    names: [], // No longer needed
    mappings: finalEncodedMappings,
    file: baseMap.file 
  };
}

export { applyTransformations as chainV3Maps };
