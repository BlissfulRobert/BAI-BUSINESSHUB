<script lang="ts">
  import type { Room } from '$lib/types/database';
  import { formatCurrency } from '$lib/utils/format';

  export let room: Room;
</script>

<a href="/rooms/{room.slug}" class="card group hover:border-primary-600/50 transition-all duration-300">
  <div class="aspect-video bg-dark-700 rounded-lg overflow-hidden mb-4 relative">
    <img
      src="/{room.name.toLowerCase().includes('meeting') ? 'meeting' : 'office'}.png"
      alt={room.name}
      class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
    />
    <div class="absolute top-3 right-3">
      <span class="badge-blue">{room.capacity} seats</span>
    </div>
  </div>

  <div class="space-y-3">
    <div>
      <h3 class="text-lg font-semibold text-white group-hover:text-primary-400 transition-colors">
        {room.name}
      </h3>
      <p class="text-sm text-dark-400 mt-1">{room.layout}</p>
    </div>

    <p class="text-sm text-dark-300 line-clamp-2">
      {room.description}
    </p>

    <div class="flex flex-wrap gap-2">
      {#each room.amenities.slice(0, 3) as amenity}
        <span class="badge bg-dark-700 text-dark-300 border-dark-600">{amenity}</span>
      {/each}
      {#if room.amenities.length > 3}
        <span class="badge bg-dark-700 text-dark-300 border-dark-600">+{room.amenities.length - 3} more</span>
      {/if}
    </div>

    <div class="pt-3 border-t border-dark-700 flex items-center justify-between">
      <div>
        <span class="text-2xl font-bold text-primary-400">{formatCurrency(room.price_per_hour)}</span>
        <span class="text-sm text-dark-400">/hour</span>
      </div>
      <span class="text-sm text-primary-400 group-hover:text-primary-300 transition-colors">
        Book Now →
      </span>
    </div>
  </div>
</a>
