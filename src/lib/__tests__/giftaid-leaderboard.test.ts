import { declarationProblems, donationIn, giftAidCsv, giftAidOn, giftAidTotals, isOpenDonation, normalisePostcode, offersGiftAid, roundUpBy } from '../giftaid';
import { ago, standings, standingsText } from '../leaderboard';
import { summaryText } from '../summary';
import type { GiftAidDeclaration, Sale } from '../types';

const AT = new Date(2026, 5, 20, 14, 30).getTime(); // 20 June 2026, local time

const sale = (id: string, extra: Partial<Sale> = {}): Sale => ({
  id,
  at: AT,
  total: 650,
  method: 'cash',
  tendered: 1000,
  lines: [
    { itemId: 'cake', name: 'Slice of cake', price: 150, qty: 1 },
    { itemId: 'don', name: 'Donation', price: 100, qty: 5, donation: true },
  ],
  tillName: 'Cake stall',
  deviceId: 'd1',
  voided: false,
  ...extra,
});

const declaration = (saleId: string, extra: Partial<GiftAidDeclaration> = {}): GiftAidDeclaration => ({
  saleId,
  at: AT,
  amount: 500,
  firstName: 'Ada',
  lastName: 'Lovelace',
  house: '12',
  postcode: 'SW1A 1AA',
  tillName: 'Cake stall',
  deviceId: 'd1',
  ...extra,
});

describe('Gift Aid', () => {
  test('only the donated part of a sale counts, never what was bought', () => {
    expect(donationIn(sale('a'))).toBe(500);
    expect(donationIn(sale('b', { lines: [{ itemId: 'tea', name: 'Tea', price: 80, qty: 2 }] }))).toBe(0);
  });

  test('Gift Aid is 25p in the pound, rounded down to whole pence', () => {
    expect(giftAidOn(500)).toBe(125);
    expect(giftAidOn(333)).toBe(83);
    expect(giftAidOn(0)).toBe(0);
  });

  test('postcodes are tidied into the usual form, and anything else is turned down', () => {
    expect(normalisePostcode('sw1a1aa')).toBe('SW1A 1AA');
    expect(normalisePostcode(' m1  1ae ')).toBe('M1 1AE');
    expect(normalisePostcode('B33 8TH')).toBe('B33 8TH');
    expect(normalisePostcode('12345')).toBeNull();
    expect(normalisePostcode('')).toBeNull();
  });

  test('every field is needed, within HMRC’s lengths', () => {
    expect(declarationProblems({ firstName: 'Ada', lastName: 'Lovelace', house: '12', postcode: 'sw1a 1aa' })).toEqual([]);
    expect(declarationProblems({ firstName: ' ', lastName: '', house: '', postcode: 'x' })).toHaveLength(4);
    expect(declarationProblems({ firstName: 'A'.repeat(36), lastName: 'L', house: '1', postcode: 'SW1A 1AA' })).toHaveLength(1);
  });

  test('totals count every donation, and claim only on declared ones whose sale still stands', () => {
    const sales = [sale('a'), sale('b'), sale('c', { voided: true })];
    const declarations = [declaration('a'), declaration('c')];
    // Sale b has no declaration and is small enough to need none.
    expect(giftAidTotals(sales, declarations)).toEqual({ donations: 1000, declared: 500, claimable: 125, count: 1, small: 500, smallCount: 1 });
  });

  test('small donations are those of £30 or less with no declaration', () => {
    const giving = (id: string, pence: number) => sale(id, { lines: [{ itemId: 'don', name: 'Donation', price: pence, qty: 1, donation: true }] });
    const sales = [giving('a', 3000), giving('b', 3001), giving('c', 40), sale('d', { lines: [{ itemId: 'tea', name: 'Tea', price: 80, qty: 1 }] })];
    expect(giftAidTotals(sales, [declaration('c', { amount: 40 })])).toMatchObject({ donations: 6041, small: 3000, smallCount: 1 });
  });

  test('a declaration is offered only when it is turned on and the donation is over the event’s amount', () => {
    const a = sale('a'); // a £5 donation alongside a slice of cake
    expect(offersGiftAid(a, null)).toBe(false);
    expect(offersGiftAid(a, undefined)).toBe(false);
    expect(offersGiftAid(a, 3000)).toBe(false);
    expect(offersGiftAid(a, 500)).toBe(false);
    expect(offersGiftAid(a, 499)).toBe(true);
    expect(offersGiftAid(a, 0)).toBe(true);
    // Something bought is never offered Gift Aid, whatever the setting.
    expect(offersGiftAid(sale('b', { lines: [{ itemId: 'tea', name: 'Tea', price: 5000, qty: 1 }] }), 0)).toBe(false);
  });

  test('rounding up adds what takes a total to the next whole pound', () => {
    expect(roundUpBy(260)).toBe(40);
    expect(roundUpBy(1)).toBe(99);
    expect(roundUpBy(300)).toBe(0);
  });

  test('only a donation with no price asks for an amount', () => {
    expect(isOpenDonation({ donation: true, price: 0 })).toBe(true);
    expect(isOpenDonation({ donation: true, price: 500 })).toBe(false);
    expect(isOpenDonation({ price: 0 })).toBe(false);
  });

  test('a declaration whose sale hasn’t arrived yet still counts', () => {
    expect(giftAidTotals([], [declaration('elsewhere')])).toMatchObject({ declared: 500, count: 1 });
  });

  test('the export follows HMRC’s schedule columns, one row per live declaration', () => {
    const csv = giftAidCsv([sale('a'), sale('c', { voided: true })], [declaration('a'), declaration('c', { firstName: 'Voided' })]);
    const rows = csv.split('\n');
    expect(rows[0]).toBe(
      '"Title","First name or initial","Last name","House name or number","Postcode","Aggregated donations","Sponsored event","Donation date","Amount"',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe('"","Ada","Lovelace","12","SW1A 1AA","","","20/06/26","5.00"');
  });

  test('the export gives the date the donation was taken, even when the declaration came later', () => {
    const nextDay = AT + 24 * 60 * 60 * 1000;
    // The sale is on this phone: its date is used.
    expect(giftAidCsv([sale('a')], [declaration('a', { at: nextDay, donatedAt: AT })]).split('\n')[1]).toContain('"20/06/26"');
    // The sale hasn't arrived yet: the donation date saved with the declaration is used.
    expect(giftAidCsv([], [declaration('a', { at: nextDay, donatedAt: AT })]).split('\n')[1]).toContain('"20/06/26"');
    // An older declaration saved without one falls back to when it was made.
    expect(giftAidCsv([], [declaration('a', { at: nextDay })]).split('\n')[1]).toContain('"21/06/26"');
  });

  test('the end-of-day summary gives the Gift Aid totals but no donor’s details', () => {
    const text = summaryText({ eventName: 'Fete', sales: [sale('a'), sale('b')], giftAid: [declaration('a')] });
    expect(text).toContain('Includes £10.00 in donations. 1 Gift Aid declaration covers £5.00, so £1.25 can be claimed from HMRC.');
    expect(text).not.toContain('Lovelace');
    expect(text).not.toContain('SW1A');
  });

  test('a summary with no donations says nothing about Gift Aid', () => {
    const text = summaryText({ eventName: 'Fete', sales: [sale('a', { lines: [{ itemId: 'tea', name: 'Tea', price: 80, qty: 1 }] })] });
    expect(text).not.toMatch(/donation|Gift Aid/i);
  });
});

describe('leaderboard', () => {
  const s = (id: string, tillName: string, total: number, at = AT, voided = false) => sale(id, { tillName, total, at, voided });

  test('tills are ranked by takings, with voided sales left out', () => {
    const rows = standings([s('1', 'Cakes', 500), s('2', 'Tombola', 900), s('3', 'Cakes', 300), s('4', 'Cakes', 1000, AT, true)]);
    expect(rows.map((r) => [r.place, r.tillName, r.takings, r.count])).toEqual([
      [1, 'Tombola', 900, 1],
      [2, 'Cakes', 800, 2],
    ]);
    expect(rows[1].share).toBeCloseTo(800 / 900);
  });

  test('tills on the same takings share a place', () => {
    const rows = standings([s('1', 'A', 500), s('2', 'B', 500), s('3', 'C', 100)]);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3]);
  });

  test('a till that has joined but not sold yet is listed at the bottom', () => {
    const rows = standings([s('1', 'Cakes', 500)], ['Cakes', 'Plants', '']);
    expect(rows.map((r) => [r.tillName, r.takings, r.lastSaleAt])).toEqual([
      ['Cakes', 500, AT],
      ['Plants', 0, null],
    ]);
  });

  test('a till’s name is matched ignoring case and stray spaces', () => {
    const rows = standings([s('1', 'Cake stall', 100), s('2', 'cake stall ', 200)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].takings).toBe(300);
  });

  test('nobody has sold anything yet', () => {
    expect(standings([], ['A', 'B']).map((r) => [r.place, r.share])).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });

  test('time since the last sale reads naturally', () => {
    expect(ago(null, AT)).toBe('no sales yet');
    expect(ago(AT, AT + 30_000)).toBe('just now');
    expect(ago(AT, AT + 4 * 60_000)).toBe('4 min ago');
    expect(ago(AT, AT + 130 * 60_000)).toBe('2 hr ago');
  });

  test('the standings can be shared as a short message', () => {
    const text = standingsText('Summer Fete', standings([s('1', 'Cakes', 500), s('2', 'Tombola', 900)]), AT);
    expect(text).toBe(['Summer Fete: takings at 14:30', '', '1st Tombola: £9.00 (1 sale)', '2nd Cakes: £5.00 (1 sale)', '', 'All tills: £14.00'].join('\n'));
  });
});
