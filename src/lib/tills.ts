// Which till sells what. Items are assigned to tills by name, ignoring case and
// stray spaces, so "Cake stall" and "cake stall " are the same till.
import type { Item } from './types';

export const tillKey = (name: string) => name.trim().toLowerCase();

/** True if this till sells the item. An item with no tills listed is sold on every till. */
export const soldOnTill = (item: Item, tillName: string) =>
  !item.tills?.length || item.tills.some((t) => tillKey(t) === tillKey(tillName));

/** Till names with blanks and repeats removed, keeping the first spelling of each. */
export function uniqueTills(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(tillKey(name))) continue;
    seen.add(tillKey(name));
    out.push(name);
  }
  return out;
}

/**
 * Switches one till on or off for an item. Starting from "every till", picking a
 * till narrows the item to just that one. Ending up with none, or with all the
 * known tills, goes back to "every till".
 */
export function toggleTill(current: string[] | undefined, till: string, known: string[]): string[] | undefined {
  const has = (list: string[], name: string) => list.some((t) => tillKey(t) === tillKey(name));
  const now = current ?? [];
  const next = has(now, till) ? now.filter((t) => tillKey(t) !== tillKey(till)) : [...now, till];
  if (!next.length || known.every((k) => has(next, k))) return undefined;
  return next;
}
