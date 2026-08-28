<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase/client';
  import RoomCard from '$lib/components/RoomCard.svelte';
  import PlanCard from '$lib/components/PlanCard.svelte';
  import Gallery from '$lib/components/Gallery.svelte';
  import Map from '$lib/components/Map.svelte';
  import type { Room, Plan, GalleryImage, Review } from '$lib/types/database';

  let rooms: Room[] = [];
  let plans: Plan[] = [];
  let galleryImages: GalleryImage[] = [];
  let reviews: Review[] = [];
  let loading = true;

  onMount(async () => {
    const [roomsRes, plansRes, galleryRes, reviewsRes] = await Promise.all([
      supabase.from('rooms').select('*').eq('is_active', true).order('name'),
      supabase.from('plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('gallery').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('reviews').select('*, profile:profiles(full_name)').order('created_at', { ascending: false }).limit(6)
    ]);

    rooms = roomsRes.data ?? [];
    plans = plansRes.data ?? [];
    galleryImages = galleryRes.data ?? [];
    reviews = reviewsRes.data ?? [];
    loading = false;
  });

  function getRatingStars(rating: number): string[] {
    return Array.from({ length: 5 }, (_, i) => i < rating ? 'filled' : 'empty');
  }
</script>

<svelte:head>
  <title>BAI Business Hub - Premium Meeting & Conference Rooms</title>
  <meta name="description" content="Book premium meeting rooms and conference spaces at BAI Business Hub. Flexible booking plans, modern amenities, and professional spaces for your business needs." />
</svelte:head>

<!-- ==================== HERO SECTION ==================== -->
<section class="relative min-h-[90vh] flex items-center overflow-hidden">
  <div class="absolute inset-0 bg-gradient-to-br from-dark-800 via-dark-700 to-primary-800/30"></div>
  <div class="absolute top-0 right-0 w-[600px] h-[600px] bg-primary-600/8 rounded-full blur-3xl"></div>
  <div class="absolute bottom-0 left-0 w-[400px] h-[400px] bg-primary-400/5 rounded-full blur-3xl"></div>

  <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div>
        <div class="inline-flex items-center gap-2 bg-primary-600/10 border border-primary-600/20 rounded-full px-4 py-1.5 mb-6">
          <span class="w-2 h-2 bg-primary-400 rounded-full animate-pulse"></span>
          <span class="text-sm text-primary-400">Now accepting bookings</span>
        </div>
        <h1 class="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
          Premium Workspaces
          <span class="text-primary-400"> Designed to Boost Productivity</span>
        </h1>
        <p class="text-lg text-dark-300 mb-8 max-w-lg">
          Get more done at BAI Business Hub with world-class meeting rooms, professional conference spaces, and flexible booking plans designed to impress.
        </p>
        <div class="flex flex-wrap gap-4">
          <a href="#rooms" class="btn-primary px-8 py-3 text-base">
            View Rooms
          </a>
          <a href="#plans" class="btn-secondary px-8 py-3 text-base">
            See Plans
          </a>
        </div>

        <div class="flex items-center gap-8 mt-12 pt-8 border-t border-dark-800">
          <div>
            <div class="text-2xl font-bold text-white">{rooms.length}</div>
            <div class="text-sm text-dark-400">Rooms Available</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-white">{plans.length}</div>
            <div class="text-sm text-dark-400">Flexible Plans</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-white">24/7</div>
            <div class="text-sm text-dark-400">Access Available</div>
          </div>
        </div>
      </div>

      <div class="relative hidden lg:block">
        <div class="aspect-[4/3] bg-dark-800 rounded-2xl overflow-hidden border border-dark-700 shadow-2xl">
          <img src="/office.png" alt="BAI Business Hub" class="w-full h-full object-cover" />
        </div>
        <div class="absolute -bottom-6 -left-6 bg-dark-800 border border-dark-700 rounded-xl p-4 shadow-xl">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-green-600/20 rounded-lg flex items-center justify-center">
              <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div class="text-sm font-medium text-white">Instant Booking</div>
              <div class="text-xs text-dark-400">Reserve in seconds</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ==================== ROOMS SECTION ==================== -->
<section id="rooms" class="py-24 bg-dark-700/50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-16">
      <span class="text-primary-400 text-sm font-semibold uppercase tracking-wider">Our Spaces</span>
      <h2 class="text-3xl md:text-4xl font-bold text-white mt-2 mb-4">Rooms Built for Success</h2>
      <p class="text-dark-400 max-w-2xl mx-auto">
        From intimate meetings to large-scale presentations, our professionally designed rooms provide the perfect environment for your business.
      </p>
    </div>

    {#if loading}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {#each [1, 2] as _}
          <div class="card animate-pulse">
            <div class="aspect-video bg-dark-700 rounded-lg mb-4"></div>
            <div class="h-6 bg-dark-700 rounded w-1/2 mb-2"></div>
            <div class="h-4 bg-dark-700 rounded w-3/4 mb-4"></div>
            <div class="h-10 bg-dark-700 rounded"></div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {#each rooms as room (room.id)}
          <RoomCard {room} />
        {/each}
      </div>
    {/if}
  </div>
</section>

<!-- ==================== PLANS / PRICING SECTION ==================== -->
<section id="plans" class="py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-16">
      <span class="text-primary-400 text-sm font-semibold uppercase tracking-wider">Pricing</span>
      <h2 class="text-3xl md:text-4xl font-bold text-white mt-2 mb-4">Flexible Plans for Every Need</h2>
      <p class="text-dark-400 max-w-2xl mx-auto">
        Choose the plan that works for you. All plans include access to our premium amenities. Payment is made on-site.
      </p>
    </div>

    {#if !loading && plans.length > 0}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {#each plans as plan, i (plan.id)}
          <PlanCard {plan} highlighted={i === 1} />
        {/each}
      </div>
    {/if}

    <div class="text-center mt-8">
      <p class="text-sm text-dark-500">
        All payments are processed on-site. Cancellations are allowed but payments are non-refundable.
      </p>
    </div>
  </div>
</section>

<!-- ==================== ABOUT / WHY CHOOSE US ==================== -->
<section id="about" class="py-24 bg-dark-700/50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
      <div>
        <span class="text-primary-400 text-sm font-semibold uppercase tracking-wider">Why Choose Us</span>
        <h2 class="text-3xl md:text-4xl font-bold text-white mt-2 mb-6">A Collaborative Environment with a Thriving Community</h2>
        <p class="text-dark-300 mb-8 leading-relaxed">
          BAI Business Hub is more than just a workspace. We provide a professional environment designed to help you and your business prosper. From quiet focused zones to vibrant collaborative areas, our spaces adapt to your needs.
        </p>

        <div class="space-y-6">
          <div class="flex gap-4">
            <div class="flex-shrink-0 w-12 h-12 bg-primary-600/20 rounded-xl flex items-center justify-center">
              <svg class="w-6 h-6 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-white font-semibold mb-1">Flexible Scheduling</h3>
              <p class="text-sm text-dark-400">Book by the day, week, or month. Choose the plan that fits your workflow.</p>
            </div>
          </div>

          <div class="flex gap-4">
            <div class="flex-shrink-0 w-12 h-12 bg-primary-600/20 rounded-xl flex items-center justify-center">
              <svg class="w-6 h-6 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 class="text-white font-semibold mb-1">Modern Equipment</h3>
              <p class="text-sm text-dark-400">4K displays, video conferencing, wireless screen sharing, and high-speed WiFi.</p>
            </div>
          </div>

          <div class="flex gap-4">
            <div class="flex-shrink-0 w-12 h-12 bg-primary-600/20 rounded-xl flex items-center justify-center">
              <svg class="w-6 h-6 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-white font-semibold mb-1">Professional Environment</h3>
              <p class="text-sm text-dark-400">Impress your clients in our premium, well-maintained spaces with all amenities included.</p>
            </div>
          </div>

          <div class="flex gap-4">
            <div class="flex-shrink-0 w-12 h-12 bg-primary-600/20 rounded-xl flex items-center justify-center">
              <svg class="w-6 h-6 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div>
              <h3 class="text-white font-semibold mb-1">On-Site Convenience</h3>
              <p class="text-sm text-dark-400">Kitchen access, parking, and everything you need in one location.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-6">
        <div class="grid grid-cols-2 gap-4">
          <div class="card text-center p-6">
            <div class="text-3xl font-bold text-primary-400 mb-1">16</div>
            <div class="text-sm text-dark-400">Conference Seats</div>
          </div>
          <div class="card text-center p-6">
            <div class="text-3xl font-bold text-primary-400 mb-1">8</div>
            <div class="text-sm text-dark-400">Meeting Seats</div>
          </div>
          <div class="card text-center p-6">
            <div class="text-3xl font-bold text-primary-400 mb-1">3</div>
            <div class="text-sm text-dark-400">Booking Plans</div>
          </div>
          <div class="card text-center p-6">
            <div class="text-3xl font-bold text-primary-400 mb-1">5★</div>
            <div class="text-sm text-dark-400">Member Rating</div>
          </div>
        </div>

        <!-- Reviews -->
        {#if reviews.length > 0}
          <div class="card">
            <h3 class="text-lg font-semibold text-white mb-4">What Our Members Say</h3>
            <div class="space-y-4">
              {#each reviews.slice(0, 3) as review}
                <div class="border-b border-dark-700 last:border-0 pb-4 last:pb-0">
                  <div class="flex items-center gap-1 mb-1">
                    {#each getRatingStars(review.rating) as star}
                      <svg class="w-4 h-4 {star === 'filled' ? 'text-yellow-400' : 'text-dark-600'}" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    {/each}
                  </div>
                  <p class="text-sm text-dark-300">{review.comment}</p>
                  <p class="text-xs text-dark-500 mt-1">{review.profile?.full_name || 'Anonymous'}</p>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</section>

<!-- ==================== GALLERY SECTION ==================== -->
<section id="gallery" class="py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-16">
      <span class="text-primary-400 text-sm font-semibold uppercase tracking-wider">Gallery</span>
      <h2 class="text-3xl md:text-4xl font-bold text-white mt-2 mb-4">See Our Spaces</h2>
      <p class="text-dark-400 max-w-2xl mx-auto">
        Take a virtual tour of our premium facilities and see why members love working here.
      </p>
    </div>

    {#if !loading}
      <Gallery images={galleryImages} />
    {/if}
  </div>
</section>

<!-- ==================== MAP / LOCATION SECTION ==================== -->
<section id="location" class="py-24 bg-dark-700/50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div>
        <span class="text-primary-400 text-sm font-semibold uppercase tracking-wider">Find Us</span>
        <h2 class="text-3xl md:text-4xl font-bold text-white mt-2 mb-6">Conveniently Located</h2>
        <p class="text-dark-300 mb-8 leading-relaxed">
          BAI Business Hub is easily accessible with nearby parking and public transport options. Visit us today and see our spaces in person.
        </p>

        <div class="space-y-4">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-10 h-10 bg-primary-600/20 rounded-lg flex items-center justify-center">
              <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-white font-medium">Address</h3>
              <p class="text-sm text-dark-400">123 Business Street, Melbourne VIC 3000</p>
            </div>
          </div>

          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-10 h-10 bg-primary-600/20 rounded-lg flex items-center justify-center">
              <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div>
              <h3 class="text-white font-medium">Phone</h3>
              <p class="text-sm text-dark-400">(03) 0000 0000</p>
            </div>
          </div>

          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-10 h-10 bg-primary-600/20 rounded-lg flex items-center justify-center">
              <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-white font-medium">Hours</h3>
              <p class="text-sm text-dark-400">Monday - Friday: 7:00 AM - 7:00 PM</p>
              <p class="text-sm text-dark-400">Monthly members: 24/7 access</p>
            </div>
          </div>
        </div>
      </div>

      <div class="h-[400px] rounded-xl overflow-hidden border border-dark-700">
        <Map lat={-37.8136} lng={144.9631} zoom={15} title="BAI Business Hub" />
      </div>
    </div>
  </div>
</section>

<!-- ==================== CTA SECTION ==================== -->
<section class="py-24">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="relative bg-gradient-to-r from-primary-600/20 to-primary-800/20 border border-primary-600/30 rounded-2xl p-12 text-center overflow-hidden">
      <div class="absolute top-0 right-0 w-64 h-64 bg-primary-600/10 rounded-full blur-3xl"></div>
      <div class="relative">
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-4">Ready to Get Started?</h2>
        <p class="text-dark-300 max-w-xl mx-auto mb-8">
          Join BAI Business Hub today and experience premium workspaces designed for your success.
        </p>
        <div class="flex flex-wrap justify-center gap-4">
          <a href="/auth/register" class="btn-primary px-8 py-3 text-base">
            Create Account
          </a>
          <a href="#plans" class="btn-secondary px-8 py-3 text-base">
            View Plans
          </a>
        </div>
      </div>
    </div>
  </div>
</section>
