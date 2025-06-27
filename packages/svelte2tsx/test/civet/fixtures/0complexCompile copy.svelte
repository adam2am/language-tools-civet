<script lang="civet">
	abc:number|null .= 1
	queryFun2 := (query:number) ->
		abc = if abc is query then null else query

	fruits := ['apple', 'banana', 'cherry']
    // First loop, should generate 'i'
	for fruit, index of fruits
		abc = index
</script> 