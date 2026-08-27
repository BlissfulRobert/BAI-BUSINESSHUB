<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase/client';
  import { user, profile } from '$lib/stores/auth';
  import Calendar from '$lib/components/Calendar.svelte';
  import TimeSlotPicker from '$lib/components/TimeSlotPicker.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import type { Room, Booking, Plan } from '$lib/types/database';
  import { formatCurrency, formatDate, formatTime, formatDuration } from '$lib/utils/format';
  import { getToday } from '$lib/utils/dates';

  let room: Room | null = null;
  let plans: Plan[] = [];
  let loading = true;
  let selectedDate = '';
  let selectedTime = '';
  let duration = 1;
  let bookedSlots: string[] = [];
  let showBookingModal = false;
  let bookingLoading = false;
  let bookingSuccess = false;

  let selectedPlan: Plan | null = null;
  let bookingMode: 'hourly' | 'plan' = 'hourly';

  let guestName = '';
  let guestEmail = '';
  let guestPhone = '';
  let purpose = '';

  $: slug = $page.params.slug;
  $: isLoggedIn = !!$user;
  $: endTime = selectedTime ? calculateEndTime(selectedTime, duration) : '';
  $: totalPrice = bookingMode === 'plan' && selectedPlan
    ? selectedPlan.price
    : room ? room.price_per_hour * duration : 0;

  function calculateEndTime(start: string, dur: number): string {
    const [h, m] = start.split(':').map(Number);
    const totalMinutes = h * 60 + m + dur * 60;
    const endH = Math.floor(totalMinutes / 60);
    const endM = totalMinutes % 60;
    return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  }

  onMount(async () => {
    const [roomRes, plansRes] = await Promise.all([
      supabase.from('rooms').select('*').eq('slug', slug).eq('is_active', true).single(),
      supabase.from('plans').select('*').eq('is_active', true).order('sort_order')
    ]);

    room = roomRes.data;
    plans = plansRes.data ?? [];
    loading = false;

    if (room) {
      selectedDate = getToday();
    }
  });

  async function loadBookedSlots() {
    if (!room || !selectedDate) return;

    const { data } = await supabase
      .from('bookings')
      .select('start_time, end_time')
      .eq('room_id', room.id)
      .eq('date', selectedDate)
      .in('status', ['pending', 'approved', 'paid']);

    bookedSlots = [];
    if (data) {
      data.forEach((booking: any) => {
        const [sh, sm] = booking.start_time.split(':').map(Number);
        const [eh, em] = booking.end_time.split(':').map(Number);
        for (let h = sh; h < eh; h++) {
          for (let m = (h === sh ? sm : 0); m < (h === eh ? em : 60); m += 30) {
            bookedSlots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
          }
        }
      });
    }
  }

  $: if (selectedDate && room) {
    loadBookedSlots();
  }

  function handleDateSelect(e: CustomEvent) {
    selectedDate = e.detail.date;
    selectedTime = '';
  }

  function handleTimeSelect(e: CustomEvent) {
    selectedTime = e.detail.time;
  }

  function proceedToBook() {
    if (!isLoggedIn) {
      goto(`/auth/login?redirect=/rooms/${slug}`);
      return;
    }

    guestName = $profile?.full_name || '';
    guestEmail = $user?.email || '';
    guestPhone = $profile?.phone || '';
    showBookingModal = true;
  }

  async function confirmBooking() {
    if (!room || !selectedDate || !selectedTime) return;

    bookingLoading = true;

    const { error } = await supabase
      .from('bookings')
      .insert({
        room_id: room.id,
        user_id: $user!.id,
        plan_id: selectedPlan?.id || null,
        date: selectedDate,
        start_time: selectedTime,
        end_time: bookingMode === 'plan' && selectedPlan
          ? calculateEndTime(selectedTime, Math.ceil(selectedPlan.duration_hours / (bookingMode === 'plan' ? 1 : 1)))
          : endTime,
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone || null,
        purpose: purpose || null,
        status: 'pending'
      });

    bookingLoading = false;

    if (error) {
      alert('Booking failed: ' + error.message);
      return;
    }

    bookingSuccess = true;
    showBookingModal = false;

    setTimeout(() => {
      goto('/member');
    }, 2000);
  }

  function closeBookingModal() {
    showBookingModal = false;
    bookingSuccess = false;
  }
</script>

<svelte:head>
  <title>{room?.name || 'Room'} - BAI Business Hub</title>
</svelte:head>

{#if loading}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
    <div class="animate-pulse space-y-6">
      <div class="h-8 bg-dark-700 rounded w-1/3"></div>
      <div class="aspect-video bg-dark-700 rounded-xl"></div>
    </div>
  </div>
{:else if !room}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
    <h1 class="text-3xl font-bold text-white mb-4">Room Not Found</h1>
    <p class="text-dark-400 mb-8">The room you're looking for doesn't exist.</p>
    <a href="/" class="btn-primary">Back to Home</a>
  </div>
{:else}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
    <a href="/" class="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white mb-6 transition-colors">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Back to Rooms
    </a>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div class="lg:col-span-2 space-y-8">
        <div>
          <h1 class="text-3xl font-bold text-white mb-2">{room.name}</h1>
          <p class="text-dark-400">{room.layout} · {room.capacity} seats</p>
        </div>

        <div class="aspect-video bg-dark-800 rounded-xl overflow-hidden">
          {#if room.images && room.images.length > 0}
            <img src={room.images[0]} alt={room.name} class="w-full h-full object-cover" />
          {:else}
            <div class="w-full h-full flex items-center justify-center">
              <svg class="w-16 h-16 text-dark-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          {/if}
        </div>

        <div class="card">
          <h2 class="text-xl font-semibold text-white mb-4">About This Room</h2>
          <p class="text-dark-300 leading-relaxed">{room.description}</p>
        </div>

        <div class="card">
          <h2 class="text-xl font-semibold text-white mb-4">Amenities</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {#each room.amenities as amenity}
              <div class="flex items-center gap-2 text-dark-300">
                <svg class="w-5 h-5 text-primary-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <span class="text-sm">{amenity}</span>
              </div>
            {/each}
          </div>
        </div>

        {#if room.equipment && room.equipment.length > 0}
          <div class="card">
            <h2 class="text-xl font-semibold text-white mb-4">Equipment</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {#each room.equipment as item}
                <div class="flex items-center gap-2 text-dark-300">
                  <svg class="w-5 h-5 text-primary-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span class="text-sm">{item}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="space-y-6">
        <div class="card sticky top-24">
          <div class="mb-6">
            <div class="flex items-baseline gap-2">
              <span class="text-3xl font-bold text-primary-400">{formatCurrency(room.price_per_hour)}</span>
              <span class="text-dark-400">/hour</span>
            </div>
          </div>

          <!-- Booking Mode Toggle -->
          {#if plans.length > 0}
            <div class="flex gap-1 bg-dark-700 rounded-lg p-1 mb-6">
              <button
                on:click={() => { bookingMode = 'hourly'; selectedPlan = null; }}
                class="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors
                  {bookingMode === 'hourly' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}"
              >
                Hourly
              </button>
              <button
                on:click={() => bookingMode = 'plan'}
                class="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors
                  {bookingMode === 'plan' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}"
              >
                Plans
              </button>
            </div>
          {/if}

          {#if bookingMode === 'plan'}
            <div class="space-y-3 mb-6">
              {#each plans as plan (plan.id)}
                <button
                  on:click={() => selectedPlan = plan}
                  class="w-full text-left p-3 rounded-lg border transition-all
                    {selectedPlan?.id === plan.id
                      ? 'bg-primary-600/10 border-primary-600'
                      : 'bg-dark-700 border-dark-600 hover:border-dark-500'}"
                >
                  <div class="flex justify-between items-center">
                    <div>
                      <p class="text-sm font-medium text-white">{plan.name}</p>
                      <p class="text-xs text-dark-400">{plan.duration_label}</p>
                    </div>
                    <span class="text-lg font-bold text-primary-400">{formatCurrency(plan.price)}</span>
                  </div>
                </button>
              {/each}
            </div>

            {#if selectedPlan}
              <button on:click={proceedToBook} class="btn-primary w-full py-3">
                {#if !isLoggedIn}
                  Login to Book
                {:else}
                  Book {selectedPlan.name} - {formatCurrency(selectedPlan.price)}
                {/if}
              </button>
            {/if}
          {:else}
            <Calendar selectedDate={selectedDate} on:select={handleDateSelect} />

            {#if selectedDate}
              <div class="mt-6">
                <p class="text-sm text-dark-400 mb-3">{formatDate(selectedDate)}</p>
                <TimeSlotPicker
                  selectedDate={selectedDate}
                  selectedTime={selectedTime}
                  bookedSlots={bookedSlots}
                  on:select={handleTimeSelect}
                />
              </div>
            {/if}

            {#if selectedTime}
              <div class="mt-6 space-y-4">
                <div>
                  <label class="block text-sm font-medium text-dark-200 mb-2">Duration</label>
                  <div class="grid grid-cols-4 gap-2">
                    {#each [1, 2, 3, 4] as hours}
                      <button
                        on:click={() => duration = hours}
                        class="px-3 py-2 text-sm rounded-lg border transition-all
                          {duration === hours
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'bg-dark-800 border-dark-600 text-dark-300 hover:border-dark-500'}"
                      >
                        {hours}hr
                      </button>
                    {/each}
                  </div>
                </div>

                <div class="pt-4 border-t border-dark-700 space-y-2">
                  <div class="flex justify-between text-sm">
                    <span class="text-dark-400">Date</span>
                    <span class="text-white">{formatDate(selectedDate)}</span>
                  </div>
                  <div class="flex justify-between text-sm">
                    <span class="text-dark-400">Time</span>
                    <span class="text-white">{formatTime(selectedTime)} - {formatTime(endTime)}</span>
                  </div>
                  <div class="flex justify-between text-sm">
                    <span class="text-dark-400">Duration</span>
                    <span class="text-white">{duration} hour{duration > 1 ? 's' : ''}</span>
                  </div>
                  <div class="pt-2 border-t border-dark-700 flex justify-between">
                    <span class="text-white font-medium">Total</span>
                    <span class="text-primary-400 font-bold text-xl">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>

                <button on:click={proceedToBook} class="btn-primary w-full py-3">
                  {#if !isLoggedIn}
                    Login to Book
                  {:else}
                    Book Now
                  {/if}
                </button>
              </div>
            {/if}
          {/if}

          <p class="text-xs text-dark-500 mt-4 text-center">
            Payment is made on-site. Cancellations allowed but non-refundable.
          </p>
        </div>
      </div>
    </div>
  </div>
{/if}

<Modal isOpen={showBookingModal} title="Confirm Booking" on:close={closeBookingModal}>
  {#if bookingSuccess}
    <div class="text-center py-4">
      <div class="w-16 h-16 bg-green-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 class="text-xl font-semibold text-white mb-2">Booking Submitted!</h3>
      <p class="text-dark-400">Your booking is pending admin approval. Redirecting to your dashboard...</p>
    </div>
  {:else}
    <form on:submit|preventDefault={confirmBooking} class="space-y-4">
      <div class="bg-dark-800 rounded-lg p-4 mb-4">
        <p class="text-sm text-dark-400">{room?.name}</p>
        {#if bookingMode === 'plan' && selectedPlan}
          <p class="text-sm text-white">{selectedPlan.name} ({selectedPlan.duration_label})</p>
        {:else}
          <p class="text-sm text-white">{formatDate(selectedDate)}</p>
          <p class="text-sm text-white">{formatTime(selectedTime)} - {formatTime(endTime)}</p>
        {/if}
        <p class="text-lg font-bold text-primary-400 mt-2">{formatCurrency(totalPrice)}</p>
      </div>

      <div>
        <label class="block text-sm font-medium text-dark-200 mb-1">Your Name</label>
        <input type="text" bind:value={guestName} class="input" required />
      </div>

      <div>
        <label class="block text-sm font-medium text-dark-200 mb-1">Email</label>
        <input type="email" bind:value={guestEmail} class="input" required />
      </div>

      <div>
        <label class="block text-sm font-medium text-dark-200 mb-1">Phone <span class="text-dark-500">(optional)</span></label>
        <input type="tel" bind:value={guestPhone} class="input" />
      </div>

      <div>
        <label class="block text-sm font-medium text-dark-200 mb-1">Purpose <span class="text-dark-500">(optional)</span></label>
        <input type="text" bind:value={purpose} class="input" placeholder="Client meeting, team workshop, etc." />
      </div>

      <p class="text-xs text-dark-500">
        Your booking will be submitted for admin approval. Payment is made on-site and is non-refundable.
      </p>

      <div class="flex gap-3 pt-2">
        <button type="button" on:click={closeBookingModal} class="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={bookingLoading} class="btn-primary flex-1">
          {#if bookingLoading}
            Submitting...
          {:else}
            Submit Booking
          {/if}
        </button>
      </div>
    </form>
  {/if}
</Modal>
