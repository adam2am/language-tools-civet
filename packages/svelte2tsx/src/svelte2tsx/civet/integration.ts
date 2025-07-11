import { maybePreprocessCivet, chainAllCivetBlocks } from './preprocess/entry';
import type { ChainBlock } from './mapping/chainer';
import type { SourceMap } from 'magic-string';

export interface CivetPreprocessResult {
    code: string;
    civetBlocks: ChainBlock[];
}

/**
 * Preprocess the source if it contains <script lang="civet"> tags. Otherwise,
 * return the original source untouched. The expensive dynamic import and
 * compilation is only executed when needed.
 */
export function preprocessCivetIfPresent(
    svelte: string,
    filename: string | undefined,
    parse: typeof import('svelte/compiler').parse
): CivetPreprocessResult {
    // Quick regex guard – cheap and avoids loading optional dependency
    if (!/<script[^>]*lang=["']civet["']/i.test(svelte)) {
        return { code: svelte, civetBlocks: [] };
    }

    // Load Civet compiler *only* when necessary so it remains an optional peer
    let civetModule: typeof import('@danielx/civet') | undefined;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        civetModule = require('@danielx/civet');
    } catch {
        civetModule = undefined;
    }

    return maybePreprocessCivet(svelte, filename, parse, civetModule);
}

/**
 * If any Civet blocks were processed, chain their maps onto the base TSX map.
 * Otherwise return the base map unchanged.
 */
export function chainCivetIfAny(
    baseMap: SourceMap,
    civetBlocks: ChainBlock[],
    originalSvelte: string,
    transformedSvelte: string
): SourceMap {
    if (!civetBlocks.length) {
        return baseMap;
    }
    return chainAllCivetBlocks(baseMap, civetBlocks, originalSvelte, transformedSvelte) as SourceMap;
} 