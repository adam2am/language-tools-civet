/**
 * @file The interpolation detective: cracks multi-line cases inside template strings.
 *
 * Powers:
 * - Map anchors inside multi-line interpolations (mapMultilineInterpolationAnchors)
 *
 * TS anchors that originate from expressions within multi-line template strings 
 * in Civet (e.g., an identifier inside a `${...}` block that spans multiple lines).
 *
 * The standard `tokenMap` logic can struggle with these because the anchor's
 * `inInterpolation` flag is only aware of the line it's on. This module,
 * `mapMultilineInterpolationAnchors`, specifically targets these identifiers.
 * It scans all potential Civet source lines associated with the TS line,
 * identifies the boundaries of each interpolation block, and then searches
 * *only* within those boundaries for a matching token.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import type { GlobalContext, LineContext } from '../context';
import { isWordChar } from '../../shared/identifierUtils';
import { DEBUG_FLAGS } from '../constants';
import { runInclusiveRangePrepass } from './rangeDotsMap';

// local copy of claimKey to avoid tight coupling
const LINE_SHIFT = 12;
const claimKey = (line: number, col: number): number | string => {
  if (col >= 0x1000 || line >= (1 << (32 - LINE_SHIFT))) {
    return `${line}:${col}`;
  }
  return (line << LINE_SHIFT) | col;
};

/**
 * Scan candidate civet lines for identifiers that appear inside multi-line string/interpolation expressions
 * and claim them if they map to the given TS anchor.
 */
export function mapMultilineInterpolationAnchors(
  globalCtx: GlobalContext,
  lineCtx: LineContext,
  lineAnchors: Anchor[],
  segList: { genCol: number; civetLine: number }[] | undefined,
) {
  type CombinedCtx = GlobalContext & LineContext;
  const ctx = { ...globalCtx, ...lineCtx } as CombinedCtx;
  if (!segList) return;

  // Run inclusive-range pre-pass early so `.slice` (or any method call produced
  // by `..`) is already claimed before we start any other identifier mapping.
  runInclusiveRangePrepass(globalCtx, lineCtx, lineAnchors, segList);
  const candidateLines = Array.from(new Set(segList.map((s) => s.civetLine)));

  for (const anchor of lineAnchors) {
    // Only care for identifiers that originate from template-interpolations
    if (
      anchor.kind !== 'identifier' ||
      ctx.mappedAnchors.has(anchor) ||
      !anchor.inInterpolation
    ) {
      if (DEBUG_FLAGS.DENSE_MAP && anchor.kind === 'identifier') {
        console.log(`[INTERP_MAP] Skipping '${anchor.text}': mapped=${ctx.mappedAnchors.has(anchor)}, inInterp=${anchor.inInterpolation}`);
      }
      continue;
    }

    if (DEBUG_FLAGS.DENSE_MAP) {
      console.log(`[INTERP_MAP] Processing interpolation identifier '${anchor.text}' at TS col ${anchor.start.character}`);
      console.log(`[INTERP_MAP] Searching in Civet lines:`, candidateLines);
    }

    for (const lineIdx of candidateLines) {
      const lineText = ctx.civetCodeLines[lineIdx] || '';
      if (DEBUG_FLAGS.DENSE_MAP) {
        console.log(`[INTERP_MAP] Scanning line ${lineIdx + 1}: "${lineText}"`);
      }

      // Block-scoped scan: walk each interpolation slice independently
      let found = false;
      const openRe = /[#$]\{/g;
      let openMatch: RegExpExecArray | null;

      outerLoop: while ((openMatch = openRe.exec(lineText))) {
        if (DEBUG_FLAGS.DENSE_MAP) {
          console.log(`[INTERP_MAP] Found interpolation opener at col ${openMatch.index}`);
        }

        // Locate matching closing brace to know the slice bounds
        let braceLevel = 1;
        let cursor = openMatch.index + 2;
        while (cursor < lineText.length && braceLevel > 0) {
          const ch = lineText[cursor];
          if (ch === '{') braceLevel++;
          else if (ch === '}') braceLevel--;
          cursor++;
        }
        const closeIdx = cursor - 1; // position of '}' (or end-of-line)
        const sliceStart = openMatch.index + 2;
        const sliceEnd = closeIdx;

        if (DEBUG_FLAGS.DENSE_MAP) {
          console.log(`[INTERP_MAP]  → slice [${sliceStart}, ${sliceEnd})`);
        }

        let searchIdx = sliceStart;
        while (searchIdx < sliceEnd) {
          const hit = lineText.indexOf(anchor.text, searchIdx);
          if (hit === -1 || hit >= sliceEnd) break;

          const before = lineText[hit - 1];
          const after = lineText[hit + anchor.text.length];
          const boundaryLeft = !isWordChar(before);
          const boundaryRight = !isWordChar(after);

          if (DEBUG_FLAGS.DENSE_MAP) {
            console.log(`[INTERP_MAP] Found potential match at col ${hit}:`);
            console.log(`[INTERP_MAP]   Text: '${anchor.text}'`);
            console.log(`[INTERP_MAP]   Boundaries: left=${boundaryLeft}(${before}), right=${boundaryRight}(${after})`);
          }

          if (boundaryLeft && boundaryRight) {
            // collision check
            const spanCollision = Array.from({ length: anchor.text.length }).some((_, i) =>
              ctx.claimedSpans.has(claimKey(lineIdx, hit + i)),
            );
            const genColCollision = ctx.claimedGenCols.has(anchor.start.character);

            if (spanCollision || genColCollision) {
              if (DEBUG_FLAGS.DENSE_MAP) {
                console.log(`[INTERP_COLLISION] '${anchor.text}' rejected at col ${hit}. spanCollision=${spanCollision}, genColCollision=${genColCollision}`);
              }
              // try next occurrence within same slice
              searchIdx = hit + anchor.text.length;
              continue;
            }

            // SUCCESS – claim
            if (DEBUG_FLAGS.DENSE_MAP) {
              console.log(`[INTERP_CLAIM] Claiming '${anchor.text}' at Civet L${lineIdx + 1}:C${hit} for genCol ${anchor.start.character}`);
            }

            for (let i = 0; i < anchor.text.length; i++) {
              ctx.claimedSpans.add(claimKey(lineIdx, hit + i));
            }
            ctx.claimedGenCols.add(anchor.start.character);
            ctx.mappedAnchors.add(anchor);

            const sourceSvelteLine = ctx.civetBlockStartLine - 1 + lineIdx;
            const sourceSvelteStartCol = hit + ctx.indentation;
            const nameIdx = ctx.names.indexOf(anchor.text);

            const segs: number[][] = [];
            const startSeg: number[] = [
              anchor.start.character,
              0,
              sourceSvelteLine,
              sourceSvelteStartCol,
            ];
            if (nameIdx > -1) startSeg.push(nameIdx);
            segs.push(startSeg);
            segs.push([
              anchor.end.character,
              0,
              sourceSvelteLine,
              sourceSvelteStartCol + anchor.text.length,
            ]);

            ctx.anchorToSegments.set(anchor, segs);
            found = true;
            break outerLoop;
          }

          searchIdx = hit + anchor.text.length;
        }

        // advance openRe search past this interpolation block
        openRe.lastIndex = closeIdx + 1;
      }

      if (!found) {
        if (DEBUG_FLAGS.DENSE_MAP) {
          console.log(`[INTERP_MAP] No match found in line ${lineIdx + 1}`);
        }
        // continue to next candidate line
        continue;
      }

      // if we get here a claim was made; break candidateLines loop
      break;
    }
  }
}