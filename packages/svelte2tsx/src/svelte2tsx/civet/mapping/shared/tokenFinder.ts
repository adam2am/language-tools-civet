import type { Anchor } from './tsAnchorCollector';
import { getLiteralRanges, isInside, type LiteralInfo } from '../dense/prep/literalRanges';
import { OPERATOR_LOOKUP, QUOTE_ALIAS } from './aliasRegistry';
import { isWordChar } from './identifierUtils';
import type { CivetToken } from '../dense/prep/indexTokens';
import { DEBUG_FLAGS, INTERPOLATION_CACHE_MAX, CACHE_TTL_MS } from '../dense/constants';

/**
 * Helper to always return a string alias (defaults to first element if array).
 */
function pickFirstAlias(alias: string | string[] | undefined): string | undefined {
	if (alias === undefined) return undefined;
	return Array.isArray(alias) ? alias[0] : alias;
}

// ---------------------------------------------------------------------------
//  INTERPOLATION TOKEN SCANNER (nest-aware)
// ---------------------------------------------------------------------------
type InterpTok = { kind: 'open' | 'close'; text: '${' | '#{' | '}'; pos: number; depth: number };

// Simple memoisation to prevent re-scanning the same line multiple times.
type InterpEntry = { value: InterpTok[]; ts: number };
const interpCache = new Map<string, InterpEntry>();

function scanInterpolationTokens(line: string): InterpTok[] {
		const now = Date.now();
		const cached = interpCache.get(line);
		if (cached && now - cached.ts < CACHE_TTL_MS) {
				// refresh LRU position
				interpCache.delete(line);
				interpCache.set(line, cached);
				return cached.value;
		}

		const out: InterpTok[] = [];
		let depth = 0;
		for (let i = 0; i < line.length; i++) {
				const ch = line[i];
				if ((ch === '$' || ch === '#') && line[i + 1] === '{') {
						const text = (ch === '$' ? '${' : '#{') as '${' | '#{';
						out.push({ kind: 'open', text, pos: i, depth });
						depth++;
						i++; // skip '{'
				} else if (ch === '}') {
						depth = Math.max(0, depth - 1);
						out.push({ kind: 'close', text: '}', pos: i, depth });
				}
		}
		interpCache.set(line, { value: out, ts: now });
		// Evict oldest to maintain upper bound
		if (interpCache.size > INTERPOLATION_CACHE_MAX) {
			const oldestKey = interpCache.keys().next().value;
			if (oldestKey !== undefined) interpCache.delete(oldestKey);
		}
		return out;
}

// ---------------------------------------------------------------------------
//  BENCHMARK STATS
// ---------------------------------------------------------------------------
export const LocatorStats = {
	regexHits: 0,
	indexHits: 0
};

export function locateTokenInCivetLine(
	anchor: Anchor,
	civetLineText: string,
	desiredOccIdx = 0,
	allowInsideLiteral = false,
	precomputed?: LiteralInfo,
	isInComment?: (col: number) => boolean,
	isInString?: (col: number) => boolean
): { startIndex: number; length: number } | undefined {
	// Hybrid override: If the token is a TS keyword that has a Civet alias in
	// `operatorLookup`, we want to search for that alias (".=" / ":=" / "->")
	// and treat the search behaviour like an operator rather than a word.

	const keywordOverrideRaw = anchor.kind === 'keyword' ? OPERATOR_LOOKUP[anchor.text] : undefined;
	const keywordOverride = pickFirstAlias(keywordOverrideRaw);

	const opAliasRaw = anchor.kind === 'operator' ? OPERATOR_LOOKUP[anchor.text] : undefined;
	const searchText = anchor.kind === 'operator'
		? (pickFirstAlias(opAliasRaw) || anchor.text)
		: (anchor.kind === 'keyword' && keywordOverride !== undefined)
			? keywordOverride
			: anchor.text;

	let foundIndex = -1;
	let seen = 0; // count of matches seen so far
	let effectiveText = searchText; // may be swapped for alias

	if (DEBUG_FLAGS.DENSE_MAP) {
		console.log(`[BUG_HUNT] Searching for "${searchText}" (anchor: "${anchor.text}", kind: ${anchor.kind}). Line content: "${civetLineText}"`);
	}

	const treatAsOperator = anchor.kind === 'operator' || keywordOverride !== undefined;
	const { literalRanges, interpolationRanges } = precomputed ?? getLiteralRanges(civetLineText);

	const allowInside = allowInsideLiteral || anchor.kind === 'interpolationOpen' || anchor.kind === 'interpolationClose';

	if (anchor.kind === 'identifier' || anchor.kind === 'numericLiteral' || (anchor.kind === 'keyword' && !treatAsOperator)) {
		if (DEBUG_FLAGS.DENSE_MAP) {
				console.log(`[FIX_VERIFY] Using Unicode-aware word boundary search for identifier-like token (kind: ${anchor.kind}).`);
		}

		// Tweak #3: Fast path for single-character tokens to avoid regex overhead.
		if (searchText.length === 1) {
				let currentPos = 0;
				while ((currentPos = civetLineText.indexOf(searchText, currentPos)) !== -1) {
						// Always ensure we are on an identifier word-boundary so that a
						// single-character identifier like `a` does not match the `a` in
						// `data` for example.
						const prevChar = civetLineText[currentPos - 1];
						const nextChar = civetLineText[currentPos + 1];
						const isValidWordBoundary = !isWordChar(prevChar) && !isWordChar(nextChar);

						// Respect literal ranges and comment/string masks
						const isValidLiteralPosition = allowInside || !isInside(currentPos, literalRanges);
						const isValidCommentString = (!isInComment || !isInComment(currentPos)) && (!isInString || !isInString(currentPos));
						if (!isValidLiteralPosition || !isValidCommentString) {
								currentPos++;
								continue;
						}

						// If the anchor is from an interpolation, the target SHOULD be inside
						// interpolation braces. However, `getLiteralRanges` cannot track
						// multi-line `${` … `}` segments that start on a *previous* line, so
						// in that case `interpolationRanges` is empty. Relax the guard when
						// the current line has zero ranges – this still guarantees we never
						// map to a position inside *another* interpolation on the same line
						// while allowing identifiers on subsequent lines of the block to
						// resolve correctly.
						if (
								anchor.inInterpolation &&
								interpolationRanges.length > 0 &&
								!isInside(currentPos, interpolationRanges)
						) {
								currentPos++;
								continue;
						}

						if (isValidWordBoundary) {
								if (seen++ === desiredOccIdx) {
										foundIndex = currentPos;
										break;
								}
						}
						currentPos++;
				}
		} else {
				let pos = civetLineText.indexOf(searchText, 0);
				while (pos !== -1) {
						// Ensure word boundaries using unicode-aware test
						const prevChar = civetLineText[pos - 1];
						const nextChar = civetLineText[pos + searchText.length];
						const isValidWordBoundary = !isWordChar(prevChar) && !isWordChar(nextChar);

						if (isValidWordBoundary) {
								const isValidLiteralPosition = allowInside || !isInside(pos, literalRanges);
								const isValidCommentString = (!isInComment || !isInComment(pos)) && (!isInString || !isInString(pos));
								if (isValidLiteralPosition && isValidCommentString) {
										if (
												anchor.inInterpolation &&
												interpolationRanges.length > 0 &&
												!isInside(pos, interpolationRanges)
										) {
												// skip – must be inside interpolation
										} else {
												if (seen++ === desiredOccIdx) {
														foundIndex = pos;
														break;
												}
										}
								}
						}
						pos = civetLineText.indexOf(searchText, pos + 1);
				}
		}
	} else if (treatAsOperator) {
		const aliasCandidates: string[] = [];

		// Keyword override takes precedence.
		if (keywordOverride) aliasCandidates.push(keywordOverride);

		if (anchor.kind === 'operator') {
			const opAlias = OPERATOR_LOOKUP[anchor.text];
			if (Array.isArray(opAlias)) {
				aliasCandidates.push(...opAlias);
			} else if (opAlias) {
				aliasCandidates.push(opAlias);
			}
			// Fallback to literal operator text if no alias matched.
			aliasCandidates.push(anchor.text);
		}

		for (const candidate of aliasCandidates) {
			if (DEBUG_FLAGS.DENSE_MAP) {
					console.log(`[FIX_VERIFY] Trying operator alias "${candidate}" for "${anchor.text}".`);
			}
			const trimmedText = candidate.trim();
			if (!trimmedText) continue;

			const isPunctuationOnlyMulti = /^[^\p{L}\p{N}_$]{2,}$/u.test(trimmedText);
			const isUnarySign = (trimmedText === '-' || trimmedText === '+');

			let pos = 0;
			while ((pos = civetLineText.indexOf(trimmedText, pos)) !== -1) {
				const prevChar = civetLineText[pos - 1];
				const nextChar = civetLineText[pos + trimmedText.length];

				// --------------------------------------------------------
				// Inline boundary guard: skip if this 1-char operator is
				// part of a larger multi-char operator on either side.
				// Prevents matching '.' inside '..' / '...', '=' inside
				// '==' / '===', '&' inside '&&', etc.
				// --------------------------------------------------------
				if (trimmedText.length === 1) {
					const ch = trimmedText;
					const isPartOfMulti = (c: string | undefined) => c === ch;

					// Generic same-char repetition (.., &&, ||, etc.)
					if (isPartOfMulti(prevChar) || isPartOfMulti(nextChar)) {
						pos += 1; // skip this occurrence, continue search
						continue;
					}

					// Special mixed combos (=>, ==, !=, >=, <=, ?:)
					const pairPrev = (prevChar ?? '') + ch;
					const pairNext = ch + (nextChar ?? '');

					const forbiddenPairs = [
						'=>', '=<', // arrows (=>) and hypothetical
						'==', '!=', '>=', '<=',
						'??', '&&', '||', '::',
					];
					if (forbiddenPairs.includes(pairNext) || forbiddenPairs.includes(pairPrev)) {
						pos += 1;
						continue;
					}
				}

				let leftBoundaryOK = !isWordChar(prevChar);
				let rightBoundaryOK = (isPunctuationOnlyMulti || isUnarySign) ? true : !isWordChar(nextChar);

				// Special-case: property accessor '.' or optional chaining '?.' –
				// the dot is *between* two word characters. Allow it as long as we
				// are not inside a multi-char operator (guarded above).
				if (trimmedText === '.') {
					leftBoundaryOK = true;
					rightBoundaryOK = true;
				}

				if (leftBoundaryOK && rightBoundaryOK) {
						if (allowInside || !isInside(pos, literalRanges)) {
						if (seen++ === desiredOccIdx) {
							// Return directly once found
							return { startIndex: pos, length: trimmedText.length };
						}
					}
				}
				// Advance by the matched operator length to avoid infinite loops while
				// still allowing overlapping matches (e.g. "&&&" should match indices 0,1).
				pos += Math.max(1, trimmedText.length);
			}
		}
	} else if (anchor.kind === 'quote') {
		if (DEBUG_FLAGS.DENSE_MAP) {
				console.log(`[FIX_VERIFY] Searching for quote in "${civetLineText}"`);
		}

		// Build candidate list: preferred alias(es) first, then original quote char
		const aliasList = QUOTE_ALIAS[anchor.text] ?? [];
		const candidates: string[] = [...aliasList, anchor.text];

		let localSeen = 0;
		outerQuoteSearch: for (const cand of candidates) {
				let pos = civetLineText.indexOf(cand);
				while (pos !== -1) {
						if (localSeen++ === desiredOccIdx) {
								foundIndex = pos;
								effectiveText = cand;
								break outerQuoteSearch;
						}
						pos = civetLineText.indexOf(cand, pos + 1);
				}
		}
	} else {
		if (DEBUG_FLAGS.DENSE_MAP) {
				console.log(`[FIX_VERIFY] Using indexOf search for non-identifier/numeric token (kind: ${anchor.kind}).`);
		}
		let idx = -1;

		if (anchor.kind === 'interpolationOpen' || anchor.kind === 'interpolationClose') {
				const tokens = scanInterpolationTokens(civetLineText);

				for (const tok of tokens) {
						if (anchor.kind === 'interpolationOpen' && tok.kind === 'open') {
								// For `${` anchors prefer `${` but allow alias `#{`.
								if (anchor.text !== tok.text && anchor.text !== '${') continue;
								if (seen++ === desiredOccIdx) {
										foundIndex = tok.pos;
										effectiveText = tok.text;
										break;
								}
						} else if (anchor.kind === 'interpolationClose' && tok.kind === 'close') {
								if (seen++ === desiredOccIdx) {
										foundIndex = tok.pos;
										break;
								}
						}
				}
		} else if (anchor.kind === 'stringLiteral') {
				idx = civetLineText.indexOf(searchText, 0);
		}

		// For tokens that must live inside literals (string chunks or interpolation markers),
		if (anchor.kind === 'stringLiteral' || anchor.kind === 'interpolationOpen' || anchor.kind === 'interpolationClose') {
				const isQuote = (c: string | undefined) => c === '"' || c === "'" || c === '`';
				while (idx !== -1) {
						// Extra guard: ensure candidate really lives inside a quoted segment,
						// not just any literal-like range such as a line comment.
						const prevChar = civetLineText[idx - 1];
						const nextChar = civetLineText[idx + searchText.length];
						const looksQuoted = isQuote(prevChar) || isQuote(nextChar);

						if (looksQuoted && (allowInside || isInside(idx, literalRanges))) {
								if (seen++ === desiredOccIdx) {
										foundIndex = idx;
										break;
								}
						}
						idx = civetLineText.indexOf(effectiveText, idx + 1);
				}
		} else {
				// For all other tokens (like keywords), we must find a match *outside* a literal range.
				idx = civetLineText.indexOf(searchText, 0);
				while (idx !== -1) {
					if (allowInside || !isInside(idx, literalRanges)) {
							if (seen++ === desiredOccIdx) {
								 foundIndex = idx;
								 break;
							}
					}
					idx = civetLineText.indexOf(searchText, idx + 1);
				}
		}
	}

	if (foundIndex !== -1) {
		if (DEBUG_FLAGS.BENCHMARK) LocatorStats.indexHits++;
		if (DEBUG_FLAGS.DENSE_MAP) {
			console.log(`[BUG_HUNT] Found "${effectiveText}" at index ${foundIndex}`);
		}
		return { startIndex: foundIndex, length: effectiveText.length };
	} else {
		if (DEBUG_FLAGS.DENSE_MAP) {
			console.log(`[BUG_HUNT] Token "${searchText}" not found on line.`);
		}
		return undefined;
	}
}

/**
 * Fast token locator using precomputed token index for identifier anchors.
 * Falls back to text scan for other anchor kinds.
 */
export function locateTokenByIndex(
    anchor: Anchor,
    tokens: CivetToken[],
    desiredOccIdx: number,
    precomputed: LiteralInfo,
    allowInsideLiteral: boolean,
): { startIndex: number; length: number } | undefined {
    // Fast-path token lookup for identifier-like anchors. We extend this
    // to cover "keyword" and "numericLiteral" anchors as their textual form
    // is also stored in the lightweight token index as an "identifier" token.
    if (anchor.kind !== 'identifier' && anchor.kind !== 'keyword' && anchor.kind !== 'numericLiteral') {
        return undefined;
    }

    let seen = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.text !== anchor.text) continue;
        // We only stored identifier-like tokens in the index, so ignore tokens
        // that are clearly punctuation operators (length 1 and non-word-char).
        if (t.kind !== 'identifier') continue;
        // Context: skip if inside literal unless allowed
        const inLiteral = isInside(t.col, precomputed.literalRanges);
        if (!allowInsideLiteral && inLiteral) continue;
        // Context: if anchor.inInterpolation, must be inside interpolation range
        if (anchor.inInterpolation) {
            if (!isInside(t.col, precomputed.interpolationRanges)) continue;
        } else {
            if (precomputed.interpolationRanges.length > 0 && isInside(t.col, precomputed.interpolationRanges)) continue;
        }
        if (seen++ === desiredOccIdx) {
            if (DEBUG_FLAGS.BENCHMARK) LocatorStats.indexHits++;
            return { startIndex: t.col, length: t.length };
        }
    }
    return undefined;
}
