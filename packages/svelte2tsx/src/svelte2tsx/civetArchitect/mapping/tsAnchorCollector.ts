import * as ts from 'typescript';

// avoid unused-import linter errors
if (ts) { /* noop */ }

export type AnchorKind = 'identifier' | 'stringLiteral' | 'numericLiteral' | 'operator' | 'keyword';

export interface Anchor {
    text: string;
    start: ts.LineAndCharacter;
    end: ts.LineAndCharacter;
    kind: AnchorKind;
}

export function collectAnchorsFromTs(
    tsCode: string,
    svelteFilePath: string,
    OPERATOR_MAP: Record<string, string>
): Anchor[] {
    const tsAnchors: Anchor[] = [];
    // Reference to avoid unused parameter lint errors
    void OPERATOR_MAP;
    const tsSourceFile = ts.createSourceFile(
        `${svelteFilePath}-snippet.ts`,
        tsCode,
        ts.ScriptTarget.ESNext,
        true
    );

    // ---------------------------------------------------------------------
    // Pass 1: Fast scanner for keywords & punctuation (operators)
    // ---------------------------------------------------------------------
    const scanner = ts.createScanner(ts.ScriptTarget.ESNext, /*skipTrivia*/ true, ts.LanguageVariant.Standard, tsCode);
    while (true) {
        const kind = scanner.scan();
        if (kind === ts.SyntaxKind.EndOfFileToken) break;

        const isKeyword = kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword;
        const isPunctuation = kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation;

        if (!isKeyword && !isPunctuation) continue;

        const tokenText = scanner.getTokenText();
        if (!tokenText.trim()) continue; // ignore trivia-like empties

        const startPos = scanner.getTokenPos();
        const endPos = scanner.getTextPos(); // exclusive end
        const start = tsSourceFile.getLineAndCharacterOfPosition(startPos);
        const end = tsSourceFile.getLineAndCharacterOfPosition(endPos);

        tsAnchors.push({
            text: tokenText,
            start,
            end,
            kind: isKeyword ? 'keyword' : 'operator'
        });
    }

    // function isKeywordKind(kind: ts.SyntaxKind): boolean {
    //     return kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword;
    // }

    function findAnchors(node: ts.Node) {
        if (ts.isIdentifier(node)) {
            const name = node.text;
            const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
            const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
            tsAnchors.push({ text: name, start, end, kind: 'identifier' });
        }

        // Add anchor for "import 'path'" string literals
        if (
            ts.isStringLiteral(node) &&
            ts.isImportDeclaration(node.parent) &&
            node === node.parent.moduleSpecifier
        ) {
            const modulePath = node.getText(tsSourceFile); // includes quotes
            const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
            const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
            tsAnchors.push({ text: modulePath, start, end, kind: 'stringLiteral' });
        }

        // Numeric literals
        if (ts.isNumericLiteral(node)) {
            const numText = node.getText(tsSourceFile); // e.g., "3", "1", "10.5"
            const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
            const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
            tsAnchors.push({ text: numText, start, end, kind: 'numericLiteral' });
        }

        node.getChildren(tsSourceFile).forEach(findAnchors);
    }
    findAnchors(tsSourceFile);
    return tsAnchors;
}

export {}; 