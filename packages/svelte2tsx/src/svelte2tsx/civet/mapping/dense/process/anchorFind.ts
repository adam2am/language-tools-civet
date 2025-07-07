/**
 * @file anchorFind: Born to hunt anchors with superhuman precision in the original Civet source.
 *
 * Powers:
 * - Pinpoint anchor location in Civet code (locateAnchor)
 * - Multi-stage search: guess, fast-path, fallback, salvage (locateAnchor)
 *
 * 1.  **Initial Guess**: Uses `tsLineToCivetLineMap`
 *     to determine the most likely Civet line for the anchor.
 * 2.  **Fast Path**: For identifier-like anchors, it first attempts a fast lookup
 *     using the pre-computed `tokenIndex` via `locateTokenByIndex`.
 * 3.  **Fallback Scan**: If the fast path fails, it falls back to a line-by-line
 *     text/regex search using `locateTokenInCivetLine`.
 * 4.  **Look-Ahead**: If still not found, it searches a few lines above and below
 *     the initial guess to handle minor line shifts.
 * 5.  **Salvage**: Implements final-effort heuristics, such as searching all
 *     possible lines from the segment list or looking for object key patterns.
 *
 * Instrumented to avoid mapping to tokens inside comments or strings and to handle
 * occurrence tracking for repeated tokens.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import { locateTokenInCivetLine, locateTokenByIndex } from '../../shared/tokenFinder';
import type { MapStats, GlobalContext, LineContext } from '../context';
import { DEBUG_FLAGS } from '../constants';

export interface LocationResult {
  civetLineIndex: number;
  locationInfo: { startIndex: number; length: number };
  desiredOccIdx: number;
  cacheKey: string;
}

/**
 * Finds the best Civet position for a given TS anchor.
 * Handles fast-path token-index lookup, regex fallback, look-ahead across lines,
 * segList salvage and object-key salvage. Also updates `occIndexCache` and
 * `stats` as in the legacy implementation.
 *
 * Returns `undefined` when no match could be found.
 */
export function locateAnchor(
  globalCtx: GlobalContext,
  lineCtx: LineContext,
  anchor: Anchor,
  segListForLine: { genCol: number; civetLine: number }[] | undefined,
  lineIndex: number,
  MAX_LOOKAHEAD: number,
  stats: MapStats,
  searchText: string,
  allowInLit: boolean,
): LocationResult | undefined {
  type CombinedCtx = GlobalContext & LineContext;
  const ctx = { ...globalCtx, ...lineCtx } as CombinedCtx;
  // 1) Determine starting Civet line guess
  let civetLineIndex: number | undefined;
  if (segListForLine && segListForLine.length > 0) {
    // choose segment covering anchor column (binary search)
    let lo = 0,
      hi = segListForLine.length - 1,
      segIdx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (segListForLine[mid].genCol <= anchor.start.character) {
        segIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (
      segIdx < segListForLine.length - 1 &&
      anchor.start.character >= segListForLine[segIdx + 1].genCol
    ) {
      segIdx++;
    }
    civetLineIndex = segListForLine[segIdx].civetLine;

    const nextGenCol = segListForLine[segIdx + 1]?.genCol ?? Infinity;
    if (!(anchor.start.character >= segListForLine[segIdx].genCol && anchor.start.character < nextGenCol)) {
      // leave civetLineIndex as is; will trigger fallback search later
    }
  } else {
    civetLineIndex = ctx.tsLineToCivetLineMap.get(lineIndex);
  }

  if (civetLineIndex === undefined) return undefined;

  const initialCacheKey = `${civetLineIndex}:${anchor.kind}:${searchText}`;
  const desiredOccIdx = ctx.occIndexCache.get(initialCacheKey) ?? 0;

  let locationInfo: { startIndex: number; length: number } | undefined;

  // Fast path via token-index for identifier-like anchors (identifier/keyword/numericLiteral)
  if (anchor.kind === 'identifier' || anchor.kind === 'keyword' || anchor.kind === 'numericLiteral') {
    locationInfo = locateTokenByIndex(
      anchor,
      ctx.tokenIndex[civetLineIndex] || [],
      desiredOccIdx,
      ctx.precomputedLiteralInfo[civetLineIndex],
      allowInLit,
    );
  }
  // Regex fallback on the full line text
  if (!locationInfo) {
    locationInfo = locateTokenInCivetLine(
      anchor,
      ctx.civetCodeLines[civetLineIndex] || '',
      desiredOccIdx,
      allowInLit,
      ctx.precomputedLiteralInfo[civetLineIndex],
      (col) => ctx.isInComment(civetLineIndex, col),
      (col) => ctx.isInString(civetLineIndex, col),
    );
  }

  // Look-ahead: search neighbouring lines (±MAX_LOOKAHEAD)
  // Safety guard: single-character punctuation operators ('.', ',', ';', etc.)
  // are prone to false-positives when we cross lines. If the anchor is such a
  // token, *do not* attempt cross-line look-ahead – we prefer to leave it
  // unmapped so that a synthetic/pass-2 mapper can handle it correctly.
  const isRiskySinglePunct =
    anchor.kind === 'operator' && anchor.text.length === 1 && /[.,;:!&|\-+*%<>?=]/.test(anchor.text);

  if (!locationInfo && !isRiskySinglePunct) {
    for (let delta = 1; delta <= MAX_LOOKAHEAD && !locationInfo; delta++) {
      stats.fallbackTotal++;
      const candidates = [civetLineIndex - delta, civetLineIndex + delta];
      for (const altIdx of candidates) {
        if (altIdx < 0 || altIdx >= ctx.civetCodeLines.length) continue;
        const altKey = `${altIdx}:${anchor.kind}:${searchText}`;
        const altDesired = ctx.occIndexCache.get(altKey) ?? 0;

        if (anchor.kind === 'identifier' || anchor.kind === 'keyword' || anchor.kind === 'numericLiteral') {
          locationInfo = locateTokenByIndex(
            anchor,
            ctx.tokenIndex[altIdx] || [],
            altDesired,
            ctx.precomputedLiteralInfo[altIdx],
            allowInLit,
          );
        }
        if (!locationInfo) {
          locationInfo = locateTokenInCivetLine(
            anchor,
            ctx.civetCodeLines[altIdx] || '',
            altDesired,
            allowInLit,
            ctx.precomputedLiteralInfo[altIdx],
            (col) => ctx.isInComment(altIdx, col),
            (col) => ctx.isInString(altIdx, col),
          );
        }
        if (locationInfo) {
          civetLineIndex = altIdx;
          ctx.occIndexCache.set(altKey, altDesired + 1);
          break;
        }
      }
    }
  }

  // segList salvage search (when multiple civet lines in segList)
  if (!locationInfo && segListForLine && segListForLine.length > 1) {
    const uniqueLines = Array.from(new Set(segListForLine.map(s => s.civetLine)));
    for (const altIdx of uniqueLines) {
      if (altIdx === civetLineIndex) continue;
      const altKey = `${altIdx}:${anchor.kind}:${searchText}`;
      const altDesired = ctx.occIndexCache.get(altKey) ?? 0;
      if (anchor.kind === 'identifier' || anchor.kind === 'keyword' || anchor.kind === 'numericLiteral') {
        locationInfo = locateTokenByIndex(
          anchor,
          ctx.tokenIndex[altIdx] || [],
          altDesired,
          ctx.precomputedLiteralInfo[altIdx],
          allowInLit,
        );
      }
      if (!locationInfo) {
        locationInfo = locateTokenInCivetLine(
          anchor,
          ctx.civetCodeLines[altIdx] || '',
          altDesired,
          allowInLit,
          ctx.precomputedLiteralInfo[altIdx],
          (col) => ctx.isInComment(altIdx, col),
          (col) => ctx.isInString(altIdx, col),
        );
      }
      if (locationInfo) {
        civetLineIndex = altIdx;
        ctx.occIndexCache.set(altKey, altDesired + 1);
        break;
      }
    }
  }

  // object-key salvage ({ foo: … })
  if (!locationInfo && anchor.kind === 'identifier' && segListForLine) {
    const keyLines = Array.from(new Set(segListForLine.map(s => s.civetLine)));
    for (const keyIdx of keyLines) {
      const txt = ctx.civetCodeLines[keyIdx] || '';
      const objKeyIdx = txt.indexOf(`${anchor.text}:`);
      if (objKeyIdx !== -1) {
        civetLineIndex = keyIdx;
        locationInfo = { startIndex: objKeyIdx, length: anchor.text.length };
        break;
      }
    }
  }

  if (!locationInfo) return undefined;

  // Guard: skip anchors that start inside comments or (for non-quote tokens) inside strings.
  const startIdx = locationInfo.startIndex;

  const isInsideComment = globalCtx.isInComment(civetLineIndex, startIdx);
  const isInsideString = globalCtx.isInString(civetLineIndex, startIdx);

  if (DEBUG_FLAGS.DENSE_MAP && anchor.kind === 'quote') {
    console.log(`[QUOTE_ANCHOR_BUG] Anchor: '${anchor.text}'. Located at Civet L${civetLineIndex + 1}:${startIdx}.`);
    console.log(`[QUOTE_ANCHOR_BUG] Checking guards: isInComment=${isInsideComment}, isInString=${isInsideString}`);
  }

  // For quote anchors, allow mapping even if the column is flagged as inside a string because
  // the opening/closing quote itself forms the string boundary. For all other anchor kinds,
  // retain the original inside-string guard.
  const shouldDrop = isInsideComment || (isInsideString && anchor.kind !== 'quote');
  if (shouldDrop) {
    if (DEBUG_FLAGS.DENSE_MAP && anchor.kind === 'quote') {
      console.log(`[QUOTE_ANCHOR_BUG] Dropping quote anchor because its location is deemed invalid.`);
    }
    return undefined;
  }

  return { civetLineIndex, locationInfo, desiredOccIdx, cacheKey: initialCacheKey };
}