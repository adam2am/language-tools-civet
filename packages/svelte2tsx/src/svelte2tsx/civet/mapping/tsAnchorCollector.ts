import * as ts from 'typescript';

// avoid unused-import linter errors
if (ts) { /* noop */ }

export type AnchorKind = 'identifier' | 'stringLiteral' | 'numericLiteral' | 'operator' | 'keyword' | 'char';

export interface Anchor {
    text: string;
    start: ts.LineAndCharacter;
    end: ts.LineAndCharacter;
    kind: AnchorKind;
    length: number;
}

/** Utility: is this node a keyword token? */
function isKeywordKind(kind: ts.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword;
}

/** Checks if a node is a binary or assignment operator token */
function isOperatorKind(kind: ts.SyntaxKind): boolean {
    return (kind >= ts.SyntaxKind.FirstBinaryOperator && kind <= ts.SyntaxKind.LastBinaryOperator) ||
           (kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment);
}

/** Push a new anchor entry */
function pushAnchor(anchors: Anchor[], source: ts.SourceFile, node: ts.Node, kind: AnchorKind, textOverride?: string) {
    const text = textOverride ?? node.getText(source);
    anchors.push({
        text,
        start: source.getLineAndCharacterOfPosition(node.getStart(source, false)),
        end: source.getLineAndCharacterOfPosition(node.getEnd()),
        kind,
        length: text.length
    });
}

export function collectAnchorsFromTs(tsCode: string, svelteFilePath: string): Anchor[] {
    const anchors: Anchor[] = [];

    const tsSourceFile = ts.createSourceFile(
        `${svelteFilePath}-snippet.ts`,
        tsCode,
        ts.ScriptTarget.ESNext,
        true
    );

    function visit(node: ts.Node) {
        if (ts.isIdentifier(node)) {
            pushAnchor(anchors, tsSourceFile, node, 'identifier');
        }
        else if (isKeywordKind(node.kind)) {
            pushAnchor(anchors, tsSourceFile, node, 'keyword');
        }
        else if (isOperatorKind(node.kind)) {
            pushAnchor(anchors, tsSourceFile, node, 'operator');
        }
        else if (ts.isNumericLiteral(node)) {
            pushAnchor(anchors, tsSourceFile, node, 'numericLiteral');
        }
        else if (
            ts.isStringLiteral(node) &&
            node.parent && // guard against node without parent
            ts.isImportDeclaration(node.parent) &&
            node === node.parent.moduleSpecifier
        ) {
            pushAnchor(anchors, tsSourceFile, node, 'stringLiteral');
        }

        node.getChildren(tsSourceFile).forEach(visit);
    }

    visit(tsSourceFile);
    return anchors;
}

export {}; 