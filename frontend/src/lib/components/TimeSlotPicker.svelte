<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { generateTimeSlots } from '$lib/utils/dates';

  export let selectedDate: string = '';
  export let selectedTime: string = '';
  export let bookedSlots: string[] = [];

  const dispatch = createEventDispatcher();

  const timeSlots = generateTimeSlots(8, 18, 30);

  function selectTime(slot: string) {
    if (!bookedSlots.includes(slot)) {
      selectedTime = slot;
      dispatch('select', { time: slot });
    }
  }

  function isBooked(slot: string): boolean {
    return bookedSlots.includes(slot);
  }

  function formatTimeLabel(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }
</script>

<div class="space-y-4">
  <div>
    <label class="block text-sm font-medium text-dark-200 mb-2">Select Time</label>
    <div class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {#each timeSlots as slot}
        <button
          on:click={() => selectTime(slot)}
          disabled={isBooked(slot)}
          class="px-3 py-2 text-sm rounded-lg border transition-all duration-200
            {selectedTime === slot
              ? 'bg-primary-600 border-primary-600 text-white'
              : isBooked(slot)
                ? 'bg-dark-800 border-dark-700 text-dark-500 cursor-not-allowed line-through'
                : 'bg-dark-800 border-dark-600 text-dark-200 hover:border-primary-500 hover:text-white'
            }"
        >
          {formatTimeLabel(slot)}
        </button>
      {/each}
    </div>
    <p class="mt-2 text-xs text-dark-500">
      <span class="text-dark-400">Available</span> · 
      <span class="text-primary-400">Selected</span> · 
      <span class="text-dark-600 line-through">Booked</span>
    </p>
  </div>
</div>
