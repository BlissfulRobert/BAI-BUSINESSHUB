<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Room } from "$lib/types/database";
  import { getRoomImage } from "$lib/utils/format";

  export let room: Room;

  const dispatch = createEventDispatcher();

  function formatRate(value: number) {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
    }).format(value);
  }

  function openBooking() {
    dispatch("book", room);
  }

  function handleBooking(event: MouseEvent) {
    // Open the booking modal from anywhere on the card.
    event.preventDefault();
    event.stopPropagation();

    openBooking();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
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
  class="group block flex cursor-pointer flex-col overflow-hidden rounded-xl border border-primary-100 bg-white transition hover:border-primary-300 hover:shadow-md"
>
  <div class="aspect-[4/3] w-full overflow-hidden bg-slate-100">
    <img
      src={getRoomImage(room.name)}
      alt={room.name}
      loading="lazy"
      class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
    />
  </div>

  <div class="flex flex-1 flex-col p-4">
    <div class="flex items-start justify-between gap-2">
      <h3 class="font-semibold text-dark-900">{room.name}</h3>

      <span
        class="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700"
      >
        Up to {room.capacity}
      </span>
    </div>

    <p class="mt-1 text-sm text-dark-500">
      {formatRate(room.price_per_hour)}/hr · {room.layout}
    </p>

    {#if room.description}
      <p class="mt-1 line-clamp-2 text-sm text-dark-500">
        {room.description}
      </p>
    {/if}

    {#if room.amenities?.length || room.equipment?.length}
      <ul class="mt-3 flex flex-wrap gap-1.5">
        {#each [...room.amenities, ...room.equipment] as item}
          <li
            class="rounded-md bg-primary-50 px-2 py-1 text-xs text-primary-700"
          >
            {item}
          </li>
        {/each}
      </ul>
    {/if}

  <span
    class="mt-auto block w-full rounded-lg bg-primary-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-primary-700"
  >
      Book Now
    </span>
  </div>
</div>
