import type { Anchor } from '../shared/tsAnchorCollector';
import { LocatorStats } from '../shared/tokenFinder';
import type { MapStats, GlobalContext, LineContext } from './context';
import { createLineContext } from './context';
import { DEBUG_FLAGS } from './constants';
import { getLiteralRanges } from './prep/literalRanges';
import { buildTokenIndex } from './prep/indexTokens';
import { buildCommentStringMasks } from './prep/maskCommentsAndStrings';
import { mapAnchor } from './process/tokenMap';
import { mapSpecialConstructs, preprocessAnchors } from './process/specialConstructs';
import { assembleSegmentsFromAnchors, finalizeLineSegments } from './post/segmentFinalizer';
import { FastBitSet } from './bitset';


// ---------------------------------------------------------------------------
//  main orchestrator: buildDenseMapLines
// ---------------------------------------------------------------------------
export function buildDenseMapLines(
  tsLines: string[],
  anchorsByLine: Map<number, Anchor[]>,
  generatedIdentifiers: Set<string>,
  tsLineToCivetLineMap: Map<number, number>,
  civetSegmentsByTsLine: Map<number, { genCol: number; civetLine: number }[]>,
  civetCodeLines: string[],
  civetBlockStartLine: number,
  indentation: number,
  names: string[],
  DEBUG_DENSE_MAP: boolean,
) {
  const tStart = DEBUG_FLAGS.BENCHMARK ? performance.now() : 0;

  // ---- Hot-loop stats -----------------------------------------------
  let anchorTotal = 0;
  const stats: MapStats = { fallbackTotal: 0, dropTotal: 0 };
  // -------------------------------------------------------------------

  const decoded: number[][][] = [];
  const claimedSpans = new FastBitSet<number | string>(); // persists across TS lines
  const MAX_LOOKAHEAD = 3; // Hoisted from normalizer scope

  if (DEBUG_FLAGS.DENSE_MAP) {
    console.log(`[BUILDER] Starting dense map build for ${tsLines.length} TS lines`);
    console.log(`[BUILDER] Civet code has ${civetCodeLines.length} lines, starting at line ${civetBlockStartLine}`);
  }

  // Precompute literal/interpolation ranges for each civet line once
  const precomputedLiteralInfo = civetCodeLines.map(line => getLiteralRanges(line));

  // Precompute comment & string masks once
  const { commentMasks, stringMasks } = buildCommentStringMasks(civetCodeLines);

  // Build token index for all civet lines
  const tokenIndex = buildTokenIndex(civetCodeLines);

  // Build global (immutable + cross-line) context once
  const globalCtx: GlobalContext = {
    tsLines,
    civetCodeLines,
    names,
    DEBUG_DENSE_MAP,
    civetBlockStartLine,
    indentation,
    anchorsByLine,
    generatedIdentifiers,
    tsLineToCivetLineMap,
    civetSegmentsByTsLine,
    tokenIndex,
    precomputedLiteralInfo,
    commentMasks,
    stringMasks,
    isInComment: (ln: number, col: number) => {
      const mask = commentMasks[ln];
      return mask ? mask.has(col) : false;
    },
    isInString: (ln: number, col: number) => {
      const mask = stringMasks[ln];
      return mask ? mask.has(col) : false;
    },
    claimedSpans,
  } as GlobalContext;

  // Development safeguard: deep-freeze global context in debug mode
  if (DEBUG_FLAGS.DENSE_MAP && typeof Object.freeze === 'function') {
    Object.freeze(globalCtx);
  }

  for (let i = 0; i < tsLines.length; i++) {
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`\n[BUILDER] Processing TS Line ${i + 1}: "${tsLines[i]}"`);
    }
    
    const lineCtx = createLineContext();
    type CombinedCtx = GlobalContext & LineContext;
    const ctx: CombinedCtx = { ...globalCtx, ...lineCtx };

    const lineAnchors = anchorsByLine.get(i) || [];
    const lineSegments: number[][] = [];
    const segListForLine = civetSegmentsByTsLine.get(i);
    
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[BUILDER] Found ${lineAnchors.length} anchors for line ${i + 1}`);
      if (segListForLine) {
        console.log(`[BUILDER] Civet segments for line ${i + 1}:`, segListForLine);
      }
    }
    
    // --- Pre-pass: Merge multi-token aliases into synthetic anchors ---
    const processedAnchors = preprocessAnchors(lineAnchors);
    // Update benchmark counter: total anchors processed
    anchorTotal += processedAnchors.length;

    // ------------------------------------------------------------------
    // Synthetic pass (inclusive range, object keys, etc.)
    // This runs BEFORE the main anchor-mapper so it can claim tokens.
    // ------------------------------------------------------------------
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[BUILDER] Starting synthetic pass for line ${i + 1}`);
    }
    mapSpecialConstructs(globalCtx, lineCtx, processedAnchors, segListForLine);

    // Pass 1: High-priority (identifiers and macros)
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[BUILDER] Starting Pass 1 (high-priority) for line ${i + 1}`);
    }
    processedAnchors.forEach(anchor => {
        if (anchor.kind === 'identifier' || (anchor as any).__syntheticMacro) {
            if (lineCtx.mappedAnchors.has(anchor)) return;
            mapAnchor(globalCtx, lineCtx, anchor, segListForLine, i, MAX_LOOKAHEAD, stats);
        }
    });

    // Pass 2: All other anchors
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[BUILDER] Starting Pass 2 (remaining anchors) for line ${i + 1}`);
    }
    processedAnchors.forEach(anchor => {
        if (lineCtx.mappedAnchors.has(anchor)) return;
        mapAnchor(globalCtx, lineCtx, anchor, segListForLine, i, MAX_LOOKAHEAD, stats);
    });
    
    // Pass 3: Assemble segments from anchors and fill gaps
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[BUILDER] Starting Pass 3 (segment assembly) for line ${i + 1}`);
    }
    const assembledFromAnchors = assembleSegmentsFromAnchors(
      processedAnchors,
      lineCtx.anchorToSegments,
      tsLines[i].length,
    );
    lineSegments.push(...assembledFromAnchors);

    const finalSegments = finalizeLineSegments(lineSegments, ctx, i);
    decoded.push(finalSegments);

    // Log the state of claimed spans after processing each line
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[BUILDER] After processing TS Line ${i + 1}, claimedSpans has been updated`);
    }
  }

  if (DEBUG_FLAGS.BENCHMARK) {
    const tEnd = performance.now();
    console.log(`[Civet-BENCH] Dense map build took ${(tEnd - tStart).toFixed(2)}ms`);
    console.log(`[denseMap] anchors=${anchorTotal} dropped=${stats.dropTotal} fallbacks=${stats.fallbackTotal}`);
    // Only print regexHits if any were recorded to prevent misleading zeros
    const locatorMsg = LocatorStats.regexHits
      ? `[tokenLocator] indexHits=${LocatorStats.indexHits} regexHits=${LocatorStats.regexHits}`
      : `[tokenLocator] indexHits=${LocatorStats.indexHits}`;
    console.log(locatorMsg);
  }

  return decoded;
}