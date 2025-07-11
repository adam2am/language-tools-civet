export type CivetParseOptions = Record<string, any> | undefined;

let _options: CivetParseOptions = undefined;

export function setCivetParseOptions(opts: CivetParseOptions) {
    _options = opts;
}

export function getCivetParseOptions(): CivetParseOptions {
    return _options;
} 