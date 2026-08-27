<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let selectedDate: string = '';
  export let minDate: string = '';

  const dispatch = createEventDispatcher();

  let currentMonth = new Date();
  let calendarDays: Date[] = [];

  $: {
    calendarDays = generateCalendar(currentMonth);
  }

  function generateCalendar(month: Date): Date[] {
    const year = month.getFullYear();
    const m = month.getMonth();
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const days: Date[] = [];

    const startPad = firstDay.getDay();
    for (let i = startPad - 1; i >= 0; i--) {
      days.push(new Date(year, m, -i));
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, m, d));
    }

    return days;
  }

  function prevMonth() {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  }

  function nextMonth() {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  }

  function selectDate(date: Date) {
    const dateStr = date.toISOString().split('T')[0];
    if (isDateDisabled(date)) return;
    selectedDate = dateStr;
    dispatch('select', { date: dateStr });
  }

  function isDateDisabled(date: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateCopy = new Date(date);
    dateCopy.setHours(0, 0, 0, 0);
    return dateCopy < today || date.getMonth() !== currentMonth.getMonth();
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  }

  function isSelected(date: Date): boolean {
    if (!selectedDate) return false;
    return date.toISOString().split('T')[0] === selectedDate;
  }

  $: monthLabel = currentMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
</script>

<div class="card">
  <div class="flex items-center justify-between mb-4">
    <button on:click={prevMonth} class="p-2 hover:bg-dark-700 rounded-lg transition-colors">
      <svg class="w-5 h-5 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
    <h3 class="text-sm font-medium text-white">{monthLabel}</h3>
    <button on:click={nextMonth} class="p-2 hover:bg-dark-700 rounded-lg transition-colors">
      <svg class="w-5 h-5 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  </div>

  <div class="grid grid-cols-7 gap-1 mb-2">
    {#each ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as day}
      <div class="text-center text-xs font-medium text-dark-500 py-2">{day}</div>
    {/each}
  </div>

  <div class="grid grid-cols-7 gap-1">
    {#each calendarDays as date}
      {@const disabled = isDateDisabled(date)}
      {@const selected = isSelected(date)}
      {@const today = isToday(date)}
      <button
        on:click={() => selectDate(date)}
        disabled={disabled}
        class="aspect-square flex items-center justify-center text-sm rounded-lg transition-all duration-200
          {selected
            ? 'bg-primary-600 text-white font-medium'
            : today
              ? 'bg-dark-700 text-primary-400 font-medium'
              : disabled
                ? 'text-dark-600 cursor-not-allowed'
                : 'text-dark-200 hover:bg-dark-700'
          }"
      >
        {date.getDate()}
      </button>
    {/each}
  </div>
</div>
