import * as ts from 'typescript';

export type AnchorKind =
	| 'identifier'
	| 'stringLiteral'
	| 'numericLiteral'
	| 'operator'
	| 'keyword'
	| 'interpolationOpen'  // `${` (in TS) – maps to `${` or `#{` in Civet
	| 'interpolationClose' // `}`
	| 'interpolationExpr' // start of expression inside ${ ... }
	| 'quote';

export interface Anchor {
	text: string;
	start: ts.LineAndCharacter;
	end: ts.LineAndCharacter;
	kind: AnchorKind;
	allowLiteral?: true;
	inInterpolation?: true;
}

export function collectAnchorsFromTs(
	tsSourceFile: ts.SourceFile
): Anchor[] {
	const tsAnchors: Anchor[] = [];

	function findAnchors(node: ts.Node, inInterpolation = false) {
		if (ts.isIdentifier(node)) {
			const name = node.text;
			const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
			const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
			const anchor: Anchor = { text: name, start, end, kind: 'identifier' };
			if (inInterpolation) {
				anchor.inInterpolation = true;
				anchor.allowLiteral = true;
			}
			tsAnchors.push(anchor);
		}

		const kind = node.kind;
		const isKeywordToken = kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword;
		const isPunctuationToken = kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation;

		if (isKeywordToken || isPunctuationToken) {
			const text = node.getText(tsSourceFile);
			if (text.trim()) {
				const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
				const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
				tsAnchors.push({
					text,
					start,
					end,
					kind: isKeywordToken ? 'keyword' : 'operator'
				});
			}
		}

		if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		) {
			const rawText = node.getText(tsSourceFile);
			const nodeStartPos = node.getStart(tsSourceFile, false);
			const firstChar = rawText[0];
			const lastChar = rawText[rawText.length - 1];

			const isOpenQuote = firstChar === '"' || firstChar === "'" || firstChar === '`';
			const isCloseQuote = lastChar === '"' || lastChar === "'" || lastChar === '`';

			if (isOpenQuote && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node))) {
				const quoteOpenStartLC = tsSourceFile.getLineAndCharacterOfPosition(nodeStartPos);
				const quoteOpenEndLC   = tsSourceFile.getLineAndCharacterOfPosition(nodeStartPos + 1);
				tsAnchors.push({ text: firstChar, start: quoteOpenStartLC, end: quoteOpenEndLC, kind: 'quote', allowLiteral: true });
			}

			if (isCloseQuote && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateTail(node))) {
				const quoteClosePos = node.getEnd() - 1;
				const quoteCloseStartLC = tsSourceFile.getLineAndCharacterOfPosition(quoteClosePos);
				const quoteCloseEndLC   = tsSourceFile.getLineAndCharacterOfPosition(quoteClosePos + 1);
				tsAnchors.push({ text: lastChar, start: quoteCloseStartLC, end: quoteCloseEndLC, kind: 'quote', allowLiteral: true });
			}
			
			const literalText: string | undefined = (node as any).text;
			if (literalText === undefined) {
				return;
			}

			if (!literalText.length) {
				if (rawText.startsWith('}')) {
					const markerStart = nodeStartPos;
					const startLC = tsSourceFile.getLineAndCharacterOfPosition(markerStart);
					const endLC   = tsSourceFile.getLineAndCharacterOfPosition(markerStart + 1);
					tsAnchors.push({ text: '}', start: startLC, end: endLC, kind: 'interpolationClose' });
				}
				return;
			}

			const relIdx = rawText.indexOf(literalText);
			if (relIdx === -1) {
				return;
			}
			const absStart = nodeStartPos + relIdx;
			
			if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
				if (literalText) {
					const startLC_plain = tsSourceFile.getLineAndCharacterOfPosition(absStart);
					const endLC_plain   = tsSourceFile.getLineAndCharacterOfPosition(absStart + literalText.length);
					tsAnchors.push({ text: literalText, start: startLC_plain, end: endLC_plain, kind: 'stringLiteral', allowLiteral: true });
				}
				return;
			}
		}

		if (ts.isNumericLiteral(node)) {
			const numText = node.getText(tsSourceFile);
			const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
			const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
			tsAnchors.push({ text: numText, start, end, kind: 'numericLiteral' });
		}

		if (ts.isTemplateSpan(node)) {
			const openBracePos = node.getStart(tsSourceFile, false) - 2;
			const openStartLC = tsSourceFile.getLineAndCharacterOfPosition(openBracePos);
			const openEndLC = tsSourceFile.getLineAndCharacterOfPosition(openBracePos + 2);
			tsAnchors.push({ text: '${', start: openStartLC, end: openEndLC, kind: 'interpolationOpen' });

			// The expression itself is traversed with the inInterpolation flag.
			findAnchors(node.expression, true);

			const bracePos = node.expression.end;
			const startLC = tsSourceFile.getLineAndCharacterOfPosition(bracePos);
			const endLC = tsSourceFile.getLineAndCharacterOfPosition(bracePos + 1);
			tsAnchors.push({ text: '}', start: startLC, end: endLC, kind: 'interpolationClose' });

			const exprStartPos = node.expression.getStart(tsSourceFile, false);
			const exprStartLC  = tsSourceFile.getLineAndCharacterOfPosition(exprStartPos);
			const exprEndLC    = tsSourceFile.getLineAndCharacterOfPosition(exprStartPos + 1);
			tsAnchors.push({ text: '<expr>', start: exprStartLC, end: exprEndLC, kind: 'interpolationExpr' });

			// We handle the children selectively to avoid double-counting
			findAnchors(node.literal, inInterpolation);
			return; // Return early as we've handled the children
		}

		node.getChildren(tsSourceFile).forEach(child => findAnchors(child, inInterpolation));
	}
	findAnchors(tsSourceFile);

	// ---------------------------------------------------------------------
	// De-duplicate overlapping anchors, preferring the semantic information
	// from the AST walk (identifiers) over the scanner's token kind.
	// This resolves cases like `is` which may be reported both as a keyword
	// by the scanner and as an identifier by the AST when `objectIs` helper
	// injection is enabled.
	// ---------------------------------------------------------------------
	// --- Score-based replacement ---
	const KIND_SCORE: Record<Anchor["kind"], number> = {
		identifier: 5,
		stringLiteral: 4,
		numericLiteral: 4,
		quote: 4,
		interpolationOpen: 3,
		interpolationClose: 3,
		keyword: 1,
		operator: 0,
		interpolationExpr: 2
	} as const;

	// --- Correct, overlap-aware de-duplication ---
	// 1. Sort by start position. If starts are equal, longer anchors (earlier end) come first.
	tsAnchors.sort((a, b) => {
		if (a.start.line !== b.start.line) return a.start.line - b.start.line;
		if (a.start.character !== b.start.character) return a.start.character - b.start.character;
		if (a.end.line !== b.end.line) return b.end.line - a.end.line;
		return b.end.character - a.end.character;
	});

	const finalAnchors: Anchor[] = [];
	if (tsAnchors.length > 0) {
		let lastAnchor = tsAnchors[0];
		for (let i = 1; i < tsAnchors.length; i++) {
			const currentAnchor = tsAnchors[i];
			
			// Check for overlap
			const endsAfterLastStarts = currentAnchor.end.line > lastAnchor.start.line || 
				(currentAnchor.end.line === lastAnchor.start.line && currentAnchor.end.character > lastAnchor.start.character);
			const startsBeforeLastEnds = currentAnchor.start.line < lastAnchor.end.line || 
				(currentAnchor.start.line === lastAnchor.end.line && currentAnchor.start.character < lastAnchor.end.character);

			if (startsBeforeLastEnds && endsAfterLastStarts) { // Overlap detected
				// The higher-priority one wins (longer, AST-based ones are preferred)
				const currentScore = KIND_SCORE[currentAnchor.kind];
				const lastScore = KIND_SCORE[lastAnchor.kind];
				if (currentScore > lastScore) {
					lastAnchor = currentAnchor;
				}
				// else, the existing `lastAnchor` wins, and we discard `currentAnchor`
			} else { 
				// No overlap, commit the last anchor and start a new one
				finalAnchors.push(lastAnchor);
				lastAnchor = currentAnchor;
			}
		}
		finalAnchors.push(lastAnchor); // Add the last processed anchor
	}
	
	return finalAnchors;
}

export {};