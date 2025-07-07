import type { EncodedSourceMap } from '@jridgewell/gen-mapping';

// Export the aliased type
export type RawMap = EncodedSourceMap;

/**
 * Interface for the Civet-specific map that has a top-level 'lines' property
 * and other fields, but not the standard V3 fields like 'version' or 'mappings'.
 */
export interface LinesMap {
    lines: number[][][];
    line?: number; // 0-indexed start line in generated code for the map context
    colOffset?: number; // Column offset in generated code
    srcLine?: number; // 0-indexed start line in source code for the map context
    srcColumn?: number; // 0-indexed start column in source code
    srcOffset?: number; // Overall offset in source code
    srcTable?: number[]; // Table of source lengths, possibly
    source?: string; // Original source content
    names?: string[]; // Added optional names array
    // This type typically does NOT have: version, sources, mappings, file
}

/**
 * The raw sourcemap object that the Civet compiler might return.
 * It can be:
 * 1. A standard V3 RawSourceMap (from `source-map` lib).
 * 2. A Civet-specific map with a top-level 'lines' property (`LinesMap`).
 * 3. Undefined (if sourcemap generation fails or is disabled).
 */
export type CivetMap = EncodedSourceMap | LinesMap;

/**
 * Result of a Civet snippet compilation to TypeScript.
 */
export interface CompileResult {
    /** The generated TypeScript code */
    code: string;
    /**
     * The raw sourcemap from the Civet compiler.
     * Can be a standard V3 map, a Civet lines-based map, or undefined.
     */
    rawMap: CivetMap | undefined;
}

/**
 * Information about a processed Civet script block.
 */
export interface BlockInfo {
    /** The normalized sourcemap: Original Svelte (Civet part) -> TS snippet */
    map: EncodedSourceMap; // After normalization, we expect a standard V3 map
    tsSnippet: {
        startOffset: number;
        endOffset: number;
    };
    civet: {
        lineCount: number;
    };
    ts: {
        lineCount: number;
    };
    svelte: {
        civetStartLine: number;
        civetStartIndex?: number;
    };
    sourceIndent?: {
        commonLength: number;
    };
}

/**
 * Metadata and code returned from preprocessing a Svelte file containing Civet scripts.
 */
export interface ProcessResult {
    /** The Svelte code with Civet snippets replaced by TS code */
    code: string;
    /** Module-script block data, if present */
    module?: BlockInfo;
    /** Instance-script block data, if present */
    instance?: BlockInfo;
} 