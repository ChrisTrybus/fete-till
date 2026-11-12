import AsyncStorage from '@react-native-async-storage/async-storage';
import { listPastEvents, loadPastEvent, savePastEvent } from '../history';
import type { Sale, Session } from '../types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../history-storage', () => ({
  historyStorage: require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
}));

const START = Date.UTC(2026, 5, 20, 10, 0);
const session: Session = { eventId: 'fete', eventName: 'Summer Fete', code: 'ABC123', tillName: 'Cake stall', mode: 'cloud', startedAt: START };

const sale = (id: string, extra: Partial<Sale> = {}): Sale => ({
  id,
  at: START + 60 * 1000,
  total: 200,
  method: 'cash',
  tendered: 200,
  lines: [{ itemId: 'cake', name: 'Slice of cake', price: 200, qty: 1 }],
  tillName: 'Cake stall',
  deviceId: 'd1',
  voided: false,
  ...extra,
});

beforeEach(() => AsyncStorage.clear());

describe('leaving the same event a second time', () => {
  test('keeps sales that only the first saved copy had', async () => {
    // First visit: "unsent" never reached the other tills.
    await savePastEvent(session, [sale('shared'), sale('unsent')], START + 1000);
    // Joined again: the phone now holds only what the server had, plus a new sale.
    const rejoined = { ...session, startedAt: START + 5000 };
    await savePastEvent(rejoined, [sale('shared'), sale('later', { method: 'card' })], START + 9000);

    const events = await listPastEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ takings: 600, cash: 400, card: 200, count: 3, startedAt: START, endedAt: START + 9000 });
    const found = await loadPastEvent('fete');
    expect(found?.sales.map((s) => s.id).sort()).toEqual(['later', 'shared', 'unsent']);
  });

  test('the phone’s current copy of a sale replaces the saved one', async () => {
    await savePastEvent(session, [sale('a'), sale('b')], START + 1000);
    await savePastEvent(session, [sale('a', { voided: true })], START + 9000);

    const [event] = await listPastEvents();
    expect(event).toMatchObject({ takings: 200, count: 1 });
    const found = await loadPastEvent('fete');
    expect(found?.sales.find((s) => s.id === 'a')?.voided).toBe(true);
  });
});
