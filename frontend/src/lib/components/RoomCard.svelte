<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Room } from '$lib/types/database';
	import { getRoomImage } from '$lib/utils/format';

	export let room: Room;

	const dispatch = createEventDispatcher();

	function formatRate(value: number) {
		return new Intl.NumberFormat('en-PH', {
			style: 'currency',
			currency: 'PHP'
		}).format(value);
	}

	function openBooking() {
		dispatch('book', room);
	}

	function handleBooking(event: MouseEvent) {
		// Open the booking modal from anywhere on the card.
		event.preventDefault();
		event.stopPropagation();

		openBooking();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openBooking();
		}
	}
</script>

<div
	role="button"
	tabindex="0"
	on:click={handleBooking}
	on:keydown={handleKeydown}
	class="group block cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-md"
>
	<div class="aspect-[4/3] w-full overflow-hidden bg-slate-100">
		<img
			src={getRoomImage(room.name)}
			alt={room.name}
			class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
		/>
	</div>

	<div class="p-4">
		<div class="flex items-start justify-between gap-2">
			<h3 class="font-semibold text-slate-900">{room.name}</h3>

			<span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
				Up to {room.capacity}
			</span>
		</div>

		<p class="mt-1 text-sm text-slate-500">
			{formatRate(room.price_per_hour)}/hr · {room.layout}
		</p>

		{#if room.description}
			<p class="mt-1 line-clamp-2 text-sm text-slate-500">
				{room.description}
			</p>
		{/if}

		{#if room.amenities?.length || room.equipment?.length}
			<ul class="mt-3 flex flex-wrap gap-1.5">
				{#each [...room.amenities, ...room.equipment] as item}
					<li class="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
						{item}
					</li>
				{/each}
			</ul>
		{/if}

		<span
			class="mt-4 block w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white"
		>
			Book Now
		</span>
	</div>
</div>
