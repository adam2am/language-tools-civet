import type { Anchor } from '../shared/tsAnchorCollector';
import type { buildTokenIndex } from './prep/indexTokens';
import type { getLiteralRanges } from './prep/literalRanges';
import { FastBitSet } from './bitset';

// ---------------------------------------------------------------------------
//  DENSE MAP BUILDER CONTEXT
//  --------------------------------------------------------------------------
//  This object bundles all inputs and mutable state used throughout the
//  dense-map building process.  Introducing it inside the same file keeps
//  behaviour identical while paving the way for an easy split into separate
//  modules later.
// ---------------------------------------------------------------------------
export interface GlobalContext {
  // Immutable per-file inputs
  readonly tsLines: string[];
  readonly civetCodeLines: string[];
  readonly names: string[];
  readonly DEBUG_DENSE_MAP: boolean;
  readonly civetBlockStartLine: number;
  readonly indentation: number;

  // Lookup tables produced by buildLookupTables
  readonly anchorsByLine: Map<number, Anchor[]>;
  readonly generatedIdentifiers: Set<string>;
  readonly tsLineToCivetLineMap: Map<number, number>;
  readonly civetSegmentsByTsLine: Map<number, { genCol: number; civetLine: number }[]>;

  // Pre-computed per-line analysis helpers
  readonly tokenIndex: ReturnType<typeof buildTokenIndex>;
  readonly precomputedLiteralInfo: Array<ReturnType<typeof getLiteralRanges>>;

  // Comment / string literal masks (per Civet line)
  readonly commentMasks: import('./bitset').FastBitSet<number>[];
  readonly stringMasks: import('./bitset').FastBitSet<number>[];

  // Helper predicates
  isInComment: (line: number, col: number) => boolean;
  isInString: (line: number, col: number) => boolean;

  // Global mutable state (persists across TS lines)
  claimedSpans: FastBitSet<number | string>;
}

export interface LineContext {
  // Hot-loop mutable state (reset for each TS line)
  claimedGenCols: FastBitSet<number>;
  occIndexCache: Map<string, number>;
  anchorToSegments: Map<Anchor, number[][]>;
  mappedAnchors: Set<Anchor>;
}

export function createLineContext(): LineContext {
  return {
    claimedGenCols: new FastBitSet<number>(),
    occIndexCache: new Map<string, number>(),
    anchorToSegments: new Map<Anchor, number[][]>(),
    mappedAnchors: new Set<Anchor>(),
  };
}

// Lightweight counter object so we can pass references into helpers
export interface MapStats {
  fallbackTotal: number;
  dropTotal: number;
}