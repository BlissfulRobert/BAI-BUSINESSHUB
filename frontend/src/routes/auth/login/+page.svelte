<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase/client';

  $: returnTo = sanitizeReturnTo($page.url.searchParams.get('returnTo'));

  function sanitizeReturnTo(value: string | null): string {
    if (value && value.startsWith('/') && !value.startsWith('//')) {
      return value;
    }
    return '/member';
  }

  let email = '';
  let password = '';
  let error = '';
  let loading = false;

  async function handleLogin() {
    error = '';
    loading = true;

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      error = authError.message;
      loading = false;
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    loading = false;

    if (profile?.role === 'admin') {
      goto('/admin');
    } else {
      goto(returnTo);
    }
  }
</script>

<svelte:head>
  <title>Login - BAI Business Hub</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-white">Welcome Back</h1>
      <p class="text-primary-200 mt-2">Sign in to your account</p>
    </div>

    <form on:submit|preventDefault={handleLogin} class="card space-y-6">
      {#if error}
        <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      {/if}

      <div>
        <label for="email" class="block text-sm font-medium text-dark-700 mb-2">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          class="input"
          placeholder="you@example.com"
          required
        />
      </div>

      <div>
        <label for="password" class="block text-sm font-medium text-dark-700 mb-2">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          class="input"
          placeholder="••••••••"
          required
        />
      </div>

      <div class="flex items-center justify-between text-sm">
        <label class="flex items-center gap-2">
          <input type="checkbox" class="w-4 h-4 rounded bg-white border-dark-300 text-primary-600 focus:ring-primary-500" />
          <span class="text-dark-600">Remember me</span>
        </label>
        <a href="/auth/reset-password" class="text-primary-700 hover:text-primary-600">Forgot password?</a>
      </div>

      <button type="submit" disabled={loading} class="btn-primary w-full py-3">
        {#if loading}
          <span class="flex items-center justify-center gap-2">
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Signing in...
          </span>
        {:else}
          Sign In
        {/if}
      </button>

      <p class="text-center text-sm text-dark-600">
        Don't have an account?
        <a href={`/auth/register?returnTo=${encodeURIComponent(returnTo)}`} class="text-primary-700 hover:text-primary-600">Register here</a>
      </p>
    </form>
  </div>
</div>
