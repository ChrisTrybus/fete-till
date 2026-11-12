import { cashLabel, formatPence, parsePounds, parsePriceList } from '../money';
import { salesToCsv, summarise } from '../totals';
import type { Sale } from '../types';

const sale = (over: Partial<Sale>): Sale => ({
  id: 's',
  at: Date.UTC(2026, 5, 20, 13, 0),
  total: 0,
  method: 'cash',
  tendered: 0,
  lines: [],
  tillName: 'Cake stall',
  deviceId: 'd',
  voided: false,
  ...over,
});

describe('money', () => {
  test('formats pence as pounds', () => {
    expect(formatPence(0)).toBe('£0.00');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(1250)).toBe('£12.50');
    expect(formatPence(-80)).toBe('-£0.80');
  });

  test('parses typed prices into whole pence without rounding errors', () => {
    expect(parsePounds('1.50')).toBe(150);
    expect(parsePounds('£2')).toBe(200);
    expect(parsePounds('0.8')).toBe(80);
    expect(parsePounds('1.15')).toBe(115);
    expect(parsePounds('19.99')).toBe(1999);
    expect(parsePounds(' 1,000.00 ')).toBe(100000);
  });

  test('rejects things that are not prices', () => {
    for (const bad of ['', 'free', '-1', '1.505', '1.', '.50', '1.2.3']) expect(parsePounds(bad)).toBeNull();
  });

  test('labels cash buttons', () => {
    expect(cashLabel(50)).toBe('50p');
    expect(cashLabel(2000)).toBe('£20');
  });

  test('parses a pasted price list and reports the lines it skipped', () => {
    const { items, skipped } = parsePriceList('Tea, 0.80\nSlice of cake\t£1.50\n\nHook-a-duck, 3 goes, 1\nRaffle\nBad, abc');
    expect(items).toEqual([
      { name: 'Tea', price: 80 },
      { name: 'Slice of cake', price: 150 },
      { name: 'Hook-a-duck, 3 goes', price: 100 },
    ]);
    expect(skipped).toEqual(['Raffle', 'Bad, abc']);
  });

  test('a pasted line can end with a category', () => {
    const { items, skipped } = parsePriceList('Tea, 0.80, Drinks\nSlice of cake\t1.50\tCakes\nRaffle strip, 5, 2.00\nJam, 3');
    expect(items).toEqual([
      { name: 'Tea', price: 80, category: 'Drinks' },
      { name: 'Slice of cake', price: 150, category: 'Cakes' },
      { name: 'Raffle strip, 5', price: 200 },
      { name: 'Jam', price: 300 },
    ]);
    expect(skipped).toEqual([]);
  });
});

describe('day totals', () => {
  const sales = [
    sale({ id: 'a', total: 310, method: 'cash', lines: [{ itemId: 't', name: 'Tea', price: 80, qty: 2 }, { itemId: 'c', name: 'Cake', price: 150, qty: 1 }] }),
    sale({ id: 'b', total: 150, method: 'card', tillName: 'Tombola', lines: [{ itemId: 'c', name: 'Cake', price: 150, qty: 1 }] }),
    sale({ id: 'c', total: 999, method: 'cash', voided: true, lines: [{ itemId: 'x', name: 'Mistake', price: 999, qty: 1 }] }),
    sale({ id: 'd', total: 80, method: 'cash', tillName: '', lines: [{ itemId: 't', name: 'Tea', price: 80, qty: 1 }] }),
  ];

  test('adds up cash, card and takings, leaving out voided sales', () => {
    const t = summarise(sales);
    expect(t).toMatchObject({ takings: 540, cash: 390, card: 150, count: 3 });
  });

  test('breaks takings down by item and by till, biggest first', () => {
    const t = summarise(sales);
    expect(t.byItem).toEqual([
      { name: 'Cake', qty: 2, value: 300 },
      { name: 'Tea', qty: 3, value: 240 },
    ]);
    expect(t.byTill).toEqual([
      { tillName: 'Cake stall', count: 1, value: 310, cash: 310 },
      { tillName: 'Tombola', count: 1, value: 150, cash: 0 },
      { tillName: 'Unnamed till', count: 1, value: 80, cash: 80 },
    ]);
  });

  test('the per-item and per-till breakdowns each add up to the takings', () => {
    const t = summarise(sales);
    expect(t.byItem.reduce((n, r) => n + r.value, 0)).toBe(t.takings);
    expect(t.byTill.reduce((n, r) => n + r.value, 0)).toBe(t.takings);
  });

  test('CSV has one row per sale line, oldest first, with quotes escaped', () => {
    const csv = salesToCsv([
      sale({ id: 'late', at: Date.UTC(2026, 5, 20, 14, 0), lines: [{ itemId: 'j', name: 'Jam "special"', price: 250, qty: 2 }], voided: true }),
      sale({ id: 'early', at: Date.UTC(2026, 5, 20, 12, 0), method: 'card', lines: [{ itemId: 't', name: 'Tea', price: 80, qty: 1 }] }),
    ]).split('\n');
    expect(csv).toEqual([
      '"Time","Till","Payment","Item","Qty","Unit price","Line total","Voided","Card reference"',
      '"2026-06-20T12:00:00.000Z","Cake stall","card","Tea","1","0.80","0.80","no",""',
      '"2026-06-20T14:00:00.000Z","Cake stall","cash","Jam ""special""","2","2.50","5.00","yes",""',
    ]);
  });
});
