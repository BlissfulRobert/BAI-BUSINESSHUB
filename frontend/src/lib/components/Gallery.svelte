<script lang="ts">
  import type { GalleryImage } from '$lib/types/database';
  import { safeKey } from '$lib/utils/keys';

  export let images: GalleryImage[] = [];
  export let selectedCategory: string = 'all';

  let lightboxOpen = false;
  let lightboxIndex = 0;

  $: filteredImages = selectedCategory === 'all'
    ? images
    : images.filter(img => img.category === selectedCategory);

  function openLightbox(index: number) {
    lightboxIndex = index;
    lightboxOpen = true;
  }

  function closeLightbox() {
    lightboxOpen = false;
  }

  function prevImage() {
    lightboxIndex = (lightboxIndex - 1 + filteredImages.length) % filteredImages.length;
  }

  function nextImage() {
    lightboxIndex = (lightboxIndex + 1) % filteredImages.length;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!lightboxOpen) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') prevImage();
    if (e.key === 'ArrowRight') nextImage();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="space-y-6">
  <div class="flex gap-2 flex-wrap">
    {#each ['all', 'room', 'facility', 'event'] as category}
      <button
        on:click={() => selectedCategory = category}
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors
          {selectedCategory === category
            ? 'bg-primary-600 text-white'
            : 'bg-dark-100 text-dark-500 hover:text-dark-900 border border-dark-200'}"
      >
        {category.charAt(0).toUpperCase() + category.slice(1)}
      </button>
    {/each}
  </div>

  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
    {#each filteredImages as image, i (safeKey(image.id, i))}
      <button
        on:click={() => openLightbox(i)}
        class="group aspect-square bg-dark-100 rounded-xl overflow-hidden border border-dark-200 hover:border-primary-600/50 transition-all duration-300 relative"
      >
        <img
          src={image.image_url}
          alt={image.title}
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div class="absolute bottom-0 left-0 right-0 p-3">
            <p class="text-sm font-medium text-white">{image.title}</p>
            {#if image.description}
              <p class="text-xs text-dark-500 mt-0.5 line-clamp-1">{image.description}</p>
            {/if}
          </div>
        </div>
      </button>
    {/each}
  </div>

  {#if filteredImages.length === 0}
    <div class="text-center py-12">
      <p class="text-dark-400">No images in this category yet.</p>
    </div>
  {/if}
</div>

{#if lightboxOpen && filteredImages.length > 0}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
    on:click={closeLightbox}
  >
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="relative max-w-4xl w-full" on:click|stopPropagation>
      <button
        on:click={closeLightbox}
        class="absolute -top-12 right-0 text-white/70 hover:text-white transition-colors"
      >
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <img
        src={filteredImages[lightboxIndex].image_url}
        alt={filteredImages[lightboxIndex].title}
        class="w-full rounded-xl"
      />

      <div class="mt-4 text-center">
        <h3 class="text-lg font-semibold text-white">{filteredImages[lightboxIndex].title}</h3>
        {#if filteredImages[lightboxIndex].description}
          <p class="text-sm text-dark-400 mt-1">{filteredImages[lightboxIndex].description}</p>
        {/if}
      </div>

      {#if filteredImages.length > 1}
        <button
          on:click={prevImage}
          class="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 text-white/70 hover:text-white transition-colors"
        >
          <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          on:click={nextImage}
          class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 text-white/70 hover:text-white transition-colors"
        >
          <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
{/if}
