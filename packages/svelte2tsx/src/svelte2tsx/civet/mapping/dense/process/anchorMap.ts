/**
 * @file anchorMap: The final judge: validates, claims, and locks in anchor mappings with ironclad checks.
 *
 * Powers:
 * - Validate and claim anchor mappings (applyValidationAndSegments)
 *
 * This module is the final step in the `tokenMap` pipeline. Once `locateAnchor`
 * has found a potential match for a TS anchor in the Civet source, this module's
 * `applyValidationAndSegments` function is called to perform critical last-mile
 * checks:
 *
 * 1.  **Alias Validation**: Ensures that if the match is an alias (e.g., `is` for
 *     `===`), the text in the Civet source is a valid alias for the TS anchor.
 * 2.  **Overlap/Collision Checks**: Verifies that the anchor's target character
 *     span in the Civet source and its generated column in the TS output have not
 *     already been claimed by another, higher-priority anchor.
 * 3.  **Claiming**: If all checks pass, it "claims" the spans to prevent other
 *     anchors from mapping to them.
 * 4.  **Segment Creation**: Generates the final source map segment(s) that link
 *     the TS anchor's start/end positions to the Civet source's start/end positions.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import { OPERATOR_LOOKUP, QUOTE_ALIAS } from '../../shared/aliasRegistry';
import type { GlobalContext, LineContext } from '../context';
import { claimKey, DEBUG_FLAGS } from '../constants';

/**
 * Performs alias validation, overlap checks, segment creation and final bookkeeping.
 * Returns true if the anchor was mapped successfully, false if dropped.
 */
export function applyValidationAndSegments(
  globalCtx: GlobalContext,
  lineCtx: LineContext,
  anchor: Anchor,
  civetLineIndex: number,
  locationInfo: { startIndex: number; length: number },
  searchText: string,
  desiredOccIdx: number,
  cacheKey: string,
  tsLineIndex: number,
): boolean {
  type CombinedCtx = GlobalContext & LineContext;
  const ctx = { ...globalCtx, ...lineCtx } as CombinedCtx;
  if (DEBUG_FLAGS.DENSE_MAP) {  
    console.log(`[ANCHOR_MAP] Processing anchor '${anchor.text}' (${anchor.kind}) at TS Line ${tsLineIndex + 1}, Col ${anchor.start.character}`);
    console.log(`[ANCHOR_MAP] Target location in Civet: Line ${civetLineIndex + 1}, Col ${locationInfo.startIndex}, Length ${locationInfo.length}`);
  }

  // Alias / replacement checks
  const civetSlice = (ctx.civetCodeLines[civetLineIndex] || '').slice(
    locationInfo.startIndex,
    locationInfo.startIndex + locationInfo.length,
  );
  const intendedText = searchText;
  const isAliasMatch =
    ((anchor.kind === 'keyword' || anchor.kind === 'operator') &&
      OPERATOR_LOOKUP[anchor.text] === civetSlice) ||
    (anchor.kind === 'interpolationOpen' && anchor.text === '${' && civetSlice === '#{') ||
    (anchor.kind === 'quote' && (QUOTE_ALIAS[anchor.text] || []).includes(civetSlice));

  if (!isAliasMatch && civetSlice !== intendedText) {
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[ANCHOR_MAP] Text mismatch - Civet: "${civetSlice}", Expected: "${intendedText}"`);
    }
    ctx.occIndexCache.set(cacheKey, desiredOccIdx + 1);
    ctx.mappedAnchors.add(anchor);
    return false;
  }
  const tsSlice = ctx.tsLines[tsLineIndex]?.slice(
    anchor.start.character,
    anchor.end.character,
  );
  if (!isAliasMatch && tsSlice !== intendedText) {
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[ANCHOR_MAP] TS text mismatch - TS: "${tsSlice}", Expected: "${intendedText}"`);
    }
    ctx.occIndexCache.set(cacheKey, desiredOccIdx + 1);
    ctx.mappedAnchors.add(anchor);
    return false;
  }

  // Duplicate generated column?
  if (ctx.claimedGenCols.has(anchor.start.character)) {
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[ANCHOR_MAP] Generated column ${anchor.start.character} already claimed`);
    }
    ctx.mappedAnchors.add(anchor);
    return false;
  }
  ctx.claimedGenCols.add(anchor.start.character);

  // Check overlap with claimedSpans
  for (let k = 0; k < locationInfo.length; k++) {
    const charKey = claimKey(civetLineIndex, locationInfo.startIndex + k);
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[ANCHOR_MAP] Checking if Civet L${civetLineIndex + 1}:C${locationInfo.startIndex + k} is claimed (key: ${charKey}). Result: ${ctx.claimedSpans.has(charKey)}`);
    }
    if (ctx.claimedSpans.has(charKey)) {
      if (DEBUG_FLAGS.DENSE_MAP) {
        console.log(`[ANCHOR_MAP] Span overlap detected at Civet L${civetLineIndex + 1}:C${locationInfo.startIndex + k}`);
      }
      ctx.mappedAnchors.add(anchor);
      return false;
    }
  }

  if (DEBUG_FLAGS.DENSE_MAP) {
    console.log(`[ANCHOR_MAP] Claiming spans for '${anchor.text}' at Civet L${civetLineIndex + 1}:C${locationInfo.startIndex}-${locationInfo.startIndex + locationInfo.length - 1}`);
  }
  for (let k = 0; k < locationInfo.length; k++) {
    const charKey = claimKey(civetLineIndex, locationInfo.startIndex + k);
    ctx.claimedSpans.add(charKey);
  }

  // Success – update occurrence index
  ctx.occIndexCache.set(cacheKey, desiredOccIdx + 1);

  // Build mapping segments
  const sourceSvelteLine = ctx.civetBlockStartLine - 1 + civetLineIndex;
  const sourceSvelteStartCol = locationInfo.startIndex + ctx.indentation;
  const nameIdx = anchor.kind === 'identifier' ? ctx.names.indexOf(anchor.text) : -1;

  const startSeg: number[] = [
    anchor.start.character,
    0,
    sourceSvelteLine,
    sourceSvelteStartCol,
  ];
  if (nameIdx > -1) startSeg.push(nameIdx);

  ctx.anchorToSegments.set(anchor, [startSeg]);

  const kindsNeedEnd = [
    'identifier',
    'numericLiteral',
    'interpolationClose',
    'interpolationOpen',
    'operator',
    'keyword',
    'stringLiteral',
    'quote',
  ];
  if (kindsNeedEnd.includes(anchor.kind) && !(anchor as any).__syntheticMacro) {
    const endSeg = [
      anchor.end.character,
      0,
      sourceSvelteLine,
      sourceSvelteStartCol + locationInfo.length,
    ];
    ctx.anchorToSegments.get(anchor)!.push(endSeg);
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[ANCHOR_MAP] Successfully mapped '${anchor.text}' with segments: [${startSeg}], [${endSeg}]`);
    }
  } else {
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[ANCHOR_MAP] Successfully mapped '${anchor.text}' with segments: [${startSeg}]`);
    }
  }

  ctx.mappedAnchors.add(anchor);
  return true;
}