/**
 * @file lookupTables: conjures fast maps for anchors and lines.
 * Recipe: Scans the raw Civet-to-TS source map and the collected TS anchors to build
 * several critical data structures that accelerate the main mapping process:
 *
 * - `tsLineToCivetLineMap`: A fast map to get an approximate Civet line for any TS line.
 * - `civetSegmentsByTsLine`: A detailed map from a TS line to all its potential Civet source lines, crucial for disambiguation.
 * - `generatedIdentifiers`: A set of identifiers present in the TS output but not in the original Civet, used to avoid mapping compiler artifacts.
 * - `anchorsByLine`: Groups all TS anchors by their line number for efficient, sequential processing.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import type { LinesMap } from '../../../types';

export function buildLookupTables(
  tsAnchors: Anchor[],
  civetMap: LinesMap,
  civetCodeLines: string[],
  tsLines: string[]
) {
  // Create a quick lookup to find the approximate Civet snippet line for a given TS line.
  const tsLineToCivetLineMap = new Map<number, number>();

  // First pass: direct mappings from the Civet map.
  civetMap.lines.forEach((segments, tsLineIdx) => {
    for (const seg of segments) {
      if (seg.length >= 4) {
        tsLineToCivetLineMap.set(tsLineIdx, seg[2]);
        break;
      }
    }
  });

  // Second pass: propagate the last known Civet line to TS lines that lack one.
  let lastKnownCivetLine: number | undefined = undefined;
  const totalTsLines = civetMap.lines.length;
  for (let tsIdx = 0; tsIdx < totalTsLines; tsIdx++) {
    if (tsLineToCivetLineMap.has(tsIdx)) {
      lastKnownCivetLine = tsLineToCivetLineMap.get(tsIdx);
    } else if (lastKnownCivetLine !== undefined) {
      tsLineToCivetLineMap.set(tsIdx, lastKnownCivetLine);
    }
  }

  // -------------------------------------------------------------------
  // Fast path: Determine compiler-generated identifiers.
  // Instead of N(anchor) × N(lines) regex tests we pre-scan the Civet
  // snippet once, collect every identifier-like token into a Set, and
  // then lookups become O(1).
  // -------------------------------------------------------------------
  const civetIdentifierSet = new Set<string>();
  const idScanRegex = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
  for (const line of civetCodeLines) {
    let m: RegExpExecArray | null;
    idScanRegex.lastIndex = 0;
    while ((m = idScanRegex.exec(line))) {
      civetIdentifierSet.add(m[0]);
    }
  }

  const generatedIdentifiers = new Set<string>();
  for (const anchor of tsAnchors) {
    if (anchor.kind === 'identifier' && !civetIdentifierSet.has(anchor.text)) {
      generatedIdentifiers.add(anchor.text);
    }
  }

  // Group all anchors by their line number for sequential processing.
  const anchorsByLine = new Map<number, Anchor[]>();
  for (const anchor of tsAnchors) {
    if (!anchorsByLine.has(anchor.start.line)) {
      anchorsByLine.set(anchor.start.line, []);
    }
    anchorsByLine.get(anchor.start.line)!.push(anchor);
  }
  // Sort anchors within each line by column to process them in order.
  for (const lineAnchors of anchorsByLine.values()) {
    lineAnchors.sort((a, b) => a.start.character - b.start.character);
  }

  const names = Array.from(new Set(tsAnchors.filter(a => a.kind === 'identifier').map(a => a.text)));
  
  // Build a detailed lookup: for each TS line, keep every raw mapping segment
  // so we can later choose the Civet line whose generated column range actually
  // covers a given anchor. This eliminates "first segment wins" errors.
  const civetSegmentsByTsLine = new Map<number, { genCol: number; civetLine: number }[]>();
  civetMap.lines.forEach((segments, tsLineIdx) => {
    for (const seg of segments) {
      if (seg.length >= 4) {
        const genCol = seg[0];
        const civetLine = seg[2];
        if (!civetSegmentsByTsLine.has(tsLineIdx)) {
          civetSegmentsByTsLine.set(tsLineIdx, []);
        }
        civetSegmentsByTsLine.get(tsLineIdx)!.push({ genCol, civetLine });
      }
    }
  });
  // Ensure each segment list is sorted by generated column ascending.
  for (const [tsIdx, list] of civetSegmentsByTsLine.entries()) {
    list.sort((a, b) => a.genCol - b.genCol || a.civetLine - b.civetLine);

    // ------------------------------------------------------------------
    // Disambiguation heuristic for duplicate generated columns:
    // If several mapping segments on the same TS line start at the identical
    // `genCol`, we need a way to decide which Civet segment belongs to which
    // anchor. We derive a *stable* alternative column by scanning the Civet
    // source line for the first identifier token, locating that identifier
    // inside the corresponding TS line, and using its column as the new
    // `genCol`. This generic approach works for all constructs that emit
    // duplicate columns (pipe chains, chained calls, etc.), not just
    // operators like `.`.
    // ------------------------------------------------------------------
    const tsText = tsLines[tsIdx] || '';
    const seenCols = new Set<number>();
    for (const seg of list) {
      if (!seenCols.has(seg.genCol)) {
        seenCols.add(seg.genCol);
        continue; // unique already
      }

      // Duplicate genCol – derive a better column
      const civetStage = civetCodeLines[seg.civetLine] || '';

      // Heuristic: find first identifier token or keyword in stage line
      const idMatch = /[\p{L}_$][\p{L}\p{N}_$]*/u.exec(civetStage);
      if (idMatch) {
        const idText = idMatch[0];
        const idxInTs = tsText.indexOf(idText);
        if (idxInTs !== -1 && !seenCols.has(idxInTs)) {
          seg.genCol = idxInTs;
          seenCols.add(idxInTs);
          continue;
        }
      }

      // Fallback: advance to next free column
      let newCol = seg.genCol;
      while (seenCols.has(newCol)) newCol++;
      seg.genCol = newCol;
      seenCols.add(newCol);
    }

    // Re-sort after modifications
    list.sort((a, b) => a.genCol - b.genCol);
  }

  return { tsLineToCivetLineMap, civetSegmentsByTsLine, generatedIdentifiers, anchorsByLine, names };
}