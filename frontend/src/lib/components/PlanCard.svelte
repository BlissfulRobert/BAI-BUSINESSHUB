<script lang="ts">
	import type { Plan } from '$lib/types/database';

	export let plan: Plan;
	export let selected = false;

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

	<span class="mt-1 text-2xl font-bold">{formatPrice(plan.price)}</span>

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