<script lang="ts">
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';

  let email = '';
  let submitted = false;
  let error = '';
  let loading = false;

  async function handleReset() {
    error = '';
    loading = true;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password/callback`
    });

    loading = false;

    if (resetError) {
      error = resetError.message;
      return;
    }

    submitted = true;
  }
</script>

<svelte:head>
  <title>Reset Password - BAI Business Hub</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center py-12 px-4">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-dark-900">Reset Password</h1>
      <p class="text-dark-500 mt-2">Enter your email to receive a reset link</p>
    </div>

    {#if submitted}
      <div class="card text-center">
        <div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-6 h-6 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 class="text-xl font-semibold text-dark-900 mb-2">Check Your Email</h2>
        <p class="text-dark-600 mb-6">We've sent a password reset link to {email}</p>
        <a href="/auth/login" class="btn-primary inline-block">
          Back to Login
        </a>
      </div>
    {:else}
      <form on:submit|preventDefault={handleReset} class="card space-y-6">
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

        <button type="submit" disabled={loading} class="btn-primary w-full py-3">
          {#if loading}
            Sending...
          {:else}
            Send Reset Link
          {/if}
        </button>

        <p class="text-center text-sm text-dark-600">
          <a href="/auth/login" class="text-primary-700 hover:text-primary-600">Back to Login</a>
        </p>
      </form>
    {/if}
  </div>
</div>
