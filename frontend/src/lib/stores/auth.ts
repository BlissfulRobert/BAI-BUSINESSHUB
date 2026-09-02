import { writable } from 'svelte/store';
import type { Profile } from '$lib/types/database';
import { supabase } from '$lib/supabase/client';

export const user = writable<any>(null);
export const profile = writable<Profile | null>(null);
export const isLoading = writable<boolean>(true);

supabase.auth.getSession().then(({ data: { session } }) => {
  user.set(session?.user ?? null);
  isLoading.set(false);
});
