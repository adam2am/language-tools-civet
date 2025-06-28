
> svelte2tsx@0.7.35 test-current /home/user/Documents/repos/language-tools-civet/packages/svelte2tsx
> mocha test/test.ts --grep "#current"


=== Input Svelte/Civet Code ===

  1| <script lang="civet">
  2| 	abc:number|null .= 1
  3| 	queryFun2 := (query:number) ->
  4| 		abc = if abc is query then null else query
  5| 
  6| 	fruits := ['apple', 'banana', 'cherry']
  7|     // First loop, should generate 'i'
  8| 	for fruit, index of fruits
  9| 		abc = index
 10| </script> 

=== FINAL OUTPUT: GENERATED TSX CODE (from svelte2tsx) ===

  1| ///<reference types="svelte" />
  2| ;function $$render() {
  3| 
  4| 	let abc:number|null = 1
  5| 	const queryFun2 = function(query:number) {
  6| 		let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
  7| 	}
  8| 	
  9| 	const fruits = ['apple', 'banana', 'cherry']
 10| 	    // First loop, should generate 'i'
 11| 	let i = 0;for (const fruit of fruits) {const index = i++;
 12| 		abc = index
 13| 	}
 14| ;
 15| async () => { };
 16| return { props: /** @type {Record<string, never>} */ ({}), slots: {}, events: {} }}
 17| 
 18| export default class ComplexCompilecopy__SvelteComponent_ extends __sveltets_2_createSvelte2TsxComponent(__sveltets_2_partial(__sveltets_2_with_any_event($$render()))) {
 19| }

=== STAGE 1: RAW TYPESCRIPT FROM CIVET COMPILER (pre-svelte2tsx integration) ===

  1| 	let abc:number|null = 1
  2| 	const queryFun2 = function(query:number) {
  3| 		let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
  4| 	}
  5| 
  6| 	const fruits = ['apple', 'banana', 'cherry']
  7|     // First loop, should generate 'i'
  8| 	let i = 0;for (const fruit of fruits) {const index = i++;
  9| 		abc = index
 10| 	}

=== STAGE 2: NORMALIZED SOURCEMAP (Civet-TS -> Svelte File) (pre-svelte2tsx integration) ===
// This is the array-style sourcemap after the raw Civet map is normalized to point to the .svelte file.
line 1: [[0,0,0,4],[0],[0,0,0,21],[5,0,0,1,0],[7,0,0,3,0],[23,0,0,20],[23,0,0,20]]
line 2: [[0,0,1,10],[0],[0,0,1,20],[0],[7,0,1,1,1],[15,0,1,9,1],[28,0,1,15,2],[32,0,1,19,2]]
line 3: [[0,0,2,5],[0,0,2,18],[0,0,2,23],[0],[0,0,2,44],[0],[0,0,2,14],[0],[14,0,2,2,0],[16,0,2,4,0],[18,0,2,15],[20,0,2,17],[22,0,2,18,2],[26,0,2,22,2],[54,0,2,39,2],[58,0,2,43,2],[67,0,2,11,0],[69,0,2,13,0]]
line 4: []
line 5: []
line 6: [[0,0,4,7],[0],[7,0,4,1,4],[12,0,4,6,4]]
line 7: []
line 8: [[0,0,6,10],[0],[0,0,6,27],[0],[0,0,6,17],[0],[22,0,6,5,6],[26,0,6,9,6],[31,0,6,21,4],[36,0,6,26,4],[46,0,6,12,7],[50,0,6,16,7]]
line 9: [[0,0,7,5],[0],[0,0,7,13],[2,0,7,2,0],[4,0,7,4,0],[8,0,7,8,7],[12,0,7,12,7]]
line 10: []
=== END PRE-INTEGRATION MAP ===


=== STAGE 2 CORRELATION: Raw TS lines with their mappings ===

--- TypeScript Line 1 ---
TS   | 	let abc:number|null = 1
Civet| 	abc:number|null .= 1
TS -> Svelte mappings:
      TS[col  0] -> Svelte L1:C21 '' 
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> Svelte L1:C1 'a' (name: abc)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> Svelte L1:C3 'c' (name: abc)
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
      TS[col 23] -> Svelte L1:C20 '1' 

Civet -> TS mappings:
      Civet[col  0] '	' -> (no mapping)
      Civet[col  1] 'a' -> TS cols: 5
      Civet[col  2] 'b' -> (no mapping)
      Civet[col  3] 'c' -> TS cols: 7
      Civet[col  4] ':' -> TS cols: 0
      Civet[col  5] 'n' -> (no mapping)
      Civet[col  6] 'u' -> (no mapping)
      Civet[col  7] 'm' -> (no mapping)
      Civet[col  8] 'b' -> (no mapping)
      Civet[col  9] 'e' -> (no mapping)
      Civet[col 10] 'r' -> (no mapping)
      Civet[col 11] '|' -> (no mapping)
      Civet[col 12] 'n' -> (no mapping)
      Civet[col 13] 'u' -> (no mapping)
      Civet[col 14] 'l' -> (no mapping)
      Civet[col 15] 'l' -> (no mapping)
      Civet[col 16] ' ' -> (no mapping)
      Civet[col 17] '.' -> (no mapping)
      Civet[col 18] '=' -> (no mapping)
      Civet[col 19] ' ' -> (no mapping)
      Civet[col 20] '1' -> TS cols: 23, 23

--- TypeScript Line 2 ---
TS   | 	const queryFun2 = function(query:number) {
Civet| 	queryFun2 := (query:number) ->
TS -> Svelte mappings:
      TS[col  0] -> (null mapping)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> Svelte L2:C1 'q' (name: queryFun2)
      TS[col  8] -> (inherited from previous)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> (inherited from previous)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> (inherited from previous)
      TS[col 13] -> (inherited from previous)
      TS[col 14] -> (inherited from previous)
      TS[col 15] -> Svelte L2:C9 '2' (name: queryFun2)
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
      TS[col 28] -> Svelte L2:C15 'q' (name: query)
      TS[col 29] -> (inherited from previous)
      TS[col 30] -> (inherited from previous)
      TS[col 31] -> (inherited from previous)
      TS[col 32] -> Svelte L2:C19 'y' (name: query)
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

Civet -> TS mappings:
      Civet[col  0] '	' -> (no mapping)
      Civet[col  1] 'q' -> TS cols: 7
      Civet[col  2] 'u' -> (no mapping)
      Civet[col  3] 'e' -> (no mapping)
      Civet[col  4] 'r' -> (no mapping)
      Civet[col  5] 'y' -> (no mapping)
      Civet[col  6] 'F' -> (no mapping)
      Civet[col  7] 'u' -> (no mapping)
      Civet[col  8] 'n' -> (no mapping)
      Civet[col  9] '2' -> TS cols: 15
      Civet[col 10] ' ' -> TS cols: 0
      Civet[col 11] ':' -> (no mapping)
      Civet[col 12] '=' -> (no mapping)
      Civet[col 13] ' ' -> (no mapping)
      Civet[col 14] '(' -> (no mapping)
      Civet[col 15] 'q' -> TS cols: 28
      Civet[col 16] 'u' -> (no mapping)
      Civet[col 17] 'e' -> (no mapping)
      Civet[col 18] 'r' -> (no mapping)
      Civet[col 19] 'y' -> TS cols: 32
      Civet[col 20] ':' -> TS cols: 0
      Civet[col 21] 'n' -> (no mapping)
      Civet[col 22] 'u' -> (no mapping)
      Civet[col 23] 'm' -> (no mapping)
      Civet[col 24] 'b' -> (no mapping)
      Civet[col 25] 'e' -> (no mapping)
      Civet[col 26] 'r' -> (no mapping)
      Civet[col 27] ')' -> (no mapping)
      Civet[col 28] ' ' -> (no mapping)
      Civet[col 29] '-' -> (no mapping)
      Civet[col 30] '>' -> (no mapping)

--- TypeScript Line 3 ---
TS   | 		let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
Civet| 		abc = if abc is query then null else query
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
      TS[col 14] -> Svelte L3:C2 'a' (name: abc)
      TS[col 15] -> (inherited from previous)
      TS[col 16] -> Svelte L3:C4 'c' (name: abc)
      TS[col 17] -> (inherited from previous)
      TS[col 18] -> Svelte L3:C15 'i' 
      TS[col 19] -> (inherited from previous)
      TS[col 20] -> Svelte L3:C17 ' ' 
      TS[col 21] -> (inherited from previous)
      TS[col 22] -> Svelte L3:C18 'q' (name: query)
      TS[col 23] -> (inherited from previous)
      TS[col 24] -> (inherited from previous)
      TS[col 25] -> (inherited from previous)
      TS[col 26] -> Svelte L3:C22 'y' (name: query)
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
      TS[col 54] -> Svelte L3:C39 'q' (name: query)
      TS[col 55] -> (inherited from previous)
      TS[col 56] -> (inherited from previous)
      TS[col 57] -> (inherited from previous)
      TS[col 58] -> Svelte L3:C43 'y' (name: query)
      TS[col 59] -> (inherited from previous)
      TS[col 60] -> (inherited from previous)
      TS[col 61] -> (inherited from previous)
      TS[col 62] -> (inherited from previous)
      TS[col 63] -> (inherited from previous)
      TS[col 64] -> (inherited from previous)
      TS[col 65] -> (inherited from previous)
      TS[col 66] -> (inherited from previous)
      TS[col 67] -> Svelte L3:C11 'a' (name: abc)
      TS[col 68] -> (inherited from previous)
      TS[col 69] -> Svelte L3:C13 'c' (name: abc)
      TS[col 70] -> (inherited from previous)
      TS[col 71] -> (inherited from previous)
      TS[col 72] -> (inherited from previous)
      TS[col 73] -> (inherited from previous)
      TS[col 74] -> (inherited from previous)
      TS[col 75] -> (inherited from previous)

Civet -> TS mappings:
      Civet[col  0] '	' -> (no mapping)
      Civet[col  1] '	' -> (no mapping)
      Civet[col  2] 'a' -> TS cols: 14
      Civet[col  3] 'b' -> (no mapping)
      Civet[col  4] 'c' -> TS cols: 16
      Civet[col  5] ' ' -> TS cols: 0
      Civet[col  6] '=' -> (no mapping)
      Civet[col  7] ' ' -> (no mapping)
      Civet[col  8] 'i' -> (no mapping)
      Civet[col  9] 'f' -> (no mapping)
      Civet[col 10] ' ' -> (no mapping)
      Civet[col 11] 'a' -> TS cols: 67
      Civet[col 12] 'b' -> (no mapping)
      Civet[col 13] 'c' -> TS cols: 69
      Civet[col 14] ' ' -> TS cols: 0
      Civet[col 15] 'i' -> TS cols: 18
      Civet[col 16] 's' -> (no mapping)
      Civet[col 17] ' ' -> TS cols: 20
      Civet[col 18] 'q' -> TS cols: 0, 22
      Civet[col 19] 'u' -> (no mapping)
      Civet[col 20] 'e' -> (no mapping)
      Civet[col 21] 'r' -> (no mapping)
      Civet[col 22] 'y' -> TS cols: 26
      Civet[col 23] ' ' -> TS cols: 0
      Civet[col 24] 't' -> (no mapping)
      Civet[col 25] 'h' -> (no mapping)
      Civet[col 26] 'e' -> (no mapping)
      Civet[col 27] 'n' -> (no mapping)
      Civet[col 28] ' ' -> (no mapping)
      Civet[col 29] 'n' -> (no mapping)
      Civet[col 30] 'u' -> (no mapping)
      Civet[col 31] 'l' -> (no mapping)
      Civet[col 32] 'l' -> (no mapping)
      Civet[col 33] ' ' -> (no mapping)
      Civet[col 34] 'e' -> (no mapping)
      Civet[col 35] 'l' -> (no mapping)
      Civet[col 36] 's' -> (no mapping)
      Civet[col 37] 'e' -> (no mapping)
      Civet[col 38] ' ' -> (no mapping)
      Civet[col 39] 'q' -> TS cols: 54
      Civet[col 40] 'u' -> (no mapping)
      Civet[col 41] 'e' -> (no mapping)
      Civet[col 42] 'r' -> (no mapping)
      Civet[col 43] 'y' -> TS cols: 58

--- TypeScript Line 4 ---
TS   | 	}
TS -> Svelte mappings:
      TS[col  0] -> (inherited from previous)
      TS[col  1] -> (inherited from previous)

--- TypeScript Line 5 ---
TS   | 
TS -> Svelte mappings:

--- TypeScript Line 6 ---
TS   | 	const fruits = ['apple', 'banana', 'cherry']
Civet| 	fruits := ['apple', 'banana', 'cherry']
TS -> Svelte mappings:
      TS[col  0] -> (null mapping)
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> (inherited from previous)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> (inherited from previous)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> Svelte L5:C1 'f' (name: fruits)
      TS[col  8] -> (inherited from previous)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> (inherited from previous)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> Svelte L5:C6 's' (name: fruits)
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
      TS[col 38] -> (inherited from previous)
      TS[col 39] -> (inherited from previous)
      TS[col 40] -> (inherited from previous)
      TS[col 41] -> (inherited from previous)
      TS[col 42] -> (inherited from previous)
      TS[col 43] -> (inherited from previous)
      TS[col 44] -> (inherited from previous)

Civet -> TS mappings:
      Civet[col  0] '	' -> (no mapping)
      Civet[col  1] 'f' -> TS cols: 7
      Civet[col  2] 'r' -> (no mapping)
      Civet[col  3] 'u' -> (no mapping)
      Civet[col  4] 'i' -> (no mapping)
      Civet[col  5] 't' -> (no mapping)
      Civet[col  6] 's' -> TS cols: 12
      Civet[col  7] ' ' -> TS cols: 0
      Civet[col  8] ':' -> (no mapping)
      Civet[col  9] '=' -> (no mapping)
      Civet[col 10] ' ' -> (no mapping)
      Civet[col 11] '[' -> (no mapping)
      Civet[col 12] ''' -> (no mapping)
      Civet[col 13] 'a' -> (no mapping)
      Civet[col 14] 'p' -> (no mapping)
      Civet[col 15] 'p' -> (no mapping)
      Civet[col 16] 'l' -> (no mapping)
      Civet[col 17] 'e' -> (no mapping)
      Civet[col 18] ''' -> (no mapping)
      Civet[col 19] ',' -> (no mapping)
      Civet[col 20] ' ' -> (no mapping)
      Civet[col 21] ''' -> (no mapping)
      Civet[col 22] 'b' -> (no mapping)
      Civet[col 23] 'a' -> (no mapping)
      Civet[col 24] 'n' -> (no mapping)
      Civet[col 25] 'a' -> (no mapping)
      Civet[col 26] 'n' -> (no mapping)
      Civet[col 27] 'a' -> (no mapping)
      Civet[col 28] ''' -> (no mapping)
      Civet[col 29] ',' -> (no mapping)
      Civet[col 30] ' ' -> (no mapping)
      Civet[col 31] ''' -> (no mapping)
      Civet[col 32] 'c' -> (no mapping)
      Civet[col 33] 'h' -> (no mapping)
      Civet[col 34] 'e' -> (no mapping)
      Civet[col 35] 'r' -> (no mapping)
      Civet[col 36] 'r' -> (no mapping)
      Civet[col 37] 'y' -> (no mapping)
      Civet[col 38] ''' -> (no mapping)
      Civet[col 39] ']' -> (no mapping)

--- TypeScript Line 7 ---
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

--- TypeScript Line 8 ---
TS   | 	let i = 0;for (const fruit of fruits) {const index = i++;
Civet| 	for fruit, index of fruits
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
      TS[col 20] -> (inherited from previous)
      TS[col 21] -> (inherited from previous)
      TS[col 22] -> Svelte L7:C5 'f' (name: fruit)
      TS[col 23] -> (inherited from previous)
      TS[col 24] -> (inherited from previous)
      TS[col 25] -> (inherited from previous)
      TS[col 26] -> Svelte L7:C9 't' (name: fruit)
      TS[col 27] -> (inherited from previous)
      TS[col 28] -> (inherited from previous)
      TS[col 29] -> (inherited from previous)
      TS[col 30] -> (inherited from previous)
      TS[col 31] -> Svelte L7:C21 'f' (name: fruits)
      TS[col 32] -> (inherited from previous)
      TS[col 33] -> (inherited from previous)
      TS[col 34] -> (inherited from previous)
      TS[col 35] -> (inherited from previous)
      TS[col 36] -> Svelte L7:C26 's' (name: fruits)
      TS[col 37] -> (inherited from previous)
      TS[col 38] -> (inherited from previous)
      TS[col 39] -> (inherited from previous)
      TS[col 40] -> (inherited from previous)
      TS[col 41] -> (inherited from previous)
      TS[col 42] -> (inherited from previous)
      TS[col 43] -> (inherited from previous)
      TS[col 44] -> (inherited from previous)
      TS[col 45] -> (inherited from previous)
      TS[col 46] -> Svelte L7:C12 'i' (name: index)
      TS[col 47] -> (inherited from previous)
      TS[col 48] -> (inherited from previous)
      TS[col 49] -> (inherited from previous)
      TS[col 50] -> Svelte L7:C16 'x' (name: index)
      TS[col 51] -> (inherited from previous)
      TS[col 52] -> (inherited from previous)
      TS[col 53] -> (inherited from previous)
      TS[col 54] -> (inherited from previous)
      TS[col 55] -> (inherited from previous)
      TS[col 56] -> (inherited from previous)
      TS[col 57] -> (inherited from previous)

Civet -> TS mappings:
      Civet[col  0] '	' -> (no mapping)
      Civet[col  1] 'f' -> (no mapping)
      Civet[col  2] 'o' -> (no mapping)
      Civet[col  3] 'r' -> (no mapping)
      Civet[col  4] ' ' -> (no mapping)
      Civet[col  5] 'f' -> TS cols: 22
      Civet[col  6] 'r' -> (no mapping)
      Civet[col  7] 'u' -> (no mapping)
      Civet[col  8] 'i' -> (no mapping)
      Civet[col  9] 't' -> TS cols: 26
      Civet[col 10] ',' -> TS cols: 0
      Civet[col 11] ' ' -> (no mapping)
      Civet[col 12] 'i' -> TS cols: 46
      Civet[col 13] 'n' -> (no mapping)
      Civet[col 14] 'd' -> (no mapping)
      Civet[col 15] 'e' -> (no mapping)
      Civet[col 16] 'x' -> TS cols: 50
      Civet[col 17] ' ' -> TS cols: 0
      Civet[col 18] 'o' -> (no mapping)
      Civet[col 19] 'f' -> (no mapping)
      Civet[col 20] ' ' -> (no mapping)
      Civet[col 21] 'f' -> TS cols: 31
      Civet[col 22] 'r' -> (no mapping)
      Civet[col 23] 'u' -> (no mapping)
      Civet[col 24] 'i' -> (no mapping)
      Civet[col 25] 't' -> (no mapping)
      Civet[col 26] 's' -> TS cols: 36

--- TypeScript Line 9 ---
TS   | 		abc = index
Civet| 		abc = index
TS -> Svelte mappings:
      TS[col  0] -> Svelte L8:C13 '' 
      TS[col  1] -> (inherited from previous)
      TS[col  2] -> Svelte L8:C2 'a' (name: abc)
      TS[col  3] -> (inherited from previous)
      TS[col  4] -> Svelte L8:C4 'c' (name: abc)
      TS[col  5] -> (inherited from previous)
      TS[col  6] -> (inherited from previous)
      TS[col  7] -> (inherited from previous)
      TS[col  8] -> Svelte L8:C8 'i' (name: index)
      TS[col  9] -> (inherited from previous)
      TS[col 10] -> (inherited from previous)
      TS[col 11] -> (inherited from previous)
      TS[col 12] -> Svelte L8:C12 'x' (name: index)

Civet -> TS mappings:
      Civet[col  0] '	' -> (no mapping)
      Civet[col  1] '	' -> (no mapping)
      Civet[col  2] 'a' -> TS cols: 2
      Civet[col  3] 'b' -> (no mapping)
      Civet[col  4] 'c' -> TS cols: 4
      Civet[col  5] ' ' -> TS cols: 0
      Civet[col  6] '=' -> (no mapping)
      Civet[col  7] ' ' -> (no mapping)
      Civet[col  8] 'i' -> TS cols: 8
      Civet[col  9] 'n' -> (no mapping)
      Civet[col 10] 'd' -> (no mapping)
      Civet[col 11] 'e' -> (no mapping)
      Civet[col 12] 'x' -> TS cols: 12

--- TypeScript Line 10 ---
TS   | 	}
TS -> Svelte mappings:
      TS[col  0] -> (inherited from previous)
      TS[col  1] -> (inherited from previous)
=== END STAGE 2 CORRELATION ===


=== Sourcemap Summary ===
Sources: 0complexCompile copy.svelte
Mappings length: 1332 chars
Number of lines mapped: 15

=== FINAL OUTPUT ANALYSIS: FULL SOURCEMAP (FINAL TSX -> SVELTE) IN ARRAY FORMAT ===
line 1: []
line 2: [[0,0,0,0],[1,0,0,1]]
line 3: [[0,0,0,18]]
line 4: [[0,0,1,0],[1,0,1,4],[2,0,1,21],[3,0,1,21],[4,0,1,21],[5,0,1,1],[6,0,1,1],[7,0,1,3],[8,0,1,3],[9,0,1,3],[10,0,1,3],[11,0,1,3],[12,0,1,3],[13,0,1,3],[14,0,1,3],[15,0,1,3],[16,0,1,3],[17,0,1,3],[18,0,1,3],[19,0,1,3],[20,0,1,3],[21,0,1,3],[22,0,1,3],[23,0,1,20],[24,0,1,20]]
line 5: [[0,0,2,10],[1,0,2,10],[2],[3],[4],[5],[6],[7,0,2,1],[8,0,2,1],[9,0,2,1],[10,0,2,1],[11,0,2,1],[12,0,2,1],[13,0,2,1],[14,0,2,1],[15,0,2,9],[16,0,2,9],[17,0,2,9],[18,0,2,9],[19,0,2,9],[20,0,2,9],[21,0,2,9],[22,0,2,9],[23,0,2,9],[24,0,2,9],[25,0,2,9],[26,0,2,9],[27,0,2,9],[28,0,2,15],[29,0,2,15],[30,0,2,15],[31,0,2,15],[32,0,2,19],[33,0,2,19],[34,0,2,19],[35,0,2,19],[36,0,2,19],[37,0,2,19],[38,0,2,19],[39,0,2,19],[40,0,2,19],[41,0,2,19],[42,0,2,19],[43,0,2,19]]
line 6: [[0,0,3,5],[1,0,3,5],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[12],[13],[14,0,3,2],[15,0,3,2],[16,0,3,4],[17,0,3,4],[18,0,3,15],[19,0,3,15],[20,0,3,17],[21,0,3,17],[22,0,3,18],[23,0,3,18],[24,0,3,18],[25,0,3,18],[26,0,3,22],[27,0,3,22],[28,0,3,22],[29,0,3,22],[30,0,3,22],[31,0,3,22],[32,0,3,22],[33,0,3,22],[34,0,3,22],[35,0,3,22],[36,0,3,22],[37,0,3,22],[38,0,3,22],[39,0,3,22],[40,0,3,22],[41,0,3,22],[42,0,3,22],[43,0,3,22],[44,0,3,22],[45,0,3,22],[46,0,3,22],[47,0,3,22],[48,0,3,22],[49,0,3,22],[50,0,3,22],[51,0,3,22],[52,0,3,22],[53,0,3,22],[54,0,3,39],[55,0,3,39],[56,0,3,39],[57,0,3,39],[58,0,3,43],[59,0,3,43],[60,0,3,43],[61,0,3,43],[62,0,3,43],[63,0,3,43],[64,0,3,43],[65,0,3,43],[66,0,3,43],[67,0,3,11],[68,0,3,11],[69,0,3,13],[70,0,3,13],[71,0,3,13],[72,0,3,13],[73,0,3,13],[74,0,3,13],[75,0,3,13],[76,0,3,13]]
line 7: [[0],[1],[2]]
line 8: [[0],[1]]
line 9: [[0,0,5,7],[1,0,5,7],[2],[3],[4],[5],[6],[7,0,5,1],[8,0,5,1],[9,0,5,1],[10,0,5,1],[11,0,5,1],[12,0,5,6],[13,0,5,6],[14,0,5,6],[15,0,5,6],[16,0,5,6],[17,0,5,6],[18,0,5,6],[19,0,5,6],[20,0,5,6],[21,0,5,6],[22,0,5,6],[23,0,5,6],[24,0,5,6],[25,0,5,6],[26,0,5,6],[27,0,5,6],[28,0,5,6],[29,0,5,6],[30,0,5,6],[31,0,5,6],[32,0,5,6],[33,0,5,6],[34,0,5,6],[35,0,5,6],[36,0,5,6],[37,0,5,6],[38,0,5,6],[39,0,5,6],[40,0,5,6],[41,0,5,6],[42,0,5,6],[43,0,5,6],[44,0,5,6],[45,0,5,6]]
line 10: [[0],[1],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[12],[13],[14],[15],[16],[17],[18],[19],[20],[21],[22],[23],[24],[25],[26],[27],[28],[29],[30],[31],[32],[33],[34],[35],[36],[37],[38],[39]]
line 11: [[0,0,7,10],[1,0,7,10],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[12],[13],[14],[15],[16],[17],[18],[19],[20],[21],[22,0,7,5],[23,0,7,5],[24,0,7,5],[25,0,7,5],[26,0,7,9],[27,0,7,9],[28,0,7,9],[29,0,7,9],[30,0,7,9],[31,0,7,21],[32,0,7,21],[33,0,7,21],[34,0,7,21],[35,0,7,21],[36,0,7,26],[37,0,7,26],[38,0,7,26],[39,0,7,26],[40,0,7,26],[41,0,7,26],[42,0,7,26],[43,0,7,26],[44,0,7,26],[45,0,7,26],[46,0,7,12],[47,0,7,12],[48,0,7,12],[49,0,7,12],[50,0,7,16],[51,0,7,16],[52,0,7,16],[53,0,7,16],[54,0,7,16],[55,0,7,16],[56,0,7,16],[57,0,7,16],[58,0,7,16]]
line 12: [[0,0,8,5],[1,0,8,5],[2,0,8,2],[3,0,8,2],[4,0,8,4],[5,0,8,4],[6,0,8,4],[7,0,8,4],[8,0,8,8],[9,0,8,8],[10,0,8,8],[11,0,8,8],[12,0,8,12],[13,0,8,12]]
line 13: [[0],[1],[2]]
line 14: [[0,0,9,0]]
line 15: [[0,0,9,0],[13,0,9,9]]
=== END FULL NORMALIZED MAP ===



  Complex sourcemap validation for generated code #current

--- DELTA_CHECK for "abc" ---
  - Civet Source:  L2:1
  - Predicted TS:    L4:5 (via simple indexOf)
  - Actual from Map: L2:1
  - DELTA (L/C):     0 / 0

--- DELTA_CHECK for "queryFun2" ---
  - Civet Source:  L3:1
  - Predicted TS:    L5:7 (via simple indexOf)
  - Actual from Map: L3:1
  - DELTA (L/C):     0 / 0

--- DELTA_CHECK for "a" ---
  - Civet Source:  L1:9
  - Predicted TS:    L4:5 (via simple indexOf)
  - Actual from Map: L2:1
  - DELTA (L/C):     1 / -8

--- DELTA_CHECK for "b" ---
  - Civet Source:  L2:2
  - Predicted TS:    L4:6 (via simple indexOf)
  - Actual from Map: L2:1
  - DELTA (L/C):     0 / -1
    ✔ >>> [DELTA_CHECK] Dynamically calculate identifier deltas

=== Checking mapping for "ref" (occurrence #1) ===
Found in TSX at L1:C4
Maps back to Svelte: No mapping
    ✔ should NOT map compiler-generated helper "ref"

=== Checking mapping for " i " (occurrence #1) ===
Found in TSX at L11:C4
Maps back to Svelte: No mapping
    ✔ should NOT map compiler-generated loop variable "i"

=== Checking mapping for "abc =" (occurrence #1) ===
Found in TSX at L6:C14
Maps back to Svelte: L4:C2
    ✔ should correctly map user-defined variable "abc"
    ✔ should NOT map compiler-generated helper variables

=== FINAL OUTPUT ANALYSIS: REVERSE MAPPING (CHARACTER-BY-CHARACTER) FROM FINAL TSX TO SVELTE SOURCE ===
// This shows mapping from the final generated TSX code (after svelte2tsx) back to the original Svelte file.
Original Civet line: abc = if abc is query then null else query
Generated TSX line: 		let ref;if (abc === query) { ref = null} else ref = query;return abc = ref
TSX Col  0: '	' -> Svelte L4:C5 
TSX Col  1: '	' -> Svelte L4:C5 
TSX Col  2: 'l' -> null 
TSX Col  3: 'e' -> null 
TSX Col  4: 't' -> null 
TSX Col  5: ' ' -> null 
TSX Col  6: 'r' -> null 
TSX Col  7: 'e' -> null 
TSX Col  8: 'f' -> null 
TSX Col  9: ';' -> null 
TSX Col 10: 'i' -> null 
TSX Col 11: 'f' -> null 
TSX Col 12: ' ' -> null 
TSX Col 13: '(' -> null 
TSX Col 14: 'a' -> Svelte L4:C2 
TSX Col 15: 'b' -> Svelte L4:C2 
TSX Col 16: 'c' -> Svelte L4:C4 
TSX Col 17: ' ' -> Svelte L4:C4 
TSX Col 18: '=' -> Svelte L4:C15 
TSX Col 19: '=' -> Svelte L4:C15 
TSX Col 20: '=' -> Svelte L4:C17 
TSX Col 21: ' ' -> Svelte L4:C17 
TSX Col 22: 'q' -> Svelte L4:C18 
TSX Col 23: 'u' -> Svelte L4:C18 
TSX Col 24: 'e' -> Svelte L4:C18 
TSX Col 25: 'r' -> Svelte L4:C18 
TSX Col 26: 'y' -> Svelte L4:C22 
TSX Col 27: ')' -> Svelte L4:C22 
TSX Col 28: ' ' -> Svelte L4:C22 
TSX Col 29: '{' -> Svelte L4:C22 
TSX Col 30: ' ' -> Svelte L4:C22 
TSX Col 31: 'r' -> Svelte L4:C22 
TSX Col 32: 'e' -> Svelte L4:C22 
TSX Col 33: 'f' -> Svelte L4:C22 
TSX Col 34: ' ' -> Svelte L4:C22 
TSX Col 35: '=' -> Svelte L4:C22 
TSX Col 36: ' ' -> Svelte L4:C22 
TSX Col 37: 'n' -> Svelte L4:C22 
TSX Col 38: 'u' -> Svelte L4:C22 
TSX Col 39: 'l' -> Svelte L4:C22 
TSX Col 40: 'l' -> Svelte L4:C22 
TSX Col 41: '}' -> Svelte L4:C22 
TSX Col 42: ' ' -> Svelte L4:C22 
TSX Col 43: 'e' -> Svelte L4:C22 
TSX Col 44: 'l' -> Svelte L4:C22 
TSX Col 45: 's' -> Svelte L4:C22 
TSX Col 46: 'e' -> Svelte L4:C22 
TSX Col 47: ' ' -> Svelte L4:C22 
TSX Col 48: 'r' -> Svelte L4:C22 
TSX Col 49: 'e' -> Svelte L4:C22 
TSX Col 50: 'f' -> Svelte L4:C22 
TSX Col 51: ' ' -> Svelte L4:C22 
TSX Col 52: '=' -> Svelte L4:C22 
TSX Col 53: ' ' -> Svelte L4:C22 
TSX Col 54: 'q' -> Svelte L4:C39 
TSX Col 55: 'u' -> Svelte L4:C39 
TSX Col 56: 'e' -> Svelte L4:C39 
TSX Col 57: 'r' -> Svelte L4:C39 
TSX Col 58: 'y' -> Svelte L4:C43 
TSX Col 59: ';' -> Svelte L4:C43 
TSX Col 60: 'r' -> Svelte L4:C43 
TSX Col 61: 'e' -> Svelte L4:C43 
TSX Col 62: 't' -> Svelte L4:C43 
TSX Col 63: 'u' -> Svelte L4:C43 
TSX Col 64: 'r' -> Svelte L4:C43 
TSX Col 65: 'n' -> Svelte L4:C43 
TSX Col 66: ' ' -> Svelte L4:C43 
TSX Col 67: 'a' -> Svelte L4:C11 
TSX Col 68: 'b' -> Svelte L4:C11 
TSX Col 69: 'c' -> Svelte L4:C13 
TSX Col 70: ' ' -> Svelte L4:C13 
TSX Col 71: '=' -> Svelte L4:C13 
TSX Col 72: ' ' -> Svelte L4:C13 
TSX Col 73: 'r' -> Svelte L4:C13 
TSX Col 74: 'e' -> Svelte L4:C13 
TSX Col 75: 'f' -> Svelte L4:C13 

=== FINAL OUTPUT ANALYSIS: FORWARD MAPPING (CHARACTER-BY-CHARACTER) FROM SVELTE SOURCE TO FINAL TSX ===
// This shows mapping from the original Svelte file to the final generated TSX code.
Analyzing Svelte line 4: "abc = if abc is query then null else query"
Svelte Col  0: '	' -> null
Svelte Col  1: '	' -> null
Svelte Col  2: 'a' -> TSX L6:C14
Svelte Col  3: 'b' -> TSX L6:C15
Svelte Col  4: 'c' -> TSX L6:C16
Svelte Col  5: ' ' -> TSX L6:C0
Svelte Col  6: '=' -> TSX L6:C1
Svelte Col  7: ' ' -> TSX L6:C1
Svelte Col  8: 'i' -> TSX L6:C1
Svelte Col  9: 'f' -> TSX L6:C1
Svelte Col 10: ' ' -> TSX L6:C1
Svelte Col 11: 'a' -> TSX L6:C67
Svelte Col 12: 'b' -> TSX L6:C68
Svelte Col 13: 'c' -> TSX L6:C69
Svelte Col 14: ' ' -> TSX L6:C76
Svelte Col 15: 'i' -> TSX L6:C18
Svelte Col 16: 's' -> TSX L6:C19
Svelte Col 17: ' ' -> TSX L6:C20
Svelte Col 18: 'q' -> TSX L6:C22
Svelte Col 19: 'u' -> TSX L6:C25
Svelte Col 20: 'e' -> TSX L6:C25
Svelte Col 21: 'r' -> TSX L6:C25
Svelte Col 22: 'y' -> TSX L6:C26
Svelte Col 23: ' ' -> TSX L6:C53
Svelte Col 24: 't' -> TSX L6:C53
Svelte Col 25: 'h' -> TSX L6:C53
Svelte Col 26: 'e' -> TSX L6:C53
Svelte Col 27: 'n' -> TSX L6:C53
Svelte Col 28: ' ' -> TSX L6:C53
Svelte Col 29: 'n' -> TSX L6:C53
Svelte Col 30: 'u' -> TSX L6:C53
Svelte Col 31: 'l' -> TSX L6:C53
Svelte Col 32: 'l' -> TSX L6:C53
Svelte Col 33: ' ' -> TSX L6:C53
Svelte Col 34: 'e' -> TSX L6:C53
Svelte Col 35: 'l' -> TSX L6:C53
Svelte Col 36: 's' -> TSX L6:C53
Svelte Col 37: 'e' -> TSX L6:C53
Svelte Col 38: ' ' -> TSX L6:C53
Svelte Col 39: 'q' -> TSX L6:C54
Svelte Col 40: 'u' -> TSX L6:C57
Svelte Col 41: 'e' -> TSX L6:C57
Svelte Col 42: 'r' -> TSX L6:C57
Svelte Col 43: 'y' -> TSX L6:C58

=== RAW COMPILER ANALYSIS: FORWARD MAPPING FROM SVELTE SOURCE TO RAW CIVET-TS (pre-normalization) ===
// This shows mapping from the Svelte file to the raw, un-normalized TS produced directly by the Civet compiler.
Analyzing Svelte line 4: "		abc = if abc is query then null else query" (as line 3 of snippet)
Svelte Col  0: '	' -> Raw TS L3:C0
Svelte Col  1: '	' -> Raw TS L3:C0
Svelte Col  2: 'a' -> Raw TS L3:C67
Svelte Col  3: 'b' -> Raw TS L3:C67
Svelte Col  4: 'c' -> Raw TS L3:C67
Svelte Col  5: ' ' -> Raw TS L3:C70
Svelte Col  6: '=' -> Raw TS L3:C70
Svelte Col  7: ' ' -> Raw TS L3:C72
Svelte Col  8: 'i' -> Raw TS L3:C10
Svelte Col  9: 'f' -> Raw TS L3:C10
Svelte Col 10: ' ' -> Raw TS L3:C10
Svelte Col 11: 'a' -> Raw TS L3:C13
Svelte Col 12: 'b' -> Raw TS L3:C14
Svelte Col 13: 'c' -> Raw TS L3:C14
Svelte Col 14: ' ' -> Raw TS L3:C17
Svelte Col 15: 'i' -> Raw TS L3:C18
Svelte Col 16: 's' -> Raw TS L3:C18
Svelte Col 17: ' ' -> Raw TS L3:C21
Svelte Col 18: 'q' -> Raw TS L3:C22
Svelte Col 19: 'u' -> Raw TS L3:C22
Svelte Col 20: 'e' -> Raw TS L3:C22
Svelte Col 21: 'r' -> Raw TS L3:C22
Svelte Col 22: 'y' -> Raw TS L3:C22
Svelte Col 23: ' ' -> Raw TS L3:C27
Svelte Col 24: 't' -> Raw TS L3:C27
Svelte Col 25: 'h' -> Raw TS L3:C27
Svelte Col 26: 'e' -> Raw TS L3:C27
Svelte Col 27: 'n' -> Raw TS L3:C27
Svelte Col 28: ' ' -> Raw TS L3:C30
Svelte Col 29: 'n' -> Raw TS L3:C37
Svelte Col 30: 'u' -> Raw TS L3:C37
Svelte Col 31: 'l' -> Raw TS L3:C37
Svelte Col 32: 'l' -> Raw TS L3:C37
Svelte Col 33: ' ' -> Raw TS L3:C42
Svelte Col 34: 'e' -> Raw TS L3:C43
Svelte Col 35: 'l' -> Raw TS L3:C43
Svelte Col 36: 's' -> Raw TS L3:C43
Svelte Col 37: 'e' -> Raw TS L3:C43
Svelte Col 38: ' ' -> Raw TS L3:C47
Svelte Col 39: 'q' -> Raw TS L3:C54
Svelte Col 40: 'u' -> Raw TS L3:C54
Svelte Col 41: 'e' -> Raw TS L3:C54
Svelte Col 42: 'r' -> Raw TS L3:C54
Svelte Col 43: 'y' -> Raw TS L3:C54

=== Checking range for "abc" in "if (abc === query)" ===
Checking "a" in "abc" at TSX L6:C14
It maps to Svelte: L4:C2 (name: null)
    1) should NOT map whitespace after a token to the token itself (range check)

=== Checking range for "abc" in "return abc = ref" ===
Checking space before "abc" at TSX L6:C66
It maps to Svelte: L4:C43 (name: null)
Checking "a" in "abc" at TSX L6:C67
It maps to Svelte: L4:C11 (name: null)
    2) should correctly handle mapping ranges around the assignment `abc`

=== BLEED_CHECK: "= if" segment ===
Analyzing Svelte line 4: "abc = if abc is query then null else query"
Svelte Col  7 (' ') -> 6:1
Svelte Col  8 ('i') -> 6:1
    3) >>> [BLEED_CHECK] Showcase mapping bleed for " = if" and "then null else" segments


  5 passing (51ms)
  3 failing

  1) Complex sourcemap validation for generated code #current
       should NOT map whitespace after a token to the token itself (range check):
     AssertionError [ERR_ASSERTION]: The start of "abc" should map to the "abc" token.
      at Context.<anonymous> (test/civet/- current - 0parseError.test.ts:460:16)
      at processImmediate (node:internal/timers:476:21)

  2) Complex sourcemap validation for generated code #current
       should correctly handle mapping ranges around the assignment `abc`:
     AssertionError [ERR_ASSERTION]: The start of "abc" should map to the "abc" token.
      at Context.<anonymous> (test/civet/- current - 0parseError.test.ts:497:16)
      at processImmediate (node:internal/timers:476:21)

  3) Complex sourcemap validation for generated code #current
       >>> [BLEED_CHECK] Showcase mapping bleed for " = if" and "then null else" segments:

      AssertionError [ERR_ASSERTION]: Bleed detected: multiple Civet columns map to the same TS position 6:1
      + expected - actual

      -false
      +true
      
      at /home/user/Documents/repos/language-tools-civet/packages/svelte2tsx/test/civet/- current - 0parseError.test.ts:535:24
      at Array.forEach (<anonymous>)
      at Context.<anonymous> (test/civet/- current - 0parseError.test.ts:525:19)
      at processImmediate (node:internal/timers:476:21)



/home/user/Documents/repos/language-tools-civet/packages/svelte2tsx:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  svelte2tsx@0.7.35 test-current: `mocha test/test.ts --grep "#current"`
Exit status 3
