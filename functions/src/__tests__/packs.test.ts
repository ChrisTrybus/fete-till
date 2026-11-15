/** The server's rules for event packs: which purchases count, and what starting an event must send. */
import { CODE_ALPHABET, makeCode, packPurchases, PACKS, readEventRequest } from '../packs';

describe('packPurchases', () => {
  const tx = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    store_transaction_id: `store-${id}`,
    purchase_date: '2026-11-01T10:00:00Z',
    store: 'app_store',
    is_sandbox: false,
    ...extra,
  });

  it('counts each pack purchase once, by RevenueCat’s transaction id, with its events', () => {
    const list = packPurchases({ cashtin_event_1: [tx('a')], cashtin_event_5: [tx('b'), tx('c')] }, false);
    expect(list.map((c) => [c.id, c.credits])).toEqual([
      ['a', 1],
      ['b', 5],
      ['c', 5],
    ]);
    expect(list[0]).toMatchObject({ product: 'cashtin_event_1', store: 'app_store', sandbox: false, at: '2026-11-01T10:00:00Z' });
  });

  it('ignores other products and anything malformed', () => {
    expect(packPurchases({ some_other_thing: [tx('x')], cashtin_event_1: 'nonsense' }, false)).toEqual([]);
    expect(packPurchases({ cashtin_event_1: [{}, null, tx('')] }, false)).toEqual([]);
    expect(packPurchases(undefined, false)).toEqual([]);
  });

  it('only counts test purchases when told to', () => {
    const history = { cashtin_event_5: [tx('t', { is_sandbox: true })] };
    expect(packPurchases(history, false)).toEqual([]);
    expect(packPurchases(history, true)).toHaveLength(1);
  });

  it('matches the packs on sale: 1 event and 5 events', () => {
    expect(PACKS).toEqual({ cashtin_event_1: 1, cashtin_event_5: 5 });
  });
});

describe('readEventRequest', () => {
  const ok = { eventId: 'a'.repeat(20), name: ' Summer Fete ', tillName: 'Cakes', items: [], deviceId: 'd1', accountToken: 'tok' };

  it('tidies a good request', () => {
    expect(readEventRequest(ok)).toEqual({ ...ok, name: 'Summer Fete' });
    expect(readEventRequest({ ...ok, tillName: '  ', deviceId: undefined, accountToken: '' })).toMatchObject({
      tillName: 'Till 1',
      deviceId: null,
      accountToken: null,
    });
  });

  it('refuses a missing or odd event id, a missing name, and a price list that is too long', () => {
    expect(readEventRequest({ ...ok, eventId: 'short' })).toBe('Missing event id.');
    expect(readEventRequest({ ...ok, eventId: '../../codes/ABC23456' })).toBe('Missing event id.');
    expect(readEventRequest({ ...ok, name: '   ' })).toBe('The event needs a name.');
    expect(readEventRequest({ ...ok, items: 'tea' })).toBe('Missing price list.');
    expect(readEventRequest({ ...ok, items: Array(201).fill({}) })).toMatch('200');
    expect(readEventRequest(null)).toBe('Missing event id.');
  });
});

describe('makeCode', () => {
  it('uses only the easy-to-read letters and digits', () => {
    let n = 0;
    const code = makeCode(8, (max) => n++ % max);
    expect(code).toHaveLength(8);
    expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });
});
