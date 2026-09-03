<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { supabase } from "$lib/supabase/client";
  import { user, profile, isLoading } from "$lib/stores/auth";
  import type {
    Booking,
    Room,
    Profile,
    Report,
    GalleryImage,
    Plan,
    Membership,
    MembershipUsage,
  } from "$lib/types/database";
  import {
    formatDate,
    formatTime,
    formatCurrency,
    getRoomImage,
  } from "$lib/utils/format";
  import { getStatusMeta, getReportStatusMeta } from "$lib/utils/booking";
  import {
    quoteForStoredBooking,
    usageMeter,
    formatMinutes,
  } from "$lib/utils/pricing";
  import { groupBookings, dateRangeLabel } from "$lib/utils/booking-groups";
  import Modal from "$lib/components/Modal.svelte";

  let bookings: Booking[] = [];
  let rooms: Room[] = [];
  let members: Profile[] = [];
  let memberships: Membership[] = [];
  let membershipUsage: MembershipUsage[] = [];
  let reports: Report[] = [];
  let galleryImages: GalleryImage[] = [];
  let plans: Plan[] = [];
  let loading = true;
  const adminTabs: {
    key: "overview" | "bookings" | "rooms" | "members" | "reports" | "gallery";
    label: string;
  }[] = [
    { key: "overview", label: "Overview" },
    { key: "bookings", label: "Bookings" },
    { key: "rooms", label: "Rooms" },
    { key: "members", label: "Members" },
    { key: "gallery", label: "Gallery" },
    { key: "reports", label: "Reports" },
  ];
  let activeTab:
    | "overview"
    | "bookings"
    | "rooms"
    | "members"
    | "reports"
    | "gallery" = "overview";
  let filterStatus = "all";

  // Bookings list controls (search / date filter / sort).
  let searchQuery = "";
  let dateFilter = "";
  let sortOrder: "newest" | "oldest" = "newest";

  // Bulk actions selection.
  let selectedBookingIds = new Set<string>();
  let bulkLoading = false;

  async function postApi(path: string, payload: unknown): Promise<boolean> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  }

  let showImageUploadModal = false;
  let uploadTitle = "";
  let uploadDescription = "";
  let uploadCategory: string = "room";
  let uploadFile: File | null = null;
  let uploadLoading = false;

  function onUploadFileChange(e: Event) {
    uploadFile = (e.currentTarget as HTMLInputElement).files?.[0] || null;
  }

  let showReportResponseModal = false;
  let reportToRespond: Report | null = null;
  let adminResponse = "";
  let responseLoading = false;

  // My Profile modal
  let showProfileModal = false;
  let profileLoading = false;
  let profileMessage: { type: "success" | "error"; text: string } | null = null;
  let pendingPhoneChange = "";
  let pendingEmailChange = "";
  let pendingPasswordChange = "";
  let pendingPasswordConfirm = "";
  let avatarFile: File | null = null;
  $: avatarPreview = avatarFile ? URL.createObjectURL(avatarFile) : "";

  $: isLoggedIn = !!$user;
  $: isAdmin = $profile?.role === "admin";
  $: myProfile = $profile ?? null;

  $: if (!$isLoading && (!isLoggedIn || !isAdmin)) {
    // goto() cannot run during SSR; redirect only after the page hydrates.
    if (browser) goto("/auth/login");
  }

  // Only load data once auth has settled AND the user is an admin. Using a
  // reactive statement (instead of onMount) avoids the refresh hang where
  // onMount runs before the Supabase session has been restored.
  $: if (!$isLoading && isLoggedIn && isAdmin && loading) {
    loadData();
  }

  async function loadData() {
    loading = true;
    try {
      const [
        bookingsRes,
        roomsRes,
        membersRes,
        reportsRes,
        galleryRes,
        plansRes,
        membershipsRes,
        usageRes,
      ] = await Promise.all([
        supabase
          .from("bookings")
          .select("*, room:rooms(*), plan:plans(*), profile:profiles(*)")
          .order("date", { ascending: false }),
        supabase.from("rooms").select("*").order("name"),
        supabase
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("reports")
          .select(
            "*, profile:profiles(full_name, email), booking:bookings(booking_number, date, start_time, end_time)",
          )
          .order("created_at", { ascending: false }),
        supabase.from("gallery").select("*").order("sort_order"),
        supabase.from("plans").select("*").order("sort_order"),
        supabase.from("memberships").select("*"),
        supabase
          .from("membership_usage")
          .select("*")
          .order("period_start", { ascending: false }),
      ]);

      bookings = bookingsRes.data ?? [];
      rooms = roomsRes.data ?? [];
      members = membersRes.data ?? [];
      reports = reportsRes.data ?? [];
      galleryImages = galleryRes.data ?? [];
      plans = plansRes.data ?? [];
      memberships = membershipsRes.data ?? [];
      membershipUsage = usageRes.data ?? [];
    } catch (e) {
      console.error("Failed to load admin data:", e);
    } finally {
      loading = false;
    }
  }

  async function toggleRoomActive(roomId: string, currentStatus: boolean) {
    const { error } = await supabase
      .from("rooms")
      .update({ is_active: !currentStatus })
      .eq("id", roomId);
    if (!error) await loadData();
  }

  async function approveMember(memberId: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ is_approved: true })
      .eq("id", memberId);
    if (!error) await loadData();
  }

  async function grantMembership(memberId: string) {
    const { error } = await supabase.from("memberships").insert({
      user_id: memberId,
      included_conference_hours: 4,
      included_meeting_hours: 4,
      is_active: true,
    });
    if (error) alert("Could not grant membership: " + error.message);
    else await loadData();
  }

  async function revokeMembership(membershipId: string) {
    const { error } = await supabase
      .from("memberships")
      .update({ is_active: false })
      .eq("id", membershipId);
    if (error) alert("Could not revoke membership: " + error.message);
    else await loadData();
  }

  $: membershipFor = (memberId: string) =>
    memberships.find((m) => m.user_id === memberId && m.is_active) ?? null;

  async function handleImageUpload() {
    if (!uploadFile) return;
    uploadLoading = true;

    const fileName = `${Date.now()}-${uploadFile.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("gallery")
      .upload(fileName, uploadFile);

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      uploadLoading = false;
      return;
    }

    const { data: urlData } = supabase.storage
      .from("gallery")
      .getPublicUrl(fileName);

    const { error: insertError } = await supabase.from("gallery").insert({
      title: uploadTitle,
      description: uploadDescription || null,
      image_url: urlData.publicUrl,
      category: uploadCategory,
      sort_order: galleryImages.length,
    });

    uploadLoading = false;
    showImageUploadModal = false;
    uploadFile = null;
    uploadTitle = "";
    uploadDescription = "";

    if (!insertError) await loadData();
  }

  async function deleteGalleryImage(imageId: string) {
    if (!confirm("Are you sure you want to delete this image?")) return;
    const { error } = await supabase.from("gallery").delete().eq("id", imageId);
    if (!error) await loadData();
  }

  function openReportResponse(report: Report) {
    reportToRespond = report;
    adminResponse = report.admin_response || "";
    showReportResponseModal = true;
  }

  async function submitReportResponse() {
    if (!reportToRespond) return;
    responseLoading = true;

    const ok = await postApi("/api/reports/respond", {
      reportId: reportToRespond.id,
      response: adminResponse,
    });

    responseLoading = false;
    showReportResponseModal = false;

    if (ok) await loadData();
  }

  function goToTab(
    tab: "overview" | "bookings" | "rooms" | "members" | "reports" | "gallery",
  ) {
    activeTab = tab;
  }

  $: pendingBookings = bookingGroups.filter((g) => g.status === "pending");

  // Weekly/Monthly bookings create one DB row per date, but they are a single
  // purchase. Group them back into one "series" so the admin sees one card per
  // pass instead of one card per day. See lib/utils/booking-groups.ts.
  interface AdminBookingGroup {
    key: string;
    room?: Room;
    plan?: Plan;
    profile?: { full_name: string; email: string };
    guest_name: string;
    guest_email: string;
    start_time: string;
    end_time: string;
    dates: string[];
    bookings: Booking[];
    status: Booking["status"];
    isSeries: boolean;
    price: number;
  }

  $: bookingGroups = groupBookings(bookings).map<AdminBookingGroup>((g) => {
    const first = g.bookings[0];
    return {
      key: g.key,
      room: g.room,
      plan: g.plan,
      profile: first.profile,
      guest_name: first.guest_name,
      guest_email: first.guest_email,
      start_time: first.start_time,
      end_time: first.end_time,
      dates: g.dates,
      bookings: g.bookings,
      status: g.status,
      isSeries: g.isSeries,
      price: quoteForStoredBooking(first).total,
    };
  });

  $: filteredBookingGroups = bookingGroups
    .filter((g) => filterStatus === "all" || g.status === filterStatus)
    .filter((g) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return [g.room?.name, g.profile?.full_name, g.guest_name, g.guest_email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    })
    .filter((g) => !dateFilter || g.dates.includes(dateFilter))
    .sort((a, b) =>
      sortOrder === "newest"
        ? a.dates[a.dates.length - 1] > b.dates[b.dates.length - 1]
          ? -1
          : a.dates[a.dates.length - 1] < b.dates[b.dates.length - 1]
            ? 1
            : 0
        : a.dates[0] < b.dates[0]
          ? -1
          : a.dates[0] > b.dates[0]
            ? 1
            : 0,
    );

  $: filteredMembers = members.filter((m) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [m.full_name, m.email, m.phone]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  $: filteredReports = reports.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [r.subject, r.description, r.profile?.full_name]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  $: visibleGroupKeys = filteredBookingGroups.map((g) => g.key);
  $: allVisibleSelected =
    visibleGroupKeys.length > 0 &&
    visibleGroupKeys.every((k) => selectedBookingIds.has(k));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      visibleGroupKeys.forEach((k) => selectedBookingIds.delete(k));
    } else {
      visibleGroupKeys.forEach((k) => selectedBookingIds.add(k));
    }
    selectedBookingIds = new Set(selectedBookingIds);
  }

  function toggleSelectGroup(key: string) {
    if (selectedBookingIds.has(key)) {
      selectedBookingIds.delete(key);
    } else {
      selectedBookingIds.add(key);
    }
    selectedBookingIds = new Set(selectedBookingIds);
  }

  function selectedBookingCount(): number {
    return bookingGroups
      .filter((g) => selectedBookingIds.has(g.key))
      .reduce((n, g) => n + g.bookings.length, 0);
  }

  async function bulkUpdateStatus(status: string) {
    if (selectedBookingIds.size === 0) return;
    const ids = bookingGroups
      .filter((g) => selectedBookingIds.has(g.key))
      .flatMap((g) => g.bookings.map((b) => b.id));
    bulkLoading = true;
    const ok = await postApi("/api/bookings/status", {
      bookingIds: ids,
      status,
    });
    bulkLoading = false;
    selectedBookingIds = new Set();
    if (ok) await loadData();
  }

  async function updateGroupStatus(group: AdminBookingGroup, status: string) {
    const ok = await postApi("/api/bookings/status", {
      bookingIds: group.bookings.map((b) => b.id),
      status,
    });
    if (ok) await loadData();
  }

  $: todayBookings = bookings.filter((b) => {
    const today = new Date().toISOString().split("T")[0];
    return b.date === today && b.status !== "cancelled";
  });

  $: totalRevenue = (() => {
    // Price each booking with the same rules as the member quote (per-room
    // weekly/monthly rates etc.) via quoteForStoredBooking. Weekly/Monthly
    // create one bookings row per day, so charge each series only once —
    // group rows by plan+room for those plans and by booking id otherwise.
    const seen = new Set<string>();
    return bookings
      .filter((b) => b.status === "completed" || b.status === "paid")
      .reduce((sum, b) => {
        const slug = b.plan?.slug;
        const seriesKey =
          slug === "weekly" || slug === "monthly"
            ? `${b.plan_id ?? ""}::${b.room_id}`
            : b.id;
        if (seen.has(seriesKey)) return sum;
        seen.add(seriesKey);
        return sum + quoteForStoredBooking(b).total;
      }, 0);
  })();

  $: pendingMembers = members.filter((m) => !m.is_approved);
  $: openReports = reports.filter((r) => r.status === "open");

  // ----- Admin notification dots (bookings / reports) -----
  // A group is "unseen" when any of its booking rows hasn't been viewed/acted
  // on yet. Weekly/Monthly series collapse into one group, so a single red
  // dot/notification represents the whole series.
  $: unseenBookingGroups = bookingGroups.filter((g) => hasUnseenBookings(g));
  $: unseenReports = reports.filter((r) => !r.is_seen);

  function hasUnseenBookings(group: AdminBookingGroup): boolean {
    return group.bookings.some((b) => !b.is_seen);
  }

  // Number of unseen booking groups in a given status, for the status filter
  // button badges. Statuses with new requests get a red dot on their upper
  // right so the admin can jump straight to them.
  $: unseenPerStatus = (status: string) =>
    bookingGroups.filter((g) => g.status === status && hasUnseenBookings(g))
      .length;

  async function markBookingGroupSeen(group: AdminBookingGroup) {
    const ids = group.bookings.map((b) => b.id);
    if (ids.length > 0) {
      const { error } = await supabase
        .from("bookings")
        .update({ is_seen: true })
        .in("id", ids);
      if (error) console.error("markBookingGroupSeen failed:", error);
    }
    await loadData();
  }

  async function markAllBookingsSeen() {
    const ids = unseenBookingGroups.flatMap((g) => g.bookings.map((b) => b.id));
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("bookings")
      .update({ is_seen: true })
      .in("id", ids);
    if (error) console.error("markAllBookingsSeen failed:", error);
    await loadData();
  }

  async function markReportSeen(report: Report) {
    const { error } = await supabase
      .from("reports")
      .update({ is_seen: true })
      .eq("id", report.id);
    if (error) console.error("markReportSeen failed:", error);
    await loadData();
  }

  async function markAllReportsSeen() {
    const ids = unseenReports.map((r) => r.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("reports")
      .update({ is_seen: true })
      .in("id", ids);
    if (error) console.error("markAllReportsSeen failed:", error);
    await loadData();
  }

  // ----- My Profile handlers -----
  function clearProfileMessage() {
    profileMessage = null;
  }

  function withProfileError(action: () => Promise<void>) {
    profileLoading = true;
    profileMessage = null;
    action()
      .catch((e: unknown) => {
        console.error(e);
        profileMessage = {
          type: "error",
          text: (e as Error)?.message || "Something went wrong. Please try again.",
        };
      })
      .finally(() => {
        profileLoading = false;
      });
  }

  async function updatePhone() {
    const phone = pendingPhoneChange.trim();
    if (!phone) return;
    await withProfileError(async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ phone })
        .eq("id", myProfile!.id);
      if (error) throw new Error(error.message);
      pendingPhoneChange = "";
      profileMessage = { type: "success", text: "Phone number updated." };
      await refreshProfile();
    });
  }

  async function updateEmail() {
    const email = pendingEmailChange.trim();
    if (!email) return;
    await withProfileError(async () => {
      const { data, error } = await supabase.auth.updateUser({ email });
      if (error) throw new Error(error.message);
      if (data?.user) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ email })
          .eq("id", myProfile!.id);
        if (profileError) throw new Error(profileError.message);
      }
      pendingEmailChange = "";
      profileMessage = {
        type: "success",
        text: "A confirmation email has been sent. Please verify the new address.",
      };
      await refreshProfile();
    });
  }

  async function updatePassword() {
    if (pendingPasswordChange.length < 6) {
      profileMessage = { type: "error", text: "Password must be at least 6 characters." };
      return;
    }
    if (pendingPasswordChange !== pendingPasswordConfirm) {
      profileMessage = { type: "error", text: "Passwords do not match." };
      return;
    }
    await withProfileError(async () => {
      const { error } = await supabase.auth.updateUser({
        password: pendingPasswordChange,
      });
      if (error) throw new Error(error.message);
      pendingPasswordChange = "";
      pendingPasswordConfirm = "";
      profileMessage = { type: "success", text: "Password changed successfully." };
    });
  }

  async function refreshProfile() {
    if (!myProfile) return;
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", myProfile.id)
      .single();
    if (data) {
      profile.set(data);
    }
  }

  function onAvatarChange(e: Event) {
    avatarFile = (e.currentTarget as HTMLInputElement).files?.[0] || null;
  }

  async function uploadAvatar() {
    if (!avatarFile || !myProfile) return;
    await withProfileError(async () => {
      const fileName = `${myProfile.id}-${Date.now()}-${avatarFile!.name}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, avatarFile!, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: urlData.publicUrl })
        .eq("id", myProfile.id);
      if (updateError) throw new Error(updateError.message);

      avatarFile = null;
      profileMessage = { type: "success", text: "Profile picture updated." };
      await refreshProfile();
    });
  }

  function closeProfileModal() {
    showProfileModal = false;
    profileMessage = null;
    pendingPhoneChange = "";
    pendingEmailChange = "";
    pendingPasswordChange = "";
    pendingPasswordConfirm = "";
    avatarFile = null;
  }

  $: tabBadge = (
    key: "overview" | "bookings" | "rooms" | "members" | "reports" | "gallery",
  ) => {
    if (key === "bookings") return unseenBookingGroups.length;
    if (key === "reports") return unseenReports.length;
    return 0;
  };
</script>

<svelte:head>
  <title>Admin Panel - BAI Business Hub</title>
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
  <!-- Header -->
  <div
    class="mb-8 bg-gradient-to-br from-dark-900 via-primary-950 to-primary-900 rounded-2xl px-8 py-8 relative overflow-hidden"
  >
    <div
      class="absolute inset-0 opacity-[0.04]"
      style="background-image: radial-gradient(circle at 1px 1px, white 1px, transparent 0); background-size: 24px 24px;"
    ></div>
    <div class="relative flex items-start justify-between gap-4">
      <div>
        <h1 class="text-4xl font-bold text-white tracking-tight">
          Admin Dashboard
        </h1>
        <div class="mt-2 h-1 w-16 bg-gold-400 rounded-full"></div>
        <p class="text-primary-200 mt-3 text-sm font-medium">
          Manage bookings, rooms, members, and content
        </p>
      </div>
      <button
        on:click={() => (showProfileModal = true)}
        class="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg backdrop-blur-sm flex-shrink-0"
      >
        {#if myProfile?.avatar_url}
          <img
            src={myProfile.avatar_url}
            alt="Profile"
            class="w-6 h-6 rounded-full object-cover ring-2 ring-gold-400"
          />
        {:else}
          <span
            class="w-6 h-6 rounded-full bg-gold-400 text-primary-900 font-bold text-xs flex items-center justify-center"
          >
            {(myProfile?.full_name || 'A')[0].toUpperCase()}
          </span>
        {/if}
        My Profile
      </button>
    </div>
  </div>

  <!-- Stats Cards -->
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
    <button
      on:click={() => goToTab("bookings")}
      class="text-left border-l-4 border-l-primary-500 bg-primary-50/70 border border-primary-200/60 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 rounded-xl p-5"
    >
      <div class="flex items-center gap-3.5">
        <div
          class="w-11 h-11 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center shadow-sm shadow-primary-500/20"
        >
          <svg
            class="w-5 h-5 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-primary-900 tracking-tight">{todayBookings.length}</p>
          <p class="text-xs text-primary-600 font-medium">Today</p>
        </div>
      </div>
    </button>

    <button
      on:click={() => goToTab("bookings")}
      class="text-left border-l-4 border-l-emerald-500 bg-emerald-50/70 border border-emerald-200/60 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 rounded-xl p-5"
    >
      <div class="flex items-center gap-3.5">
        <div
          class="w-11 h-11 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-sm shadow-emerald-500/20"
        >
          <svg
            class="w-5 h-5 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-emerald-900 tracking-tight">
            {formatCurrency(totalRevenue)}
          </p>
          <p class="text-xs text-emerald-600 font-medium">Revenue</p>
        </div>
      </div>
    </button>

    <button
      on:click={() => {
        filterStatus = "pending";
        goToTab("bookings");
      }}
      class="text-left border-l-4 border-l-amber-500 bg-amber-50/70 border border-amber-200/60 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 rounded-xl p-5"
    >
      <div class="flex items-center gap-3.5">
        <div
          class="w-11 h-11 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center shadow-sm shadow-amber-500/20"
        >
          <svg
            class="w-5 h-5 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div>
              <p class="text-2xl font-bold text-amber-900 tracking-tight">
            {pendingBookings.length}
          </p>
          <p class="text-xs text-amber-600 font-medium">Pending</p>
        </div>
      </div>
    </button>

    <button
      on:click={() => goToTab("members")}
      class="text-left border-l-4 border-l-violet-500 bg-violet-50/70 border border-violet-200/60 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 rounded-xl p-5"
    >
      <div class="flex items-center gap-3.5">
        <div
          class="w-11 h-11 bg-gradient-to-br from-violet-500 to-violet-600 rounded-xl flex items-center justify-center shadow-sm shadow-violet-500/20"
        >
          <svg
            class="w-5 h-5 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-violet-900 tracking-tight">
            {pendingMembers.length}
          </p>
          <p class="text-xs text-violet-600 font-medium">Members</p>
        </div>
      </div>
    </button>

    <button
      on:click={() => goToTab("reports")}
      class="text-left border-l-4 border-l-red-500 bg-red-50/70 border border-red-200/60 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 rounded-xl p-5"
    >
      <div class="flex items-center gap-3.5">
        <div
          class="w-11 h-11 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center shadow-sm shadow-red-500/20"
        >
          <svg
            class="w-5 h-5 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <div>
          <p class="text-2xl font-bold text-red-900 tracking-tight">{openReports.length}</p>
          <p class="text-xs text-red-600 font-medium">Reports</p>
        </div>
      </div>
    </button>
  </div>

  <!-- Tab Navigation -->
  <div
    class="flex gap-1.5 mb-8 overflow-x-auto pb-1 bg-white/70 backdrop-blur-sm border border-dark-200/60 rounded-2xl px-2 py-2"
  >
    {#each adminTabs as tab}
      {@const isActive = activeTab === tab.key}
      {@const tabBg = isActive
        ? (tab.key === 'overview' ? 'bg-primary-50 border-primary-200 text-primary-700 shadow-sm shadow-primary-100/50'
          : tab.key === 'bookings' ? 'bg-primary-50 border-primary-200 text-primary-700 shadow-sm shadow-primary-100/50'
          : tab.key === 'rooms' ? 'bg-primary-50 border-primary-200 text-primary-700 shadow-sm shadow-primary-100/50'
          : tab.key === 'members' ? 'bg-violet-50 border-violet-200 text-violet-700 shadow-sm shadow-violet-100/50'
          : tab.key === 'gallery' ? 'bg-primary-50 border-primary-200 text-primary-700 shadow-sm shadow-primary-100/50'
          : 'bg-red-50 border-red-200 text-red-700 shadow-sm shadow-red-100/50')
        : 'bg-transparent border-transparent text-dark-900 hover:text-dark-700 hover:bg-dark-100/60'}
      <button
        on:click={() => (activeTab = tab.key)}
        class="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all duration-200 whitespace-nowrap relative rounded-xl border
          {tabBg}
          {tab.key === 'reports' ? 'ml-auto' : ''}"
      >
        {#if tab.key === 'overview'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
        {:else if tab.key === 'bookings'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        {:else if tab.key === 'rooms'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        {:else if tab.key === 'members'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
        {:else if tab.key === 'gallery'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        {:else if tab.key === 'reports'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        {/if}
        {tab.label}
        {#if tabBadge(tab.key) > 0}
          <span
            class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shadow-sm"
            title="New notifications"
          >
            {tabBadge(tab.key)}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="space-y-6" aria-label="Loading admin dashboard">
      <div
        class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 animate-pulse"
      >
        {#each [1, 2, 3, 4, 5] as _}
          <div class="card h-[84px] bg-dark-100 border-dark-200/50">
            <div class="flex items-center gap-3.5">
              <div class="w-11 h-11 bg-dark-200 rounded-xl"></div>
              <div class="space-y-1.5">
                <div class="h-6 bg-dark-200 rounded w-14"></div>
                <div class="h-3 bg-dark-200 rounded w-12"></div>
              </div>
            </div>
          </div>
        {/each}
      </div>
      <div class="h-12 bg-dark-100 rounded-xl mb-4 animate-pulse border border-dark-200/50"></div>
      <div class="space-y-4">
        {#each [1, 2, 3] as _}
          <div class="card animate-pulse">
            <div class="flex items-center gap-4">
              <div class="h-4 bg-dark-200 rounded w-4"></div>
              <div class="flex-1 space-y-2.5">
                <div class="h-4 bg-dark-200 rounded w-1/3"></div>
                <div class="h-3.5 bg-dark-200 rounded w-full"></div>
                <div class="h-3.5 bg-dark-200 rounded w-2/3"></div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- OVERVIEW TAB -->
  {:else if activeTab === "overview"}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Recent Bookings — takes 2 cols -->
      <div class="lg:col-span-2 card">
        <div class="flex items-center justify-between mb-5">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </div>
            <div>
              <h3 class="text-sm font-bold text-dark-900 tracking-tight">Recent Bookings</h3>
              <p class="text-xs text-dark-900">{bookings.length} total</p>
            </div>
          </div>
          <button
            on:click={() => goToTab("bookings")}
            class="btn-ghost-primary text-xs"
            >View all
            <svg class="w-3 h-3 ml-0.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
        <div class="space-y-0">
          {#each bookings.slice(0, 6) as booking (booking.id)}
            {@const statusMeta = getStatusMeta(booking.status)}
            <div
              class="flex items-center gap-3 py-2.5 border-b border-dark-100/80 last:border-0 group"
            >
              <div class="w-9 h-9 rounded-full bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center flex-shrink-0">
                <span class="text-xs font-bold text-primary-700">{(booking.profile?.full_name || booking.guest_name || '?')[0].toUpperCase()}</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-dark-800 truncate">
                  {booking.profile?.full_name || booking.guest_name}
                </p>
                <p class="text-xs text-dark-900 truncate">{booking.room?.name || "Room"} · {formatDate(booking.date)}</p>
              </div>
              <span class={statusMeta.badgeClass}>{statusMeta.label}</span>
            </div>
          {/each}
          {#if bookings.length === 0}
            <div class="text-center py-8">
              <div class="w-10 h-10 bg-dark-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg class="w-5 h-5 text-dark-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              </div>
              <p class="text-sm text-dark-900">No bookings yet</p>
            </div>
          {/if}
        </div>
      </div>

      <!-- Right column: Pending + Reports stacked -->
      <div class="space-y-6">
        <!-- Pending Approvals -->
        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                <svg class="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <div>
                <h3 class="text-sm font-bold text-dark-900 tracking-tight">Pending Approvals</h3>
                <p class="text-xs text-dark-900">{pendingMembers.length} waiting</p>
              </div>
            </div>
            <button
              on:click={() => goToTab("members")}
              class="btn-ghost-primary text-xs"
              >View all</button
            >
          </div>
          {#if pendingMembers.length === 0}
            <div class="text-center py-5">
              <div class="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              </div>
              <p class="text-xs text-dark-900">All caught up</p>
            </div>
          {:else}
            <div class="space-y-0">
              {#each pendingMembers.slice(0, 4) as member}
                <div
                  class="flex items-center gap-3 py-2.5 border-b border-dark-100/80 last:border-0"
                >
                  <div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center flex-shrink-0">
                    <span class="text-xs font-bold text-amber-700">{member.full_name[0].toUpperCase()}</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-dark-800 truncate">{member.full_name}</p>
                    <p class="text-xs text-dark-900 truncate">{member.email}</p>
                  </div>
                  <button
                    on:click={() => approveMember(member.id)}
                    class="text-xs font-semibold text-emerald-700 hover:text-emerald-600 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-all"
                  >
                    Approve
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Open Reports -->
        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
              </div>
              <div>
                <h3 class="text-sm font-bold text-dark-900 tracking-tight">Open Reports</h3>
                <p class="text-xs text-dark-900">{openReports.length} open</p>
              </div>
            </div>
            <button
              on:click={() => goToTab("reports")}
              class="btn-ghost-primary text-xs"
              >View all</button
            >
          </div>
          {#if openReports.length === 0}
            <div class="text-center py-5">
              <div class="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              </div>
              <p class="text-xs text-dark-900">No open reports</p>
            </div>
          {:else}
            <div class="space-y-0">
              {#each openReports.slice(0, 4) as report}
                <div
                  class="flex items-center gap-3 py-2.5 border-b border-dark-100/80 last:border-0"
                >
                  <div class="w-8 h-8 rounded-full bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center flex-shrink-0">
                    <svg class="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-dark-800 truncate">{report.subject}</p>
                    <p class="text-xs text-dark-900 truncate">{report.profile?.full_name || "Unknown"}</p>
                  </div>
                  <button
                    on:click={() => openReportResponse(report)}
                    class="text-xs font-semibold text-primary-700 hover:text-primary-600 px-2.5 py-1.5 rounded-lg hover:bg-primary-50 transition-all"
                  >
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
  {:else if activeTab === "bookings"}
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
          <svg class="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-bold text-dark-900 tracking-tight">Booking Management</h3>
          <p class="text-xs text-dark-900">{bookingGroups.length} total &middot; {unseenBookingGroups.length} new</p>
        </div>
      </div>
    </div>

    {#if unseenBookingGroups.length > 0}
      <div class="mb-5 flex items-center justify-between gap-2 bg-gradient-to-r from-red-500 via-red-50 to-red-50 border border-red-200 rounded-xl px-5 py-3.5 shadow-sm shadow-red-100/40">
        <div class="flex items-center gap-2.5">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
          <p class="text-sm font-semibold text-red-800">You have {unseenBookingGroups.length} new booking notification{unseenBookingGroups.length === 1 ? "" : "s"}</p>
        </div>
        <button on:click={markAllBookingsSeen} class="text-sm font-semibold text-red-700 hover:text-red-900 underline underline-offset-2">Mark all as seen</button>
      </div>
    {/if}

    <!-- Sub-tabs: Status filters -->
    <div class="mb-5">
      <div class="flex gap-1.5 p-1.5 bg-gradient-to-r from-white via-primary-50 to-dark-50 border border-primary-100 rounded-2xl w-fit shadow-sm">
        {#each [{ key: "all", label: "All", activeBg: "bg-white text-dark-900 shadow-sm", dot: "" }, { key: "pending", label: "Pending", activeBg: "bg-amber-50 text-amber-800 border-amber-200 shadow-sm shadow-amber-100/50", dot: "bg-amber-400" }, { key: "approved", label: "Approved", activeBg: "bg-emerald-50 text-emerald-800 border-emerald-200 shadow-sm shadow-emerald-100/50", dot: "bg-emerald-400" }, { key: "paid", label: "Paid", activeBg: "bg-blue-50 text-blue-800 border-blue-200 shadow-sm shadow-blue-100/50", dot: "bg-blue-400" }, { key: "completed", label: "Complete", activeBg: "bg-primary-50 text-primary-800 border-primary-200 shadow-sm shadow-primary-100/50", dot: "bg-primary-400" }, { key: "cancelled", label: "Cancelled", activeBg: "bg-red-50 text-red-800 border-red-200 shadow-sm shadow-red-100/50", dot: "bg-red-400" }] as tab}
          {@const isActive = filterStatus === tab.key}
          {@const count = tab.key === "all" ? bookingGroups.length : bookingGroups.filter((g) => g.status === tab.key).length}
          {@const unseen = tab.key === "all" ? unseenBookingGroups.length : unseenPerStatus(tab.key)}
          <button
            on:click={() => { filterStatus = tab.key; }}
            class="relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border border-transparent {isActive ? tab.activeBg : 'text-dark-900 hover:text-dark-700 hover:bg-white/50'}"
          >
            {#if tab.dot}
              <span class="w-2 h-2 rounded-full {tab.dot} flex-shrink-0 {isActive ? 'ring-2 ring-white/60' : ''}"></span>
            {/if}
            <span>{tab.label}</span>
            <span class="text-[10px] opacity-60 {isActive ? 'opacity-80' : ''}">({count})</span>
            {#if unseen > 0}
              <span class="min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none flex items-center justify-center">{unseen}</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Filters row -->
    <div class="!p-4 mb-5 bg-gradient-to-br from-primary-50/80 to-white border border-primary-100 rounded-xl shadow-sm">
      <div class="flex flex-col sm:flex-row gap-2.5">
        <div class="relative flex-1 min-w-0">
          <svg class="w-4 h-4 text-dark-900 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input bind:value={searchQuery} type="search" placeholder="Search room, guest, or email..." class="input !py-2 pl-10 text-sm" />
        </div>
        <input bind:value={dateFilter} type="date" class="input !py-2 sm:w-40 text-sm" aria-label="Filter by date" />
        <select bind:value={sortOrder} class="input !py-2 sm:w-auto text-sm" aria-label="Sort bookings">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        {#if searchQuery || dateFilter || filterStatus !== "all"}
          <button on:click={() => { searchQuery = ""; dateFilter = ""; filterStatus = "all"; }} class="text-xs text-primary-600 hover:text-primary-800 px-3 py-2 rounded-lg hover:bg-primary-100/60 transition-colors font-semibold">Clear all</button>
        {/if}
      </div>
    </div>

    <!-- Bulk actions -->
    {#if selectedBookingIds.size > 0}
      <div class="mb-4 flex items-center gap-3 flex-wrap bg-gradient-to-r from-primary-600 to-primary-500 border border-primary-700 rounded-xl px-5 py-3.5 shadow-md shadow-primary-600/20">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          </div>
          <span class="text-sm font-semibold text-white">{selectedBookingIds.size} group{selectedBookingIds.size === 1 ? "" : "s"} &middot; {selectedBookingCount()} rows</span>
        </div>
        <div class="flex items-center gap-1.5 ml-auto">
          <button on:click={() => bulkUpdateStatus("approved")} disabled={bulkLoading} class="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold text-sm px-3 py-1.5 rounded-lg transition-all shadow-sm">
            <svg class="w-3.5 h-3.5 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            Approve
          </button>
          <button on:click={() => bulkUpdateStatus("paid")} disabled={bulkLoading} class="bg-white text-blue-700 hover:bg-blue-50 font-semibold text-sm px-3 py-1.5 rounded-lg transition-all shadow-sm">
            <svg class="w-3.5 h-3.5 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Mark Paid
          </button>
          <button on:click={() => bulkUpdateStatus("cancelled")} disabled={bulkLoading} class="bg-white text-red-600 hover:bg-red-50 font-semibold text-sm px-3 py-1.5 rounded-lg transition-all shadow-sm">
            <svg class="w-3.5 h-3.5 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            Cancel
          </button>
        </div>
        <button on:click={() => (selectedBookingIds = new Set())} class="text-xs text-white/80 hover:text-white px-2 py-1.5 rounded-md hover:bg-white/10 transition-colors font-medium">Deselect</button>
      </div>
    {/if}

    <!-- Results -->
    {#if filteredBookingGroups.length === 0}
      <div class="text-center py-16 bg-gradient-to-br from-primary-50/80 to-white border border-primary-100 rounded-xl shadow-sm">
        <div class="flex flex-col items-center">
          <div class="w-14 h-14 bg-gradient-to-br from-primary-100 to-primary-200 rounded-2xl flex items-center justify-center mb-4">
            <svg class="w-7 h-7 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </div>
          <p class="text-dark-900 font-semibold mb-1">No bookings found</p>
          <p class="text-dark-900 text-sm mb-4">Try adjusting your filters or check back later</p>
          <button on:click={() => { searchQuery = ""; dateFilter = ""; filterStatus = "all"; }} class="btn-primary text-sm">Clear all filters</button>
        </div>
      </div>
    {:else}
      <!-- Select all bar -->
      <div class="flex items-center justify-between px-1 mb-3">
        <div class="flex items-center gap-2.5">
          <input type="checkbox" checked={allVisibleSelected} on:change={toggleSelectAll} class="w-4 h-4 accent-primary-600 rounded" />
          <span class="text-xs text-dark-900 font-medium">Select all ({filteredBookingGroups.length} groups)</span>
        </div>
        <span class="text-xs text-dark-900">{filteredBookingGroups.length} result{filteredBookingGroups.length === 1 ? "" : "s"}</span>
      </div>

      <!-- Booking cards grouped by date -->
      {@const groupedByDate = (() => {
        const map = new Map();
        for (const group of filteredBookingGroups) {
          const latestDate = group.dates[group.dates.length - 1];
          if (!map.has(latestDate)) map.set(latestDate, []);
          map.get(latestDate).push(group);
        }
        return [...map.entries()].sort((a, b) => sortOrder === "newest" ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
      })()}

      {#each groupedByDate as [date, groups], gi (date)}
        <div class="mb-6">
          <!-- Date header -->
          <div class="flex items-center gap-3 mb-3 px-1">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-md bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
                <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              </div>
              <span class="text-xs font-bold text-primary-700 uppercase tracking-wider">{formatDate(date)}</span>
            </div>
            <div class="flex-1 h-px bg-gradient-to-r from-primary-200 to-transparent"></div>
            <span class="text-[11px] font-semibold text-primary-500">{groups.length} booking{groups.length === 1 ? "" : "s"}</span>
          </div>

          <!-- Cards for this date -->
          <div class="space-y-3">
            {#each groups as group (group.key)}
              {@const statusMeta = getStatusMeta(group.status)}
              {@const unseen = hasUnseenBookings(group)}
              {@const isPending = group.status === 'pending'}
              {@const isApproved = group.status === 'approved'}
              {@const isPaid = group.status === 'paid'}
              {@const isCompleted = group.status === 'completed'}
              {@const isCancelled = group.status === 'cancelled'}
              {@const stripColor = isApproved ? 'from-emerald-500 to-emerald-400' : isPending ? 'from-amber-500 to-amber-400' : isPaid ? 'from-blue-500 to-blue-400' : isCompleted ? 'from-primary-500 to-primary-400' : 'from-red-400 to-red-300'}
              {@const cardBg = isPending ? 'bg-amber-50/40' : isApproved ? 'bg-emerald-50/40' : isPaid ? 'bg-blue-50/40' : isCompleted ? 'bg-primary-50/40' : isCancelled ? 'bg-red-50/40' : ''}
              {@const guestInitials = (group.profile?.full_name || group.guest_name || "G").split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}

              <div class="!p-0 overflow-hidden group rounded-xl border border-dark-200/60 shadow-sm bg-white {cardBg} {unseen ? 'ring-1 ring-red-200 shadow-md shadow-red-100/50' : 'hover:shadow-md hover:border-dark-300/60 transition-all duration-200'}">
                <div class="flex">
                  <!-- Left color strip -->
                  <div class="w-1.5 flex-shrink-0 bg-gradient-to-b {stripColor}"></div>

                  <div class="flex-1 p-5">
                    <div class="flex flex-col lg:flex-row lg:items-start gap-4">
                      <!-- Checkbox -->
                      <input type="checkbox" checked={selectedBookingIds.has(group.key)} on:change={() => toggleSelectGroup(group.key)} class="w-4 h-4 accent-primary-600 flex-shrink-0 rounded mt-0.5" />

                      <!-- Main content -->
                      <div class="flex-1 min-w-0">
                        <!-- Top row: Room name + badges -->
                        <div class="flex items-center gap-2 mb-2.5 flex-wrap">
                          {#if unseen}
                            <span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 animate-pulse" title="New booking"></span>
                          {/if}
                          <h3 class="font-bold text-dark-900 tracking-tight text-base">{group.room?.name || "Unknown Room"}</h3>
                          <span class={statusMeta.badgeClass}>{statusMeta.label}</span>
                          {#if group.plan}
                            <span class="badge bg-violet-100 text-violet-700 border border-violet-200">{group.plan.name}</span>
                          {/if}
                          {#if group.isSeries}
                            <span class="badge bg-primary-100 text-primary-700 border border-primary-200">
                              <svg class="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                              Series
                            </span>
                          {/if}
                        </div>

                        <!-- Info grid -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          <!-- Guest -->
                          <div class="flex items-center gap-2 text-sm">
                            <div class="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                              <span class="text-[10px] font-bold text-white">{guestInitials}</span>
                            </div>
                            <div class="min-w-0">
                              <p class="font-semibold text-dark-800 truncate">{group.profile?.full_name || group.guest_name}</p>
                              <p class="text-xs text-dark-900 truncate">{group.guest_email}</p>
                            </div>
                          </div>

                          <!-- Date/Time -->
                          <div class="flex items-center gap-2 text-sm text-dark-900">
                            <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center flex-shrink-0">
                              <svg class="w-3.5 h-3.5 text-primary-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                            </div>
                            <div>
                              {#if group.isSeries}
                                <p class="font-medium">{dateRangeLabel(group)}</p>
                              {:else}
                                <p class="font-medium">{formatDate(group.dates[0])}</p>
                              {/if}
                              <p class="text-xs text-dark-900">{formatTime(group.start_time)} &ndash; {formatTime(group.end_time)}</p>
                            </div>
                          </div>

                          <!-- Price -->
                          {#if group.plan}
                            <div class="flex items-center gap-2 text-sm">
                              <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center flex-shrink-0">
                                <svg class="w-3.5 h-3.5 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                              </div>
                              <div>
                                <p class="font-bold text-dark-900">{formatCurrency(group.price)}</p>
                                <p class="text-xs text-emerald-600">{group.plan.name}</p>
                              </div>
                            </div>
                          {/if}
                        </div>
                      </div>

                      <!-- Actions column -->
                      <div class="flex items-center gap-1.5 flex-wrap lg:flex-col lg:items-end lg:flex-shrink-0">
                        {#if unseen}
                          <button on:click={() => markBookingGroupSeen(group)} class="text-[11px] text-dark-900 hover:text-dark-900 px-2.5 py-1.5 rounded-lg hover:bg-dark-100 transition-colors font-medium" title="Dismiss notification">
                            <svg class="w-3.5 h-3.5 mr-0.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                            Seen
                          </button>
                        {/if}
                        {#if isPending}
                          <button on:click={() => updateGroupStatus(group, "approved")} class="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-all shadow-sm shadow-emerald-500/30 active:scale-[0.97]">
                            <svg class="w-3.5 h-3.5 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                            Approve
                          </button>
                        {/if}
                        {#if isApproved}
                          <button on:click={() => updateGroupStatus(group, "paid")} class="bg-blue-500 hover:bg-blue-600 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-all shadow-sm shadow-blue-500/30 active:scale-[0.97]">
                            <svg class="w-3.5 h-3.5 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                            Mark Paid
                          </button>
                        {/if}
                        {#if isPaid}
                          <button on:click={() => updateGroupStatus(group, "completed")} class="bg-primary-600 hover:bg-primary-700 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-all shadow-sm shadow-primary-600/30 active:scale-[0.97]">
                            <svg class="w-3.5 h-3.5 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            Complete
                          </button>
                        {/if}
                        {#if !isCancelled}
                          <button on:click={() => updateGroupStatus(group, "cancelled")} class="text-xs text-dark-900 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors font-medium">
                            <svg class="w-3.5 h-3.5 mr-0.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                            Cancel
                          </button>
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}

    <!-- ROOMS TAB -->
  {:else if activeTab === "rooms"}
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
          <svg class="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-bold text-dark-900 tracking-tight">Room Management</h3>
          <p class="text-xs text-dark-900">{rooms.length} rooms &middot; {rooms.filter(r => r.is_active).length} active</p>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each rooms as room (room.id)}
        <div class="card !p-0 overflow-hidden group">
          <div class="h-40 bg-dark-100 overflow-hidden relative">
            <img src={getRoomImage(room.name)} alt={room.name} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
            <div class="absolute bottom-3 left-4 right-4 flex items-end justify-between">
              <h3 class="font-bold text-white text-lg tracking-tight drop-shadow-sm">{room.name}</h3>
              <span class="badge {room.is_active ? 'bg-emerald-500/90 text-white border-0 backdrop-blur-sm' : 'bg-red-500/90 text-white border-0 backdrop-blur-sm'}">{room.is_active ? 'Active' : 'Inactive'}</span>
            </div>
          </div>
          <div class="p-4">
            <div class="flex items-center gap-2 mb-3 flex-wrap">
              <span class="badge bg-dark-100 text-dark-900 border-dark-200 text-xs">
                <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                {room.capacity} seats
              </span>
              <span class="badge bg-dark-100 text-dark-900 border-dark-200 text-xs">
                <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z"/></svg>
                {room.layout}
              </span>
              <span class="badge bg-primary-50 text-primary-700 border border-primary-200 text-xs font-bold">{formatCurrency(room.price_per_hour)}/hr</span>
            </div>
            <button
              on:click={() => toggleRoomActive(room.id, room.is_active)}
              class="w-full text-center text-sm font-semibold py-2 rounded-lg transition-all duration-200 {room.is_active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'}"
            >
              {room.is_active ? "Deactivate Room" : "Activate Room"}
            </button>
          </div>
        </div>
      {/each}
    </div>

    <!-- MEMBERS TAB -->
  {:else if activeTab === "members"}
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
          <svg class="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-bold text-dark-900 tracking-tight">Member Directory</h3>
          <p class="text-xs text-dark-900">{members.length} total &middot; {pendingMembers.length} pending</p>
        </div>
      </div>
    </div>
    <div class="card !p-4 mb-5">
      <div class="relative max-w-sm">
        <svg class="w-4 h-4 text-dark-900 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input bind:value={searchQuery} type="search" placeholder="Search name, email, or phone..." class="input !py-2 pl-10 text-sm" />
      </div>
    </div>
    {#if filteredMembers.length === 0}
      <div class="card text-center py-16">
        <div class="flex flex-col items-center">
          <div class="w-14 h-14 bg-dark-100 rounded-2xl flex items-center justify-center mb-4">
            <svg class="w-7 h-7 text-dark-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          </div>
          <p class="text-dark-900 font-semibold">No members found</p>
        </div>
      </div>
    {:else}
      <div class="space-y-3">
        {#each filteredMembers as member (member.id)}
          {@const mem = membershipFor(member.id)}
          {@const initials = member.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
          <div class="card">
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
              <div class="w-11 h-11 rounded-full bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center flex-shrink-0">
                <span class="text-sm font-bold text-primary-700">{initials}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 class="font-bold text-dark-900 tracking-tight">{member.full_name}</h3>
                  <span class={member.is_approved ? "badge-green" : "badge-yellow"}>{member.is_approved ? "Approved" : "Pending"}</span>
                  <span class="badge bg-dark-100 text-dark-900 border-dark-200">{member.role}</span>
                  {#if mem}
                    <span class="badge bg-amber-50 text-amber-700 border border-amber-200">
                      <svg class="w-3 h-3 mr-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                      Member
                    </span>
                  {/if}
                </div>
                <p class="text-sm text-dark-900">{member.email} &middot; {member.phone || "No phone"}</p>
                <p class="text-xs text-dark-900 mt-0.5">Joined {formatDate(member.created_at)}</p>
              </div>
              <div class="flex items-center gap-2">
                {#if !member.is_approved}
                  <button on:click={() => approveMember(member.id)} class="btn-ghost-green text-sm">Approve</button>
                {:else if member.role !== "admin"}
                  {#if mem}
                    <button on:click={() => revokeMembership(mem.id)} class="btn-ghost-danger text-sm">Revoke</button>
                  {:else}
                    <button on:click={() => grantMembership(member.id)} class="btn-ghost-green text-sm">Grant Membership</button>
                  {/if}
                {/if}
              </div>
            </div>
            {#if mem}
              {@const conf = usageMeter(mem, membershipUsage.filter((u) => u.membership_id === mem.id), "conference-room")}
              {@const meet = usageMeter(mem, membershipUsage.filter((u) => u.membership_id === mem.id), "meeting-room")}
              <div class="grid sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-dark-100">
                <div class="bg-dark-50/80 border border-dark-200/60 rounded-xl p-3.5">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs font-semibold text-dark-900 uppercase tracking-wider">Conference</p>
                    <p class="text-xs font-bold text-dark-800">{conf.remainingLabel}</p>
                  </div>
                  <div class="h-2 bg-dark-200 rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500 {conf.exhausted ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-primary-400 to-primary-600'}" style="width: {Math.min(100, (conf.usedMinutes / conf.includedMinutes) * 100)}%"></div>
                  </div>
                  <p class="text-[11px] text-dark-900 mt-1.5">{conf.usedMinutes > 0 ? "Used " + formatMinutes(conf.usedMinutes) + " this month" : "No usage this month"}</p>
                </div>
                <div class="bg-dark-50/80 border border-dark-200/60 rounded-xl p-3.5">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs font-semibold text-dark-900 uppercase tracking-wider">Meeting</p>
                    <p class="text-xs font-bold text-dark-800">{meet.remainingLabel}</p>
                  </div>
                  <div class="h-2 bg-dark-200 rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500 {meet.exhausted ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-primary-400 to-primary-600'}" style="width: {Math.min(100, (meet.usedMinutes / meet.includedMinutes) * 100)}%"></div>
                  </div>
                  <p class="text-[11px] text-dark-900 mt-1.5">{meet.usedMinutes > 0 ? "Used " + formatMinutes(meet.usedMinutes) + " this month" : "No usage this month"}</p>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- REPORTS TAB -->
  {:else if activeTab === "reports"}
    {#if unseenReports.length > 0}
      <div
        class="mb-4 flex items-center justify-between gap-2 bg-gradient-to-r from-red-50 to-red-50/50 border border-red-200 rounded-xl px-5 py-3.5"
      >
        <div class="flex items-center gap-2.5">
          <span
            class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"
          ></span>
          <p class="text-sm font-semibold text-red-800">
            You have {unseenReports.length} new report{unseenReports.length === 1
              ? ""
              : "s"}
          </p>
        </div>
        <button
          on:click={markAllReportsSeen}
          class="text-sm font-semibold text-red-700 hover:text-red-900 underline underline-offset-2"
          >Mark all as seen</button
        >
      </div>
    {/if}
    <div class="card !p-4 mb-5">
      <div class="relative max-w-sm">
        <svg class="w-4 h-4 text-dark-900 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input bind:value={searchQuery} type="search" placeholder="Search subject, description, or reporter..." class="input !py-2 pl-10 text-sm" />
      </div>
    </div>
    {#if filteredReports.length === 0}
      <div class="card text-center py-16">
        <div class="flex flex-col items-center">
          <div class="w-14 h-14 bg-dark-100 rounded-2xl flex items-center justify-center mb-4">
            <svg class="w-7 h-7 text-dark-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <p class="text-dark-900 font-semibold">No reports found</p>
        </div>
      </div>
    {:else}
      <div class="space-y-3">
        {#each filteredReports as report (report.id)}
          {@const reportMeta = getReportStatusMeta(report.status)}
          <div class="card {report.is_seen ? '' : 'ring-1 ring-red-200 shadow-md shadow-red-100/50'}">
            <div class="flex gap-4">
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center flex-shrink-0">
                <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                  {#if !report.is_seen}
                    <span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 animate-pulse"></span>
                  {/if}
                  <h3 class="font-bold text-dark-900 tracking-tight">{report.subject}</h3>
                  <span class={reportMeta.badgeClass}>{reportMeta.label}</span>
                </div>
                <div class="flex items-center gap-1.5 text-sm text-dark-900 mb-2">
                  <svg class="w-3.5 h-3.5 text-dark-900 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                  <span class="font-medium text-dark-700">{report.profile?.full_name || "Unknown"}</span>
                  <span class="text-dark-900">&middot;</span>
                  <span class="text-dark-900">{report.profile?.email || ""}</span>
                </div>
                {#if report.booking}
                  <div class="inline-flex items-center gap-1.5 bg-dark-50 border border-dark-200/60 rounded-lg px-2.5 py-1 mb-2">
                    <svg class="w-3 h-3 text-dark-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    <span class="text-xs font-semibold text-dark-700">{report.booking.booking_number}</span>
                    <span class="text-xs text-dark-900">{formatDate(report.booking.date)} &middot; {formatTime(report.booking.start_time)}-{formatTime(report.booking.end_time)}</span>
                  </div>
                {/if}
                <p class="text-sm text-dark-900 leading-relaxed">{report.description}</p>
                {#if report.admin_response}
                  <div class="mt-3 bg-primary-50/60 border border-primary-200/40 rounded-xl overflow-hidden">
                    <div class="px-3.5 py-2 bg-primary-100/50 border-b border-primary-200/30">
                      <p class="text-[11px] font-bold text-primary-700 uppercase tracking-wider">Admin Response</p>
                    </div>
                    <div class="p-3.5">
                      <p class="text-sm text-dark-700 leading-relaxed">{report.admin_response}</p>
                    </div>
                  </div>
                {/if}
                <p class="text-xs text-dark-900 mt-2.5">{formatDate(report.created_at)}</p>
              </div>
              <div class="flex flex-col items-end gap-1.5">
                {#if !report.is_seen}
                  <button on:click={() => markReportSeen(report)} class="text-xs text-dark-900 hover:text-dark-900 px-2 py-1 rounded-md hover:bg-dark-100 transition-colors font-medium" title="Dismiss">Dismiss</button>
                {/if}
                <button on:click={() => openReportResponse(report)} class="btn-ghost-primary text-sm">{report.admin_response ? "Update" : "Respond"}</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- GALLERY TAB -->
  {:else if activeTab === "gallery"}
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
          <svg class="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-bold text-dark-900 tracking-tight">Gallery</h3>
          <p class="text-xs text-dark-900">{galleryImages.length} images</p>
        </div>
      </div>
      <button on:click={() => (showImageUploadModal = true)} class="btn-primary text-sm">
        <svg class="w-4 h-4 mr-1.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        Upload
      </button>
    </div>

    {#if galleryImages.length === 0}
      <div class="card text-center py-16">
        <div class="flex flex-col items-center">
          <div class="w-14 h-14 bg-dark-100 rounded-2xl flex items-center justify-center mb-4">
            <svg class="w-7 h-7 text-dark-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </div>
          <p class="text-dark-900 font-semibold mb-1">No images uploaded yet</p>
          <p class="text-dark-900 text-sm mb-4">Start building your gallery</p>
          <button on:click={() => (showImageUploadModal = true)} class="btn-primary">Upload First Image</button>
        </div>
      </div>
    {:else}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {#each galleryImages as image (image.id)}
          <div class="card !p-0 overflow-hidden group relative">
            <div class="aspect-square overflow-hidden bg-dark-100 relative">
              <img src={image.image_url} alt={image.title} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
              <div class="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                <p class="text-sm font-semibold text-white truncate">{image.title}</p>
                <p class="text-xs text-white/70 capitalize">{image.category}</p>
              </div>
              <span class="absolute top-2 left-2 badge bg-black/50 text-white border-0 backdrop-blur-sm text-[10px] uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">{image.category}</span>
              <button
                on:click={() => deleteGalleryImage(image.id)}
                class="absolute top-2 right-2 w-8 h-8 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg backdrop-blur-sm"
              >
                <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="p-3">
              <p class="text-sm font-semibold text-dark-900 truncate">{image.title}</p>
              <p class="text-xs text-dark-900 capitalize">{image.category}</p>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Image Upload Modal -->
<Modal
  isOpen={showImageUploadModal}
  title="Upload Image"
  on:close={() => (showImageUploadModal = false)}
>
  <form on:submit|preventDefault={handleImageUpload} class="space-y-4">
    <div>
      <label
        for="gallery-image"
        class="block text-sm font-semibold text-dark-700 mb-1.5">Image</label
      >
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
      <label
        for="gallery-title"
        class="block text-sm font-semibold text-dark-700 mb-1.5">Title</label
      >
      <input
        id="gallery-title"
        type="text"
        bind:value={uploadTitle}
        class="input"
        placeholder="Image title"
        required
      />
    </div>

    <div>
      <label
        for="gallery-description"
        class="block text-sm font-semibold text-dark-700 mb-1.5"
        >Description <span class="text-dark-900 font-normal">(optional)</span></label
      >
      <input
        id="gallery-description"
        type="text"
        bind:value={uploadDescription}
        class="input"
        placeholder="Brief description"
      />
    </div>

    <div>
      <label
        for="gallery-category"
        class="block text-sm font-semibold text-dark-700 mb-1.5">Category</label
      >
      <select id="gallery-category" bind:value={uploadCategory} class="input">
        <option value="room">Room</option>
        <option value="facility">Facility</option>
        <option value="event">Event</option>
        <option value="general">General</option>
      </select>
    </div>

    <div class="flex gap-3 pt-3">
      <button
        type="button"
        on:click={() => (showImageUploadModal = false)}
        class="btn-secondary flex-1">Cancel</button
      >
      <button
        type="submit"
        disabled={uploadLoading || !uploadFile}
        class="btn-primary flex-1"
      >
        {uploadLoading ? "Uploading..." : "Upload"}
      </button>
    </div>
  </form>
</Modal>

<!-- Report Response Modal -->
<Modal
  isOpen={showReportResponseModal}
  title="Respond to Report"
  on:close={() => (showReportResponseModal = false)}
>
  {#if reportToRespond}
    <form on:submit|preventDefault={submitReportResponse} class="space-y-4">
      <div class="bg-dark-50/80 border border-dark-200/60 rounded-xl p-4">
        <p class="text-sm text-dark-900 font-semibold">
          {reportToRespond.subject}
        </p>
        <p class="text-sm text-dark-900 mt-1 leading-relaxed">{reportToRespond.description}</p>
      </div>

      <div>
        <label
          for="admin-response"
          class="block text-sm font-semibold text-dark-700 mb-1.5"
          >Your Response</label
        >
        <textarea
          id="admin-response"
          bind:value={adminResponse}
          class="input"
          rows="4"
          placeholder="Write your response..."
          required
        ></textarea>
      </div>

      <div class="flex gap-3 pt-3">
        <button
          type="button"
          on:click={() => (showReportResponseModal = false)}
          class="btn-secondary flex-1">Cancel</button
        >
        <button
          type="submit"
          disabled={responseLoading}
          class="btn-primary flex-1"
        >
          {responseLoading ? "Sending..." : "Send Response"}
        </button>
      </div>
    </form>
  {/if}
</Modal>

<!-- My Profile Modal -->
<Modal
  isOpen={showProfileModal}
  title="My Profile"
  on:close={closeProfileModal}
>
  {#if myProfile}
    <div class="space-y-6">
      {#if profileMessage}
        <div
          class="rounded-xl px-4 py-3 text-sm font-medium border {profileMessage.type === 'success'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-red-50 text-red-700 border-red-200'}"
        >
          {profileMessage.text}
        </div>
      {/if}

      <!-- Profile picture (circle) -->
      <div class="flex flex-col items-center gap-3">
        <div class="relative">
          {#if avatarPreview}
            <img
              src={avatarPreview}
              alt="Profile preview"
              class="w-24 h-24 rounded-full object-cover ring-4 ring-primary-100 shadow-lg"
            />
          {:else if myProfile.avatar_url}
            <img
              src={myProfile.avatar_url}
              alt="Profile"
              class="w-24 h-24 rounded-full object-cover ring-4 ring-primary-100 shadow-lg"
            />
          {:else}
            <div
              class="w-24 h-24 rounded-full bg-gradient-to-br from-primary-100 to-primary-200 ring-4 ring-primary-100 shadow-lg flex items-center justify-center"
            >
              <span class="text-3xl font-bold text-primary-700">
                {(myProfile.full_name || 'A')[0].toUpperCase()}
              </span>
            </div>
          {/if}
        </div>
        <p class="text-lg font-bold text-dark-900 tracking-tight">{myProfile.full_name}</p>
        <div class="flex items-center gap-1.5">
          <label
            for="avatar-upload"
            class="cursor-pointer text-xs font-semibold text-primary-700 hover:bg-primary-50 px-3 py-1.5 rounded-lg border border-primary-200 transition-all"
          >
            Change Picture
          </label>
          <input
            id="avatar-upload"
            type="file"
            accept="image/*"
            class="sr-only"
            on:change={onAvatarChange}
          />
          {#if avatarFile}
            <button
              on:click={uploadAvatar}
              disabled={profileLoading}
              class="text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-lg transition-all"
            >
              {profileLoading ? "Saving..." : "Save picture"}
            </button>
          {/if}
        </div>
      </div>

      <!-- Details table -->
      <div class="overflow-hidden border border-dark-200/70 rounded-xl">
        <!-- Email row -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 px-5 py-4 bg-dark-50/60 border-b border-dark-200/70">
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-dark-900 uppercase tracking-wider mb-0.5">Email</p>
            <p class="text-sm font-medium text-dark-800 truncate">{myProfile.email}</p>
          </div>
          <input
            type="email"
            bind:value={pendingEmailChange}
            placeholder="New email"
            class="input !py-1.5 text-xs sm:w-56"
          />
          <button
            on:click={updateEmail}
            disabled={profileLoading || !pendingEmailChange.trim()}
            class="btn-primary text-xs !py-1.5 flex-shrink-0 disabled:opacity-50"
          >Change Email</button>
        </div>

        <!-- Password row -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 px-5 py-4 bg-white border-b border-dark-200/70">
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-dark-900 uppercase tracking-wider mb-0.5">Password</p>
            <p class="text-sm font-medium text-dark-800">••••••••••</p>
          </div>
          <input
            type="password"
            bind:value={pendingPasswordChange}
            placeholder="New password"
            class="input !py-1.5 text-xs sm:w-40"
          />
          <input
            type="password"
            bind:value={pendingPasswordConfirm}
            placeholder="Confirm"
            class="input !py-1.5 text-xs sm:w-28"
          />
          <button
            on:click={updatePassword}
            disabled={profileLoading || !pendingPasswordChange}
            class="btn-primary text-xs !py-1.5 flex-shrink-0 disabled:opacity-50"
          >Change Password</button>
        </div>

        <!-- Phone row -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 px-5 py-4 bg-dark-50/60">
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-dark-900 uppercase tracking-wider mb-0.5">Phone</p>
            <p class="text-sm font-medium text-dark-800 truncate">{myProfile.phone || "Not set"}</p>
          </div>
          <input
            type="tel"
            bind:value={pendingPhoneChange}
            placeholder="New phone number"
            class="input !py-1.5 text-xs sm:w-56"
          />
          <button
            on:click={updatePhone}
            disabled={profileLoading || !pendingPhoneChange.trim()}
            class="btn-primary text-xs !py-1.5 flex-shrink-0 disabled:opacity-50"
          >Change Phone</button>
        </div>
      </div>

      <!-- Missing details -->
      <div class="bg-amber-50/60 border border-amber-200/60 rounded-xl p-4">
        <p class="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Details needed
        </p>
        <ul class="space-y-1.5">
          {#if !myProfile.phone}
            <li class="text-sm text-amber-800">Add your <span class="font-semibold">phone number</span> so we can reach you.</li>
          {/if}
          {#if !myProfile.avatar_url}
            <li class="text-sm text-amber-800">Add a <span class="font-semibold">profile picture</span> to personalize your account.</li>
          {/if}
          {#if myProfile.phone && myProfile.avatar_url}
            <li class="text-sm text-emerald-700 flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              All details are filled in. Great job!
            </li>
          {/if}
        </ul>
      </div>
    </div>
  {/if}
</Modal>
