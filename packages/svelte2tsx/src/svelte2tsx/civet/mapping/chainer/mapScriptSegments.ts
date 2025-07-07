import { traceSegment, TraceMap } from "@jridgewell/trace-mapping";

/**
 * Standard binary search on a sorted array of sourcemap segments.
 * Finds the index of the segment whose `generatedColumn` is less than or
 * equal to the target column.
 */
function binarySearch(
  segments: readonly (readonly number[])[],
  targetCol: number
): number {
  let lo = 0;
  let hi = segments.length - 1;
  let bestIndex = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (segments[mid][0] <= targetCol) {
      bestIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return bestIndex;
}

export function mapScriptSegments(
    codeSegs: { segment: number[]; charOffset: number; blockIndex: number }[],
    blocks: any[], // Use a more specific type if available
    tracers: TraceMap[],
    nameOffsets: number[],
    chainCivetDebug: boolean
): number[][] {
    const codeLines: number[][] = [];
    for (const { segment, blockIndex } of codeSegs) {
        const [generatedCol, , preprocessedLine, preprocessedCol] = segment;
        const block = blocks[blockIndex];
        const tracer = tracers[blockIndex];
        // Calculate relative line/col *within the compiled TS snippet* that block.map refers to.
        // preprocessedLine is 0-based line in the svelteWithTs content (where the <script> tag content starts)
        // block.tsSnippet.startLine is 1-based line where the <script> tag content starts in svelteWithTs
        const tracerLine = (preprocessedLine + 1) - block.tsSnippet.startLine;
        // The tracer (normalized Civet map) expects columns relative to the dedented TS snippet.
        // Subtract both the common indent and any per-line extra indent to align columns.
        const extraLineIndent = block.sourceIndent.perLineLengths?.[tracerLine] ?? 0;
        const indentShift = block.sourceIndent.commonLength + extraLineIndent;
  
        const tracerCol = preprocessedCol - indentShift;
  
        let traced: readonly number[] | null = null;
        try {
          if (chainCivetDebug) console.log(`[CHAINER_INPUT] Querying Civet->TS map for L${tracerLine}C${tracerCol}`);
          traced = traceSegment(tracer, tracerLine, Math.max(0, tracerCol));
          if (chainCivetDebug) console.log(`[CHAINER_OUTPUT] traceSegment raw result: ${JSON.stringify(traced)}`);
        } catch (e) {
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Error during traceSegment: ${(e as Error).message}`);
        }
  
        if (traced && traced.length === 1) {
          codeLines.push([generatedCol]);
        } else if (!(traced && traced.length >= 4)) {
          const lineMap = (tracer as any)._decoded[tracerLine];
          if (lineMap) {
            const segIndex = binarySearch(lineMap, tracerCol);
            if (segIndex !== -1) {
              const prevSeg = lineMap[segIndex];
              if (prevSeg.length >= 4) {
                  const deltaCol = tracerCol - prevSeg[0];
                  const adjustedOrigCol = prevSeg[3] + deltaCol;
                  const civetNameIndex = prevSeg[4];
                  const finalNameIndex = (civetNameIndex !== undefined && civetNameIndex !== null)
                      ? nameOffsets[blockIndex] + civetNameIndex
                      : undefined;
                  codeLines.push([generatedCol, 0, prevSeg[2], adjustedOrigCol, finalNameIndex].filter(n => n !== undefined) as number[]);
              } else {
                codeLines.push([generatedCol]);
              }
            } else {
              codeLines.push([generatedCol]);
            }
          } else {
            codeLines.push([generatedCol]);
          }
        } else {
          const civetNameIndex = traced[4];
          const finalNameIndex = (civetNameIndex !== undefined && civetNameIndex !== null)
              ? nameOffsets[blockIndex] + civetNameIndex
              : undefined;
          codeLines.push([generatedCol, 0, traced[2], traced[3], finalNameIndex].filter(n => n !== undefined) as number[]);
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Traced OK. Final segment: [${generatedCol}, 0, ${traced[2]}, ${traced[3]}${finalNameIndex !== undefined ? ', '+finalNameIndex : ''}]`);
        }
      }
      return codeLines;
} 