// Item categories and tile colours. A category is just a name on the item,
// matched ignoring case and stray spaces, so "Drinks" and "drinks " are one group.
import type { Item } from './types';

export const COLOURS = ['red', 'yellow', 'blue', 'green', 'pink', 'purple', 'orange'] as const;
export type Colour = (typeof COLOURS)[number];

// Items with no colour or category take one of these in turn, as the bunting does.
const AUTO = 5;

export const categoryKey = (name: string | undefined) => (name ?? '').trim().toLowerCase();
export const isColour = (c: string | undefined): c is Colour => COLOURS.includes(c as Colour);

/** Category names in the order they first appear, keeping the first spelling of each. */
export function categoriesOf(items: { category?: string }[]): string[] {
  const seen = new Map<string, string>();
  for (const i of items) {
    const key = categoryKey(i.category);
    if (key && !seen.has(key)) seen.set(key, i.category!.trim());
  }
  return [...seen.values()];
}

/**
 * Items in their groups, for the till. Categories come in the order they first
 * appear in the price list; items with none come last. With no categories at
 * all there is a single unnamed group.
 */
export function groupByCategory<T extends { category?: string }>(items: T[]): { category: string; items: T[] }[] {
  const groups = new Map<string, { category: string; items: T[] }>();
  for (const name of categoriesOf(items)) groups.set(categoryKey(name), { category: name, items: [] });
  const rest: T[] = [];
  for (const i of items) (groups.get(categoryKey(i.category))?.items ?? rest).push(i);
  const out = [...groups.values()];
  if (rest.length) out.push({ category: out.length ? 'Other' : '', items: rest });
  return out;
}

/**
 * The colour of each item's tile. A chosen colour wins. Otherwise a category's
 * items share a colour, and items with no category take colours in turn.
 */
export function tileColours(items: Pick<Item, 'id' | 'category' | 'colour'>[]): Map<string, Colour> {
  const cats = categoriesOf(items).map(categoryKey);
  const chosen = new Map<string, Colour>(); // a category's colour: the first one chosen for any of its items
  for (const i of items) {
    const key = categoryKey(i.category);
    if (key && isColour(i.colour) && !chosen.has(key)) chosen.set(key, i.colour);
  }
  const out = new Map<string, Colour>();
  items.forEach((item, n) => {
    const key = categoryKey(item.category);
    out.set(
      item.id,
      isColour(item.colour) ? item.colour : key ? (chosen.get(key) ?? COLOURS[cats.indexOf(key) % COLOURS.length]) : COLOURS[n % AUTO],
    );
  });
  return out;
}
