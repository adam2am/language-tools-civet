import { traceSegment, TraceMap } from "@jridgewell/trace-mapping";

export function mapScriptSegments(
    codeSegs: { segment: number[]; charOffset: number; blockIndex: number }[],
    blocks: any[], // Use a more specific type if available
    tracers: TraceMap[],
    blockNameMaps: (Map<number, number> | undefined)[],
    chainCivetDebug: boolean
): number[][] {
    const codeLines: number[][] = [];
    for (const { segment, blockIndex } of codeSegs) {
        const [generatedCol, , preprocessedLine, preprocessedCol] = segment;
        const block = blocks[blockIndex];
        const tracer = tracers[blockIndex];
        const nameMap = blockNameMaps[blockIndex];
        // Calculate relative line/col *within the compiled TS snippet* that block.map refers to.
        // preprocessedLine is 0-based line in the svelteWithTs content (where the <script> tag content starts)
        // block.tsSnippet.startLine is 1-based line where the <script> tag content starts in svelteWithTs
        const tracerLine = (preprocessedLine + 1) - block.tsSnippet.startLine;
        // The tracer (normalized Civet map) expects columns relative to the dedented TS snippet.
        // We need to subtract the amount of indent that was artificially re-added when the TS
        // code was inserted back into the <script> block. Most of the time this is the
        // uniform `block.sourceIndent.commonLength`, but if a per-line table is provided we
        // use that for higher accuracy / uneven indents.
        const indentShift =
          (block.sourceIndent.perLineLengths &&
           tracerLine < block.sourceIndent.perLineLengths.length)
            ? block.sourceIndent.perLineLengths[tracerLine]
            : block.sourceIndent.commonLength;
  
        const tracerCol = preprocessedCol - indentShift;
  
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
            let finalNameIndex: number | undefined = tracedPrev.length > 4 ? tracedPrev[4] : undefined;
            if (finalNameIndex !== undefined && nameMap) {
                finalNameIndex = nameMap.get(finalNameIndex);
            }
            codeLines.push([generatedCol, 0, tracedPrev[2], adjustedOrigCol, finalNameIndex].filter(n => n !== undefined) as number[]);
          } else {
            // Still no luck – propagate null mapping instead of incorrect fallback
            codeLines.push([generatedCol]);
            if (chainCivetDebug) console.log(`[CHAINER_NULL_FALLBACK] Trace & backtrack failed. Propagated null mapping at generatedCol ${generatedCol}.`);
          }
        } else {
          // Normal successful trace path
          let finalNameIndex: number | undefined = traced.length > 4 ? traced[4] : undefined;
          if (finalNameIndex !== undefined && nameMap) {
              finalNameIndex = nameMap.get(finalNameIndex);
          }
          codeLines.push([generatedCol, 0, traced[2], traced[3], finalNameIndex].filter(n => n !== undefined) as number[]);
          if (chainCivetDebug) console.log(`[CHAIN_MAPS]   Traced OK. Final segment: [${generatedCol}, 0, ${traced[2]}, ${traced[3]}${finalNameIndex !== undefined ? ', '+finalNameIndex : ''}]`);
        }
      }
      return codeLines;
} 