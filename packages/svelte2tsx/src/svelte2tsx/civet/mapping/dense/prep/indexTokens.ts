/**
 * @file indexTokens: slices code into fast, minimal tokens.
 * Recipe: Build token index for anchor lookups (buildTokenIndex)
 */
import { AnchorKind } from '../../shared/tsAnchorCollector';

export interface CivetToken {
	text: string;
	kind: AnchorKind | 'operator' | 'keyword';
	line: number;
	col: number; // start column
	length: number;
}

export function buildTokenIndex(civetLines: string[]): CivetToken[][] {
	const lineTokens: CivetToken[][] = new Array(civetLines.length);
	const ident = /[\p{L}\p{N}_$]+/u;
	for (let lineNo = 0; lineNo < civetLines.length; lineNo++) {
		const text = civetLines[lineNo];
		const tokens: CivetToken[] = [];
		let idx = 0;
		while (idx < text.length) {
			const ch = text[idx];
			if (/\s/.test(ch)) {
				idx++;
				continue;
			}
			// identifier/numeric literal
			const idMatch = ident.exec(text.slice(idx));
			if (idMatch && idMatch.index === 0) {
				const tokenText = idMatch[0];
				tokens.push({ text: tokenText, kind: 'identifier', line: lineNo, col: idx, length: tokenText.length });
				idx += tokenText.length;
				continue;
			}
			// single char operator brace etc
			tokens.push({ text: ch, kind: 'operator', line: lineNo, col: idx, length: 1 });
			idx++;
		}
		lineTokens[lineNo] = tokens;
	}
	return lineTokens;
} 