import type { SourceMap as CivetSourceMapClass } from '@danielx/civet';
import type { CivetCompileResult, CivetOutputMap, StandardRawSourceMap, CivetLinesSourceMap } from './types';

const civetCompilerDebug = false;

// Dynamically load the Civet compiler to make it optional
let _civetModule: typeof import('@danielx/civet') | null | undefined;
function getCivetModule(): typeof import('@danielx/civet') | null {
  if (_civetModule !== undefined) return _civetModule;
  try {
    // Use require to allow optional dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _civetModule = require('@danielx/civet');
  } catch (e) {
    console.warn('[compileCivet] @danielx/civet not found, skipping Civet compilation');
    _civetModule = null;
  }
  return _civetModule;
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
): CivetCompileResult {
  const civet = options?.civetModule ?? getCivetModule();
  if (!civet) {
    // No Civet compiler available, return original code and no map
    return { code: snippet, rawMap: undefined };
  }
  if (civetCompilerDebug) {
    console.log(`[compileCivet-debug] Compiling Civet snippet for file: ${filename}`);
    console.log(`[compileCivet-debug] Snippet content:\n${snippet}`);
  }

  const baseCompileOpts = {
    js: false,
    sourceMap: true,
    inlineMap: false,
    filename,
    sync: true,
    errors: [], // prevent ParseError throwing; Civet will return partial result
  } as Record<string, any>;

  // ---- Merge caller provided options -------------------------------------------
  const userCompileOpts = options?.civetCompileOptions ?? {};

  // Final options sent to `civet.compile`.
  const compileOpts = {
    ...baseCompileOpts,
    ...userCompileOpts
  };

  let civetResult: { code: string; sourceMap?: CivetSourceMapClass };
  try {
    civetResult = (civet.compile as any)(snippet, compileOpts);
  } catch (err: any) {
    const partial = err?.partial || err?.partialResult;
    if (partial && partial.code) {
      // Civet threw but provided partial output (different versions expose 'partial' or 'partialResult')
      civetResult = partial as { code: string; sourceMap?: CivetSourceMapClass };
    } else {
      throw err;
    }
  }

  if ((compileOpts as any).errors && (compileOpts as any).errors.length > 0) {
    // Throw the first parse error. preprocessCivet is set up to handle it.
    throw (compileOpts as any).errors[0];
  }

  if (civetCompilerDebug) {
    console.log(`[compileCivet-debug] Civet.compile returned code length: ${civetResult.code.length}`);
    console.log(`[compileCivet-debug] Civet.compile code snippet prefix: ${civetResult.code.slice(0, 100).replace(/\n/g, '\\n')}...`);
  }

  let finalMap: CivetOutputMap | undefined = undefined;

  if (civetResult.sourceMap) {
    if (options?.outputStandardV3Map === true) {
      finalMap = civetResult.sourceMap.json(filename, filename) as StandardRawSourceMap;
    } else {
      finalMap = civetResult.sourceMap as unknown as CivetLinesSourceMap;
    }
    if (civetCompilerDebug) console.log(`[compileCivet-debug] rawMap type: ${finalMap && 'lines' in finalMap ? 'CivetLinesSourceMap' : 'StandardRawSourceMap'}`);
  }

  return {
    code: civetResult.code,
    rawMap: finalMap
  };
} 