import { preprocessCivet, ProcessResult } from './preprocess/preprocessor';
import { applyTransformations, ChainedSourceMap as ChainEncodedMap } from './chainer';
import { createHash } from 'crypto';
import { parse as svelteParse } from 'svelte/compiler';
import type { Transformation } from './types';
import type { SourceMap as MagicSourceMap } from 'magic-string';

function withStringHelpers<T extends ChainEncodedMap>(map: T): T & { toString(): string; toUrl(): string } {
    const m: any = map;
    if (!('file' in m) || m.file == null) {
        m.file = '';
    }
    if (typeof m.toString !== 'function') {
        m.toString = function () { return JSON.stringify(this); };
    }
    if (typeof m.toUrl !== 'function') {
        m.toUrl = function () { return 'data:application/json;charset=utf-8,' + encodeURIComponent(this.toString()); };
    }
    return m;
}

export type SourceMap = ChainEncodedMap & MagicSourceMap;

export interface CivetProcessor {
    preprocess: () => ProcessResult;
    chainSourceMap: (baseMap: SourceMap, transformations: Transformation[]) => SourceMap;
}

/**
 * Creates a Civet processor if needed. Returns null if Civet processing is not required.
 * This keeps Civet as an optional peer dependency and encapsulates all Civet-specific logic.
 */
export function createCivetProcessor(
    svelteCode: string,
    filename: string | undefined,
    svelte5Plus: boolean,
    parse: typeof svelteParse = svelteParse
): CivetProcessor | null {
    if (!/<script[^>]*lang=["']civet["']/i.test(svelteCode)) {
        return null;
    }

    const CHAINER_CACHE = new Map<string, SourceMap>();
    let processedResult: ProcessResult | null = null;

    let civetModule: typeof import('@danielx/civet') | undefined;
    try {
        civetModule = require('@danielx/civet');
    } catch {
        civetModule = undefined;
    }

    return {
        preprocess() {
            // Run the main Civet preprocessor
            processedResult = preprocessCivet(
                svelteCode,
                filename || '',
                svelte5Plus,
                parse,
                civetModule
            );
            return processedResult;
        },

        chainSourceMap(baseMap: SourceMap, transformations: Transformation[]): SourceMap {
            if (!transformations || transformations.length === 0) {
                return baseMap;
            }

            const chainerCacheKey = createHash('sha256')
                .update(baseMap.mappings)
                .update(transformations.map((t) => t.map.mappings).join(''))
                .digest('hex');

            const cachedMap = CHAINER_CACHE.get(chainerCacheKey);
            if (cachedMap) {
                return cachedMap;
            }

            const finalRawMap = applyTransformations(baseMap, transformations, svelteCode, processedResult!.code);
            const finalMap = withStringHelpers(finalRawMap) as SourceMap;
            CHAINER_CACHE.set(chainerCacheKey, finalMap);

            return finalMap;
        },
    };
} 