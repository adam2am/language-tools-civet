import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

/** Standard config filenames (in search order, without path) */
const CONFIG_FILES = [
  '🐈.json',
  'civetconfig.json',
  'civet.config.json',
  '🐈.yaml',
  'civetconfig.yaml',
  'civet.config.yaml',
  '🐈.yml',
  'civetconfig.yml',
  'civet.config.yml',
  '🐈.civet',
  'civetconfig.civet',
  'civet.config.civet',
  '🐈.js',
  'civetconfig.js',
  'civet.config.js',
  'package.json'
];

interface ConfigCache {
  options: Record<string, unknown>;
  /** Path of the config file that produced these options (undefined → none found) */
  path?: string;
  /** Last known mtime (epoch millis) for quick change detection */
  mtime?: number;
}

// --- ASYNC IMPLEMENTATION ---

/** Cache for async operations, stores promises to prevent race conditions. */
const dirCacheAsync = new Map<string, Promise<ConfigCache>>();

/** Check if a path is a file, asynchronously. */
async function isFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Walk up directory tree from startDir searching for a Civet config file, asynchronously. */
async function findConfigAsync(startDir: string): Promise<string | undefined> {
  let dir = path.resolve(startDir);
  while (true) {
    for (const name of CONFIG_FILES) {
      const candidate = path.join(dir, name);
      if (await isFile(candidate)) {
        return candidate;
      }
      const dotConfig = path.join(dir, '.config', name);
      if (await isFile(dotConfig)) {
        return dotConfig;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Attempt to asynchronously load a config object from the given file. */
async function loadConfigAsync(filePath: string): Promise<Record<string, unknown> | undefined> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.json') {
      const data = await fsp.readFile(filePath, 'utf8');
      const json = JSON.parse(data);
      if (path.basename(filePath) === 'package.json') {
        return (json as any).civetConfig ?? undefined;
      }
      return json;
    }
    if (ext === '.yaml' || ext === '.yml') {
      try {
        const yaml = require('yaml');
        const data = await fsp.readFile(filePath, 'utf8');
        return yaml.parse(data);
      } catch {
        return undefined;
      }
    }
    if (ext === '.js' || ext === '.civet') {
      // require is sync, but we keep it inside the async function
      const mod = require(filePath);
      return mod?.default ?? mod ?? undefined;
    }
  } catch (err) {
    console.warn(`[civetConfigAsync] Failed to load ${filePath}:`, err);
  }
  return undefined;
}

/**
 * Asynchronously discover and load Civet compile options for a source file.
 * Returns an object suitable to spread into civet.compile options.
 */
export async function loadCompileOptsAsync(filePath: string): Promise<Record<string, unknown>> {
  const directory = path.dirname(filePath);

  const cachedPromise = dirCacheAsync.get(directory);
  if (cachedPromise) {
    const cached = await cachedPromise;
    // Fast path: re-validate cache with a single stat call.
    if (cached.path) {
        try {
            const stat = await fsp.stat(cached.path);
            if (stat.mtimeMs === cached.mtime) {
                return cached.options; // Unchanged.
            }
        } catch {
            // file disappeared, fall through to full reload.
        }
    } else {
        // Previously found no config file. Check if one has been added.
        const discoveredPath = await findConfigAsync(directory);
        if (!discoveredPath) {
            return cached.options; // Still no config file.
        }
    }
  }
  
  // Create and cache the promise immediately to handle concurrent calls.
  const loadingPromise = (async (): Promise<ConfigCache> => {
    const discoveredPath = await findConfigAsync(directory);
    if (!discoveredPath) {
      return { options: {}, path: undefined, mtime: undefined };
    }

    const cfg = (await loadConfigAsync(discoveredPath)) ?? {};
    let mtimeVal: number | undefined;
    try {
      mtimeVal = (await fsp.stat(discoveredPath)).mtimeMs;
    } catch {
      mtimeVal = undefined;
    }
    
    return { options: cfg as Record<string, unknown>, path: discoveredPath, mtime: mtimeVal };
  })();
  
  dirCacheAsync.set(directory, loadingPromise);

  const result = await loadingPromise;
  return result.options;
}

// --- SYNC IMPLEMENTATION (for backward compatibility) ---

/** Cache of discovered configs keyed by directory */
const dirCache = new Map<string, ConfigCache>();

/** Attempt to synchronously load a config object from the given file. */
function loadConfig(filePath: string): Record<string, unknown> | undefined {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.json') {
      const data = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(data);
      if (path.basename(filePath) === 'package.json') {
        return (json as any).civetConfig ?? undefined;
      }
      return json;
    }
    if (ext === '.yaml' || ext === '.yml') {
      try {
        const yaml = require('yaml');
        const data = fs.readFileSync(filePath, 'utf8');
        return yaml.parse(data);
      } catch {
        // yaml module not present – ignore.
        return undefined;
      }
    }
    if (ext === '.js' || ext === '.civet') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(filePath);
      return mod?.default ?? mod ?? undefined;
    }
  } catch (err) {
    console.warn(`[civetConfigSync] Failed to load ${filePath}:`, err);
  }
  return undefined;
}

/** Walk up directory tree from startDir searching for a Civet config file. */
function findConfig(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    // 1. Check dir candidates
    for (const name of CONFIG_FILES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
      // also look under .config subdir
      const dotConfig = path.join(dir, '.config', name);
      if (fs.existsSync(dotConfig) && fs.statSync(dotConfig).isFile()) {
        return dotConfig;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Synchronously discover and load Civet compile options for a source file.
 * Returns an object suitable to spread into civet.compile options.
 */
export function loadCompileOpts(filePath: string): Record<string, unknown> {
  const directory = path.dirname(filePath);

  // Discover current config path (may be undefined)
  const discoveredPath = findConfig(directory);

  const cached = dirCache.get(directory);
  if (cached) {
    // If the path is unchanged, check mtime
    if (cached.path === discoveredPath) {
      if (!discoveredPath) {
        return cached.options; // still no config file
      }
      try {
        const stat = fs.statSync(discoveredPath);
        const mtimeMs = stat.mtimeMs;
        if (mtimeMs === cached.mtime) {
          return cached.options; // unchanged
        }
      } catch {
        // file disappeared between calls – fall through to reload
      }
    }
  }

  // Need to (re)load because either path changed or mtime changed or no cache.
  if (!discoveredPath) {
    dirCache.set(directory, { options: {}, path: undefined, mtime: undefined });
    return {};
  }

  const cfg = loadConfig(discoveredPath) ?? {};
  let mtimeVal: number | undefined;
  try {
    mtimeVal = fs.statSync(discoveredPath).mtimeMs;
  } catch {
    mtimeVal = undefined;
  }
  dirCache.set(directory, { options: cfg as Record<string, unknown>, path: discoveredPath, mtime: mtimeVal });
  return cfg as Record<string, unknown>;
} 