import ts from 'typescript';
import { walkAndPatchSpans } from './civetMapper';
import { Logger } from '../../logger';

/**
 * Wraps a TypeScript language service so that any locations/diagnostics referring
 * to the generated .ts/.tsx shadow files are rewritten back to the original
 * .civet sources. This is done by running `walkAndPatchSpans` over every return
 * value coming from the language-service.
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