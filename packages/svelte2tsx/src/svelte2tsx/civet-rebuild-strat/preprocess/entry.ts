import { preprocessCivet } from './preprocessor';
import { chainCivetMaps, ChainBlock, ChainedSourceMap as ChainEncodedMap } from '../mapping/chainer';
import { getLineAndColumnForOffset } from '../util/htmlx';
import type { ProcessResult, BlockInfo } from '../types';

/** Result returned by maybePreprocessCivet */
export interface MaybePreprocessResult {
    /** Svelte code with any Civet converted to TS (or original code if none) */
    code: string;
    /** Normalised Civet block data ready for map chaining */
    civetBlocks: ChainBlock[];
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
    const preRes: ProcessResult = preprocessCivet(svelte, filename || '', parse, civetModule);

    const civetBlocks: ChainBlock[] = [];

    const addBlock = (info?: BlockInfo) => {
        if (!info) return;
        const { line: startLine, column: startCol } = getLineAndColumnForOffset(preRes.code, info.tsSnippet.startOffset);
        const { line: endLine } = getLineAndColumnForOffset(preRes.code, info.tsSnippet.endOffset);
        civetBlocks.push({
            map: info.map as ChainEncodedMap,
            tsSnippet: {
                startOffset: info.tsSnippet.startOffset,
                endOffset: info.tsSnippet.endOffset,
                startLine: startLine,
                startCol: startCol,
                endLine: endLine,
            },
            civet: {
                lineCount: info.civet.lineCount,
            },
            ts: {
                lineCount: info.ts.lineCount,
            },
            svelte: {
                civetStartLine: info.svelte.civetStartLine,
                civetStartIndex: info.svelte.civetStartIndex ?? 0,
            },
            sourceIndent: {
                commonLength: info.sourceIndent?.commonLength ?? 0,
                perLineLengths: info.sourceIndent?.perLineLengths,
            },
        });
    };

    addBlock(preRes.module);
    addBlock(preRes.instance);

    // Sort to guarantee ascending start offset order (required for chainCivetMaps)
    civetBlocks.sort((a, b) => a.tsSnippet.startOffset - b.tsSnippet.startOffset);

    return { code: preRes.code, civetBlocks };
}

/**
 * Chain the Civet->TS maps onto the SvelteWithTs->TSX base map, producing
 * a direct map Original->TSX. If there are no Civet blocks, the base map is
 * returned unchanged.
 */
export function chainAllCivetBlocks(
    baseMap: ChainEncodedMap,
    civetBlocks: ChainBlock[],
    originalSvelte: string,
    svelteWithTs: string
): ChainEncodedMap {
    if (!civetBlocks || civetBlocks.length === 0) {
        return baseMap;
    }
    return chainCivetMaps(baseMap, civetBlocks, originalSvelte, svelteWithTs);
}

export {}; 