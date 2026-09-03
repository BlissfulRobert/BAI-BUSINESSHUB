<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let isOpen = false;
  export let title: string = '';
  export let size: 'default' | 'lg' = 'default';

  const dispatch = createEventDispatcher();

  function close() {
    isOpen = false;
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    on:click={handleBackdropClick}
  >
    <div class="bg-white border border-dark-200/80 rounded-2xl w-full shadow-2xl {size === 'lg' ? 'max-w-4xl' : 'max-w-2xl'} max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-dark-100 {size === 'lg' ? 'px-8 py-6' : 'px-6 py-5'}">
        <h2 class="text-lg font-bold text-dark-900 tracking-tight">{title}</h2>
        <button on:click={close} class="p-2 hover:bg-dark-100 rounded-lg transition-all duration-200 hover:scale-105">
          <svg class="w-5 h-5 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class={size === 'lg' ? 'p-8' : 'p-6'}>
        <slot />
      </div>
    </div>
  </div>
{/if}
