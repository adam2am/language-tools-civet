/**
 * @file Detects literal and interpolation ranges for a *single* line of Civet.
 *
 * Responsibilities:
 *   • Mark quoted strings (', ", `) while respecting escape sequences.
 *   • Track interpolation blocks (`#{…}` and `${…}`) inside double-quoted and
 *     template literals, returning both the literal slice and the inner
 *     expression slice.
 *   • Identify line comments introduced by `//`, or by `#` **only** when the
 *     hash is the first non-whitespace character on the line – mirroring
 *     Civet's comment semantics.
 *
 * The returned `literalRanges`/`interpolationRanges` arrays contain inclusive
 * start/end positions and are optimised for fast `isInside()` checks.
 */
import { LITERAL_RANGES_CACHE_MAX, CACHE_TTL_MS } from '../constants';

export type Range = { start: number; end: number }; // end is inclusive

export type LiteralInfo = {
	literalRanges: Range[];
	interpolationRanges: Range[];
};

// Hybrid LRU + TTL cache entry
type CacheEntry = { value: LiteralInfo; ts: number };
const literalCache = new Map<string, CacheEntry>();

function pushRange(ranges: Range[], s: number, e: number) {
		if (e >= s) ranges.push({ start: s, end: e });
};

export function getLiteralRanges(line: string): LiteralInfo {
	const now = Date.now();
	let cached = literalCache.get(line);
	if (cached && now - cached.ts < CACHE_TTL_MS) {
		// Cache hit within TTL – mark as recently used by reinserting
		literalCache.delete(line);
		literalCache.set(line, cached);
		return cached.value;
	}

	const literalRanges: Range[] = [];
	const interpolationRanges: Range[] = [];
	const len = line.length;

	let i = 0;

	while (i < len) {
		const ch = line[i];

		if (ch === "'" || ch === '"' || ch === '`') {
			// String or template literal
			const quote = ch;
			let currentLiteralPartStart = i;
			pushRange(literalRanges, i, i); // The opening quote is a literal
			i++;

			while (i < len) {
				const c = line[i];
				if (c === '\\') {
					i += 2; // skip escaped char
					continue;
				}
				
				// Handle interpolation only for " and `
				if ((quote === '"' || quote === '`') && (
					(c === '#' && i + 1 < len && line[i + 1] === '{') ||
					(c === '$' && i + 1 < len && line[i + 1] === '{')
				)) {
						// End of the string part before interpolation.
						pushRange(literalRanges, currentLiteralPartStart + 1, i - 1);

						const interpStart = i;
						// Skip over the interpolation block.
						i += 2; // Move past `#{` or `${`
						let braceLevel = 1;
						const exprStart = i;
						while (i < len && braceLevel > 0) {
								if (line[i] === '{') braceLevel++;
								else if (line[i] === '}') braceLevel--;
								i++;
						}
						// `i` is now at the character after the closing `}`.
						const exprEnd = i - 1;
						pushRange(interpolationRanges, exprStart, exprEnd);
						pushRange(literalRanges, interpStart, i - 1); // The whole ${...} is also a literal part

						// This is the start of the next part of the string literal.
						currentLiteralPartStart = i - 1;
						continue; // Back to the inner string-scanning loop.
				}

				if (c === quote) {
					pushRange(literalRanges, i, i); // The closing quote
					i++; // move past closing quote
					break; // Exit the inner while loop
				}
				i++;
			}
			if (i > currentLiteralPartStart + 1) {
				pushRange(literalRanges, currentLiteralPartStart + 1, i - 2);
			}
			continue;
		}

		// Line comment detection (// or #, but not in string)
		if (ch === '/' && i + 1 < len && line[i + 1] === '/') {
			pushRange(literalRanges, i, len - 1);
			break;
		}
		if (ch === '#') {
			// Treat everything after # as comment if # is first non-space char
			const prefix = line.slice(0, i).trim();
			if (prefix === '') {
				pushRange(literalRanges, i, len - 1);
				break;
			}
		}

		i++;
	}

	const result: LiteralInfo = { literalRanges, interpolationRanges };

	// Simple LRU eviction when size limit reached
	if (literalCache.size >= LITERAL_RANGES_CACHE_MAX) {
		const oldestKey = literalCache.keys().next().value;
		if (oldestKey !== undefined) literalCache.delete(oldestKey);
	}
	literalCache.set(line, { value: result, ts: now });
	return result;
}

export function isInside(idx: number, ranges: Range[]): boolean {
	for (const r of ranges) {
		if (idx >= r.start && idx <= r.end) return true;
	}
	return false;
}