// Running totals per till, ranked, for the organiser to show the stalls during the event.
import { formatPence } from './money';
import { tillKey, uniqueTills } from './tills';
import type { Sale } from './types';

export type Standing = {
  tillName: string;
  /** 1 for the leader. Tills on the same takings share a place. */
  place: number;
  takings: number; // pence, voided sales excluded
  count: number;
  /** When this till last took a sale (epoch ms), or null if it hasn't yet. */
  lastSaleAt: number | null;
  /** Takings as a share of the leader's, 0 to 1, for drawing bars. */
  share: number;
};

/**
 * Every till ranked by takings. Tills that have joined but not sold anything are
 * listed too, at the bottom, so nobody is left off the board.
 */
export function standings(sales: Sale[], joined: string[] = []): Standing[] {
  const byKey = new Map<string, Omit<Standing, 'place' | 'share'>>();
  for (const name of uniqueTills(joined)) byKey.set(tillKey(name), { tillName: name, takings: 0, count: 0, lastSaleAt: null });
  for (const s of sales) {
    if (s.voided) continue;
    const name = s.tillName.trim() || 'Unnamed till';
    const row = byKey.get(tillKey(name)) ?? { tillName: name, takings: 0, count: 0, lastSaleAt: null };
    row.takings += s.total;
    row.count += 1;
    row.lastSaleAt = Math.max(row.lastSaleAt ?? 0, s.at);
    byKey.set(tillKey(name), row);
  }
  const rows = [...byKey.values()].sort((a, b) => b.takings - a.takings || a.tillName.localeCompare(b.tillName));
  const top = rows[0]?.takings ?? 0;
  let place = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.takings !== rows[i - 1].takings) place = i + 1;
    return { ...r, place, share: top ? r.takings / top : 0 };
  });
}

/** "just now", "4 min ago", "2 hr ago". */
export function ago(at: number | null, now: number): string {
  if (at === null) return 'no sales yet';
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} hr ago`;
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** The standings as a short message for the volunteers' group chat. */
export function standingsText(eventName: string, rows: Standing[], at: number): string {
  const time = new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const total = rows.reduce((t, r) => t + r.takings, 0);
  return [
    `${eventName}: takings at ${time}`,
    '',
    ...rows.map((r) => `${ordinal(r.place)} ${r.tillName}: ${formatPence(r.takings)} (${r.count} ${r.count === 1 ? 'sale' : 'sales'})`),
    '',
    `All tills: ${formatPence(total)}`,
  ].join('\n');
}
