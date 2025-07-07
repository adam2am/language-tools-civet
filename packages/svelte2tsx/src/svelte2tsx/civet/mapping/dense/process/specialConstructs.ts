/**
 * @file Special construct: preps before the main course.
 *
 * Recipe:
 * - Run all special-case mappers (mapSpecialConstructs)
 * - Fuse multi-token macros (preprocessAnchors)
 */
import type { GlobalContext, LineContext } from '../context';
import { runInclusiveRangePrepass } from './rangeDotsMap';
import { runObjectKeyPrepass } from './objKey';
import { mapMultilineInterpolationAnchors } from './interpMap';
import { fuseMultiTokenMacros } from './macroFuse';
import type { Anchor } from '../../shared/tsAnchorCollector';

/**
 * Runs all synthetic segment mappers in the correct order.
 */
export function mapSpecialConstructs(
  globalCtx: GlobalContext,
  lineCtx: LineContext,
  processedAnchors: Anchor[],
  segListForLine: { genCol: number; civetLine: number }[] | undefined,
): void {
  runObjectKeyPrepass(globalCtx, lineCtx, processedAnchors, segListForLine);
  mapMultilineInterpolationAnchors(globalCtx, lineCtx, processedAnchors, segListForLine);
  runInclusiveRangePrepass(globalCtx, lineCtx, processedAnchors, segListForLine);
}

export function preprocessAnchors(anchors: Anchor[]): Anchor[] {
    return fuseMultiTokenMacros(anchors);
} 