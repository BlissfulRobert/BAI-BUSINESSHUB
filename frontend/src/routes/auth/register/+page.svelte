<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase/client';
  import { validateEmail } from '$lib/utils/validation';

  $: returnTo = $page.url.searchParams.get('returnTo') || '/#rooms';

  let fullName = '';
  let email = '';
  let phone = '';
  let password = '';
  let confirmPassword = '';
  let error = '';
  let loading = false;

  async function handleRegister() {
    error = '';

    if (!validateEmail(email)) {
      error = 'Please enter a valid email address';
      return;
    }

    if (password.length < 6) {
      error = 'Password must be at least 6 characters';
      return;
    }

    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }

    loading = true;

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone: phone || null
        }
      }
    });

    if (authError) {
      error = authError.message;
      loading = false;
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          email: email,
          full_name: fullName,
          phone: phone || null,
          role: 'client'
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
      }
    }

    loading = false;
    goto(`/auth/login?registered=true&returnTo=${encodeURIComponent(returnTo)}`);
  }
</script>

<svelte:head>
  <title>Register - BAI Business Hub</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-dark-50">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-dark-900">Create Account</h1>
      <p class="text-dark-500 mt-2">Join BAI Business Hub today</p>
    </div>

    <form on:submit|preventDefault={handleRegister} class="card space-y-6">
      {#if error}
        <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      {/if}

      <div>
        <label for="fullName" class="block text-sm font-medium text-dark-700 mb-2">Full Name</label>
        <input
          id="fullName"
          type="text"
          bind:value={fullName}
          class="input"
          placeholder="John Smith"
          required
        />
      </div>

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
        <label for="phone" class="block text-sm font-medium text-dark-700 mb-2">Phone <span class="text-dark-500">(optional)</span></label>
        <input
          id="phone"
          type="tel"
          bind:value={phone}
          class="input"
          placeholder="0400 000 000"
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
          minlength="6"
        />
      </div>

      <div>
        <label for="confirmPassword" class="block text-sm font-medium text-dark-700 mb-2">Confirm Password</label>
        <input
          id="confirmPassword"
          type="password"
          bind:value={confirmPassword}
          class="input"
          placeholder="••••••••"
          required
        />
      </div>

      <button type="submit" disabled={loading} class="btn-primary w-full py-3">
        {#if loading}
          <span class="flex items-center justify-center gap-2">
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Creating account...
          </span>
        {:else}
          Create Account
        {/if}
      </button>

      <p class="text-center text-sm text-dark-600">
        Already have an account?
        <a href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`} class="text-primary-700 hover:text-primary-600">Sign in</a>
      </p>
    </form>
  </div>
</div>
