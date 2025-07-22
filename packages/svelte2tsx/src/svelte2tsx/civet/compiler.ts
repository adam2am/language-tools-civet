/**
 * Compile Civet code to TypeScript using Civet's V3 source map.
 * Returns { code, map } or throws if compilation fails.
 */
export function compileCivet(
  snippet: string,
  filename: string,
  options?: {
    civetModule?: typeof import('@danielx/civet');
    civetCompileOptions?: Record<string, any>; // <-- Receives options
  }
): { code: string; map?: any; rawMap?: any; sourceMapLines?: any[] } {
  // Dynamically load Civet if not provided
  const civet = options?.civetModule ?? (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@danielx/civet');
    } catch (e) {
      return null;
    }
  })();
  if (!civet) {
    // No Civet compiler available, return original code and no map
    return { code: snippet, map: undefined };
  }

  const defaultOpts = {
    js: false,
    sourceMap: true,
    inlineMap: false,
    filename,
    sync: true,
    errors: [],
  } as Record<string, any>;
  const userOpts = options?.civetCompileOptions ?? {}; // <-- Uses received options
  const opts = {
    ...defaultOpts,
    ...userOpts,
    outputStandardV3Map: true,
  };

  let result: { code: string; sourceMap?: any };
  try {
    result = (civet.compile)(snippet, opts);
  } catch (err) {
    const partial = err?.partial || err?.partialResult;
    if (partial && partial.code) {
      result = partial as { code: string; sourceMap?: any };
    } else {
      throw err;
    }
  }

  const compilationErrors = (opts as Record<string, any>).errors as any[] | undefined;
  if (compilationErrors?.length) {
    throw compilationErrors[0];
  }

  let map: any = undefined;
  let sourceMapLines: any[] = [];
  let rawMap: any = undefined;
  if (result.sourceMap) {
    rawMap = { ...result.sourceMap, lines: result.sourceMap.lines };
    map = result.sourceMap.json(filename, filename);
    sourceMapLines = result.sourceMap.lines;
  }

  return {
    code: result.code,
    map,
    rawMap,
    sourceMapLines
  };
}
