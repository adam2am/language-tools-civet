import type { EncodedSourceMap } from '@jridgewell/gen-mapping';

// Export the aliased type
export type StandardRawSourceMap = EncodedSourceMap;

/**
 * Interface for the Civet-specific map that has a top-level 'lines' property
 * and other fields, but not the standard V3 fields like 'version' or 'mappings'.
 */
export interface CivetLinesSourceMap {
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
 * 2. A Civet-specific map with a top-level 'lines' property (`CivetLinesSourceMap`).
 * 3. Undefined (if sourcemap generation fails or is disabled).
 */
export type CivetOutputMap = EncodedSourceMap | CivetLinesSourceMap;

/**
 * Result of a Civet snippet compilation to TypeScript.
 */
export interface CivetCompileResult {
    /** The generated TypeScript code */
    code: string;
    /**
     * The raw sourcemap from the Civet compiler.
     * Can be a standard V3 map, a Civet lines-based map, or undefined.
     */
    rawMap: CivetOutputMap | undefined;
}

/**
 * Information about a processed Civet script block.
 */
export interface CivetBlockInfo {
    /** The normalized sourcemap: Original Svelte (Civet part) -> TS snippet */
    map: EncodedSourceMap; // After normalization, we expect a standard V3 map
    /** Start offset of the compiled TS code within the preprocessed svelte string (svelteWithTs) */
    tsStartInSvelteWithTs: number;
    /** End offset of the compiled TS code within the preprocessed svelte string (svelteWithTs) */
    tsEndInSvelteWithTs: number;
    /** 1-based line number in the original Svelte file where the Civet content started */
    originalContentStartLine: number;
    /** Line count of the original (dedented) Civet snippet */
    originalCivetLineCount: number;
    /** Line count of the compiled TypeScript code for this block */
    compiledTsLineCount: number;
    /** Raw mapping lines from the Civet compiler before normalization */
    rawMapLines?: number[][][];
    /** How much common leading indent was stripped from the original Civet snippet (in spaces) */
    removedCivetContentIndentLength?: number;
    /** Optional per‐line indent values (spaces) that were removed from the Civet snippet before compile. Length should be ≥ originalCivetLineCount. */
    removedIndentPerLine?: number[];
}

/**
 * Metadata and code returned from preprocessing a Svelte file containing Civet scripts.
 */
export interface PreprocessResult {
    /** The Svelte code with Civet snippets replaced by TS code */
    code: string;
    /** Module-script block data, if present */
    module?: CivetBlockInfo;
    /** Instance-script block data, if present */
    instance?: CivetBlockInfo;
} 