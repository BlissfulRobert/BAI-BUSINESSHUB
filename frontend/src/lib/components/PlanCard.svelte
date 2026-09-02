<script lang="ts">
	import type { Plan, Room } from '$lib/types/database';
	import { planReferencePrice } from '$lib/utils/pricing';

	export let plan: Plan;
	export let selected = false;
	export let rooms: Room[] = [];

	function formatPrice(value: number) {
		return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
	}
</script>

<button
	type="button"
	on:click
	aria-pressed={selected}
	class="flex w-full flex-col rounded-xl border p-4 text-left transition {selected
		? 'border-primary-600 bg-primary-600 text-white'
		: 'border-dark-200 bg-white hover:border-primary-300'}"
>
	<div class="flex items-baseline justify-between">
		<span class="font-semibold">{plan.name}</span>
		<span class="text-sm {selected ? 'text-primary-100' : 'text-dark-500'}">{plan.duration_label}</span>
	</div>

	{#if rooms.length > 0}
		<div class="mt-2 space-y-1.5">
			{#each rooms as room}
				<div class="flex items-center justify-between rounded-lg {selected ? 'bg-white/15' : 'bg-dark-50'} px-3 py-2">
					<span class="text-xs font-medium {selected ? 'text-primary-100' : 'text-dark-500'}">{room.name}</span>
					<span class="text-lg font-bold">{formatPrice(planReferencePrice(room, plan))}</span>
				</div>
			{/each}
		</div>
	{:else}
		<span class="mt-1 text-2xl font-bold">{formatPrice(plan.price)}</span>
	{/if}

	{#if plan.description}
		<p class="mt-2 text-sm {selected ? 'text-primary-100' : 'text-dark-500'}">{plan.description}</p>
	{/if}

	{#if plan.features?.length}
		<ul class="mt-3 space-y-1 text-sm {selected ? 'text-primary-50' : 'text-dark-600'}">
			{#each plan.features as feature}
				<li class="flex items-start gap-1.5">
					<span aria-hidden="true">•</span>
					<span>{feature}</span>
				</li>
			{/each}
		</ul>
	{/if}
</button>
