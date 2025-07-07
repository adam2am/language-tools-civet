export type AliasEntry = { ts: string[]; civet: string | string[] };

export const aliasRegistry: AliasEntry[] = [
	// Single-token operator / keyword aliases (former operatorLookup)
	{ ts: ['='],        civet: '=' },
	{ ts: ['==='],      civet: 'is' },
	{ ts: ['!=='],      civet: ['isnt ', 'is not '] },
	{ ts: ['&&'],       civet: 'and' },
	{ ts: ['||'],       civet: 'or ' },
	{ ts: ['!'],        civet: 'not ' },
	{ ts: ['let'],      civet: '.=' },
	{ ts: ['const'],    civet: ':=' },
	{ ts: ['function'], civet: '->' },

	// Multi-token macro aliases
	{ ts: ['if', '(', '!'], civet: 'unless' },
	// Slice macro: numbers.slice(…) ↔ bracket slice with ... / ..
	{ ts: ['.', 'slice', '('], civet: '...' }
	// → add new macros here
];

// ---------------------------------------------------------------------------
//  Allows mapper to recognise Civet's triple-quoted
//  strings (""" / ''' / ```) as valid matches for the single back-tick (`)
//  which the TS anchor originates from.  Extend when Civet gains more raw
//  string flavours.
// ---------------------------------------------------------------------------

export const QUOTE_ALIAS: Record<string, string[]> = {
	'`': ['"""', "'''", '```'],
	'"': ['"""'],
	"'": ["'''"],
};
// --- Derived helper maps/arrays -------------------------------------------

// Fast single-token lookup:  "TS token" → Civet replacement(s)
export const OPERATOR_LOOKUP: Record<string, string | string[]> = (() => {
	const out: Record<string, string | string[]> = {};
	for (const entry of aliasRegistry) {
		if (entry.ts.length === 1) {
			out[entry.ts[0]] = entry.civet;
		}
	}
	return out;
})();

// List of multi-token aliases:  [ 'if','(','!' ] → 'unless'
export const MULTI_TOKEN_ALIASES: { search: string[]; replace: string }[] = aliasRegistry
	.filter((e) => e.ts.length > 1)
	.map((e) => ({ search: e.ts, replace: Array.isArray(e.civet) ? e.civet[0] : e.civet }));

// Fast lookup: first token → array of multi-token aliases starting with that token
export const MULTI_TOKEN_ALIAS_MAP: Record<string, { search: string[]; replace: string }[]> = (() => {
	const out = Object.create(null) as Record<string, { search: string[]; replace: string }[]>;
	for (const alias of MULTI_TOKEN_ALIASES) {
		const first = alias.search[0];
		if (!out[first]) out[first] = [];
		out[first].push(alias);
	}
	return out;
})();

// --- Quote alias table --------------------------------------------------
// Maps each TS quote character to its valid Civet equivalents.
// Used by the mapper to recognize triple-quoted strings (""" / ''' / ```)
// as valid matches for the single back-tick (`) which the TS anchor
// originates from.
