import { writable } from 'svelte/store';
import type { Profile } from '$lib/types/database';
import { supabase } from '$lib/supabase/client';

export const user = writable<any>(null);
export const profile = writable<Profile | null>(null);
export const isLoading = writable<boolean>(true);

async function fetchProfile(userId: string | undefined): Promise<Profile | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data ?? null;
}

// A version counter ensures that when multiple syncSession calls are
// in flight (from both getSession and onAuthStateChange), only the
// most recent one is allowed to clear isLoading. This prevents a stale
// onAuthStateChange callback (e.g. SIGNED_OUT from a failed token
// refresh) from overwriting a valid session that is still being
// fetched by an earlier call.
let syncVersion = 0;

async function syncSession(
  session: { user: { id: string } | null } | null,
  version: number
) {
  user.set(session?.user ?? null);
  profile.set(await fetchProfile(session?.user?.id));
  if (version === syncVersion) {
    isLoading.set(false);
  }
}

// Seed from the cached session so the UI can render immediately.
const v1 = ++syncVersion;
supabase.auth
  .getSession()
  .then(({ data: { session } }) => syncSession(session, v1));

// Keep in sync with real auth events (login, logout, token refresh).
// onAuthStateChange is the source of truth once Supabase has
// determined the actual session state.
supabase.auth.onAuthStateChange((_event, session) => {
  const v = ++syncVersion;
  syncSession(session, v);
});
