<script lang="ts">
  import type { Plan } from '$lib/types/database';
  import { formatCurrency } from '$lib/utils/format';

  export let plan: Plan;
  export let highlighted: boolean = false;
</script>

<div class="relative card {highlighted ? 'border-primary-600 ring-1 ring-primary-600/30' : ''} hover:border-primary-600/50 transition-all duration-300">
  {#if highlighted}
    <div class="absolute -top-3 left-1/2 -translate-x-1/2">
      <span class="bg-primary-600 text-white text-xs font-semibold px-3 py-1 rounded-full">Most Popular</span>
    </div>
  {/if}

  <div class="text-center mb-6">
    <h3 class="text-xl font-bold text-white mb-2">{plan.name}</h3>
    <p class="text-sm text-dark-400 mb-4">{plan.description}</p>
    <div class="flex items-baseline justify-center gap-1">
      <span class="text-4xl font-bold text-primary-400">{formatCurrency(plan.price)}</span>
      <span class="text-dark-400">/{plan.duration_label.toLowerCase()}</span>
    </div>
  </div>

  <ul class="space-y-3 mb-8">
    {#each plan.features as feature}
      <li class="flex items-start gap-3">
        <svg class="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        <span class="text-sm text-dark-300">{feature}</span>
      </li>
    {/each}
  </ul>

  <a
    href="/auth/register"
    class="block text-center {highlighted ? 'btn-primary' : 'btn-secondary'} py-3 w-full"
  >
    Get Started
  </a>
</div>
