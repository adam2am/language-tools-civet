import { preprocessCivet } from './preprocessor';
import { chainMaps, EnhancedChainBlock, EncodedSourceMap as ChainEncodedMap } from './mapChainer';
import { getLineAndColumnForOffset } from './helpers';
import type { PreprocessResult, CivetBlockInfo } from './types';

/** Result returned by maybePreprocessCivet */
export interface MaybePreprocessResult {
    /** Svelte code with any Civet converted to TS (or original code if none) */
    code: string;
    /** Normalised Civet block data ready for map chaining */
    civetBlocks: EnhancedChainBlock[];
}

/**
 * Detect <script lang="civet"> blocks and preprocess them to TS.
 * If none are present, this is effectively a no-op.
 */
export function maybePreprocessCivet(
    svelte: string,
    filename: string | undefined,
    parse: typeof import('svelte/compiler').parse,
    civetModule?: typeof import('@danielx/civet')
): MaybePreprocessResult {
    // Quick guard: skip work if file clearly has no Civet blocks
    if (!/<script[^>]*lang=["']civet["']/i.test(svelte)) {
        return { code: svelte, civetBlocks: [] };
    }

    // Run the existing Civet preprocessor
    const preRes: PreprocessResult = preprocessCivet(svelte, filename || '', parse, civetModule);

    const civetBlocks: EnhancedChainBlock[] = [];

    const addBlock = (info?: CivetBlockInfo) => {
        if (!info) return;
        const { line: startLine, column: startCol } = getLineAndColumnForOffset(preRes.code, info.tsStartInSvelteWithTs);
        const { line: endLine } = getLineAndColumnForOffset(preRes.code, info.tsEndInSvelteWithTs);
        civetBlocks.push({
            map: info.map as any, // Already a normalised EncodedSourceMap
            tsStartCharInSvelteWithTs: info.tsStartInSvelteWithTs,
            tsEndCharInSvelteWithTs: info.tsEndInSvelteWithTs,
            tsStartLineInSvelteWithTs: startLine,
            tsStartColInSvelteWithTs: startCol,
            tsEndLineInSvelteWithTs: endLine,
            originalCivetLineCount: info.originalCivetLineCount,
            compiledTsLineCount: info.compiledTsLineCount,
            originalCivetSnippetLineOffset_0based: (info as any).originalCivetSnippetLineOffset_0based ?? 0,
            removedCivetContentIndentLength: (info as any).removedCivetContentIndentLength ?? 0,
            removedIndentPerLine: (info as any).removedIndentPerLine,
            originalContentStartLine_Svelte_1based: info.originalContentStartLine
        });
    };

    addBlock(preRes.module);
    addBlock(preRes.instance);

    // Sort to guarantee ascending start offset order (required for chainMaps)
    civetBlocks.sort((a, b) => a.tsStartCharInSvelteWithTs - b.tsStartCharInSvelteWithTs);

    return { code: preRes.code, civetBlocks };
}

/**
 * Chain the Civet->TS maps onto the SvelteWithTs->TSX base map, producing
 * a direct map Original->TSX. If there are no Civet blocks, the base map is
 * returned unchanged.
 */
export function chainAllCivetBlocks(
    baseMap: ChainEncodedMap,
    civetBlocks: EnhancedChainBlock[],
    originalSvelte: string,
    svelteWithTs: string
): ChainEncodedMap {
    if (!civetBlocks || civetBlocks.length === 0) {
        return baseMap;
    }
    return chainMaps(baseMap as any, civetBlocks, originalSvelte, svelteWithTs);
}

export {}; 