import type { SourceMap as CivetSourceMapClass } from '@danielx/civet';
import type { CompileResult, CivetMap, RawMap, LinesMap } from './types';

const debug = false;

// Dynamically load the Civet compiler to make it optional
let moduleCache: typeof import('@danielx/civet') | null | undefined;
function getModule(): typeof import('@danielx/civet') | null {
  if (moduleCache !== undefined) return moduleCache;
  try {
    // Use require to allow optional dependency
    moduleCache = require('@danielx/civet');
  } catch (e) {
    console.warn('[compileCivet] @danielx/civet not found, skipping Civet compilation');
    moduleCache = null;
  }
  return moduleCache;
}

/**
 * Compile a Civet snippet into TypeScript code and a raw sourcemap.
 */
export function compileCivet(
  snippet: string,
  filename: string,
  options?: {
    /** If `true` return a full V3 sourcemap instead of Civet's line format */
    outputStandardV3Map?: boolean;
    /** Pre-resolved Civet compiler to use instead of dynamic loading */
    civetModule?: typeof import('@danielx/civet');
    /**
     * Optional compile-time options that should be forwarded to `civet.compile`.
     * These will override the defaults defined in this utility, allowing callers
     * to respect project-specific civet configuration (e.g. parseOptions).
     */
    civetCompileOptions?: Record<string, any>;
  }
): CompileResult {
  const civet = options?.civetModule ?? getModule();
  if (!civet) {
    // No Civet compiler available, return original code and no map
    return { code: snippet, rawMap: undefined };
  }
  if (debug) {
    console.log(`[compileCivet-debug] Compiling Civet snippet for file: ${filename}`);
    console.log(`[compileCivet-debug] Snippet content:\n${snippet}`);
  }

  const defaultOpts = {
    js: false,
    sourceMap: true,
    inlineMap: false,
    filename,
    sync: true,
    errors: [], // prevent ParseError throwing; Civet will return partial result
  } as Record<string, any>;

  // ---- Merge caller provided options -------------------------------------------
  const userOpts = options?.civetCompileOptions ?? {};

  // Final options sent to `civet.compile`.
  const opts = {
    ...defaultOpts,
    ...userOpts
  };

  let result: { code: string; sourceMap?: CivetSourceMapClass };
  try {
    result = (civet.compile as any)(snippet, opts);
  } catch (err: any) {
    const partial = err?.partial || err?.partialResult;
    if (partial && partial.code) {
      // Civet threw but provided partial output (different versions expose 'partial' or 'partialResult')
      result = partial as { code: string; sourceMap?: CivetSourceMapClass };
    } else {
      throw err;
    }
  }

  if ((opts as any).errors && (opts as any).errors.length > 0) {
    // Throw the first parse error. preprocessCivet is set up to handle it.
    throw (opts as any).errors[0];
  }

  if (debug) {
    console.log(`[compileCivet-debug] Civet.compile returned code length: ${result.code.length}`);
    console.log(`[compileCivet-debug] Civet.compile code snippet prefix: ${result.code.slice(0, 100).replace(/\n/g, '\\n')}...`);
  }

  let rawMap: CivetMap | undefined = undefined;

  if (result.sourceMap) {
    if (options?.outputStandardV3Map === true) {
      rawMap = result.sourceMap.json(filename, filename) as RawMap;
    } else {
      rawMap = result.sourceMap as unknown as LinesMap;
    }
    if (debug) console.log(`[compileCivet-debug] rawMap type: ${rawMap && 'lines' in rawMap ? 'LinesMap' : 'RawMap'}`);
  }

  return {
    code: result.code,
    rawMap
  };
} 