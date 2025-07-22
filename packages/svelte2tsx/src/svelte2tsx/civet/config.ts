import fs from 'fs';
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
  const discoveredPath = findConfig(directory);
  const cached = dirCache.get(directory);
  if (cached && cached.path === discoveredPath) {
    return cached.options;
  }
  if (!discoveredPath) {
    dirCache.set(directory, { options: {}, path: undefined });
    return {};
  }
  const cfg = loadConfig(discoveredPath) ?? {};
  dirCache.set(directory, { options: cfg, path: discoveredPath });
  return cfg;
} 