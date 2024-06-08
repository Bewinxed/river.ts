<script lang="ts">
	import { onMount } from 'svelte';
	import { events } from './sse';
	import { RiverStream } from 'river.ts';

	let messages = $state<string[]>([]);

	const client = RiverStream.init(events).prepare('http://localhost:5173/sse', {
		method: 'GET'
		// body: '{}'
	});
	console.log(client);
	client.stream();
	client
		.on('test_msg', (e) => {
			messages.push(e.message);
		})
		.on('test_json', (e) => {
			messages.push('JSON message received');
		});

	onMount(async () => {
		await client.stream();
	});
</script>

<div>
	{#each messages as message}
		<p>{message}</p>
	{/each}
</div>
