import { soldOnTill, toggleTill, uniqueTills } from '../tills';
import type { Item } from '../types';

const tea: Item = { id: 'tea', name: 'Tea', price: 80 };
const cake: Item = { id: 'cake', name: 'Cake', price: 150, tills: ['Cake stall'] };

describe('which till sells an item', () => {
  test('an item with no tills chosen is sold everywhere', () => {
    expect(soldOnTill(tea, 'Raffle')).toBe(true);
    expect(soldOnTill({ ...tea, tills: [] }, 'Raffle')).toBe(true);
  });

  test('an item with tills chosen is sold only on those', () => {
    expect(soldOnTill(cake, 'Cake stall')).toBe(true);
    expect(soldOnTill(cake, 'Raffle')).toBe(false);
  });

  test('till names match whatever the capitals or stray spaces', () => {
    expect(soldOnTill(cake, ' cake STALL ')).toBe(true);
  });
});

describe('the list of tills to choose from', () => {
  test('blanks and repeats are dropped, keeping the first spelling', () => {
    expect(uniqueTills(['Cake stall', '', 'cake stall', ' Raffle ', 'Raffle'])).toEqual(['Cake stall', 'Raffle']);
  });
});

describe('choosing tills for an item', () => {
  const known = ['Cake stall', 'Raffle', 'Drinks'];

  test('picking a till for an everywhere item narrows it to that till', () => {
    expect(toggleTill(undefined, 'Raffle', known)).toEqual(['Raffle']);
  });

  test('a second till can be added, and taken off again', () => {
    expect(toggleTill(['Raffle'], 'Drinks', known)).toEqual(['Raffle', 'Drinks']);
    expect(toggleTill(['Raffle', 'Drinks'], 'raffle', known)).toEqual(['Drinks']);
  });

  test('taking off the last till, or picking them all, goes back to everywhere', () => {
    expect(toggleTill(['Raffle'], 'Raffle', known)).toBeUndefined();
    expect(toggleTill(['Cake stall', 'Raffle'], 'Drinks', known)).toBeUndefined();
  });
});
