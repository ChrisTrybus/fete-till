import type { Sale } from './types';

export type DayTotals = {
  takings: number;
  cash: number;
  card: number;
  count: number;
  byItem: { name: string; qty: number; value: number }[];
  byTill: { tillName: string; count: number; value: number }[];
};

/** End-of-day figures across every till in the event. Voided sales are excluded. */
export function summarise(sales: Sale[]): DayTotals {
  const live = sales.filter((s) => !s.voided);
  const items = new Map<string, { qty: number; value: number }>();
  const tills = new Map<string, { count: number; value: number }>();
  let cash = 0;
  let card = 0;
  for (const s of live) {
    if (s.method === 'cash') cash += s.total;
    else card += s.total;
    const till = tills.get(s.tillName || 'Unnamed till') ?? { count: 0, value: 0 };
    till.count += 1;
    till.value += s.total;
    tills.set(s.tillName || 'Unnamed till', till);
    for (const l of s.lines) {
      const it = items.get(l.name) ?? { qty: 0, value: 0 };
      it.qty += l.qty;
      it.value += l.qty * l.price;
      items.set(l.name, it);
    }
  }
  return {
    takings: cash + card,
    cash,
    card,
    count: live.length,
    byItem: [...items].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value),
    byTill: [...tills].map(([tillName, v]) => ({ tillName, ...v })).sort((a, b) => b.value - a.value),
  };
}

/** CSV export for the treasurer: one row per sale line. */
export function salesToCsv(sales: Sale[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['Time', 'Till', 'Payment', 'Item', 'Qty', 'Unit price', 'Line total', 'Voided']];
  for (const s of [...sales].sort((a, b) => a.at - b.at)) {
    for (const l of s.lines) {
      rows.push([
        new Date(s.at).toISOString(),
        s.tillName,
        s.method,
        l.name,
        String(l.qty),
        (l.price / 100).toFixed(2),
        ((l.price * l.qty) / 100).toFixed(2),
        s.voided ? 'yes' : 'no',
      ]);
    }
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
