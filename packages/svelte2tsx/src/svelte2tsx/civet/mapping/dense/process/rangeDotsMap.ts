/**
 * @file Range operator: lassos '..' and ties it to the right method call.
 *
 * Powers:
 * - Map inclusive range operators to method anchors (runInclusiveRangePrepass)
 *
 * This module addresses a specific and tricky mapping problem. The Civet `..`
 * operator compiles into a method call in TypeScript, such as `.slice()/.splice`. Without
 * a specialized pre-pass, the `slice` identifier anchor would be mapped by the
 * general-purpose `tokenMap`, often leading to incorrect matches.
 *
 * When a pair is found, it:
 * 1. Creates a direct mapping from the `..` to the method name (`slice`).
 * 2. "Claims" both the `..` span and the TS anchor, preventing other mappers
 *    from processing them.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import type { GlobalContext, LineContext } from '../context';
import { claimKey, DEBUG_FLAGS } from '../constants';

/**
 * Pre-pass for the inclusive-range operator (`..`).
 *
 * Problem: The Civet range operator compiles to `array.slice(...)` (or a similar
 * method call) in the generated TS.  The identifier anchor for that method
 * call (e.g. `slice`) gets picked up by the general identifier-mapper **before**
 * we get a chance to rewrite it, causing it to be mapped to the *next* textual
 * occurrence of that identifier in the Civet source (often a user-defined
 * function of the same name).
 *
 * This pre-pass detects the pattern early and:
 *   1. Claims the method-call identifier anchor (so later passes ignore it)
 *   2. Claims the `..` span in the Civet source
 *   3. Emits mapping segments that link that span to the method-call anchor
 *
 * The logic uses only positional information and generic heuristics ("identifier
 * preceded by '.' and followed by '('") so it works regardless of whether the
 * compiler emits `.slice(`, `.splice(` or any other helper.
 */
export function runInclusiveRangePrepass(
  globalCtx: GlobalContext,
  lineCtx: LineContext,
  lineAnchors: Anchor[],
  segListForLine: { genCol: number; civetLine: number }[] | undefined,
) {
  if (!segListForLine || segListForLine.length === 0) return;

  type CombinedCtx = GlobalContext & LineContext;
  const ctx = { ...globalCtx, ...lineCtx } as CombinedCtx;

  // Derive the current TS line index from the first anchor (all anchors passed in
  // belong to the same TS line).
  const tsLineIdx = lineAnchors.length > 0 ? lineAnchors[0].start.line : -1;
  if (tsLineIdx === -1) return;

  const tsLine = ctx.tsLines[tsLineIdx] ?? '';

  // Helper: pick the first unmapped identifier anchor that forms a property
  // call (`.<ident>(`) on this TS line.
  const pickNextMethodAnchor = (used: Set<Anchor>): Anchor | undefined => {
    for (const a of lineAnchors) {
      if (a.kind !== 'identifier') continue;
      if (ctx.mappedAnchors.has(a) || used.has(a)) continue;
      const start = a.start.character;
      const end = a.end.character;
      if (tsLine[start - 1] === '.' && tsLine[end] === '(') {
        return a;
      }
    }
    return undefined;
  };

  const uniqueCivetLines = Array.from(new Set(segListForLine.map((s) => s.civetLine)));

  // Track anchors we have already paired in this pass so we don't reuse them
  const consumedAnchors = new Set<Anchor>();

  for (const civetIdx of uniqueCivetLines) {
    const srcLine = ctx.civetCodeLines[civetIdx] || '';
    const inclusiveRegex = /(?<!\.)\.\.(?!\.)/g; // ".." but not part of "..."
    let match: RegExpExecArray | null;

    while ((match = inclusiveRegex.exec(srcLine))) {
      const dotStart = match.index;

      // Collision: has someone claimed this span already?
      const spanClaimed = ctx.claimedSpans.has(claimKey(civetIdx, dotStart)) ||
        ctx.claimedSpans.has(claimKey(civetIdx, dotStart + 1));
      if (spanClaimed) continue;

      // Grab a method-call anchor to bind to this '..'
      const methodAnchor = pickNextMethodAnchor(consumedAnchors);
      if (!methodAnchor) break; // no more anchors to pair on this TS line

      consumedAnchors.add(methodAnchor);

      // ---- Claim identifiers & spans so later passes skip them ----
      ctx.mappedAnchors.add(methodAnchor);
      ctx.claimedGenCols.add(methodAnchor.start.character);

      ctx.claimedSpans.add(claimKey(civetIdx, dotStart));
      ctx.claimedSpans.add(claimKey(civetIdx, dotStart + 1));

      // ---- Emit mapping segments ----
      const sourceSvelteLine = ctx.civetBlockStartLine - 1 + civetIdx;
      const sourceSvelteStartCol = dotStart + ctx.indentation;

      const startSeg: number[] = [
        methodAnchor.start.character,
        0,
        sourceSvelteLine,
        sourceSvelteStartCol,
      ];
      const endSeg: number[] = [
        methodAnchor.end.character,
        0,
        sourceSvelteLine,
        sourceSvelteStartCol + 2, // '..' length
      ];

      ctx.anchorToSegments.set(methodAnchor, [startSeg, endSeg]);

      if (DEBUG_FLAGS.DENSE_MAP) {
        console.log(
          `[INC_RANGE_PREPASS] '..' at Civet L${civetIdx + 1}:C${dotStart} → method '${methodAnchor.text}' at TS col ${methodAnchor.start.character}`,
        );
      }

      // One mapping per '..' occurrence
      break;
    }
  }
} 