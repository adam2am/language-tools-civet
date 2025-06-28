
> svelte2tsx@0.7.35 test-current /home/user/Documents/repos/language-tools-civet/packages/svelte2tsx
> mocha test/test.ts --grep "#current"


=== Input Svelte/Civet Code ===

  1| <script lang="civet">
  2|     abc:number|null .= 1
  3|     queryFun2 := (query:number) ->
  4|         abc = if abc is query then null else query
  5| 
  6|     // First loop, should generate 'i'
  7|     for a of [1..10]
  8|         abc = a
  9| </script> 

=== FINAL OUTPUT: GENERATED TSX CODE (from svelte2tsx) ===

  1| ///<reference types="svelte" />
  2| ;function $$render() {
  3| 
  4|     let abc:number|null = 1
  5|     const queryFun2 = function(query:number) {
  6|         let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
  7|     }
  8|     
  9|     // First loop, should generate 'i'
 10|     for (let i = 1; i <= 10; ++i) {const a = i;
 11|         abc = a
 12|     }
 13| ;
 14| async () => { };
 15| return { props: /** @type {Record<string, never>} */ ({}), slots: {}, events: {} }}
 16| 
 17| export default class ComplexCompilecopy__SvelteComponent_ extends __sveltets_2_createSvelte2TsxComponent(__sveltets_2_partial(__sveltets_2_with_any_event($$render()))) {
 18| }

=== STAGE 1: RAW TYPESCRIPT FROM CIVET COMPILER (pre-svelte2tsx integration) ===

  1|     let abc:number|null = 1
  2|     const queryFun2 = function(query:number) {
  3|         let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
  4|     }
  5| 
  6|     // First loop, should generate 'i'
  7|     for (let i = 1; i <= 10; ++i) {const a = i;
  8|         abc = a
  9|     }

=== STAGE 2: NORMALIZED SOURCEMAP (Civet-TS -> Svelte File) (pre-svelte2tsx integration) ===
// This is the array-style sourcemap after the raw Civet map is normalized to point to the .svelte file.
line 1: [[0,0,0,7],[0],[0,0,0,24],[8,0,0,4,0],[10,0,0,6,0],[26,0,0,23],[26,0,0,23]]
line 2: [[0,0,1,13],[0],[0,0,1,23],[0],[10,0,1,4,1],[18,0,1,12,1],[31,0,1,18,2],[35,0,1,22,2]]
line 3: [[0,0,2,11],[0,0,2,24],[0,0,2,29],[0],[0,0,2,50],[0],[0,0,2,20],[0],[20,0,2,8,0],[22,0,2,10,0],[24,0,2,21],[26,0,2,23],[28,0,2,24,2],[32,0,2,28,2],[60,0,2,45,2],[64,0,2,49,2],[73,0,2,17,0],[75,0,2,19,0]]
line 4: []
line 5: []
line 6: []
line 7: [[0,0,5,15],[0],[0,0,5,19],[0],[0,0,5,9],[0],[17,0,5,14],[17,0,5,14],[25,0,5,17],[26,0,5,18],[41,0,5,8,5],[41,0,5,8,5]]
line 8: [[0,0,6,11],[0],[0,0,6,15],[8,0,6,8,0],[10,0,6,10,0],[14,0,6,14,5],[14,0,6,14,5]]
line 9: []
=== END PRE-INTEGRATION MAP ===


=== STAGE 2 CORRELATION: Raw TS lines with their mappings ===

--- TypeScript Line 1 ---
TS   |     let abc:number|null = 1
Civet|     abc:number|null .= 1
TS -> Svelte mappings:
      TS[col  0] -> Svelte L1:C24 '' 
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> (inherited from previous)
      TS[col  8] -> Svelte L1:C4 'a' (name: abc)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> Svelte L1:C6 'c' (name: abc)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> (inherited from previous)
      TS[col 13] -> (inherited from previous)
      TS[col 14] -> (inherited from previous)
      TS[col 15] -> (inherited from previous)
      TS[col 16] -> (inherited from previous)
      TS[col 17] -> (inherited from previous)
      TS[col 18] -> (inherited from previous)
      TS[col 19] -> (inherited from previous)
      TS[col 20] -> (inherited from previous)
      TS[col 21] -> (inherited from previous)
      TS[col 22] -> (inherited from previous)
      TS[col 23] -> (inherited from previous)
      TS[col 24] -> (inherited from previous)
      TS[col 25] -> (inherited from previous)
      TS[col 26] -> Svelte L1:C23 '1' 

Civet -> TS mappings:
      Civet[col  0] ' ' -> (no mapping)
      Civet[col  1] ' ' -> (no mapping)
      Civet[col  2] ' ' -> (no mapping)
      Civet[col  3] ' ' -> (no mapping)
      Civet[col  4] 'a' -> TS cols: 8
      Civet[col  5] 'b' -> (no mapping)
      Civet[col  6] 'c' -> TS cols: 10
      Civet[col  7] ':' -> TS cols: 0
      Civet[col  8] 'n' -> (no mapping)
      Civet[col  9] 'u' -> (no mapping)
      Civet[col 10] 'm' -> (no mapping)
      Civet[col 11] 'b' -> (no mapping)
      Civet[col 12] 'e' -> (no mapping)
      Civet[col 13] 'r' -> (no mapping)
      Civet[col 14] '|' -> (no mapping)
      Civet[col 15] 'n' -> (no mapping)
      Civet[col 16] 'u' -> (no mapping)
      Civet[col 17] 'l' -> (no mapping)
      Civet[col 18] 'l' -> (no mapping)
      Civet[col 19] ' ' -> (no mapping)
      Civet[col 20] '.' -> (no mapping)
      Civet[col 21] '=' -> (no mapping)
      Civet[col 22] ' ' -> (no mapping)
      Civet[col 23] '1' -> TS cols: 26, 26

--- TypeScript Line 2 ---
TS   |     const queryFun2 = function(query:number) {
Civet|     queryFun2 := (query:number) ->
TS -> Svelte mappings:
      TS[col  0] -> (null mapping)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> (inherited from previous)
      TS[col  8] -> (inherited from previous)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> Svelte L2:C4 'q' (name: queryFun2)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> (inherited from previous)
      TS[col 13] -> (inherited from previous)
      TS[col 14] -> (inherited from previous)
      TS[col 15] -> (inherited from previous)
      TS[col 16] -> (inherited from previous)
      TS[col 17] -> (inherited from previous)
      TS[col 18] -> Svelte L2:C12 '2' (name: queryFun2)
      TS[col 19] -> (inherited from previous)
      TS[col 20] -> (inherited from previous)
      TS[col 21] -> (inherited from previous)
      TS[col 22] -> (inherited from previous)
      TS[col 23] -> (inherited from previous)
      TS[col 24] -> (inherited from previous)
      TS[col 25] -> (inherited from previous)
      TS[col 26] -> (inherited from previous)
      TS[col 27] -> (inherited from previous)
      TS[col 28] -> (inherited from previous)
      TS[col 29] -> (inherited from previous)
      TS[col 30] -> (inherited from previous)
      TS[col 31] -> Svelte L2:C18 'q' (name: query)
      TS[col 32] -> (inherited from previous)
      TS[col 33] -> (inherited from previous)
      TS[col 34] -> (inherited from previous)
      TS[col 35] -> Svelte L2:C22 'y' (name: query)
      TS[col 36] -> (inherited from previous)
      TS[col 37] -> (inherited from previous)
      TS[col 38] -> (inherited from previous)
      TS[col 39] -> (inherited from previous)
      TS[col 40] -> (inherited from previous)
      TS[col 41] -> (inherited from previous)
      TS[col 42] -> (inherited from previous)
      TS[col 43] -> (inherited from previous)
      TS[col 44] -> (inherited from previous)
      TS[col 45] -> (inherited from previous)

Civet -> TS mappings:
      Civet[col  0] ' ' -> (no mapping)
      Civet[col  1] ' ' -> (no mapping)
      Civet[col  2] ' ' -> (no mapping)
      Civet[col  3] ' ' -> (no mapping)
      Civet[col  4] 'q' -> TS cols: 10
      Civet[col  5] 'u' -> (no mapping)
      Civet[col  6] 'e' -> (no mapping)
      Civet[col  7] 'r' -> (no mapping)
      Civet[col  8] 'y' -> (no mapping)
      Civet[col  9] 'F' -> (no mapping)
      Civet[col 10] 'u' -> (no mapping)
      Civet[col 11] 'n' -> (no mapping)
      Civet[col 12] '2' -> TS cols: 18
      Civet[col 13] ' ' -> TS cols: 0
      Civet[col 14] ':' -> (no mapping)
      Civet[col 15] '=' -> (no mapping)
      Civet[col 16] ' ' -> (no mapping)
      Civet[col 17] '(' -> (no mapping)
      Civet[col 18] 'q' -> TS cols: 31
      Civet[col 19] 'u' -> (no mapping)
      Civet[col 20] 'e' -> (no mapping)
      Civet[col 21] 'r' -> (no mapping)
      Civet[col 22] 'y' -> TS cols: 35
      Civet[col 23] ':' -> TS cols: 0
      Civet[col 24] 'n' -> (no mapping)
      Civet[col 25] 'u' -> (no mapping)
      Civet[col 26] 'm' -> (no mapping)
      Civet[col 27] 'b' -> (no mapping)
      Civet[col 28] 'e' -> (no mapping)
      Civet[col 29] 'r' -> (no mapping)
      Civet[col 30] ')' -> (no mapping)
      Civet[col 31] ' ' -> (no mapping)
      Civet[col 32] '-' -> (no mapping)
      Civet[col 33] '>' -> (no mapping)

--- TypeScript Line 3 ---
TS   |         let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
Civet|         abc = if abc is query then null else query
TS -> Svelte mappings:
      TS[col  0] -> (null mapping)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> (inherited from previous)
      TS[col  8] -> (inherited from previous)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> (inherited from previous)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> (inherited from previous)
      TS[col 13] -> (inherited from previous)
      TS[col 14] -> (inherited from previous)
      TS[col 15] -> (inherited from previous)
      TS[col 16] -> (inherited from previous)
      TS[col 17] -> (inherited from previous)
      TS[col 18] -> (inherited from previous)
      TS[col 19] -> (inherited from previous)
      TS[col 20] -> Svelte L3:C8 'a' (name: abc)
      TS[col 21] -> (inherited from previous)
      TS[col 22] -> Svelte L3:C10 'c' (name: abc)
      TS[col 23] -> (inherited from previous)
      TS[col 24] -> Svelte L3:C21 'i' 
      TS[col 25] -> (inherited from previous)
      TS[col 26] -> Svelte L3:C23 ' ' 
      TS[col 27] -> (inherited from previous)
      TS[col 28] -> Svelte L3:C24 'q' (name: query)
      TS[col 29] -> (inherited from previous)
      TS[col 30] -> (inherited from previous)
      TS[col 31] -> (inherited from previous)
      TS[col 32] -> Svelte L3:C28 'y' (name: query)
      TS[col 33] -> (inherited from previous)
      TS[col 34] -> (inherited from previous)
      TS[col 35] -> (inherited from previous)
      TS[col 36] -> (inherited from previous)
      TS[col 37] -> (inherited from previous)
      TS[col 38] -> (inherited from previous)
      TS[col 39] -> (inherited from previous)
      TS[col 40] -> (inherited from previous)
      TS[col 41] -> (inherited from previous)
      TS[col 42] -> (inherited from previous)
      TS[col 43] -> (inherited from previous)
      TS[col 44] -> (inherited from previous)
      TS[col 45] -> (inherited from previous)
      TS[col 46] -> (inherited from previous)
      TS[col 47] -> (inherited from previous)
      TS[col 48] -> (inherited from previous)
      TS[col 49] -> (inherited from previous)
      TS[col 50] -> (inherited from previous)
      TS[col 51] -> (inherited from previous)
      TS[col 52] -> (inherited from previous)
      TS[col 53] -> (inherited from previous)
      TS[col 54] -> (inherited from previous)
      TS[col 55] -> (inherited from previous)
      TS[col 56] -> (inherited from previous)
      TS[col 57] -> (inherited from previous)
      TS[col 58] -> (inherited from previous)
      TS[col 59] -> (inherited from previous)
      TS[col 60] -> Svelte L3:C45 'q' (name: query)
      TS[col 61] -> (inherited from previous)
      TS[col 62] -> (inherited from previous)
      TS[col 63] -> (inherited from previous)
      TS[col 64] -> Svelte L3:C49 'y' (name: query)
      TS[col 65] -> (inherited from previous)
      TS[col 66] -> (inherited from previous)
      TS[col 67] -> (inherited from previous)
      TS[col 68] -> (inherited from previous)
      TS[col 69] -> (inherited from previous)
      TS[col 70] -> (inherited from previous)
      TS[col 71] -> (inherited from previous)
      TS[col 72] -> (inherited from previous)
      TS[col 73] -> Svelte L3:C17 'a' (name: abc)
      TS[col 74] -> (inherited from previous)
      TS[col 75] -> Svelte L3:C19 'c' (name: abc)
      TS[col 76] -> (inherited from previous)
      TS[col 77] -> (inherited from previous)
      TS[col 78] -> (inherited from previous)
      TS[col 79] -> (inherited from previous)
      TS[col 80] -> (inherited from previous)
      TS[col 81] -> (inherited from previous)

Civet -> TS mappings:
      Civet[col  0] ' ' -> (no mapping)
      Civet[col  1] ' ' -> (no mapping)
      Civet[col  2] ' ' -> (no mapping)
      Civet[col  3] ' ' -> (no mapping)
      Civet[col  4] ' ' -> (no mapping)
      Civet[col  5] ' ' -> (no mapping)
      Civet[col  6] ' ' -> (no mapping)
      Civet[col  7] ' ' -> (no mapping)
      Civet[col  8] 'a' -> TS cols: 20
      Civet[col  9] 'b' -> (no mapping)
      Civet[col 10] 'c' -> TS cols: 22
      Civet[col 11] ' ' -> TS cols: 0
      Civet[col 12] '=' -> (no mapping)
      Civet[col 13] ' ' -> (no mapping)
      Civet[col 14] 'i' -> (no mapping)
      Civet[col 15] 'f' -> (no mapping)
      Civet[col 16] ' ' -> (no mapping)
      Civet[col 17] 'a' -> TS cols: 73
      Civet[col 18] 'b' -> (no mapping)
      Civet[col 19] 'c' -> TS cols: 75
      Civet[col 20] ' ' -> TS cols: 0
      Civet[col 21] 'i' -> TS cols: 24
      Civet[col 22] 's' -> (no mapping)
      Civet[col 23] ' ' -> TS cols: 26
      Civet[col 24] 'q' -> TS cols: 0, 28
      Civet[col 25] 'u' -> (no mapping)
      Civet[col 26] 'e' -> (no mapping)
      Civet[col 27] 'r' -> (no mapping)
      Civet[col 28] 'y' -> TS cols: 32
      Civet[col 29] ' ' -> TS cols: 0
      Civet[col 30] 't' -> (no mapping)
      Civet[col 31] 'h' -> (no mapping)
      Civet[col 32] 'e' -> (no mapping)
      Civet[col 33] 'n' -> (no mapping)
      Civet[col 34] ' ' -> (no mapping)
      Civet[col 35] 'n' -> (no mapping)
      Civet[col 36] 'u' -> (no mapping)
      Civet[col 37] 'l' -> (no mapping)
      Civet[col 38] 'l' -> (no mapping)
      Civet[col 39] ' ' -> (no mapping)
      Civet[col 40] 'e' -> (no mapping)
      Civet[col 41] 'l' -> (no mapping)
      Civet[col 42] 's' -> (no mapping)
      Civet[col 43] 'e' -> (no mapping)
      Civet[col 44] ' ' -> (no mapping)
      Civet[col 45] 'q' -> TS cols: 60
      Civet[col 46] 'u' -> (no mapping)
      Civet[col 47] 'e' -> (no mapping)
      Civet[col 48] 'r' -> (no mapping)
      Civet[col 49] 'y' -> TS cols: 64

--- TypeScript Line 4 ---
TS   |     }
TS -> Svelte mappings:
      TS[col  0] -> (inherited from previous)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)

--- TypeScript Line 5 ---
TS   | 
TS -> Svelte mappings:

--- TypeScript Line 6 ---
TS   |     // First loop, should generate 'i'
TS -> Svelte mappings:
      TS[col  0] -> (inherited from previous)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> (inherited from previous)
      TS[col  8] -> (inherited from previous)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> (inherited from previous)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> (inherited from previous)
      TS[col 13] -> (inherited from previous)
      TS[col 14] -> (inherited from previous)
      TS[col 15] -> (inherited from previous)
      TS[col 16] -> (inherited from previous)
      TS[col 17] -> (inherited from previous)
      TS[col 18] -> (inherited from previous)
      TS[col 19] -> (inherited from previous)
      TS[col 20] -> (inherited from previous)
      TS[col 21] -> (inherited from previous)
      TS[col 22] -> (inherited from previous)
      TS[col 23] -> (inherited from previous)
      TS[col 24] -> (inherited from previous)
      TS[col 25] -> (inherited from previous)
      TS[col 26] -> (inherited from previous)
      TS[col 27] -> (inherited from previous)
      TS[col 28] -> (inherited from previous)
      TS[col 29] -> (inherited from previous)
      TS[col 30] -> (inherited from previous)
      TS[col 31] -> (inherited from previous)
      TS[col 32] -> (inherited from previous)
      TS[col 33] -> (inherited from previous)
      TS[col 34] -> (inherited from previous)
      TS[col 35] -> (inherited from previous)
      TS[col 36] -> (inherited from previous)
      TS[col 37] -> (inherited from previous)

--- TypeScript Line 7 ---
TS   |     for (let i = 1; i <= 10; ++i) {const a = i;
Civet|     for a of [1..10]
TS -> Svelte mappings:
      TS[col  0] -> (null mapping)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> (inherited from previous)
      TS[col  8] -> (inherited from previous)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> (inherited from previous)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> (inherited from previous)
      TS[col 13] -> (inherited from previous)
      TS[col 14] -> (inherited from previous)
      TS[col 15] -> (inherited from previous)
      TS[col 16] -> (inherited from previous)
      TS[col 17] -> Svelte L6:C14 '1' 
      TS[col 18] -> (inherited from previous)
      TS[col 19] -> (inherited from previous)
      TS[col 20] -> (inherited from previous)
      TS[col 21] -> (inherited from previous)
      TS[col 22] -> (inherited from previous)
      TS[col 23] -> (inherited from previous)
      TS[col 24] -> (inherited from previous)
      TS[col 25] -> Svelte L6:C17 '1' 
      TS[col 26] -> Svelte L6:C18 '0' 
      TS[col 27] -> (inherited from previous)
      TS[col 28] -> (inherited from previous)
      TS[col 29] -> (inherited from previous)
      TS[col 30] -> (inherited from previous)
      TS[col 31] -> (inherited from previous)
      TS[col 32] -> (inherited from previous)
      TS[col 33] -> (inherited from previous)
      TS[col 34] -> (inherited from previous)
      TS[col 35] -> (inherited from previous)
      TS[col 36] -> (inherited from previous)
      TS[col 37] -> (inherited from previous)
      TS[col 38] -> (inherited from previous)
      TS[col 39] -> (inherited from previous)
      TS[col 40] -> (inherited from previous)
      TS[col 41] -> Svelte L6:C8 'a' (name: a)
      TS[col 42] -> (inherited from previous)
      TS[col 43] -> (inherited from previous)
      TS[col 44] -> (inherited from previous)
      TS[col 45] -> (inherited from previous)
      TS[col 46] -> (inherited from previous)

Civet -> TS mappings:
      Civet[col  0] ' ' -> (no mapping)
      Civet[col  1] ' ' -> (no mapping)
      Civet[col  2] ' ' -> (no mapping)
      Civet[col  3] ' ' -> (no mapping)
      Civet[col  4] 'f' -> (no mapping)
      Civet[col  5] 'o' -> (no mapping)
      Civet[col  6] 'r' -> (no mapping)
      Civet[col  7] ' ' -> (no mapping)
      Civet[col  8] 'a' -> TS cols: 41, 41
      Civet[col  9] ' ' -> TS cols: 0
      Civet[col 10] 'o' -> (no mapping)
      Civet[col 11] 'f' -> (no mapping)
      Civet[col 12] ' ' -> (no mapping)
      Civet[col 13] '[' -> (no mapping)
      Civet[col 14] '1' -> TS cols: 17, 17
      Civet[col 15] '.' -> TS cols: 0
      Civet[col 16] '.' -> (no mapping)
      Civet[col 17] '1' -> TS cols: 25
      Civet[col 18] '0' -> TS cols: 26
      Civet[col 19] ']' -> TS cols: 0

--- TypeScript Line 8 ---
TS   |         abc = a
Civet|         abc = a
TS -> Svelte mappings:
      TS[col  0] -> Svelte L7:C15 '' 
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> (inherited from previous)
      TS[col  8] -> Svelte L7:C8 'a' (name: abc)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> Svelte L7:C10 'c' (name: abc)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> (inherited from previous)
      TS[col 13] -> (inherited from previous)
      TS[col 14] -> Svelte L7:C14 'a' (name: a)

Civet -> TS mappings:
      Civet[col  0] ' ' -> (no mapping)
      Civet[col  1] ' ' -> (no mapping)
      Civet[col  2] ' ' -> (no mapping)
      Civet[col  3] ' ' -> (no mapping)
      Civet[col  4] ' ' -> (no mapping)
      Civet[col  5] ' ' -> (no mapping)
      Civet[col  6] ' ' -> (no mapping)
      Civet[col  7] ' ' -> (no mapping)
      Civet[col  8] 'a' -> TS cols: 8
      Civet[col  9] 'b' -> (no mapping)
      Civet[col 10] 'c' -> TS cols: 10
      Civet[col 11] ' ' -> TS cols: 0
      Civet[col 12] '=' -> (no mapping)
      Civet[col 13] ' ' -> (no mapping)
      Civet[col 14] 'a' -> TS cols: 14, 14

--- TypeScript Line 9 ---
TS   |     }
TS -> Svelte mappings:
      TS[col  0] -> (inherited from previous)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
=== END STAGE 2 CORRELATION ===


=== Sourcemap Summary ===
Sources: 0complexCompile copy.svelte
Mappings length: 1163 chars
Number of lines mapped: 14

=== FINAL OUTPUT ANALYSIS: FULL SOURCEMAP (FINAL TSX -> SVELTE) IN ARRAY FORMAT ===
line 1: []
line 2: [[0,0,0,0],[1,0,0,1]]
line 3: [[0,0,0,18]]
line 4: [[0,0,1,0],[1,0,1,1],[2,0,1,2],[3,0,1,3],[4,0,1,7],[5,0,1,24],[6,0,1,24],[7,0,1,24],[8,0,1,4],[9,0,1,4],[10,0,1,6],[11,0,1,6],[12,0,1,6],[13,0,1,6],[14,0,1,6],[15,0,1,6],[16,0,1,6],[17,0,1,6],[18,0,1,6],[19,0,1,6],[20,0,1,6],[21,0,1,6],[22,0,1,6],[23,0,1,6],[24,0,1,6],[25,0,1,6],[26,0,1,23],[27,0,1,23]]
line 5: [[0,0,2,13],[1,0,2,13],[2,0,2,13],[3,0,2,13],[4,0,2,13],[5],[6],[7],[8],[9],[10,0,2,4],[11,0,2,4],[12,0,2,4],[13,0,2,4],[14,0,2,4],[15,0,2,4],[16,0,2,4],[17,0,2,4],[18,0,2,12],[19,0,2,12],[20,0,2,12],[21,0,2,12],[22,0,2,12],[23,0,2,12],[24,0,2,12],[25,0,2,12],[26,0,2,12],[27,0,2,12],[28,0,2,12],[29,0,2,12],[30,0,2,12],[31,0,2,18],[32,0,2,18],[33,0,2,18],[34,0,2,18],[35,0,2,22],[36,0,2,22],[37,0,2,22],[38,0,2,22],[39,0,2,22],[40,0,2,22],[41,0,2,22],[42,0,2,22],[43,0,2,22],[44,0,2,22],[45,0,2,22],[46,0,2,22]]
line 6: [[0,0,3,11],[1,0,3,11],[2,0,3,11],[3,0,3,11],[4,0,3,11],[5],[6],[7],[8],[9],[10],[11],[12],[13],[14],[15],[16],[17],[18],[19],[20,0,3,8],[21,0,3,8],[22,0,3,10],[23,0,3,10],[24,0,3,21],[25,0,3,21],[26,0,3,23],[27,0,3,23],[28,0,3,24],[29,0,3,24],[30,0,3,24],[31,0,3,24],[32,0,3,28],[33,0,3,28],[34,0,3,28],[35,0,3,28],[36,0,3,28],[37,0,3,28],[38,0,3,28],[39,0,3,28],[40,0,3,28],[41,0,3,28],[42,0,3,28],[43,0,3,28],[44,0,3,28],[45,0,3,28],[46,0,3,28],[47,0,3,28],[48,0,3,28],[49,0,3,28],[50,0,3,28],[51,0,3,28],[52,0,3,28],[53,0,3,28],[54,0,3,28],[55,0,3,28],[56,0,3,28],[57,0,3,28],[58,0,3,28],[59,0,3,28],[60,0,3,45],[61,0,3,45],[62,0,3,45],[63,0,3,45],[64,0,3,49],[65,0,3,49],[66,0,3,49],[67,0,3,49],[68,0,3,49],[69,0,3,49],[70,0,3,49],[71,0,3,49],[72,0,3,49],[73,0,3,17],[74,0,3,17],[75,0,3,19],[76,0,3,19],[77,0,3,19],[78,0,3,19],[79,0,3,19],[80,0,3,19],[81,0,3,19],[82,0,3,19]]
line 7: [[0],[1],[2],[3],[4],[5]]
line 8: [[0],[1],[2],[3],[4]]
line 9: [[0],[1],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[12],[13],[14],[15],[16],[17],[18],[19],[20],[21],[22],[23],[24],[25],[26],[27],[28],[29],[30],[31],[32],[33],[34],[35],[36],[37],[38]]
line 10: [[0,0,6,15],[1,0,6,15],[2,0,6,15],[3,0,6,15],[4,0,6,15],[5],[6],[7],[8],[9],[10],[11],[12],[13],[14],[15],[16],[17,0,6,14],[18,0,6,14],[19,0,6,14],[20,0,6,14],[21,0,6,14],[22,0,6,14],[23,0,6,14],[24,0,6,14],[25,0,6,17],[26,0,6,18],[27,0,6,18],[28,0,6,18],[29,0,6,18],[30,0,6,18],[31,0,6,18],[32,0,6,18],[33,0,6,18],[34,0,6,18],[35,0,6,18],[36,0,6,18],[37,0,6,18],[38,0,6,18],[39,0,6,18],[40,0,6,18],[41,0,6,8],[42,0,6,8],[43,0,6,8],[44,0,6,8],[45,0,6,8],[46,0,6,8],[47,0,6,8]]
line 11: [[0,0,7,11],[1,0,7,11],[2,0,7,11],[3,0,7,11],[4,0,7,11],[5,0,7,15],[6,0,7,15],[7,0,7,15],[8,0,7,8],[9,0,7,8],[10,0,7,10],[11,0,7,10],[12,0,7,10],[13,0,7,10],[14,0,7,14],[15,0,7,14]]
line 12: [[0],[1],[2],[3],[4],[5]]
line 13: [[0,0,8,0]]
line 14: [[0,0,8,0],[13,0,8,9]]
=== END FULL NORMALIZED MAP ===



  Complex sourcemap validation for generated code #current

--- DELTA_CHECK for "abc" ---
  - Civet Source:  L2:4
  - Predicted TS:    L4:8 (via simple indexOf)
  - Actual from Map: L2:4
  - DELTA (L/C):     0 / 0

--- DELTA_CHECK for "queryFun2" ---
  - Civet Source:  L3:4
  - Predicted TS:    L5:10 (via simple indexOf)
  - Actual from Map: L3:4
  - DELTA (L/C):     0 / 0

--- DELTA_CHECK for "a" ---
  - Civet Source:  L1:9
  - Predicted TS:    L4:8 (via simple indexOf)
  - Actual from Map: L2:4
  - DELTA (L/C):     1 / -5

--- DELTA_CHECK for "b" ---
  - Civet Source:  L2:5
  - Predicted TS:    L4:9 (via simple indexOf)
  - Actual from Map: L2:4
  - DELTA (L/C):     0 / -1
    ✔ >>> [DELTA_CHECK] Dynamically calculate identifier deltas

=== Checking mapping for "ref" (occurrence #1) ===
Found in TSX at L1:C4
Maps back to Svelte: No mapping
    ✔ should NOT map compiler-generated helper "ref"

=== Checking mapping for " i " (occurrence #1) ===
Found in TSX at L10:C12
Maps back to Svelte: No mapping
    ✔ should NOT map compiler-generated loop variable "i"

=== Checking mapping for "abc =" (occurrence #1) ===
Found in TSX at L6:C20
Maps back to Svelte: L4:C8
    ✔ should correctly map user-defined variable "abc"
    ✔ should NOT map compiler-generated helper variables

=== FINAL OUTPUT ANALYSIS: REVERSE MAPPING (CHARACTER-BY-CHARACTER) FROM FINAL TSX TO SVELTE SOURCE ===
// This shows mapping from the final generated TSX code (after svelte2tsx) back to the original Svelte file.
Original Civet line: abc = if abc is query then null else query
Generated TSX line:         let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
TSX Col  0: ' ' -> Svelte L4:C11 
TSX Col  1: ' ' -> Svelte L4:C11 
TSX Col  2: ' ' -> Svelte L4:C11 
TSX Col  3: ' ' -> Svelte L4:C11 
TSX Col  4: ' ' -> Svelte L4:C11 
TSX Col  5: ' ' -> null 
TSX Col  6: ' ' -> null 
TSX Col  7: ' ' -> null 
TSX Col  8: 'l' -> null 
TSX Col  9: 'e' -> null 
TSX Col 10: 't' -> null 
TSX Col 11: ' ' -> null 
TSX Col 12: 'r' -> null 
TSX Col 13: 'e' -> null 
TSX Col 14: 'f' -> null 
TSX Col 15: ';' -> null 
TSX Col 16: 'i' -> null 
TSX Col 17: 'f' -> null 
TSX Col 18: ' ' -> null 
TSX Col 19: '(' -> null 
TSX Col 20: 'a' -> Svelte L4:C8 
TSX Col 21: 'b' -> Svelte L4:C8 
TSX Col 22: 'c' -> Svelte L4:C10 
TSX Col 23: ' ' -> Svelte L4:C10 
TSX Col 24: '=' -> Svelte L4:C21 
TSX Col 25: '=' -> Svelte L4:C21 
TSX Col 26: '=' -> Svelte L4:C23 
TSX Col 27: ' ' -> Svelte L4:C23 
TSX Col 28: 'q' -> Svelte L4:C24 
TSX Col 29: 'u' -> Svelte L4:C24 
TSX Col 30: 'e' -> Svelte L4:C24 
TSX Col 31: 'r' -> Svelte L4:C24 
TSX Col 32: 'y' -> Svelte L4:C28 
TSX Col 33: ')' -> Svelte L4:C28 
TSX Col 34: ' ' -> Svelte L4:C28 
TSX Col 35: '{' -> Svelte L4:C28 
TSX Col 36: ' ' -> Svelte L4:C28 
TSX Col 37: 'r' -> Svelte L4:C28 
TSX Col 38: 'e' -> Svelte L4:C28 
TSX Col 39: 'f' -> Svelte L4:C28 
TSX Col 40: ' ' -> Svelte L4:C28 
TSX Col 41: '=' -> Svelte L4:C28 
TSX Col 42: ' ' -> Svelte L4:C28 
TSX Col 43: 'n' -> Svelte L4:C28 
TSX Col 44: 'u' -> Svelte L4:C28 
TSX Col 45: 'l' -> Svelte L4:C28 
TSX Col 46: 'l' -> Svelte L4:C28 
TSX Col 47: '}' -> Svelte L4:C28 
TSX Col 48: ' ' -> Svelte L4:C28 
TSX Col 49: 'e' -> Svelte L4:C28 
TSX Col 50: 'l' -> Svelte L4:C28 
TSX Col 51: 's' -> Svelte L4:C28 
TSX Col 52: 'e' -> Svelte L4:C28 
TSX Col 53: ' ' -> Svelte L4:C28 
TSX Col 54: 'r' -> Svelte L4:C28 
TSX Col 55: 'e' -> Svelte L4:C28 
TSX Col 56: 'f' -> Svelte L4:C28 
TSX Col 57: ' ' -> Svelte L4:C28 
TSX Col 58: '=' -> Svelte L4:C28 
TSX Col 59: ' ' -> Svelte L4:C28 
TSX Col 60: 'q' -> Svelte L4:C45 
TSX Col 61: 'u' -> Svelte L4:C45 
TSX Col 62: 'e' -> Svelte L4:C45 
TSX Col 63: 'r' -> Svelte L4:C45 
TSX Col 64: 'y' -> Svelte L4:C49 
TSX Col 65: ';' -> Svelte L4:C49 
TSX Col 66: 'r' -> Svelte L4:C49 
TSX Col 67: 'e' -> Svelte L4:C49 
TSX Col 68: 't' -> Svelte L4:C49 
TSX Col 69: 'u' -> Svelte L4:C49 
TSX Col 70: 'r' -> Svelte L4:C49 
TSX Col 71: 'n' -> Svelte L4:C49 
TSX Col 72: ' ' -> Svelte L4:C49 
TSX Col 73: 'a' -> Svelte L4:C17 
TSX Col 74: 'b' -> Svelte L4:C17 
TSX Col 75: 'c' -> Svelte L4:C19 
TSX Col 76: ' ' -> Svelte L4:C19 
TSX Col 77: '=' -> Svelte L4:C19 
TSX Col 78: ' ' -> Svelte L4:C19 
TSX Col 79: 'r' -> Svelte L4:C19 
TSX Col 80: 'e' -> Svelte L4:C19 
TSX Col 81: 'f' -> Svelte L4:C19 

=== FINAL OUTPUT ANALYSIS: FORWARD MAPPING (CHARACTER-BY-CHARACTER) FROM SVELTE SOURCE TO FINAL TSX ===
// This shows mapping from the original Svelte file to the final generated TSX code.
Analyzing Svelte line 4: "abc = if abc is query then null else query"
Svelte Col  0: ' ' -> null
Svelte Col  1: ' ' -> null
Svelte Col  2: ' ' -> null
Svelte Col  3: ' ' -> null
Svelte Col  4: ' ' -> null
Svelte Col  5: ' ' -> null
Svelte Col  6: ' ' -> null
Svelte Col  7: ' ' -> null
Svelte Col  8: 'a' -> TSX L6:C20
Svelte Col  9: 'b' -> TSX L6:C21
Svelte Col 10: 'c' -> TSX L6:C22
Svelte Col 11: ' ' -> TSX L6:C0
Svelte Col 12: '=' -> TSX L6:C4
Svelte Col 13: ' ' -> TSX L6:C4
Svelte Col 14: 'i' -> TSX L6:C4
Svelte Col 15: 'f' -> TSX L6:C4
Svelte Col 16: ' ' -> TSX L6:C4
Svelte Col 17: 'a' -> TSX L6:C73
Svelte Col 18: 'b' -> TSX L6:C74
Svelte Col 19: 'c' -> TSX L6:C75
Svelte Col 20: ' ' -> TSX L6:C82
Svelte Col 21: 'i' -> TSX L6:C24
Svelte Col 22: 's' -> TSX L6:C25
Svelte Col 23: ' ' -> TSX L6:C26
Svelte Col 24: 'q' -> TSX L6:C28
Svelte Col 25: 'u' -> TSX L6:C31
Svelte Col 26: 'e' -> TSX L6:C31
Svelte Col 27: 'r' -> TSX L6:C31
Svelte Col 28: 'y' -> TSX L6:C32
Svelte Col 29: ' ' -> TSX L6:C59
Svelte Col 30: 't' -> TSX L6:C59
Svelte Col 31: 'h' -> TSX L6:C59
Svelte Col 32: 'e' -> TSX L6:C59
Svelte Col 33: 'n' -> TSX L6:C59
Svelte Col 34: ' ' -> TSX L6:C59
Svelte Col 35: 'n' -> TSX L6:C59
Svelte Col 36: 'u' -> TSX L6:C59
Svelte Col 37: 'l' -> TSX L6:C59
Svelte Col 38: 'l' -> TSX L6:C59
Svelte Col 39: ' ' -> TSX L6:C59
Svelte Col 40: 'e' -> TSX L6:C59
Svelte Col 41: 'l' -> TSX L6:C59
Svelte Col 42: 's' -> TSX L6:C59
Svelte Col 43: 'e' -> TSX L6:C59
Svelte Col 44: ' ' -> TSX L6:C59
Svelte Col 45: 'q' -> TSX L6:C60
Svelte Col 46: 'u' -> TSX L6:C63
Svelte Col 47: 'e' -> TSX L6:C63
Svelte Col 48: 'r' -> TSX L6:C63
Svelte Col 49: 'y' -> TSX L6:C64

=== RAW COMPILER ANALYSIS: FORWARD MAPPING FROM SVELTE SOURCE TO RAW CIVET-TS (pre-normalization) ===
// This shows mapping from the Svelte file to the raw, un-normalized TS produced directly by the Civet compiler.
Analyzing Svelte line 4: "        abc = if abc is query then null else query" (as line 3 of snippet)
Svelte Col  0: ' ' -> Raw TS L3:C0
Svelte Col  1: ' ' -> Raw TS L3:C0
Svelte Col  2: ' ' -> Raw TS L3:C0
Svelte Col  3: ' ' -> Raw TS L3:C0
Svelte Col  4: ' ' -> Raw TS L3:C0
Svelte Col  5: ' ' -> Raw TS L3:C0
Svelte Col  6: ' ' -> Raw TS L3:C0
Svelte Col  7: ' ' -> Raw TS L3:C0
Svelte Col  8: 'a' -> Raw TS L3:C73
Svelte Col  9: 'b' -> Raw TS L3:C73
Svelte Col 10: 'c' -> Raw TS L3:C73
Svelte Col 11: ' ' -> Raw TS L3:C76
Svelte Col 12: '=' -> Raw TS L3:C76
Svelte Col 13: ' ' -> Raw TS L3:C78
Svelte Col 14: 'i' -> Raw TS L3:C16
Svelte Col 15: 'f' -> Raw TS L3:C16
Svelte Col 16: ' ' -> Raw TS L3:C16
Svelte Col 17: 'a' -> Raw TS L3:C19
Svelte Col 18: 'b' -> Raw TS L3:C20
Svelte Col 19: 'c' -> Raw TS L3:C20
Svelte Col 20: ' ' -> Raw TS L3:C23
Svelte Col 21: 'i' -> Raw TS L3:C24
Svelte Col 22: 's' -> Raw TS L3:C24
Svelte Col 23: ' ' -> Raw TS L3:C27
Svelte Col 24: 'q' -> Raw TS L3:C28
Svelte Col 25: 'u' -> Raw TS L3:C28
Svelte Col 26: 'e' -> Raw TS L3:C28
Svelte Col 27: 'r' -> Raw TS L3:C28
Svelte Col 28: 'y' -> Raw TS L3:C28
Svelte Col 29: ' ' -> Raw TS L3:C33
Svelte Col 30: 't' -> Raw TS L3:C33
Svelte Col 31: 'h' -> Raw TS L3:C33
Svelte Col 32: 'e' -> Raw TS L3:C33
Svelte Col 33: 'n' -> Raw TS L3:C33
Svelte Col 34: ' ' -> Raw TS L3:C36
Svelte Col 35: 'n' -> Raw TS L3:C43
Svelte Col 36: 'u' -> Raw TS L3:C43
Svelte Col 37: 'l' -> Raw TS L3:C43
Svelte Col 38: 'l' -> Raw TS L3:C43
Svelte Col 39: ' ' -> Raw TS L3:C48
Svelte Col 40: 'e' -> Raw TS L3:C49
Svelte Col 41: 'l' -> Raw TS L3:C49
Svelte Col 42: 's' -> Raw TS L3:C49
Svelte Col 43: 'e' -> Raw TS L3:C49
Svelte Col 44: ' ' -> Raw TS L3:C53
Svelte Col 45: 'q' -> Raw TS L3:C60
Svelte Col 46: 'u' -> Raw TS L3:C60
Svelte Col 47: 'e' -> Raw TS L3:C60
Svelte Col 48: 'r' -> Raw TS L3:C60
Svelte Col 49: 'y' -> Raw TS L3:C60

=== Checking range for "abc" in "if (abc === query)" ===
Checking "a" in "abc" at TSX L6:C20
It maps to Svelte: L4:C8 (name: null)
    1) should NOT map whitespace after a token to the token itself (range check)

=== Checking range for "abc" in "return abc = ref" ===
Checking space before "abc" at TSX L6:C72
It maps to Svelte: L4:C49 (name: null)
Checking "a" in "abc" at TSX L6:C73
It maps to Svelte: L4:C17 (name: null)
    2) should correctly handle mapping ranges around the assignment `abc`

=== BLEED_CHECK: "= if" segment ===
Analyzing Svelte line 4: "abc = if abc is query then null else query"
Svelte Col  7 (' ') -> null
Svelte Col  8 ('a') -> 6:20
Svelte Col  9 ('b') -> 6:21
Svelte Col 10 ('c') -> 6:22

=== BLEED_CHECK: "then null else" whitespace ===
Svelte Col 30 ('t') -> 6:59
Svelte Col 31 ('h') -> 6:59
    3) >>> [BLEED_CHECK] Showcase mapping bleed for " = if" and "then null else" segments


  5 passing (161ms)
  3 failing

  1) Complex sourcemap validation for generated code #current
       should NOT map whitespace after a token to the token itself (range check):
     AssertionError [ERR_ASSERTION]: The start of "abc" should map to the "abc" token.
      at Context.<anonymous> (test/civet/- current - 0complexCompile.test.ts:454:16)
      at processImmediate (node:internal/timers:476:21)

  2) Complex sourcemap validation for generated code #current
       should correctly handle mapping ranges around the assignment `abc`:
     AssertionError [ERR_ASSERTION]: The start of "abc" should map to the "abc" token.
      at Context.<anonymous> (test/civet/- current - 0complexCompile.test.ts:491:16)
      at processImmediate (node:internal/timers:476:21)

  3) Complex sourcemap validation for generated code #current
       >>> [BLEED_CHECK] Showcase mapping bleed for " = if" and "then null else" segments:

      AssertionError [ERR_ASSERTION]: Bleed detected in 'then null else': Civet columns share TS position 6:59
      + expected - actual

      -false
      +true
      
      at Context.<anonymous> (test/civet/- current - 0complexCompile.test.ts:547:24)
      at processImmediate (node:internal/timers:476:21)



/home/user/Documents/repos/language-tools-civet/packages/svelte2tsx:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  svelte2tsx@0.7.35 test-current: `mocha test/test.ts --grep "#current"`
Exit status 3
