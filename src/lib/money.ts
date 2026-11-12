export const formatPence = (pence: number): string => {
  const sign = pence < 0 ? '-' : '';
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
};

/** Parses "1.50", "£1.50", "1" into pence. Returns null if it isn't a valid non-negative amount. */
export const parsePounds = (text: string): number | null => {
  const cleaned = text.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
};

/** UK notes and coins offered as quick "cash handed over" buttons. */
export const CASH_BUTTONS = [50, 100, 200, 500, 1000, 2000, 5000];

export const cashLabel = (pence: number) => (pence < 100 ? `${pence}p` : `£${pence / 100}`);

/**
 * Parses a pasted price list: one item per line, "Name, price" (comma or tab),
 * optionally followed by a category: "Tea, 0.80, Drinks". A category can't start
 * with a digit, so "Raffle strip, 5, 2.00" is still an item called "Raffle strip, 5".
 * Lines that don't match are returned in `skipped` so the UI can report them.
 */
export const parsePriceList = (text: string) => {
  const items: { name: string; price: number; category?: string }[] = [];
  const skipped: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)[,\t]\s*£?\s*([\d.]+)\s*(?:[,\t]\s*([^\d£\s].*))?$/);
    const price = m ? parsePounds(m[2]) : null;
    const category = m?.[3]?.trim();
    if (m && m[1].trim() && price !== null) items.push({ name: m[1].trim(), price, ...(category ? { category } : {}) });
    else skipped.push(line);
  }
  return { items, skipped };
};
