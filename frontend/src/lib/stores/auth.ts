import { writable } from 'svelte/store';
import type { Profile } from '$lib/types/database';

export const user = writable<any>(null);
export const profile = writable<Profile | null>(null);
export const isLoading = writable<boolean>(true);
