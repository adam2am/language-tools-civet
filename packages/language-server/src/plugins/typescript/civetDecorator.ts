import ts from 'typescript';
import { walkAndPatchSpans } from './civetMapper';
import { Logger } from '../../logger';

/**
 * Civet shadow-file support: A lightweight wrapper leaves the TypeScript LanguageService untouched, but when
 * a .civet file has a generated .ts/.tsx sibling file, it remaps diagnostics, hover, and Go to Definition back
 * to the source. Also removes duplicate .ts/.tsx entries from result arrays once their .civet equivalents are injected,
 * preventing double entries in completion/definition lists.
 */

export function civetDecorateLanguageService(
    ls: ts.LanguageService,
    ctx: { host: ts.LanguageServiceHost; ts: typeof ts }
): ts.LanguageService {
    // small helpers passed down to the mapper
    const log = (msg: string) => Logger.debug(`[CIVET_DECORATOR] ${msg}`);
    const fileExists = (p: string) => ctx.host.fileExists?.(p) ?? ctx.ts.sys.fileExists(p);
    const patch = <T>(v: T) => walkAndPatchSpans(v as any, log, fileExists) as T;

    // Build a proxy object which patches the result of every function call.
    const proxy = Object.create(null) as ts.LanguageService;

    for (const key in ls) {
        const k = key as keyof ts.LanguageService;
        const original = (ls as any)[k];
        if (typeof original === 'function') {
            (proxy as any)[k] = (...args: any[]) => patch(original.apply(ls, args));
        } else {
            (proxy as any)[k] = original;
        }
    }
    return proxy;
} 