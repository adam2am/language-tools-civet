import type { SourceMap } from './integration';

export interface Transformation {
    /** The original source range in the Svelte file this transformation replaces. */
    sourceRange: { start: number; end: number };
    /** The range in the *new* code that the transformation occupies. */
    outputRange: { start: number; end: number };
    /** The source map for this specific transformation (e.g., from Civet to TS). */
    map: SourceMap;
    /**
     * The number of lines in the original Civet snippet.
     */
    sourceLineCount: number;
    /**
     * The number of lines in the final TypeScript output that replaced the snippet.
     */
    outputLineCount: number;
    // NEW: 1-based line number of the first non-whitespace character inside the original <script> block
    sourceStartLine?: number;
}

export interface CivetBlock {
    map: SourceMap;
    civetLineCount: number;
    tsLineCount: number;
    startOffset: number;
    endOffset: number;
    sourceMapLines?: any[];
}

export interface TsSnippetRange {
    startOffset: number;
    length: number;
    startLine: number;
    startCol: number;
    endLine: number;
}

export interface BlockInfo {
    map: any;
    tsSnippet: TsSnippetRange;
    civet: {
        lineCount: number;
    };
    ts: {
        lineCount: number;
    };
    svelte: {
        civetStartLine: number;
        civetStartIndex: number;
        civetStartColumn: number;
    };
    isTemplateLiteralContent?: boolean[];
}

export interface ProcessResult {
    code: string;
    // The preprocessor's ONLY job is to produce the new code and a list of transformations.
    transformations: Transformation[];
}

export interface CompileResult {
    code: string;
    rawMap?: any;
    map?: any;
    sourceMapLines?: any[];
} 