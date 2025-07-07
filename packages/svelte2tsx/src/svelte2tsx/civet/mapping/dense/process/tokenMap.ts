/**
 * @file The anchor dispatcher: sends each TS anchor to its perfect Civet match.
 *
 * Recipe:
 * - Map a single anchor from TS to Civet (mapAnchor)
 *
 * The primary function responsible for processing
 * one TS anchor and finding its corresponding location in the Civet source. 
 * It acts as a dispatcher, performing several key steps:
 *
 * 1.  **Pre-checks**: Skips anchors that have already been mapped or are known to be
 *     compiler-generated artifacts.
 * 2.  **Alias Handling**: Substitutes TS keywords/operators with their Civet
 *     equivalents (e.g., `===` becomes `is`) to ensure correct searching.
 * 3.  **Heuristics**: Applies special-case logic, such as the "greedy-dot fix,"
 *     to prevent common mapping errors with property accessors.
 * 4.  **Location**: Calls `locateAnchor` to perform the core search logic.
 * 5.  **Validation & Application**: If a location is found, it calls
 *     `applyValidationAndSegments` to validate the match and generate the
 *     final source map segments.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import { MULTI_TOKEN_ALIASES } from '../../shared/aliasRegistry';
import { locateAnchor } from './anchorFind';
import type { MapStats, GlobalContext, LineContext } from '../context';
import { applyValidationAndSegments } from './anchorMap';
import { isWordChar } from '../../shared/identifierUtils';

// ---------------------------------------------------------------------------
//  Core anchor-mapping helper 
// ---------------------------------------------------------------------------
export function mapAnchor(
  globalCtx: GlobalContext,
  lineCtx: LineContext,
  anchor: Anchor,
  segListForLine: { genCol: number; civetLine: number }[] | undefined,
  lineIndex: number,
  MAX_LOOKAHEAD: number,
  stats: MapStats,
) {
  type CombinedCtx = GlobalContext & LineContext;
  const ctx = { ...globalCtx, ...lineCtx } as CombinedCtx;

  if (ctx.mappedAnchors.has(anchor)) return;

  // ---------------- Alias Handling ----------------
  let searchTextOverride: string | undefined;
  for (const alias of MULTI_TOKEN_ALIASES) {
    if (anchor.text === alias.search[0] && alias.search.length === 1) {
      searchTextOverride = alias.replace;
      break;
    }
  }

  // ---------------- Generated identifiers ----------------
  const isGenerated = anchor.kind === 'identifier' && ctx.generatedIdentifiers.has(anchor.text);
  if (isGenerated) {
    stats.dropTotal++;
    ctx.mappedAnchors.add(anchor);
    return;
  }

  // ---------------------------------------------------------------------------
  //  Greedy-dot fix: Skip mapping for property-access dot so that the following
  //  identifier can exclusively claim the contiguous span. This prevents the
  //  identifier from being split across Civet lines (issue #slice-map-shift).
  //  Heuristic: if the anchor is a single '.' operator and, after skipping any
  //  immediate whitespace, the next character is an identifier start, we treat
  //  this as a property-access dot and drop it from mapping. The information
  //  loss for the dot itself is negligible while greatly improving stability
  //  of the adjacent identifier mapping.
  // ---------------------------------------------------------------------------
  if (anchor.kind === 'operator' && anchor.text === '.') {
    const lineText = globalCtx.tsLines[lineIndex] || '';
    let lookAhead = anchor.start.character + 1;
    while (lookAhead < lineText.length && /\s/.test(lineText.charAt(lookAhead))) {
      lookAhead++;
    }
    const nextChar = lineText.charAt(lookAhead);
    if (isWordChar(nextChar)) {
      // Likely a member-access dot → skip mapping
      stats.dropTotal++;
      ctx.mappedAnchors.add(anchor);
      return;
    }
  }

  const searchText = searchTextOverride ?? anchor.text;
  const allowInLit = anchor.inInterpolation === true || (anchor as any).allowLiteral === true;

  const locRes = locateAnchor(
    globalCtx,
    lineCtx,
    anchor,
    segListForLine,
    lineIndex,
    MAX_LOOKAHEAD,
    stats,
    searchText,
    allowInLit,
  );

  if (!locRes) {
    // No hit → drop & record
    stats.dropTotal++;
    ctx.mappedAnchors.add(anchor);
    return;
  }

  const { civetLineIndex, locationInfo, desiredOccIdx, cacheKey } = locRes;

  // Apply validation & segment creation
  applyValidationAndSegments(
    globalCtx,
    lineCtx,
    anchor,
    civetLineIndex,
    locationInfo,
    searchText,
    desiredOccIdx,
    cacheKey,
    lineIndex,
  );

  ctx.mappedAnchors.add(anchor);
}