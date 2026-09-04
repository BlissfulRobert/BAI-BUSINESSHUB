// Resilient key helper for keyed {#each} blocks. Svelte throws an "Invalid
// key"/duplicate-key error when a keyed each produces a null, undefined, or
// duplicate key. These helpers guarantee a non-empty, unique-enough key by
// falling back to the item's index (and a random salt) whenever the primary
// value is missing or blank, so malformed data can never crash the UI.
let saltCounter = 0;

function nextSalt(): number {
  saltCounter += 1;
  return saltCounter;
}

export function safeKey(value: unknown, index: number): string | number {
  if (value !== null && value !== undefined && value !== '') {
    return value as string | number;
  }
  return `__k${nextSalt()}_${index}`;
}

// For keys that are strings built from multiple parts (e.g. a series key) we
// treat only non-empty strings as usable; otherwise fall back to the index.
export function safeStringKey(value: unknown, index: number): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return `__k${nextSalt()}_${index}`;
}
