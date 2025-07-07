/**
 * @file Finalizes source map segments for a single line.
 *
 * This module contains the logic for the "post" phase of the dense mapper,
 * which takes a raw collection of generated segments for a single TS line and
 * performs several cleanup and enhancement steps:
 *
 * 1.  `assembleSegmentsFromAnchors`: Takes the final, mapped anchors and converts
 *     them into a preliminary list of source map segments. It also identifies
 *     gaps between anchors that need to be filled.
 *
 * 2.  `finalizeLineSegments`: This is the main orchestrator for the post-pass.
 *     It sorts all segments by their generated column, removes any duplicates,
 *     and then applies two critical heuristics:
 *
 *     - **Fallback Insertion**: If a TS line has no mappings at all, it attempts
 *       to insert a "fallback" mapping that points to the first non-whitespace
 *       character of the corresponding Civet line. This ensures that even
 *       lines containing only syntax (like a closing brace) are still mappable.
 *
 *     - **Front-Padding Fix**: It addresses issues with leading whitespace by
 *       adjusting the initial mapping segment to ensure it doesn't create
 *       incorrect mappings for indentation.
 */
// Stage-4: gap-fill, deduplication, fallback insertion, front-padding fixes.

import type { Anchor } from '../../shared/tsAnchorCollector';
import { DEBUG_FLAGS } from '../constants';
import { getLiteralRanges } from '../prep/literalRanges';
import type { GlobalContext, LineContext } from '../context';
type CombinedCtx = GlobalContext & LineContext;

/**
 * Assemble a list of segments for one TS line from processed anchors.
 * Fills gaps with placeholder arrays containing only the generated column.
 */
export function assembleSegmentsFromAnchors(
  processedAnchors: Anchor[],
  anchorToSegments: Map<Anchor, number[][]>,
  tsLineLength: number,
): number[][] {
  const assembled: number[][] = [];
  let lastGenCol = 0;
  for (const anchor of processedAnchors) {
    if (anchor.start.character > lastGenCol) {
      assembled.push([lastGenCol]);
    }

    const segments = anchorToSegments.get(anchor);
    if (segments) {
      assembled.push(...segments);
    } else {
      assembled.push([anchor.start.character]);
    }
    lastGenCol = anchor.end.character;
  }

  if (lastGenCol < tsLineLength) {
    assembled.push([lastGenCol]);
  }
  return assembled;
}

/**
 * Applies sorting, deduplication, fallback insertion, and leading-whitespace fix.
 */
export function finalizeLineSegments(
  lineSegments: number[][],
  ctx: CombinedCtx,
  lineIndex: number,
): number[][] {
  const sorted = lineSegments.sort((a, b) => a[0] - b[0]);
  const deduped: number[][] = [];
  const seen = new Set<string>();
  for (const seg of sorted) {
    const key = seg.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(seg);
    }
  }

  if (DEBUG_FLAGS.DENSE_MAP) {
    console.log(`[WHITESPACE_MAP] Line ${lineIndex + 1} – deduped segments BEFORE fallback/front-pad:`, JSON.stringify(deduped));
    // Log whitespace segments
    const whitespaceSeg = deduped.filter(s => s.length < 4);
    console.log(`[WHITESPACE_MAP] Line ${lineIndex + 1} – whitespace segments:`, JSON.stringify(whitespaceSeg));
  }

  // Ensure there is at least one real mapping.
  const hasRealMapping = deduped.some(s => s.length >= 4);
  const hasRealSegAtZero = deduped.some(s => s[0] === 0 && s.length >= 4);

  if (!hasRealMapping && !hasRealSegAtZero) {
    const fallbackCivetLine = ctx.tsLineToCivetLineMap.get(lineIndex);
    if (fallbackCivetLine !== undefined) {
      const civetText = ctx.civetCodeLines[fallbackCivetLine] || '';
      if (civetText.trim() !== '') {
        const { literalRanges } = getLiteralRanges(civetText);
        let firstNonWsIndex = -1;
        for (let col = 0; col < civetText.length; col++) {
          if (
            !/\s/.test(civetText[col]) &&
            !literalRanges.some(r => col >= r.start && col <= r.end)
          ) {
            firstNonWsIndex = col;
            break;
          }
        }
        if (firstNonWsIndex !== -1) {
          const sourceSvelteLine = ctx.civetBlockStartLine - 1 + fallbackCivetLine;
          const sourceSvelteCol = firstNonWsIndex + ctx.indentation;
          deduped.unshift([0, 0, sourceSvelteLine, sourceSvelteCol]);

          if (DEBUG_FLAGS.DENSE_MAP) {
            console.log(
              `[DENSE_MAP_FALLBACK] Inserted synthetic mapping for TS line ${lineIndex + 1} -> Civet line ${fallbackCivetLine + 1}`,
            );
          }
        }
      }
    }
  }

  // Front-padding fix for leading whitespace.
  const firstSegAtZero = deduped.find(s => s.length >= 4 && s[0] === 0);
  if (firstSegAtZero) {
    // Count how many real mappings we have (segments with source info)
    const realMappings = deduped.filter(s => s.length >= 4);
    const hasOtherRealMappings = realMappings.length > 1;
    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[WHITESPACE_MAP] Line ${lineIndex + 1} – firstSegAtZero:`, JSON.stringify(firstSegAtZero));
      console.log(`[WHITESPACE_MAP] Line ${lineIndex + 1} – hasOtherRealMappings:`, hasOtherRealMappings);
      console.log(`[WHITESPACE_MAP] Line ${lineIndex + 1} – realMappings:`, JSON.stringify(realMappings));
    }
    if (!hasOtherRealMappings) {
      // Only rewrite if this is the only real mapping
      const rewritten = deduped.map(s => {
        if (s === firstSegAtZero) return [0];
        return s;
      });
      if (DEBUG_FLAGS.DENSE_MAP) {
        console.log(`[WHITESPACE_MAP] Line ${lineIndex + 1} – rewritten segments:`, JSON.stringify(rewritten));
      }
      return rewritten;
    } else {
      if (DEBUG_FLAGS.DENSE_MAP) {
        console.log(`[FP_SEG_REWRITE_SUPPRESS] TS line ${lineIndex + 1} has additional real segments; rewrite skipped.`);
      }
    }
  }

  if (DEBUG_FLAGS.DENSE_MAP) {
    console.log(`[WHITESPACE_MAP] Line ${lineIndex + 1} – segments AFTER front-pad:`, JSON.stringify(deduped));
  }

  return deduped;
}