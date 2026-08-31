<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase/client';
  import { user } from '$lib/stores/auth';

  let newPassword = '';
  let confirmPassword = '';
  let error = '';
  let success = false;
  let loading = true;
  let saving = false;

  /**
   * Supabase delivers the recovery session in the URL hash fragment
   * (#access_token=...&type=recovery). We parse it, restore the session,
   * then let the user set a new password while the recovery session is live.
   */
  onMount(async () => {
    const hash = $page.url.hash;
    error = '';

    if (!hash) {
      error = 'This link is invalid or has expired. Please request a new one.';
      loading = false;
      return;
    }

    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');

    if (!accessToken || !refreshToken || type !== 'recovery') {
      error = 'This link is invalid or has expired. Please request a new one.';
      loading = false;
      return;
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (sessionError) {
      error = sessionError.message || 'Could not restore your session. Please request a new link.';
      loading = false;
      return;
    }

    loading = false;
  });

  async function handleSubmit() {
    error = '';

    if (newPassword.length < 6) {
      error = 'Password must be at least 6 characters';
      return;
    }

    if (newPassword !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }

    saving = true;

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    saving = false;

    if (updateError) {
      error = updateError.message;
      return;
    }

    await supabase.auth.signOut();
    success = true;
    setTimeout(() => goto('/auth/login'), 1500);
  }
</script>

<svelte:head>
  <title>Set New Password - BAI Business Hub</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-dark-50">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-dark-900">Set New Password</h1>
      <p class="text-dark-500 mt-2">Choose a new password for your account</p>
    </div>

    {#if success}
      <div class="card text-center">
        <div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-6 h-6 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 class="text-xl font-semibold text-dark-900 mb-2">Password Updated</h2>
        <p class="text-dark-600 mb-6">Your password has been changed. Redirecting to login...</p>
        <a href="/auth/login" class="btn-primary inline-block">Go to Login</a>
      </div>
    {:else if loading}
      <div class="card text-center py-12">
        <p class="text-dark-500">Verifying your reset link...</p>
      </div>
    {:else if error && !$user}
      <div class="card text-center">
        <div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-6 h-6 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 class="text-xl font-semibold text-dark-900 mb-2">Link Invalid or Expired</h2>
        <p class="text-dark-600 mb-6">{error}</p>
        <a href="/auth/reset-password" class="btn-primary inline-block">Request New Link</a>
      </div>
    {:else}
      <form on:submit|preventDefault={handleSubmit} class="card space-y-6">
        {#if error}
          <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        {/if}

        <div>
          <label for="new-password" class="block text-sm font-medium text-dark-700 mb-2">New Password</label>
          <input
            id="new-password"
            type="password"
            bind:value={newPassword}
            class="input"
            placeholder="••••••••"
            minlength="6"
            required
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-dark-700 mb-2">Confirm New Password</label>
          <input
            id="confirm-password"
            type="password"
            bind:value={confirmPassword}
            class="input"
            placeholder="••••••••"
            minlength="6"
            required
          />
        </div>

        <button type="submit" disabled={saving} class="btn-primary w-full py-3">
          {saving ? 'Saving...' : 'Update Password'}
        </button>

        <p class="text-center text-sm text-dark-600">
          <a href="/auth/login" class="text-primary-700 hover:text-primary-600">Back to Login</a>
        </p>
      </form>
    {/if}
  </div>
</div>
