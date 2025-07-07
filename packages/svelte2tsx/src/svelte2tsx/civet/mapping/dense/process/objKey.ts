/**
 * @file The object key: interprets Civet's abbreviated syntax and reserves the appropriate anchors.
 *
 * Powers:
 * - Map object key anchors with confidence (runObjectKeyPrepass)
 *
 * This module handles the mapping of object keys, which are often challenging
 * due to Civet's shorthand syntax (e.g., `{ anIdentifier }` where the key and
 * value are the same). The standard `tokenMap` can misinterpret these.
 *
 * `runObjectKeyPrepass` is executed before the main `tokenMap`. It specifically
 * looks for identifier anchors that match common object key patterns
 * - A lone identifier inside braces: `{ key }`
 * - An identifier followed by a colon: `key:`
 *
 * When a confident match is found, it creates the mapping and claims the
 * relevant spans and anchors, ensuring the main mapper doesn't process them again.
 * This significantly improves the accuracy of object literal mappings.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import type { GlobalContext, LineContext } from '../context';
import { claimKey, DEBUG_FLAGS } from '../constants';
import { FastBitSet } from '../bitset';
import { findLoneObjectKey, looksLikeColonObjectKey } from '../../shared/identifierUtils';

function mapObjectKeyAnchors(
    lineAnchors: Anchor[],
    civetLines: string[],
    segList: { genCol: number; civetLine: number }[] | undefined,
    claimedSpans: FastBitSet<number | string>,
    claimedGenCols: FastBitSet<number>,
    occIndexCache: Map<string, number>,
    anchorToSegments: Map<Anchor, number[][]>,
    civetBlockStartLine: number,
    indentation: number,
    names: string[],
    mappedAnchors: Set<Anchor>,
    isInComment: (line: number, col: number) => boolean,
    isInString: (line: number, col: number) => boolean,
) {
    if (!segList) return;
    const keyCandidateLines = Array.from(new Set(segList.map(s => s.civetLine)));

    for (const anchor of lineAnchors) {
        if (anchor.kind !== 'identifier' || mappedAnchors.has(anchor)) continue;

        for (const lineIdx of keyCandidateLines) {
            const line = civetLines[lineIdx] || '';
            // 1) Classic object key pattern: "status:" (identifier followed by colon)
            let keyIdx = -1;
            const colonIdx = line.indexOf(anchor.text);
            if (colonIdx !== -1 && looksLikeColonObjectKey(line, colonIdx, anchor.text)) {
                keyIdx = colonIdx;
            }

            // 2) Lone object-key pattern ("{status}", "status}", "status,")
            if (keyIdx === -1) {
                keyIdx = findLoneObjectKey(line, anchor.text);
            }

            if (keyIdx !== -1) {
                // Skip if the match starts inside a comment or string literal
                if (isInComment(lineIdx, keyIdx) || isInString(lineIdx, keyIdx)) {
                    continue;
                }

                const keyLen = anchor.text.length;
                const isClaimed = Array.from({ length: keyLen }).some((_, i) => claimedSpans.has(claimKey(lineIdx, keyIdx + i)));
                if (isClaimed || claimedGenCols.has(anchor.start.character)) continue;

                // Claim it
                for (let i = 0; i < keyLen; i++) claimedSpans.add(claimKey(lineIdx, keyIdx + i));
                claimedGenCols.add(anchor.start.character);
                // Reserve occurrence index so main pass starts with next instance
                const cacheKey = `${lineIdx}:identifier:${anchor.text}`;
                const prevOcc = occIndexCache.get(cacheKey) ?? 0;
                occIndexCache.set(cacheKey, prevOcc + 1);
                mappedAnchors.add(anchor);

                const sourceSvelteLine = (civetBlockStartLine - 1) + lineIdx;
                const sourceSvelteStartCol = keyIdx + indentation;
                const nameIdx = names.indexOf(anchor.text);

                const segments: number[][] = [];
                const startSegment: number[] = [anchor.start.character, 0, sourceSvelteLine, sourceSvelteStartCol];
                if (nameIdx > -1) startSegment.push(nameIdx);
                segments.push(startSegment);
                
                const endSegment = [anchor.end.character, 0, sourceSvelteLine, sourceSvelteStartCol + anchor.text.length];
                segments.push(endSegment);

                anchorToSegments.set(anchor, segments);
                
                if (DEBUG_FLAGS.DENSE_MAP) {
                    console.log(`[ANCHOR_OBJKEY_PREPASS] '${anchor.text}' at Civet L${lineIdx+1}C${keyIdx}`);
                }
                break; 
            }
        }
    }
}

export function runObjectKeyPrepass(
  globalCtx: GlobalContext,
  lineCtx: LineContext,
  lineAnchors: Anchor[],
  segListForLine: { genCol: number; civetLine: number }[] | undefined,
) {
    type CombinedCtx = GlobalContext & LineContext;
    const ctx = { ...globalCtx, ...lineCtx } as CombinedCtx;
    mapObjectKeyAnchors(
        lineAnchors,
        ctx.civetCodeLines,
        segListForLine,
        ctx.claimedSpans,
        ctx.claimedGenCols,
        ctx.occIndexCache,
        ctx.anchorToSegments,
        ctx.civetBlockStartLine,
        ctx.indentation,
        ctx.names,
        ctx.mappedAnchors,
        ctx.isInComment,
        ctx.isInString,
    );
}