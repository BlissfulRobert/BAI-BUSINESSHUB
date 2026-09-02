import { writable } from 'svelte/store';
import type { Profile } from '$lib/types/database';
import { supabase } from '$lib/supabase/client';

export const user = writable<any>(null);
export const profile = writable<Profile | null>(null);
export const isLoading = writable<boolean>(true);

// Restore the session on initial load, then keep the stores in sync with
// future auth events (login, logout, token refresh). Without this, the
// initial page render can see `isLoading === true` and `user === null`
// forever, which causes dashboards to hang on refresh.
supabase.auth.getSession().then(({ data: { session } }) => {
  user.set(session?.user ?? null);
  isLoading.set(false);
});

supabase.auth.onAuthStateChange((_event, session) => {
  user.set(session?.user ?? null);
  isLoading.set(false);
});
