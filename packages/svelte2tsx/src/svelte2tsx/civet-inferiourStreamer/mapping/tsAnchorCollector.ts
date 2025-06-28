import * as ts from 'typescript';

// avoid unused-import linter errors
if (ts) { /* noop */ }

export interface Anchor {
    text: string;
    start: ts.LineAndCharacter;
    end: ts.LineAndCharacter;
    kind: 'identifier' | 'stringLiteral' | 'numericLiteral' | 'operator';
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

        // Operators (punctuation) we know how to map
        if (ts.isToken(node) && node.kind >= ts.SyntaxKind.FirstPunctuation && node.kind <= ts.SyntaxKind.LastPunctuation) {
            const operatorText = node.getText(tsSourceFile);
            if (operatorText.trim()) {
                const start = tsSourceFile.getLineAndCharacterOfPosition(node.getStart(tsSourceFile, false));
                const end = tsSourceFile.getLineAndCharacterOfPosition(node.getEnd());
                tsAnchors.push({ text: operatorText, start, end, kind: 'operator' });
            }
        }

        node.getChildren(tsSourceFile).forEach(findAnchors);
    }
    findAnchors(tsSourceFile);
    return tsAnchors;
}

export {}; 