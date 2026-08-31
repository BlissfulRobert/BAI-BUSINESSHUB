<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { user, profile } from '$lib/stores/auth';
  import type { Booking, Room, Profile, Report, GalleryImage, Plan } from '$lib/types/database';
  import { formatDate, formatTime, formatCurrency, getRoomImage } from '$lib/utils/format';
  import { getStatusMeta, getReportStatusMeta } from '$lib/utils/booking';
  import Modal from '$lib/components/Modal.svelte';

  let bookings: Booking[] = [];
  let rooms: Room[] = [];
  let members: Profile[] = [];
  let reports: Report[] = [];
  let galleryImages: GalleryImage[] = [];
  let plans: Plan[] = [];
  let loading = true;
  const adminTabs: { key: 'overview' | 'bookings' | 'rooms' | 'members' | 'reports' | 'gallery'; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'rooms', label: 'Rooms' },
    { key: 'members', label: 'Members' },
    { key: 'reports', label: 'Reports' },
    { key: 'gallery', label: 'Gallery' },
  ];
  let activeTab: 'overview' | 'bookings' | 'rooms' | 'members' | 'reports' | 'gallery' = 'overview';
  let filterStatus = 'all';

  // Bookings list controls (search / date filter / sort).
  let searchQuery = '';
  let dateFilter = '';
  let sortOrder: 'newest' | 'oldest' = 'newest';

  // Bulk actions selection.
  let selectedBookingIds = new Set<string>();
  let bulkLoading = false;

  async function postApi(path: string, payload: unknown): Promise<boolean> {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  }

  let showImageUploadModal = false;
  let uploadTitle = '';
  let uploadDescription = '';
  let uploadCategory: string = 'room';
  let uploadFile: File | null = null;
  let uploadLoading = false;

  function onUploadFileChange(e: Event) {
    uploadFile = (e.currentTarget as HTMLInputElement).files?.[0] || null;
  }

  let showReportResponseModal = false;
  let reportToRespond: Report | null = null;
  let adminResponse = '';
  let responseLoading = false;

  $: isLoggedIn = !!$user;
  $: isAdmin = $profile?.role === 'admin';

  onMount(async () => {
    if (!isLoggedIn || !isAdmin) {
      goto('/auth/login');
      return;
    }
    await loadData();
  });

  async function loadData() {
    const [bookingsRes, roomsRes, membersRes, reportsRes, galleryRes, plansRes] = await Promise.all([
      supabase.from('bookings').select('*, room:rooms(*), profile:profiles(*)').order('date', { ascending: false }),
      supabase.from('rooms').select('*').order('name'),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('reports').select('*, profile:profiles(full_name, email)').order('created_at', { ascending: false }),
      supabase.from('gallery').select('*').order('sort_order'),
      supabase.from('plans').select('*').order('sort_order')
    ]);

    bookings = bookingsRes.data ?? [];
    rooms = roomsRes.data ?? [];
    members = membersRes.data ?? [];
    reports = reportsRes.data ?? [];
    galleryImages = galleryRes.data ?? [];
    plans = plansRes.data ?? [];
    loading = false;
  }

  async function updateBookingStatus(bookingId: string, status: string) {
    const ok = await postApi('/api/bookings/status', { bookingId, status });
    if (ok) await loadData();
  }

  async function toggleRoomActive(roomId: string, currentStatus: boolean) {
    const { error } = await supabase.from('rooms').update({ is_active: !currentStatus }).eq('id', roomId);
    if (!error) await loadData();
  }

  async function approveMember(memberId: string) {
    const { error } = await supabase.from('profiles').update({ is_approved: true }).eq('id', memberId);
    if (!error) await loadData();
  }

  async function handleImageUpload() {
    if (!uploadFile) return;
    uploadLoading = true;

    const fileName = `${Date.now()}-${uploadFile.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('gallery')
      .upload(fileName, uploadFile);

    if (uploadError) {
      alert('Upload failed: ' + uploadError.message);
      uploadLoading = false;
      return;
    }

    const { data: urlData } = supabase.storage.from('gallery').getPublicUrl(fileName);

    const { error: insertError } = await supabase.from('gallery').insert({
      title: uploadTitle,
      description: uploadDescription || null,
      image_url: urlData.publicUrl,
      category: uploadCategory,
      sort_order: galleryImages.length
    });

    uploadLoading = false;
    showImageUploadModal = false;
    uploadFile = null;
    uploadTitle = '';
    uploadDescription = '';

    if (!insertError) await loadData();
  }

  async function deleteGalleryImage(imageId: string) {
    if (!confirm('Are you sure you want to delete this image?')) return;
    const { error } = await supabase.from('gallery').delete().eq('id', imageId);
    if (!error) await loadData();
  }

  function openReportResponse(report: Report) {
    reportToRespond = report;
    adminResponse = report.admin_response || '';
    showReportResponseModal = true;
  }

  async function submitReportResponse() {
    if (!reportToRespond) return;
    responseLoading = true;

    const ok = await postApi('/api/reports/respond', {
      reportId: reportToRespond.id,
      response: adminResponse
    });

    responseLoading = false;
    showReportResponseModal = false;

    if (ok) await loadData();
  }

  function goToTab(tab: 'overview' | 'bookings' | 'rooms' | 'members' | 'reports' | 'gallery') {
    activeTab = tab;
  }

  $: pendingBookings = bookings.filter(b => b.status === 'pending');

  $: filteredBookings = bookings
    .filter(b => filterStatus === 'all' || b.status === filterStatus)
    .filter(b => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return [b.room?.name, b.profile?.full_name, b.guest_name, b.guest_email]
        .filter(Boolean)
        .some(v => v!.toLowerCase().includes(q));
    })
    .filter(b => !dateFilter || b.date === dateFilter)
    .sort((a, b) => sortOrder === 'newest'
      ? (a.date > b.date ? -1 : a.date < b.date ? 1 : 0)
      : (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  $: filteredMembers = members
    .filter(m => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return [m.full_name, m.email, m.phone].filter(Boolean).some(v => v!.toLowerCase().includes(q));
    });

  $: filteredReports = reports
    .filter(r => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return [r.subject, r.description, r.profile?.full_name].filter(Boolean).some(v => v!.toLowerCase().includes(q));
    });

  $: visibleBookingIds = filteredBookings.map(b => b.id);
  $: allVisibleSelected = visibleBookingIds.length > 0 && visibleBookingIds.every(id => selectedBookingIds.has(id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      visibleBookingIds.forEach(id => selectedBookingIds.delete(id));
    } else {
      visibleBookingIds.forEach(id => selectedBookingIds.add(id));
    }
    selectedBookingIds = new Set(selectedBookingIds);
  }

  function toggleSelectBooking(id: string) {
    if (selectedBookingIds.has(id)) {
      selectedBookingIds.delete(id);
    } else {
      selectedBookingIds.add(id);
    }
    selectedBookingIds = new Set(selectedBookingIds);
  }

  async function bulkUpdateStatus(status: string) {
    if (selectedBookingIds.size === 0) return;
    bulkLoading = true;
    const ok = await postApi('/api/bookings/status', { bookingIds: [...selectedBookingIds], status });
    bulkLoading = false;
    selectedBookingIds = new Set();
    if (ok) await loadData();
  }

  $: todayBookings = bookings.filter(b => {
    const today = new Date().toISOString().split('T')[0];
    return b.date === today && b.status !== 'cancelled';
  });

  $: totalRevenue = bookings
    .filter(b => b.status === 'completed' || b.status === 'paid')
    .reduce((sum, b) => {
      const [sh, sm] = b.start_time.split(':').map(Number);
      const [eh, em] = b.end_time.split(':').map(Number);
      const hours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      return sum + (b.room?.price_per_hour || 0) * hours;
    }, 0);

  $: pendingMembers = members.filter(m => !m.is_approved);
  $: openReports = reports.filter(r => r.status === 'open');
</script>

<svelte:head>
  <title>Admin Panel - BAI Business Hub</title>
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <div class="mb-8 bg-gradient-to-r from-primary-700 to-primary-900 rounded-2xl px-8 py-8">
    <h1 class="text-3xl font-bold text-white">Admin Dashboard</h1>
    <p class="text-primary-100 mt-2">Manage bookings, rooms, members, and content</p>
  </div>

  <!-- Stats Cards -->
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
    <button on:click={() => goToTab('bookings')} class="card text-left hover:shadow-md transition-shadow">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center border border-primary-100">
          <svg class="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-dark-900">{todayBookings.length}</p>
          <p class="text-xs text-dark-500">Today</p>
        </div>
      </div>
    </button>

    <button on:click={() => goToTab('bookings')} class="card text-left hover:shadow-md transition-shadow">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-dark-900">{formatCurrency(totalRevenue)}</p>
          <p class="text-xs text-dark-500">Revenue</p>
        </div>
      </div>
    </button>

    <button on:click={() => { filterStatus = 'pending'; goToTab('bookings'); }} class="card text-left hover:shadow-md transition-shadow">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-gold-500/15 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-dark-900">{pendingBookings.length}</p>
          <p class="text-xs text-dark-500">Pending</p>
        </div>
      </div>
    </button>

    <button on:click={() => goToTab('members')} class="card text-left hover:shadow-md transition-shadow">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-gold-500/15 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-dark-900">{pendingMembers.length}</p>
          <p class="text-xs text-dark-500">Members</p>
        </div>
      </div>
    </button>

    <button on:click={() => goToTab('reports')} class="card text-left hover:shadow-md transition-shadow">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-dark-900">{openReports.length}</p>
          <p class="text-xs text-dark-500">Reports</p>
        </div>
      </div>
    </button>
  </div>

  <!-- Tab Navigation -->
  <div class="flex gap-1 bg-dark-100 border border-dark-200 rounded-lg p-1 mb-8 overflow-x-auto">
    {#each adminTabs as tab}
      <button
        on:click={() => activeTab = tab.key}
        class="px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap
          {activeTab === tab.key ? 'bg-primary-600 text-white' : 'text-dark-500 hover:text-dark-900 hover:bg-dark-50'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="space-y-6" aria-label="Loading admin dashboard">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 animate-pulse">
        {#each [1, 2, 3, 4, 5] as _}
          <div class="card h-[76px] bg-dark-200"></div>
        {/each}
      </div>
      <div class="h-10 bg-dark-200 rounded-lg mb-4 animate-pulse"></div>
      <div class="space-y-4">
        {#each [1, 2, 3] as _}
          <div class="card animate-pulse">
            <div class="h-4 bg-dark-200 rounded w-1/3 mb-3"></div>
            <div class="h-5 bg-dark-200 rounded w-full"></div>
          </div>
        {/each}
      </div>
    </div>

  <!-- OVERVIEW TAB -->
  {:else if activeTab === 'overview'}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-dark-900">Recent Bookings</h3>
          <button on:click={() => goToTab('bookings')} class="text-sm text-primary-700 hover:text-primary-600 font-medium">View all</button>
        </div>
        <div class="space-y-3">
          {#each bookings.slice(0, 5) as booking (booking.id)}
            {@const statusMeta = getStatusMeta(booking.status)}
            <div class="flex items-center justify-between py-2 border-b border-dark-200 last:border-0">
              <div>
                <p class="text-sm text-dark-900">{booking.room?.name || 'Room'} - {booking.profile?.full_name || booking.guest_name}</p>
                <p class="text-xs text-dark-500">{formatDate(booking.date)}</p>
              </div>
              <span class={statusMeta.badgeClass}>{statusMeta.label}</span>
            </div>
          {/each}
          {#if bookings.length === 0}
            <p class="text-sm text-dark-500 text-center py-4">No bookings yet</p>
          {/if}
        </div>
      </div>

      <div class="space-y-6">
        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-dark-900">Pending Approvals</h3>
            <button on:click={() => goToTab('members')} class="text-sm text-primary-700 hover:text-primary-600 font-medium">View all</button>
          </div>
          {#if pendingMembers.length === 0}
            <p class="text-sm text-dark-500">No pending members</p>
          {:else}
            <div class="space-y-3">
              {#each pendingMembers.slice(0, 5) as member}
                <div class="flex items-center justify-between py-2 border-b border-dark-200 last:border-0">
                  <div>
                    <p class="text-sm text-dark-900">{member.full_name}</p>
                    <p class="text-xs text-dark-500">{member.email}</p>
                  </div>
                  <button on:click={() => approveMember(member.id)} class="text-sm text-green-700 hover:text-green-600 px-2 py-1 rounded hover:bg-green-100">
                    Approve
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-dark-900">Open Reports</h3>
            <button on:click={() => goToTab('reports')} class="text-sm text-primary-700 hover:text-primary-600 font-medium">View all</button>
          </div>
          {#if openReports.length === 0}
            <p class="text-sm text-dark-500">No open reports</p>
          {:else}
            <div class="space-y-3">
              {#each openReports.slice(0, 5) as report}
                <div class="flex items-center justify-between py-2 border-b border-dark-200 last:border-0">
                  <div>
                    <p class="text-sm text-dark-900">{report.subject}</p>
                    <p class="text-xs text-dark-500">{report.profile?.full_name || 'Unknown'}</p>
                  </div>
                  <button on:click={() => openReportResponse(report)} class="text-sm text-primary-700 hover:text-primary-600 px-2 py-1 rounded hover:bg-primary-50">
                    Respond
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

  <!-- BOOKINGS TAB -->
  {:else if activeTab === 'bookings'}
    <div class="mb-4 space-y-4">
      <div class="mb-4 flex gap-2 flex-wrap">
        {#each ['all', 'pending', 'approved', 'paid', 'completed', 'cancelled'] as status}
          <button
            on:click={() => filterStatus = status}
            class="px-3 py-1.5 rounded-lg text-sm transition-colors border
              {filterStatus === status ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-dark-200 text-dark-600 hover:bg-dark-100'}"
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            {#if status !== 'all'}
              <span class="ml-1 text-xs">({bookings.filter(b => b.status === status).length})</span>
            {/if}
          </button>
        {/each}
      </div>

      <div class="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div class="relative flex-1 min-w-0 w-full sm:w-auto">
          <svg class="w-4 h-4 text-dark-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            bind:value={searchQuery}
            type="search"
            placeholder="Search room, guest, or email..."
            class="input pl-9"
          />
        </div>
        <input
          bind:value={dateFilter}
          type="date"
          class="input sm:w-44"
          aria-label="Filter by date"
        />
        <select bind:value={sortOrder} class="input sm:w-auto" aria-label="Sort bookings">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        {#if searchQuery || dateFilter}
          <button
            on:click={() => { searchQuery = ''; dateFilter = ''; }}
            class="text-sm text-dark-500 hover:text-dark-700 px-2 py-1.5 rounded-lg hover:bg-dark-100 transition-colors"
          >
            Clear
          </button>
        {/if}
      </div>
    </div>

    {#if selectedBookingIds.size > 0}
      <div class="mb-4 flex items-center gap-2 flex-wrap bg-primary-50 border border-primary-100 rounded-lg px-4 py-3">
        <span class="text-sm font-medium text-primary-900">{selectedBookingIds.size} selected</span>
        <button on:click={() => bulkUpdateStatus('approved')} disabled={bulkLoading} class="btn-ghost-green text-sm">Approve</button>
        <button on:click={() => bulkUpdateStatus('paid')} disabled={bulkLoading} class="btn-ghost-blue text-sm">Mark Paid</button>
        <button on:click={() => bulkUpdateStatus('cancelled')} disabled={bulkLoading} class="btn-ghost-danger text-sm">Cancel</button>
        <button on:click={() => selectedBookingIds = new Set()} class="text-sm text-dark-500 hover:text-dark-700 px-3 py-1.5 rounded-lg hover:bg-dark-100">Clear</button>
      </div>
    {/if}

    {#if filteredBookings.length === 0}
      <div class="card text-center py-12">
        <p class="text-dark-500 mb-6">No bookings found</p>
        <button on:click={() => { searchQuery = ''; dateFilter = ''; filterStatus = 'all'; }} class="btn-secondary">
          Clear filters
        </button>
      </div>
    {:else}
      <div class="space-y-3">
        <div class="flex items-center gap-3 px-1">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            on:change={toggleSelectAll}
            class="w-4 h-4 accent-primary-600"
            aria-label="Select all"
          />
          <span class="text-xs text-dark-500">Select all ({filteredBookings.length})</span>
        </div>
        {#each filteredBookings as booking (booking.id)}
          {@const statusMeta = getStatusMeta(booking.status)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
              <input
                type="checkbox"
                checked={selectedBookingIds.has(booking.id)}
                on:change={() => toggleSelectBooking(booking.id)}
                class="w-4 h-4 accent-primary-600 flex-shrink-0"
                aria-label={`Select ${booking.room?.name || 'booking'}`}
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-dark-900">{booking.room?.name || 'Unknown Room'}</h3>
                  <span class={statusMeta.badgeClass}>{statusMeta.label}</span>
                </div>
                <p class="text-sm text-dark-500">{booking.profile?.full_name || booking.guest_name} · {booking.guest_email}</p>
                <p class="text-sm text-dark-500">{formatDate(booking.date)} · {formatTime(booking.start_time)} - {formatTime(booking.end_time)}</p>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                {#if booking.status === 'pending'}
                  <button on:click={() => updateBookingStatus(booking.id, 'approved')} class="btn-ghost-green text-sm">Approve</button>
                {/if}
                {#if booking.status === 'approved'}
                  <button on:click={() => updateBookingStatus(booking.id, 'paid')} class="btn-ghost-blue text-sm">Mark Paid</button>
                {/if}
                {#if booking.status === 'paid'}
                  <button on:click={() => updateBookingStatus(booking.id, 'completed')} class="btn-ghost-primary text-sm">Complete</button>
                {/if}
                {#if booking.status !== 'cancelled'}
                  <button on:click={() => updateBookingStatus(booking.id, 'cancelled')} class="btn-ghost-danger text-sm">Cancel</button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  <!-- ROOMS TAB -->
  {:else if activeTab === 'rooms'}
    <div class="space-y-3">
      {#each rooms as room (room.id)}
        <div class="card">
          <div class="flex flex-col sm:flex-row sm:items-center gap-4">
            <div class="flex-shrink-0 w-16 h-16 bg-dark-100 border border-dark-200 rounded-lg overflow-hidden">
              <img src={getRoomImage(room.name)} alt={room.name} class="w-full h-full object-cover" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="font-semibold text-dark-900">{room.name}</h3>
                <span class={room.is_active ? 'badge-green' : 'badge-red'}>{room.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <p class="text-sm text-dark-500">{room.capacity} seats · {room.layout} · {formatCurrency(room.price_per_hour)}/hr</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                on:click={() => toggleRoomActive(room.id, room.is_active)}
                class="text-sm {room.is_active ? 'text-gold-600 hover:text-gold-700' : 'text-green-700 hover:text-green-600'} px-3 py-1.5 rounded-lg hover:bg-dark-100 transition-colors"
              >
                {room.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>

  <!-- MEMBERS TAB -->
  {:else if activeTab === 'members'}
    <div class="mb-4 relative max-w-sm">
      <svg class="w-4 h-4 text-dark-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        bind:value={searchQuery}
        type="search"
        placeholder="Search name, email, or phone..."
        class="input pl-9"
      />
    </div>
    {#if filteredMembers.length === 0}
      <div class="card text-center py-12"><p class="text-dark-500">No members found</p></div>
    {:else}
      <div class="space-y-3">
        {#each filteredMembers as member (member.id)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-dark-900">{member.full_name}</h3>
                  <span class={member.is_approved ? 'badge-green' : 'badge-yellow'}>
                    {member.is_approved ? 'Approved' : 'Pending'}
                  </span>
                  <span class="badge bg-dark-100 text-dark-600 border-dark-200">{member.role}</span>
                </div>
                <p class="text-sm text-dark-500">{member.email} · {member.phone || 'No phone'}</p>
                <p class="text-xs text-dark-500">Joined {formatDate(member.created_at)}</p>
              </div>
              <div class="flex items-center gap-2">
                {#if !member.is_approved}
                  <button on:click={() => approveMember(member.id)} class="btn-ghost-green text-sm">
                    Approve
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  <!-- REPORTS TAB -->
  {:else if activeTab === 'reports'}
    <div class="mb-4 relative max-w-sm">
      <svg class="w-4 h-4 text-dark-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        bind:value={searchQuery}
        type="search"
        placeholder="Search subject, description, or reporter..."
        class="input pl-9"
      />
    </div>
    {#if filteredReports.length === 0}
      <div class="card text-center py-12"><p class="text-dark-500">No reports found</p></div>
    {:else}
      <div class="space-y-3">
        {#each filteredReports as report (report.id)}
          {@const reportMeta = getReportStatusMeta(report.status)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-start gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-dark-900">{report.subject}</h3>
                  <span class={reportMeta.badgeClass}>{reportMeta.label}</span>
                </div>
                <p class="text-sm text-dark-500">From: {report.profile?.full_name || 'Unknown'} ({report.profile?.email || ''})</p>
                <p class="text-sm text-dark-700 mt-1">{report.description}</p>
                {#if report.admin_response}
                  <div class="mt-3 p-3 bg-dark-100 border border-dark-200 rounded-lg">
                    <p class="text-xs text-dark-500 mb-1">Your Response:</p>
                    <p class="text-sm text-dark-700">{report.admin_response}</p>
                  </div>
                {/if}
                <p class="text-xs text-dark-500 mt-2">{formatDate(report.created_at)}</p>
              </div>
              <div>
                <button on:click={() => openReportResponse(report)} class="btn-ghost-primary text-sm">
                  {report.admin_response ? 'Update' : 'Respond'}
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  <!-- GALLERY TAB -->
  {:else if activeTab === 'gallery'}
    <div class="flex justify-between items-center mb-6">
      <h3 class="text-lg font-semibold text-dark-900">Gallery Images</h3>
      <button on:click={() => showImageUploadModal = true} class="btn-primary text-sm">
        Upload Image
      </button>
    </div>

    {#if galleryImages.length === 0}
      <div class="card text-center py-12">
        <p class="text-dark-500 mb-4">No images uploaded yet</p>
        <button on:click={() => showImageUploadModal = true} class="btn-primary">Upload First Image</button>
      </div>
    {:else}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {#each galleryImages as image (image.id)}
          <div class="card p-0 overflow-hidden group relative">
            <img src={image.image_url} alt={image.title} class="w-full aspect-square object-cover" />
            <div class="p-3">
              <p class="text-sm font-medium text-dark-900 truncate">{image.title}</p>
              <p class="text-xs text-dark-500 capitalize">{image.category}</p>
            </div>
            <button
              on:click={() => deleteGalleryImage(image.id)}
              class="absolute top-2 right-2 w-8 h-8 bg-red-600/80 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Image Upload Modal -->
<Modal isOpen={showImageUploadModal} title="Upload Image" on:close={() => showImageUploadModal = false}>
  <form on:submit|preventDefault={handleImageUpload} class="space-y-4">
    <div>
      <label for="gallery-image" class="block text-sm font-medium text-dark-700 mb-1">Image</label>
      <input
        id="gallery-image"
        type="file"
        accept="image/*"
        on:change={onUploadFileChange}
        class="input"
        required
      />
    </div>

    <div>
      <label for="gallery-title" class="block text-sm font-medium text-dark-700 mb-1">Title</label>
      <input id="gallery-title" type="text" bind:value={uploadTitle} class="input" placeholder="Image title" required />
    </div>

    <div>
      <label for="gallery-description" class="block text-sm font-medium text-dark-700 mb-1">Description <span class="text-dark-500">(optional)</span></label>
      <input id="gallery-description" type="text" bind:value={uploadDescription} class="input" placeholder="Brief description" />
    </div>

    <div>
      <label for="gallery-category" class="block text-sm font-medium text-dark-700 mb-1">Category</label>
      <select id="gallery-category" bind:value={uploadCategory} class="input">
        <option value="room">Room</option>
        <option value="facility">Facility</option>
        <option value="event">Event</option>
        <option value="general">General</option>
      </select>
    </div>

    <div class="flex gap-3 pt-2">
      <button type="button" on:click={() => showImageUploadModal = false} class="btn-secondary flex-1">Cancel</button>
      <button type="submit" disabled={uploadLoading || !uploadFile} class="btn-primary flex-1">
        {uploadLoading ? 'Uploading...' : 'Upload'}
      </button>
    </div>
  </form>
</Modal>

<!-- Report Response Modal -->
<Modal isOpen={showReportResponseModal} title="Respond to Report" on:close={() => showReportResponseModal = false}>
  {#if reportToRespond}
    <form on:submit|preventDefault={submitReportResponse} class="space-y-4">
      <div class="bg-dark-50 border border-dark-200 rounded-lg p-3">
        <p class="text-sm text-dark-900 font-medium">{reportToRespond.subject}</p>
        <p class="text-sm text-dark-600 mt-1">{reportToRespond.description}</p>
      </div>

      <div>
        <label for="admin-response" class="block text-sm font-medium text-dark-700 mb-1">Your Response</label>
        <textarea id="admin-response" bind:value={adminResponse} class="input" rows="4" placeholder="Write your response..." required></textarea>
      </div>

      <div class="flex gap-3 pt-2">
        <button type="button" on:click={() => showReportResponseModal = false} class="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={responseLoading} class="btn-primary flex-1">
          {responseLoading ? 'Sending...' : 'Send Response'}
        </button>
      </div>
    </form>
  {/if}
</Modal>
