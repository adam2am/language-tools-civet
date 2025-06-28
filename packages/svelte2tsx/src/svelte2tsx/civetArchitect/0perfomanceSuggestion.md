

Read file: language-tools-civet/packages/svelte2tsx/src/svelte2tsx/civetArchitect/compile/compiler.ts


Read file: language-tools-civet/packages/svelte2tsx/src/svelte2tsx/civetArchitect/preprocess/preprocessor.ts


Read file: language-tools-civet/packages/svelte2tsx/src/svelte2tsx/civetArchitect/compile/config.ts


Read file: language-tools-civet/packages/svelte2tsx/src/svelte2tsx/civetArchitect/util/string.ts


Read file: language-tools-civet/packages/svelte2tsx/src/svelte2tsx/civetArchitect/util/htmlx.ts

Below is a quick “perf-profile walk-through” of the CivetArchitect pieces you listed and the main things that still cost measurable time or allocate more than they have to.

────────────────────────────────────────
Legend
• ⚠️ = obvious / easy-to-fix perf issue  
• ❄️ = intrinsic cost (can’t remove, only optimise)  
• ✅ = already fast / negligible

────────────────────────────────────────
1. index.ts
────────────────────────────────────────
✅ Only re-exports – zero runtime cost.

────────────────────────────────────────
2. compile/ (config.ts & compiler.ts)
────────────────────────────────────────
config.ts
⚠️ `fs.existsSync / fs.statSync / fs.readFileSync` in `findConfig` + `loadConfig`  
   – All synchronous, so they block the event-loop.  
   – Even though it runs **once per distinct directory**, if many Civet files live in different folders this repeats.

   Quick win → switch to an async, memoised version or load config once per process start (watch for fs changes with `fs.watch`).

compiler.ts
❄️ `civet.compile` – real work happens here; single biggest CPU user.  
✅ Dynamic `require('@danielx/civet')` is cached; negligible overhead afterwards.

Minor micro-issue: the `debug` guard wraps multiple `console.log` calls that still concatenate strings; wrap them in a `if (debug) { … }` block instead of ternaries to avoid work when `debug=false`.

────────────────────────────────────────
3. preprocess/
────────────────────────────────────────
preprocessor.ts
❄️ 1× `parseHtmlx` + 1× `svelte/compiler.parse` per Svelte file – necessary.  
⚠️  Several `split('\n')` / `replace(/\r?\n+$/)` calls on full snippets. For huge `<script>` tags this turns into noticeable GC pressure. Replace with a single pass or an iterator if you need to squeeze more.

⚠️ `offsetToPosition` is O(N) character scan; it’s only used for error-paths, but if users frequently hit parse errors on large snippets it becomes expensive. Consider pre-computing a line-offset table once per file.

✅ Loads compile options once (`loadCompileOpts`) and reuses them across blocks – good.

────────────────────────────────────────
4. mapping/
────────────────────────────────────────
tsAnchorCollector.ts
❄️ `ts.createSourceFile` + AST walk = heavy but unavoidable if you want reliable anchors.

normalizer.ts  
We already fixed overlapping-token issues without regressing perf, but big hitters remain:

⚠️  `locateTokenInCivetLine`  
    • Runs a fresh `RegExp.exec` per occurrence per token.  
    • Worst-case complexity ≈ O(T * O), T = tokens, O = occurrences of identical token text on the line.  
    • Improvement: keep `lastIndex` between tokens of the same cacheKey so you don’t rescan the early part of the line repeatedly.

⚠️  `encode()` from `@jridgewell/sourcemap-codec` allocates a new string for the entire map every time. If you ever batch-process thousands of snippets you can pool or stream encode.

✅  Regex-cache, range-claiming and single-pass anchor loop keep things fairly lean now.

────────────────────────────────────────
5. util/
────────────────────────────────────────
string.ts & htmlx.ts  
✅ All straightforward string/array ops; negligible unless called in tight loops.

Only note: `getLineAndColumnForOffset` does another O(N) scan; you could share the same pre-computed line index table used by `offsetToPosition`.

────────────────────────────────────────
Biggest Low-Hanging Fruit
(ordered by expected payoff)

1. ⚠️ Replace synchronous FS config lookups with async + cache (compile/config.ts)  
   Impact: unblocks I/O, improves parallel builds.

2. ⚠️ Stop rescanning prefixes in `locateTokenInCivetLine` by remembering the last match index per `(line, searchText)`; complexity drops to O(T).

3. ⚠️ Consolidate multiple `split('\n')` calls in preprocessor; reuse the same `lines` array or count lines with a single pass.

4. (optional) Build a per-file “line start offsets” table once and reuse in `offsetToPosition` & `getLineAndColumnForOffset`.

Fixing the above will remove the last obvious bottlenecks; everything else is already near the intrinsic cost of compiling Civet and parsing TS/Svelte.
