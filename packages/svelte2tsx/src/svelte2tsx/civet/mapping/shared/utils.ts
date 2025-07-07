import { claimKey } from '../dense/constants';
import type { GlobalContext, LineContext } from '../dense/context';
type CombinedCtx = GlobalContext & LineContext;

/**
 * Validates that a synthetic span can be inserted at the given Civet line/column.
 * Criteria:
 *   1. None of the columns in the span are already claimed.
 *   2. Span does not reside inside a literal/comment block.
 *
 * @param ctx Dense map builder context
 * @param civetLine Index (0-based within block) of the Civet line
 * @param startCol Column offset (0-based) where span starts
 * @param length Width of span in characters (default 1)
 * @param includeLiteralCheck Whether to include literal check
 */
export function validateSyntheticSpan(
  ctx: CombinedCtx,
  civetLine: number,
  startCol: number,
  length = 1,
  includeLiteralCheck = true,
): boolean {
  const { claimedSpans, precomputedLiteralInfo } = ctx;
  for (let col = startCol; col < startCol + length; col++) {
    if (claimedSpans.has(claimKey(civetLine, col))) {
      return false;
    }
    if (includeLiteralCheck) {
      const { literalRanges } = precomputedLiteralInfo[civetLine] || { literalRanges: [] };
      if (literalRanges.some(r => col >= r.start && col <= r.end)) {
        return false;
      }
      if (ctx.isInComment && ctx.isInComment(civetLine, col)) {
        return false;
      }
      if (ctx.isInString && ctx.isInString(civetLine, col)) {
        return false;
      }
    }
  }
  return true;
} 