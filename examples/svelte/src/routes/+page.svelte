<script lang="ts">
	import { onMount } from 'svelte';
	import { events } from './sse';
	import { } from 'river.ts';
	import { RiverClient } from 'river.ts/client';

	let messages = $state<()[]>([]);

	const client = RiverClient.init(events).prepare('http://localhost:5173/sse', {
		method: 'POST'
		// body: '{}'
	});
	console.log(client);
	client
		.on('test_msg', (e) => {
			messages.push(e);
		})
		.on('test_json', (e) => {
			messages.push({message: 'JSON message received'});
		});

	onMount(async () => {
		await client.stream();
	});
</script>

<div>
	{#each messages as message}
		<p>{message.message}</p>
	{/each}
</div>
