import { categoriesOf, groupByCategory, tileColours } from '../categories';
import { cashToCount, tillFloats } from '../floats';
import type { Item, Session } from '../types';

const session: Session = { eventId: 'fete', eventName: 'Summer Fete', code: 'ABC234', tillName: 'Cake stall', mode: 'cloud', float: 2000 };

describe('opening floats', () => {
  test('a this-phone-only event has just this till’s float', () => {
    expect(tillFloats({ ...session, mode: 'local' }, 'me', [{ deviceId: 'x', tillName: 'Tombola', float: 500 }])).toEqual([
      { tillName: 'Cake stall', float: 2000 },
    ]);
    expect(tillFloats({ ...session, mode: 'local', float: undefined }, 'me', [])).toEqual([]);
    expect(tillFloats(null, 'me', [])).toEqual([]);
  });

  test('in a shared event, this phone’s own figure replaces the server’s copy of it', () => {
    const floats = tillFloats(session, 'me', [
      { deviceId: 'me', tillName: 'Cake stall', float: 500 }, // stale: changed on this phone since
      { deviceId: 'a', tillName: 'Tombola', float: 1500 },
      { deviceId: 'b', tillName: 'Plants', float: 0 },
    ]);
    expect(floats).toEqual([
      { tillName: 'Cake stall', float: 2000 },
      { tillName: 'Tombola', float: 1500 },
    ]);
  });

  test('a phone whose sign-in changed is counted once, by its latest registration', () => {
    const floats = tillFloats(session, 'me', [
      { deviceId: 'a', tillName: 'Tombola', float: 1500, joinedAt: 100 },
      { deviceId: 'a', tillName: 'Tombola', float: 2500, joinedAt: 300 }, // same phone, new sign-in, float corrected
      { deviceId: 'me', tillName: 'Cake stall', float: 2000, joinedAt: 100 },
      { deviceId: 'me', tillName: 'Cake stall', float: 2000, joinedAt: 200 },
      { deviceId: '', tillName: 'Plants', float: 500 }, // registered before floats carried a device id
      { deviceId: '', tillName: 'Books', float: 700 },
    ]);
    expect(floats).toEqual([
      { tillName: 'Cake stall', float: 2000 },
      { tillName: 'Plants', float: 500 },
      { tillName: 'Books', float: 700 },
      { tillName: 'Tombola', float: 2500 },
    ]);
  });

  test('two phones on one till are added together', () => {
    expect(tillFloats(session, 'me', [{ deviceId: 'a', tillName: ' cake stall', float: 1000 }])).toEqual([{ tillName: 'Cake stall', float: 3000 }]);
  });

  test('each tin should hold its float plus the cash it took', () => {
    const totals = {
      cash: 4500,
      byTill: [
        { tillName: 'Cake stall', count: 3, value: 5000, cash: 3000 },
        { tillName: 'Tombola', count: 2, value: 1500, cash: 1500 },
        { tillName: 'Card only', count: 1, value: 400, cash: 0 },
      ],
    };
    const tins = cashToCount(totals, [
      { tillName: 'cake stall', float: 2000 },
      { tillName: 'Plants', float: 1000 },
    ]);
    expect(tins.rows).toEqual([
      { tillName: 'cake stall', float: 2000, cash: 3000, inTin: 5000 },
      { tillName: 'Tombola', float: 0, cash: 1500, inTin: 1500 },
      { tillName: 'Plants', float: 1000, cash: 0, inTin: 1000 },
    ]);
    expect(tins).toMatchObject({ float: 3000, inTin: 7500 });
    expect(tins.rows.reduce((n, r) => n + r.inTin, 0)).toBe(tins.inTin);
  });

  test('with no floats, the tins hold the cash taken', () => {
    expect(cashToCount({ cash: 800, byTill: [{ tillName: 'Till 1', count: 2, value: 800, cash: 800 }] }, [])).toMatchObject({ float: 0, inTin: 800 });
  });
});

describe('item categories', () => {
  const items: Item[] = [
    { id: 'tea', name: 'Tea', price: 80, category: 'Drinks' },
    { id: 'raffle', name: 'Raffle', price: 100 },
    { id: 'cake', name: 'Cake', price: 150, category: 'Cakes' },
    { id: 'coffee', name: 'Coffee', price: 100, category: ' drinks' },
  ];

  test('are listed in the order they first appear, ignoring case and spaces', () => {
    expect(categoriesOf(items)).toEqual(['Drinks', 'Cakes']);
  });

  test('group the items, with those in no category last', () => {
    expect(groupByCategory(items).map((g) => [g.category, g.items.map((i) => i.id)])).toEqual([
      ['Drinks', ['tea', 'coffee']],
      ['Cakes', ['cake']],
      ['Other', ['raffle']],
    ]);
  });

  test('with no categories there is one unnamed group', () => {
    const plain: Item[] = items.map(({ category: _c, ...i }) => i);
    expect(groupByCategory(plain).map((g) => [g.category, g.items.length])).toEqual([['', 4]]);
    expect(groupByCategory([])).toEqual([]);
  });

  test('a category’s items share a colour, and a chosen colour wins', () => {
    const auto = tileColours(items);
    expect(auto.get('tea')).toBe(auto.get('coffee'));
    expect(auto.get('tea')).not.toBe(auto.get('cake'));

    const chosen = tileColours([...items.slice(0, 3), { ...items[3], colour: 'purple' }, { id: 'jam', name: 'Jam', price: 300, colour: 'orange' }]);
    expect(chosen.get('coffee')).toBe('purple');
    expect(chosen.get('tea')).toBe('purple'); // the rest of Drinks follows
    expect(chosen.get('jam')).toBe('orange');
  });

  test('an unknown colour falls back to an automatic one', () => {
    expect(tileColours([{ id: 'a', colour: 'beige' }]).get('a')).toBe('red');
  });
});
