<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { user, profile } from '$lib/stores/auth';
  import type { Booking, Review, Report } from '$lib/types/database';
  import { formatDate, formatTime, formatDuration, formatCurrency } from '$lib/utils/format';
  import Modal from '$lib/components/Modal.svelte';

  let bookings: Booking[] = [];
  let reviews: Review[] = [];
  let reports: Report[] = [];
  let loading = true;
  let activeTab: 'upcoming' | 'past' | 'reviews' | 'reports' = 'upcoming';

  let showReviewModal = false;
  let reviewBooking: Booking | null = null;
  let reviewRating = 5;
  let reviewComment = '';
  let reviewLoading = false;

  let showReportModal = false;
  let reportBooking: Booking | null = null;
  let reportSubject = '';
  let reportDescription = '';
  let reportLoading = false;

  let showRescheduleModal = false;
  let rescheduleBooking: Booking | null = null;
  let rescheduleDate = '';
  let rescheduleTime = '';
  let rescheduleLoading = false;

  $: isLoggedIn = !!$user;

  onMount(async () => {
    if (!isLoggedIn) {
      goto('/auth/login');
      return;
    }
    await loadData();
  });

  async function loadData() {
    const [bookingsRes, reviewsRes, reportsRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('*, room:rooms(*)')
        .eq('user_id', $user!.id)
        .order('date', { ascending: false }),
      supabase
        .from('reviews')
        .select('*, room:rooms(name)')
        .eq('user_id', $user!.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('reports')
        .select('*')
        .eq('user_id', $user!.id)
        .order('created_at', { ascending: false })
    ]);

    bookings = bookingsRes.data ?? [];
    reviews = reviewsRes.data ?? [];
    reports = reportsRes.data ?? [];
    loading = false;
  }

  async function cancelBooking(bookingId: string) {
    if (!confirm('Are you sure you want to cancel this booking? Payment is non-refundable.')) return;

    const { error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId);

    if (!error) await loadData();
  }

  function openReviewModal(booking: Booking) {
    reviewBooking = booking;
    reviewRating = 5;
    reviewComment = '';
    showReviewModal = true;
  }

  async function submitReview() {
    if (!reviewBooking) return;
    reviewLoading = true;

    const { error } = await supabase
      .from('reviews')
      .insert({
        user_id: $user!.id,
        room_id: reviewBooking.room_id,
        booking_id: reviewBooking.id,
        rating: reviewRating,
        comment: reviewComment || null
      });

    reviewLoading = false;
    showReviewModal = false;

    if (!error) await loadData();
  }

  function openReportModal(booking: Booking | null = null) {
    reportBooking = booking;
    reportSubject = '';
    reportDescription = '';
    showReportModal = true;
  }

  async function submitReport() {
    reportLoading = true;

    const { error } = await supabase
      .from('reports')
      .insert({
        user_id: $user!.id,
        booking_id: reportBooking?.id || null,
        subject: reportSubject,
        description: reportDescription
      });

    reportLoading = false;
    showReportModal = false;

    if (!error) await loadData();
  }

  function openRescheduleModal(booking: Booking) {
    rescheduleBooking = booking;
    rescheduleDate = booking.date;
    rescheduleTime = booking.start_time;
    showRescheduleModal = true;
  }

  async function submitReschedule() {
    if (!rescheduleBooking) return;
    rescheduleLoading = true;

    const [h, m] = rescheduleTime.split(':').map(Number);
    const duration = Math.abs(
      (rescheduleBooking.end_time.split(':').map(Number)[0] * 60 + rescheduleBooking.end_time.split(':').map(Number)[1]) -
      (rescheduleBooking.start_time.split(':').map(Number)[0] * 60 + rescheduleBooking.start_time.split(':').map(Number)[1])
    );
    const endMinutes = h * 60 + m + duration;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

    const { error } = await supabase
      .from('bookings')
      .update({
        date: rescheduleDate,
        start_time: rescheduleTime,
        end_time: endTime,
        status: 'pending'
      })
      .eq('id', rescheduleBooking.id);

    rescheduleLoading = false;
    showRescheduleModal = false;

    if (!error) await loadData();
  }

  $: upcomingBookings = bookings.filter(b => {
    const today = new Date().toISOString().split('T')[0];
    return b.date >= today && b.status !== 'cancelled';
  });

  $: pastBookings = bookings.filter(b => {
    const today = new Date().toISOString().split('T')[0];
    return b.date < today || b.status === 'cancelled';
  });

  $: memberTabs = [
    { key: 'upcoming', label: 'Upcoming', count: upcomingBookings.length },
    { key: 'past', label: 'Past', count: pastBookings.length },
    { key: 'reviews', label: 'Reviews', count: reviews.length },
    { key: 'reports', label: 'Reports', count: reports.length },
  ] as { key: 'upcoming' | 'past' | 'reviews' | 'reports'; label: string; count: number }[];

  function getStatusBadge(status: string) {
    switch (status) {
      case 'paid': return 'badge-green';
      case 'pending': case 'approved': return 'badge-yellow';
      case 'cancelled': return 'badge-red';
      case 'completed': return 'badge-blue';
      default: return 'badge-blue';
    }
  }

  function getReportStatusBadge(status: string) {
    switch (status) {
      case 'open': return 'badge-yellow';
      case 'in_progress': return 'badge-blue';
      case 'resolved': return 'badge-green';
      default: return 'badge-blue';
    }
  }
</script>

<svelte:head>
  <title>My Dashboard - BAI Business Hub</title>
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
    <div>
      <h1 class="text-3xl font-bold text-dark-900">My Dashboard</h1>
      <p class="text-dark-500 mt-1">Manage your bookings, reviews, and reports</p>
    </div>
    <button on:click={() => openReportModal()} class="btn-secondary text-sm self-start">
      Report Issue
    </button>
  </div>

  <div class="flex gap-1 bg-dark-100 border border-dark-200 rounded-lg p-1 mb-8 overflow-x-auto">
    {#each memberTabs as tab}
      <button
        on:click={() => activeTab = tab.key}
        class="px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap
          {activeTab === tab.key ? 'bg-primary-600 text-white' : 'text-dark-500 hover:text-dark-900 hover:bg-dark-50'}"
      >
        {tab.label} ({tab.count})
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="space-y-4">
      {#each [1, 2, 3] as _}
        <div class="card animate-pulse">
          <div class="h-20 bg-dark-200 rounded"></div>
        </div>
      {/each}
    </div>
  {:else if activeTab === 'upcoming'}
    {#if upcomingBookings.length === 0}
      <div class="card text-center py-12">
        <svg class="w-12 h-12 text-dark-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 class="text-lg font-medium text-dark-900 mb-2">No upcoming bookings</h3>
        <p class="text-dark-500 mb-6">You don't have any upcoming bookings.</p>
        <a href="/#rooms" class="btn-primary">Browse Rooms</a>
      </div>
    {:else}
      <div class="space-y-4">
        {#each upcomingBookings as booking (booking.id)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="text-lg font-semibold text-dark-900 truncate">{booking.room?.name || 'Unknown Room'}</h3>
                  <span class={getStatusBadge(booking.status)}>{booking.status}</span>
                </div>
                <p class="text-sm text-dark-500">
                  {formatDate(booking.date)} · {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
                </p>
                <p class="text-sm text-dark-500">
                  {formatDuration(booking.start_time, booking.end_time)} · {booking.room ? formatCurrency(booking.room.price_per_hour) : ''}/hr
                </p>
              </div>
              <div class="flex items-center gap-2">
                {#if booking.status === 'pending' || booking.status === 'approved'}
                  <button on:click={() => openRescheduleModal(booking)} class="text-sm text-primary-700 hover:text-primary-600 px-3 py-1.5 rounded-lg hover:bg-primary-50 transition-colors">
                    Reschedule
                  </button>
                {/if}
                {#if booking.status !== 'cancelled'}
                  <button on:click={() => cancelBooking(booking.id)} class="text-sm text-red-600 hover:text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors">
                    Cancel
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  {:else if activeTab === 'past'}
    {#if pastBookings.length === 0}
      <div class="card text-center py-12">
        <h3 class="text-lg font-medium text-dark-900 mb-2">No past bookings</h3>
        <p class="text-dark-500">Your completed and cancelled bookings will appear here.</p>
      </div>
    {:else}
      <div class="space-y-4">
        {#each pastBookings as booking (booking.id)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="text-lg font-semibold text-dark-900 truncate">{booking.room?.name || 'Unknown Room'}</h3>
                  <span class={getStatusBadge(booking.status)}>{booking.status}</span>
                </div>
                <p class="text-sm text-dark-500">
                  {formatDate(booking.date)} · {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
                </p>
              </div>
              <div class="flex items-center gap-2">
                {#if booking.status === 'completed' || booking.status === 'paid'}
                  <button on:click={() => openReviewModal(booking)} class="text-sm text-primary-700 hover:text-primary-600 px-3 py-1.5 rounded-lg hover:bg-primary-50 transition-colors">
                    Leave Review
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  {:else if activeTab === 'reviews'}
    {#if reviews.length === 0}
      <div class="card text-center py-12">
        <h3 class="text-lg font-medium text-dark-900 mb-2">No reviews yet</h3>
        <p class="text-dark-500">Complete a booking to leave a review.</p>
      </div>
    {:else}
      <div class="space-y-4">
        {#each reviews as review (review.id)}
          <div class="card">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0">
                <div class="flex items-center gap-0.5">
                  {#each Array(5) as _, i}
                    <svg class="w-4 h-4 {i < review.rating ? 'text-gold-500' : 'text-dark-300'}" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  {/each}
                </div>
              </div>
              <div class="flex-1">
                <p class="text-sm text-dark-900 font-medium">{review.room?.name || 'Room'}</p>
                {#if review.comment}
                  <p class="text-sm text-dark-700 mt-1">{review.comment}</p>
                {/if}
                <p class="text-xs text-dark-500 mt-2">{formatDate(review.created_at)}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  {:else if activeTab === 'reports'}
    {#if reports.length === 0}
      <div class="card text-center py-12">
        <h3 class="text-lg font-medium text-dark-900 mb-2">No reports</h3>
        <p class="text-dark-500 mb-6">You haven't submitted any reports yet.</p>
        <button on:click={() => openReportModal()} class="btn-primary">Submit a Report</button>
      </div>
    {:else}
      <div class="space-y-4">
        {#each reports as report (report.id)}
          <div class="card">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-dark-900">{report.subject}</h3>
                  <span class={getReportStatusBadge(report.status)}>{report.status.replace('_', ' ')}</span>
                </div>
                <p class="text-sm text-dark-600 line-clamp-2">{report.description}</p>
                {#if report.admin_response}
                  <div class="mt-3 p-3 bg-dark-100 border border-dark-200 rounded-lg">
                    <p class="text-xs text-dark-500 mb-1">Admin Response:</p>
                    <p class="text-sm text-dark-700">{report.admin_response}</p>
                  </div>
                {/if}
                <p class="text-xs text-dark-500 mt-2">{formatDate(report.created_at)}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Review Modal -->
<Modal isOpen={showReviewModal} title="Leave a Review" on:close={() => showReviewModal = false}>
  {#if reviewBooking}
    <form on:submit|preventDefault={submitReview} class="space-y-4">
      <div class="bg-dark-50 border border-dark-200 rounded-lg p-3">
        <p class="text-sm text-dark-600">{reviewBooking.room?.name}</p>
        <p class="text-sm text-dark-900">{formatDate(reviewBooking.date)}</p>
      </div>

      <div>
        <span class="block text-sm font-medium text-dark-700 mb-2">Rating</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Rating">
          {#each [1, 2, 3, 4, 5] as star}
            <button type="button" role="radio" aria-checked={reviewRating === star} aria-label={`${star} star${star > 1 ? 's' : ''}`} on:click={() => reviewRating = star} class="p-0.5">
              <svg class="w-8 h-8 {star <= reviewRating ? 'text-gold-500' : 'text-dark-300'}" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <label for="review-comment" class="block text-sm font-medium text-dark-700 mb-1">Comment <span class="text-dark-500">(optional)</span></label>
        <textarea id="review-comment" bind:value={reviewComment} class="input" rows="3" placeholder="Share your experience..."></textarea>
      </div>

      <div class="flex gap-3 pt-2">
        <button type="button" on:click={() => showReviewModal = false} class="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={reviewLoading} class="btn-primary flex-1">
          {reviewLoading ? 'Submitting...' : 'Submit Review'}
        </button>
      </div>
    </form>
  {/if}
</Modal>

<!-- Report Modal -->
<Modal isOpen={showReportModal} title="Submit a Report" on:close={() => showReportModal = false}>
  <form on:submit|preventDefault={submitReport} class="space-y-4">
    <div>
      <label for="report-subject" class="block text-sm font-medium text-dark-700 mb-1">Subject</label>
      <input id="report-subject" type="text" bind:value={reportSubject} class="input" placeholder="Brief description of the issue" required />
    </div>

    <div>
      <label for="report-description" class="block text-sm font-medium text-dark-700 mb-1">Description</label>
      <textarea id="report-description" bind:value={reportDescription} class="input" rows="4" placeholder="Please provide details about your issue..." required></textarea>
    </div>

    <div class="flex gap-3 pt-2">
      <button type="button" on:click={() => showReportModal = false} class="btn-secondary flex-1">Cancel</button>
      <button type="submit" disabled={reportLoading} class="btn-primary flex-1">
        {reportLoading ? 'Submitting...' : 'Submit Report'}
      </button>
    </div>
  </form>
</Modal>

<!-- Reschedule Modal -->
<Modal isOpen={showRescheduleModal} title="Reschedule Booking" on:close={() => showRescheduleModal = false}>
  {#if rescheduleBooking}
    <form on:submit|preventDefault={submitReschedule} class="space-y-4">
      <div class="bg-dark-50 border border-dark-200 rounded-lg p-3">
        <p class="text-sm text-dark-600">{rescheduleBooking.room?.name}</p>
        <p class="text-sm text-dark-900">Currently: {formatDate(rescheduleBooking.date)}</p>
      </div>

      <div>
        <label for="reschedule-date" class="block text-sm font-medium text-dark-700 mb-1">New Date</label>
        <input id="reschedule-date" type="date" bind:value={rescheduleDate} class="input" required />
      </div>

      <div>
        <label for="reschedule-time" class="block text-sm font-medium text-dark-700 mb-1">New Start Time</label>
        <input id="reschedule-time" type="time" bind:value={rescheduleTime} class="input" required />
      </div>

      <p class="text-xs text-dark-500">
        Your booking will be moved to pending status for re-approval. Payment is non-refundable.
      </p>

      <div class="flex gap-3 pt-2">
        <button type="button" on:click={() => showRescheduleModal = false} class="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={rescheduleLoading} class="btn-primary flex-1">
          {rescheduleLoading ? 'Rescheduling...' : 'Confirm Reschedule'}
        </button>
      </div>
    </form>
  {/if}
</Modal>
