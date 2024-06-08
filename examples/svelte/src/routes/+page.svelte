<script lang="ts">
	import { onMount } from 'svelte';
	import { events } from './sse';

	let messages = $state<string[]>([]);

	const client = events.client();
	console.log(client);
	client
		.on('test_msg', (e) => {
			messages.push(e.message);
		})
		.on('test_json', (e) => {
			messages.push('JSON message received');
		})
		.prepare('http://localhost:5173/sse', {
			method: 'POST',
			body: '{}'
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
