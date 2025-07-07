/**
 * @file Macro fusion: blends multi-token Civet constructs into a single, powerful anchor.
 *
 * Recipe:
 * - Collapse macro token sequences (fuseMultiTokenMacros)
 *
 * Some Civet constructs (e.g., `unless`) compile into multiple, separate
 * TypeScript tokens (e.g., `if`, `(`, `!`). The standard anchor collector sees
 * these as distinct, unrelated anchors.
 * 
 * When a match is found, it:
 * 1.  Removes the individual anchors from the processing list.
 * 2.  Creates a new "synthetic" anchor that spans the entire sequence,
 *     representing the original Civet macro as a single, logical unit.
 *
 * This ensures that the entire original construct is mapped as a whole,
 * improving mapping accuracy and simplifying the logic for downstream mappers.
 */
import type { Anchor } from '../../shared/tsAnchorCollector';
import { MULTI_TOKEN_ALIAS_MAP } from '../../shared/aliasRegistry';

// ---------------------------------------------------------------------------
//  Pre-pass helper: collapse multi-token macro aliases into synthetic anchors
// ---------------------------------------------------------------------------
export function fuseMultiTokenMacros(lineAnchors: Anchor[]): Anchor[] {
	const processedAnchors: Anchor[] = [];
	for (let j = 0; j < lineAnchors.length; j++) {
		let wasMacro = false;
		const possibleAliases = MULTI_TOKEN_ALIAS_MAP[lineAnchors[j].text];
		if (!Array.isArray(possibleAliases) && possibleAliases !== undefined) {
			console.error('BUG: possibleAliases is not an array:', possibleAliases, 'for token', lineAnchors[j].text);
		}
		if (Array.isArray(possibleAliases)) {
			for (const alias of possibleAliases) {
				const sequence = lineAnchors.slice(j, j + alias.search.length);
				if (
					sequence.length === alias.search.length &&
					sequence.every((anchor, k) => anchor.text === alias.search[k])
				) {
					const firstToken = sequence[0];
					const lastToken = sequence[alias.search.length - 1];

					const isPunctuationOnly = /^[^\p{L}\p{N}]+$/u.test(alias.replace);
					// 1. Add synthetic anchor representing the collapsed macro
					const syntheticAnchor: Anchor & { __syntheticMacro?: true } = {
						...firstToken,
						end: lastToken.end,
						text: alias.replace,
						kind: isPunctuationOnly ? 'operator' : 'keyword',
						__syntheticMacro: true,
					};
					processedAnchors.push(syntheticAnchor);

					// 2. Preserve any identifier anchors inside the sequence (e.g. the "slice" part) so that
					//    language-tools can still map property identifiers correctly.  We skip purely
					//    punctuation tokens such as '.' or '('.
					for (const tok of sequence) {
						if (tok.kind === 'identifier') {
							processedAnchors.push(tok);
						}
					}

					j += alias.search.length - 1;
					wasMacro = true;
					break;
				}
			}
		}
		if (!wasMacro) {
			processedAnchors.push(lineAnchors[j]);
		}
	}
	return processedAnchors;
}