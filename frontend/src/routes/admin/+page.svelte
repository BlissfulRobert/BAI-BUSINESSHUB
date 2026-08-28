<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { user, profile } from '$lib/stores/auth';
  import type { Booking, Room, Profile, Report, GalleryImage, Plan } from '$lib/types/database';
  import { formatDate, formatTime, formatDuration, formatCurrency, getRoomImage } from '$lib/utils/format';
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
    const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);
    if (!error) await loadData();
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

    const { error } = await supabase
      .from('reports')
      .update({
        admin_response: adminResponse,
        status: 'resolved'
      })
      .eq('id', reportToRespond.id);

    responseLoading = false;
    showReportResponseModal = false;

    if (!error) await loadData();
  }

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

  $: filteredBookings = filterStatus === 'all'
    ? bookings
    : bookings.filter(b => b.status === filterStatus);

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
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
    <div class="card">
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
    </div>

    <div class="card">
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
    </div>

    <div class="card">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-gold-500/15 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-dark-900">{pendingMembers.length}</p>
          <p class="text-xs text-dark-500">Pending</p>
        </div>
      </div>
    </div>

    <div class="card">
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
    </div>
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
    <div class="space-y-4">
      {#each [1, 2, 3] as _}
        <div class="card animate-pulse"><div class="h-16 bg-dark-200 rounded"></div></div>
      {/each}
    </div>

  <!-- OVERVIEW TAB -->
  {:else if activeTab === 'overview'}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="card">
        <h3 class="text-lg font-semibold text-dark-900 mb-4">Recent Bookings</h3>
        <div class="space-y-3">
          {#each bookings.slice(0, 5) as booking}
            <div class="flex items-center justify-between py-2 border-b border-dark-200 last:border-0">
              <div>
                <p class="text-sm text-dark-900">{booking.room?.name || 'Room'} - {booking.profile?.full_name || booking.guest_name}</p>
                <p class="text-xs text-dark-500">{formatDate(booking.date)}</p>
              </div>
              <span class={getStatusBadge(booking.status)}>{booking.status}</span>
            </div>
          {/each}
          {#if bookings.length === 0}
            <p class="text-sm text-dark-500 text-center py-4">No bookings yet</p>
          {/if}
        </div>
      </div>

      <div class="space-y-6">
        <div class="card">
          <h3 class="text-lg font-semibold text-dark-900 mb-4">Pending Approvals</h3>
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
          <h3 class="text-lg font-semibold text-dark-900 mb-4">Open Reports</h3>
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

    {#if filteredBookings.length === 0}
      <div class="card text-center py-12"><p class="text-dark-500">No bookings found</p></div>
    {:else}
      <div class="space-y-3">
        {#each filteredBookings as booking (booking.id)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-dark-900">{booking.room?.name || 'Unknown Room'}</h3>
                  <span class={getStatusBadge(booking.status)}>{booking.status}</span>
                </div>
                <p class="text-sm text-dark-500">{booking.profile?.full_name || booking.guest_name} · {booking.guest_email}</p>
                <p class="text-sm text-dark-500">{formatDate(booking.date)} · {formatTime(booking.start_time)} - {formatTime(booking.end_time)}</p>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                {#if booking.status === 'pending'}
                  <button on:click={() => updateBookingStatus(booking.id, 'approved')} class="text-sm text-green-700 hover:text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-100">Approve</button>
                {/if}
                {#if booking.status === 'approved'}
                  <button on:click={() => updateBookingStatus(booking.id, 'paid')} class="text-sm text-blue-700 hover:text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100">Mark Paid</button>
                {/if}
                {#if booking.status === 'paid'}
                  <button on:click={() => updateBookingStatus(booking.id, 'completed')} class="text-sm text-primary-700 hover:text-primary-600 px-3 py-1.5 rounded-lg hover:bg-primary-50">Complete</button>
                {/if}
                {#if booking.status !== 'cancelled'}
                  <button on:click={() => updateBookingStatus(booking.id, 'cancelled')} class="text-sm text-red-600 hover:text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-100">Cancel</button>
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
    <div class="space-y-3">
      {#each members as member (member.id)}
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
                <button on:click={() => approveMember(member.id)} class="text-sm text-green-700 hover:text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-100">
                  Approve
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

  <!-- REPORTS TAB -->
  {:else if activeTab === 'reports'}
    {#if reports.length === 0}
      <div class="card text-center py-12"><p class="text-dark-500">No reports</p></div>
    {:else}
      <div class="space-y-3">
        {#each reports as report (report.id)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-start gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold text-dark-900">{report.subject}</h3>
                  <span class={getReportStatusBadge(report.status)}>{report.status.replace('_', ' ')}</span>
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
                <button on:click={() => openReportResponse(report)} class="text-sm text-primary-700 hover:text-primary-600 px-3 py-1.5 rounded-lg hover:bg-primary-50">
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
