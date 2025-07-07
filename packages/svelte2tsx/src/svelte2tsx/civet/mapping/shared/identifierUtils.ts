/**
 * Utilities for identifier / word matching inside Civet source lines.
 * These helpers are shared between the object-key pre-pass and other
 * mapping components so that the logic lives in a single place.
 */

/**
 * Returns the index of `identifier` inside `line` if it appears as a
 * "lone object key", meaning:
 *   • Start-of-line OR immediately after `,` or `{` (ignoring whitespace)
 *   • Followed by end-of-line OR `,` or `}` (ignoring whitespace)
 *   • Example matches: "status", "  status", "{ status", "status }", "status,"
 *   • Non-matches: "status:", "foo.status", "status * 2"
 *
 * If no such occurrence exists the function returns -1.
 *
 * The algorithm avoids regexes for clarity/perf and mirrors the boundary
 * checks used in `tokenLocator.ts`.
 */
export function findLoneObjectKey(line: string, identifier: string): number {
    const idLen = identifier.length;
    let pos = line.indexOf(identifier);
    while (pos !== -1) {
        // -----------------------------------------------
        // 1) Ensure we are *inside* an object-literal scope
        // -----------------------------------------------
        const openIdx = line.lastIndexOf('{', pos);
        const closeIdx = line.lastIndexOf('}', pos);
        const insideBraces = openIdx !== -1 && openIdx > closeIdx;

        // Look left (skip whitespace)
        let i = pos - 1;
        while (i >= 0 && isWhitespace(line[i])) i--;
        const prev = i >= 0 ? line[i] : undefined;
        const leftOk = (i < 0 && insideBraces) || prev === '{' || (prev === ',' && insideBraces);

        // Look right (skip whitespace)
        let j = pos + idLen;
        while (j < line.length && isWhitespace(line[j])) j++;
        const next = j < line.length ? line[j] : undefined;
        const rightOk = (next === undefined && insideBraces) || next === ',' || next === '}';

        if (insideBraces && leftOk && rightOk) return pos;
        pos = line.indexOf(identifier, pos + 1);
    }
    return -1;
}

/** Unicode-aware "is this a JS identifier constituent" helper. */
export function isWordChar(c: string | undefined): boolean {
    return !!c && /\p{L}|\p{N}|_|\$/u.test(c);
}

/** Simple whitespace predicate – space or tab. */
export function isWhitespace(c: string | undefined): boolean {
    return c === ' ' || c === '\t';
}

/**
 * Returns true if the identifier that starts at `idx` in `line` is very likely
 * an object-key that uses the trailing-colon syntax (e.g. "status:").  The
 * heuristic: After optional whitespace, the next char must be ':'; before the
 * identifier (skipping whitespace) there must be SOL, '{' or ','.  This avoids
 * false-positives inside function parameter lists like `(user:string)` where the
 * preceding non-WS char is '('.
 */
export function looksLikeColonObjectKey(line: string, idx: number, identifier: string): boolean {
    const idEnd = idx + identifier.length;
    // Forward check – optional whitespace then ':'
    let j = idEnd;
    while (j < line.length && isWhitespace(line[j])) j++;
    if (j >= line.length || line[j] !== ':') return false;

    // Backward check – skip whitespace, expect start-of-line or { or ,
    let i = idx - 1;
    while (i >= 0 && isWhitespace(line[i])) i--;
    if (i < 0) return true; // SOL
    const ch = line[i];
    return ch === '{' || ch === ',';
} 