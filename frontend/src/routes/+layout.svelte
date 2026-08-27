<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase/client';
  import { user, profile, isLoading } from '$lib/stores/auth';
  import '../app.css';

  let mobileMenuOpen = false;

  $: currentPath = $page.url.pathname;
  $: isLoggedIn = !!$user;
  $: isAdmin = $profile?.role === 'admin';
  $: isClient = $profile?.role === 'client';
  $: isHome = currentPath === '/';

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    $user = session?.user ?? null;

    if ($user) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', $user.id)
        .single();
      $profile = data;
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      $user = session?.user ?? null;

      if ($user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', $user.id)
          .single();
        $profile = data;
      } else {
        $profile = null;
      }
    });

    $isLoading = false;
  });

  async function handleLogout() {
    await supabase.auth.signOut();
    $user = null;
    $profile = null;
    mobileMenuOpen = false;
    goto('/');
  }

  function toggleMobileMenu() {
    mobileMenuOpen = !mobileMenuOpen;
  }

  function closeMobileMenu() {
    mobileMenuOpen = false;
  }

  function navLink(path: string, label: string) {
    const active = isHome && (path === '/' || path.startsWith('#'))
      ? true
      : currentPath === path;
    return { path, label, active };
  }

  const navLinks = [
    navLink('/#rooms', 'Rooms'),
    navLink('/#plans', 'Plans'),
    navLink('/#about', 'About'),
    navLink('/#gallery', 'Gallery'),
    navLink('/#location', 'Location'),
  ];
</script>

<div class="min-h-screen flex flex-col">
  <header class="border-b border-dark-800/50 bg-dark-950/80 backdrop-blur-xl sticky top-0 z-50">
    <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <div class="flex items-center gap-10">
          <a href="/" class="flex items-center gap-2">
            <div class="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <span class="text-white font-bold text-sm">B</span>
            </div>
            <span class="text-lg font-bold text-white">BAI Business Hub</span>
          </a>
          <div class="hidden lg:flex items-center gap-1">
            {#each navLinks as link}
              <a
                href={link.path}
                class="px-3 py-2 rounded-lg text-sm font-medium transition-colors
                  {link.active ? 'text-white bg-dark-800' : 'text-dark-400 hover:text-white hover:bg-dark-800/50'}"
              >
                {link.label}
              </a>
            {/each}
          </div>
        </div>

        <div class="hidden lg:flex items-center gap-3">
          {#if $isLoading}
            <div class="w-20 h-8 bg-dark-700 rounded animate-pulse"></div>
          {:else if isLoggedIn}
            {#if isAdmin}
              <a href="/admin" class="px-3 py-2 text-sm text-dark-400 hover:text-white transition-colors rounded-lg hover:bg-dark-800">
                Admin
              </a>
            {/if}
            {#if isClient}
              <a href="/member" class="px-3 py-2 text-sm text-dark-400 hover:text-white transition-colors rounded-lg hover:bg-dark-800">
                My Bookings
              </a>
            {/if}
            <div class="w-px h-6 bg-dark-700"></div>
            <span class="text-sm text-dark-400 max-w-[120px] truncate">
              {$profile?.full_name || $user?.email}
            </span>
            <button on:click={handleLogout} class="btn-secondary text-sm px-3 py-1.5">
              Logout
            </button>
          {:else}
            <a href="/auth/login" class="px-3 py-2 text-sm text-dark-400 hover:text-white transition-colors rounded-lg hover:bg-dark-800">
              Login
            </a>
            <a href="/auth/register" class="btn-primary text-sm px-4 py-1.5">
              Get Started
            </a>
          {/if}
        </div>

        <button on:click={toggleMobileMenu} class="lg:hidden p-2 text-dark-400 hover:text-white rounded-lg hover:bg-dark-800 transition-colors">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {#if mobileMenuOpen}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            {:else}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            {/if}
          </svg>
        </button>
      </div>
    </nav>

    {#if mobileMenuOpen}
      <div class="lg:hidden border-t border-dark-800 bg-dark-900/95 backdrop-blur-xl">
        <div class="px-4 py-4 space-y-1">
          {#each navLinks as link}
            <a
              href={link.path}
              on:click={closeMobileMenu}
              class="block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                {link.active ? 'text-white bg-dark-800' : 'text-dark-400 hover:text-white hover:bg-dark-800/50'}"
            >
              {link.label}
            </a>
          {/each}
          <hr class="border-dark-700 my-2" />
          {#if isLoggedIn}
            {#if isAdmin}
              <a href="/admin" on:click={closeMobileMenu} class="block px-3 py-2.5 text-sm text-dark-400 hover:text-white hover:bg-dark-800/50 rounded-lg">Admin Panel</a>
            {/if}
            {#if isClient}
              <a href="/member" on:click={closeMobileMenu} class="block px-3 py-2.5 text-sm text-dark-400 hover:text-white hover:bg-dark-800/50 rounded-lg">My Bookings</a>
            {/if}
            <button on:click={handleLogout} class="w-full text-left px-3 py-2.5 text-sm text-dark-400 hover:text-white hover:bg-dark-800/50 rounded-lg">
              Logout
            </button>
          {:else}
            <a href="/auth/login" on:click={closeMobileMenu} class="block px-3 py-2.5 text-sm text-dark-400 hover:text-white hover:bg-dark-800/50 rounded-lg">Login</a>
            <a href="/auth/register" on:click={closeMobileMenu} class="block px-3 py-2.5 text-sm text-primary-400 hover:text-primary-300 hover:bg-dark-800/50 rounded-lg font-medium">Get Started</a>
          {/if}
        </div>
      </div>
    {/if}
  </header>

  <main class="flex-1">
    <slot />
  </main>

  <footer class="border-t border-dark-800 bg-dark-950">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <div class="flex items-center gap-2 mb-4">
            <div class="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <span class="text-white font-bold text-sm">B</span>
            </div>
            <span class="text-lg font-bold text-white">BAI Business Hub</span>
          </div>
          <p class="text-sm text-dark-400 leading-relaxed">
            Premium workspaces designed to boost productivity. Professional meeting rooms and conference spaces for your business needs.
          </p>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-white uppercase tracking-wider mb-4">Quick Links</h3>
          <ul class="space-y-2.5">
            <li><a href="/#rooms" class="text-sm text-dark-400 hover:text-white transition-colors">Rooms</a></li>
            <li><a href="/#plans" class="text-sm text-dark-400 hover:text-white transition-colors">Plans & Pricing</a></li>
            <li><a href="/#about" class="text-sm text-dark-400 hover:text-white transition-colors">About Us</a></li>
            <li><a href="/#gallery" class="text-sm text-dark-400 hover:text-white transition-colors">Gallery</a></li>
            <li><a href="/#location" class="text-sm text-dark-400 hover:text-white transition-colors">Location</a></li>
          </ul>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-white uppercase tracking-wider mb-4">Account</h3>
          <ul class="space-y-2.5">
            <li><a href="/auth/login" class="text-sm text-dark-400 hover:text-white transition-colors">Member Login</a></li>
            <li><a href="/auth/register" class="text-sm text-dark-400 hover:text-white transition-colors">Register</a></li>
            <li><a href="/auth/reset-password" class="text-sm text-dark-400 hover:text-white transition-colors">Reset Password</a></li>
          </ul>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-white uppercase tracking-wider mb-4">Contact</h3>
          <ul class="space-y-2.5 text-sm text-dark-400">
            <li class="flex items-start gap-2">
              <svg class="w-4 h-4 text-primary-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              123 Business Street, Melbourne VIC 3000
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-primary-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              info@baibusinesshub.com
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-primary-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              (03) 0000 0000
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-12 pt-8 border-t border-dark-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p class="text-sm text-dark-500">
          &copy; {new Date().getFullYear()} BAI Business Hub. All rights reserved.
        </p>
        <div class="flex items-center gap-4">
          <span class="text-xs text-dark-600">On-site payment</span>
          <span class="text-dark-700">·</span>
          <span class="text-xs text-dark-600">Non-refundable</span>
          <span class="text-dark-700">·</span>
          <span class="text-xs text-dark-600">Cancel anytime</span>
        </div>
      </div>
    </div>
  </footer>
</div>
