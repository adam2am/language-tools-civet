// shifts, debug flags
export const DEBUG_FLAGS = {
    BENCHMARK: process.env.CIVET_BENCH === '1',
    DENSE_MAP: process.env.CIVET_DEBUG_DENSE === '1',
    CHAINER: process.env.CIVET_DEBUG_CHAINER === '1',
    PREPROCESS: process.env.CIVET_DEBUG_PREPROCESS === '1',

};
// ---------------------------------------------------------------------------
//  NUMERIC CLAIM-KEY ENCODING (line: 20 bits | column: 12 bits ⇢ 0‒4095)
//  Replaces the previous `${line}:${col}` string keys to reduce allocations.
// ---------------------------------------------------------------------------
export const LINE_SHIFT = 12; // supports column values up to 4095
// Guarded key: falls back to string for extreme columns/lines
export const claimKey = (line: number, col: number): number | string => {
  if (col >= 0x1000 || line >= (1 << (32 - LINE_SHIFT))) {
    return `${line}:${col}`; // rare path – keeps uniqueness without overflow
  }
  return (line << LINE_SHIFT) | col;
};

// ---------------------------------------------------------------------------
//  CACHE SIZE LIMITS – keep hot-path memoization bounded in long-lived LS runs
// ---------------------------------------------------------------------------
export const LITERAL_RANGES_CACHE_MAX = 10_000;      // lines memoised in getLiteralRanges()
export const INTERPOLATION_CACHE_MAX = 5_000;        // lines memoised in tokenLocator interpCache
export const AST_CACHE_MAX            = 200;         // compiled TS snippets stored in normalizer AST cache

// ---------------------------------------------------------------------------
//  CACHE TTL – max age for hybrid LRU+TTL caches (default 30 min)
// ---------------------------------------------------------------------------
export const CACHE_TTL_MS = process.env.CIVET_CACHE_TTL_MS ? Number(process.env.CIVET_CACHE_TTL_MS) : 30 * 60 * 1000;