import { traceSegment, TraceMap } from "@jridgewell/trace-mapping";

export class LineCalc {
    private lineOffsets: number[];
    constructor(content: string) {
        this.lineOffsets = [0]; // First line starts at offset 0
        for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') {
                this.lineOffsets.push(i + 1);
            }
        }
    }
  
    getOffset(line1Based: number, col0Based: number): number {
        if (line1Based < 1 || line1Based > this.lineOffsets.length) {
            console.warn(`[LineOffsetCalculator] Line ${line1Based} out of bounds (1-${this.lineOffsets.length}). Clamping.`);
            line1Based = Math.max(1, Math.min(line1Based, this.lineOffsets.length));
        }
        const lineStartOffset = this.lineOffsets[line1Based - 1];
        return lineStartOffset + col0Based;
    }
}

export function remapScriptSegments(
    codeSegs: { segment: number[]; charOffset: number; blockIndex: number }[],
    blocks: any[], // Use a more specific type if available
    tracers: TraceMap[],
    chainCivetDebug: boolean
): number[][] {
    const codeLines: number[][] = [];
    for (const { segment, blockIndex } of codeSegs) {
        const [generatedCol, , preprocessedLine, preprocessedCol, nameIndex] = segment;
        const block = blocks[blockIndex];
        const tracer = tracers[blockIndex];
        // Calculate relative line/col *within the compiled TS snippet* that block.map refers to.
        // preprocessedLine is 0-based line in the svelteWithTs content (where the <script> tag content starts)
        // block.tsSnippet.startLine is 1-based line where the <script> tag content starts in svelteWithTs
        const tracerLine = (preprocessedLine + 1) - block.tsSnippet.startLine;
        // The tracer (normalized Civet map) expects columns relative to the dedented TS snippet.
        // We need to subtract the amount of indent that was artificially re-added when the TS
        // code was inserted back into the <script> block. Most of the time this is the
        // uniform `block.sourceIndent.commonLength`, but if a per-line table is provided we
        // use that for higher accuracy / uneven indents.
        const indentRemovedForThisLine =
          (block.sourceIndent.perLineLengths &&
           tracerLine < block.sourceIndent.perLineLengths.length)
            ? block.sourceIndent.perLineLengths[tracerLine]
            : block.sourceIndent.commonLength;
  
        const tracerCol = preprocessedCol - indentRemovedForThisLine;
  
        let traced: readonly number[] | null = null;
        try {
          if (chainCivetDebug) console.log(`[CHAINER_INPUT] Querying Civet->TS map for L${tracerLine}C${tracerCol}`);
          traced = traceSegment(tracer, tracerLine, Math.max(0, tracerCol));
          if (chainCivetDebug) console.log(`[CHAINER_OUTPUT] traceSegment raw result: ${JSON.stringify(traced)}`);
        } catch (e) {
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Error during traceSegment: ${(e as Error).message}`);
        }
  
        // ------------------------------------------------------------------
        // Handle tracing result cases:
        // 1) traced && len>=4  -> full mapping segment (success)
        // 2) traced && len===1 -> explicit null mapping -> propagate [generatedCol]
        // 3) traced null or <4 -> attempt limited backtrack, else propagate null
        // ------------------------------------------------------------------
  
        if (traced && traced.length === 1) {
          // Case 2: explicit null mapping from dense Civet map
          codeLines.push([generatedCol]);
          if (chainCivetDebug) console.log(`[CHAINER_NULL_PRESERVE] Explicit null mapping preserved at generatedCol ${generatedCol}`);
        } else if (!(traced && traced.length >= 4)) {
          /* ---------------------------------------------------------
           * Backtrack leftward on the same line until we
           * find a column that traces, then shift the original column
           * by the delta between our target and the traced-column.
           * ------------------------------------------------------- */
          let backtrackCol = tracerCol - 1;
          let tracedPrev: readonly number[] | null = null;
          while (backtrackCol >= 0) {
            try {
              tracedPrev = traceSegment(tracer, tracerLine, backtrackCol);
            } catch {
              tracedPrev = null;
            }
            if (tracedPrev && tracedPrev.length >= 4) {
              break;
            }
            backtrackCol--;
          }
  
          if (tracedPrev && tracedPrev.length >= 4) {
            if (chainCivetDebug) console.log(`[CHAINER_BACKTRACK_SUCCESS] L${tracerLine}C${tracerCol} succeeded by backtracking to C${backtrackCol}.`);
            const deltaCol = tracerCol - backtrackCol;
            const adjustedOrigCol = tracedPrev[3] + deltaCol;
            codeLines.push([generatedCol, 0, tracedPrev[2], adjustedOrigCol, nameIndex].filter(n => n !== undefined) as number[]);
          } else {
            // Still no luck – propagate null mapping instead of incorrect fallback
            codeLines.push([generatedCol]);
            if (chainCivetDebug) console.log(`[CHAINER_NULL_FALLBACK] Trace & backtrack failed. Propagated null mapping at generatedCol ${generatedCol}.`);
          }
        } else {
          // Normal successful trace path
          codeLines.push([generatedCol, 0, traced[2], traced[3], nameIndex].filter(n => n !== undefined) as number[]);
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Traced OK. Final segment: [${generatedCol}, 0, ${traced[2]}, ${traced[3]}${nameIndex !== undefined ? ', '+nameIndex : ''}]`);
        }
      }
      return codeLines;
}

export function remapTemplateSegments(
    tmplSegs: { segment: number[]; charOffset: number }[],
    blocks: any[], // Use a more specific type if available
    lineDeltas: number[]
): number[][] {
    const tmplLines: number[][] = [];
    for (const { segment, charOffset } of tmplSegs) {
        const [generatedCol, , preprocessedLine, preprocessedCol, nameIndex] = segment;
        let delta = 0;
        for (let k = 0; k < blocks.length; k++) {
            if (charOffset < blocks[k].tsSnippet.startOffset) {
                delta = lineDeltas[k];
                break;
            }
            delta = lineDeltas[k + 1];
        }
        tmplLines.push([generatedCol, 0, preprocessedLine - delta, preprocessedCol, nameIndex].filter(n => n !== undefined) as number[]);
    }
    return tmplLines;
}

export {}; 