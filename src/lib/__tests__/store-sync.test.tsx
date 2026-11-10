/**
 * Sync tests for the local-first store: a whole session with no signal, then
 * reconnecting; and the app being killed while sales are still unsent.
 *
 * Firestore is replaced by a fake `cloud` module, so "offline" means its
 * writes time out the way the real ones do with no connection.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import * as Cloud from '../cloud';
import { StoreProvider, useStore } from '../store';
import type { OutboxOp, Sale, SaleLine } from '../types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('../firebase', () => ({ cloudEnabled: true }));
jest.mock('../cloud', () => ({
  createEvent: jest.fn(),
  joinEvent: jest.fn(),
  joinAsMember: jest.fn(),
  pushOp: jest.fn(),
  watchEvent: jest.fn(),
}));

const cloud = jest.mocked(Cloud);
const STORAGE_KEY = 'fetetill:v1';
const TEA: SaleLine[] = [{ itemId: 'tea', name: 'Tea', price: 80, qty: 2 }];

type Store = ReturnType<typeof useStore>;
let store: Store;
function Probe() {
  store = useStore();
  return null;
}

/** Lets pending promises and timers run, optionally moving the clock on. */
const settle = (ms = 0) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

/** Starts the app, as on a fresh launch: state comes only from device storage. */
async function launch() {
  const view = await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await settle();
  return view;
}

const goOffline = () => {
  cloud.pushOp.mockRejectedValue(new Error('timeout'));
  cloud.joinAsMember.mockRejectedValue(new Error('timeout'));
};
const goOnline = () => {
  cloud.pushOp.mockResolvedValue(undefined);
  cloud.joinAsMember.mockResolvedValue(undefined);
};

async function sell(method: 'cash' | 'card' = 'cash') {
  let sale!: Sale;
  await act(async () => {
    sale = store.recordSale(TEA, method, 200);
  });
  await settle();
  return sale;
}

const persisted = async () => JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}');
const pushedOps = () => cloud.pushOp.mock.calls.map(([, op]) => op);
const opKey = (op: OutboxOp) => (op.kind === 'sale' ? `sale:${op.sale.id}` : op.kind === 'void' ? `void:${op.saleId}` : 'items');

let onRemoteSales: (sales: Sale[]) => void;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  goOnline();
  cloud.createEvent.mockResolvedValue({ eventId: 'ev1', code: 'ABC234' });
  cloud.watchEvent.mockImplementation((_id, _onEvent, onSales) => {
    onRemoteSales = onSales;
    return () => {};
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function launchInCloudEvent() {
  const view = await launch();
  await act(() => store.createCloudEvent('Summer Fete', 'Cake stall'));
  await settle();
  return view;
}

describe('with signal', () => {
  test('a sale is sent straight away and the outbox empties', async () => {
    await launchInCloudEvent();
    const sale = await sell();

    expect(cloud.pushOp).toHaveBeenCalledWith('ev1', { kind: 'sale', sale });
    expect(store.outbox).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
  });
});

describe('a whole session with no signal', () => {
  test('every sale is kept on the phone, then sent in order on reconnect', async () => {
    await launchInCloudEvent();
    goOffline();

    const sales: Sale[] = [];
    for (let i = 0; i < 12; i++) sales.push(await sell(i % 3 === 0 ? 'card' : 'cash'));
    await settle(60_000); // several failed retries change nothing

    expect(Object.keys(store.sales)).toHaveLength(12);
    expect(store.outbox).toHaveLength(12);
    expect(store.syncStatus).toBe('waiting');
    expect(store.syncError).toMatch(/saved on this phone/i);
    expect((await persisted()).outbox).toHaveLength(12);

    cloud.pushOp.mockClear();
    goOnline();
    await settle(15_000); // the next periodic retry

    expect(pushedOps().map(opKey)).toEqual(sales.map((s) => `sale:${s.id}`));
    expect(store.outbox).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
    expect(store.syncError).toBeNull();
    expect((await persisted()).outbox).toHaveLength(0);
    expect(Object.keys((await persisted()).sales)).toHaveLength(12);
  });

  test('voids and price-list edits made offline are sent after the sales they follow', async () => {
    await launchInCloudEvent();
    goOffline();

    const first = await sell();
    await act(async () => store.setVoided(first.id, true));
    const second = await sell();
    await act(async () => store.setItems([{ id: 'tea', name: 'Tea', price: 90 }]));
    await settle();

    cloud.pushOp.mockClear();
    goOnline();
    await settle(15_000);

    expect(pushedOps().map(opKey)).toEqual([`sale:${first.id}`, `void:${first.id}`, `sale:${second.id}`, 'items']);
    expect(store.outbox).toHaveLength(0);
  });

  test('signal dropping part-way through a send keeps the rest queued, with no resends', async () => {
    await launchInCloudEvent();
    goOffline();
    const [a, b, c] = [await sell(), await sell(), await sell()];

    cloud.pushOp.mockClear();
    cloud.joinAsMember.mockResolvedValue(undefined);
    cloud.pushOp.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('timeout'));
    await settle(15_000);

    expect(store.outbox.map(opKey)).toEqual([`sale:${b.id}`, `sale:${c.id}`]);
    expect(store.syncStatus).toBe('waiting');

    goOnline();
    await settle(15_000);

    expect(pushedOps().map(opKey)).toEqual([`sale:${a.id}`, `sale:${b.id}`, `sale:${b.id}`, `sale:${c.id}`]);
    expect(store.outbox).toHaveLength(0);
  });

  test('the Send now button retries without waiting for the timer', async () => {
    await launchInCloudEvent();
    goOffline();
    await sell();
    goOnline();

    await act(async () => store.flushNow());
    await settle();

    expect(store.outbox).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
  });

  test('an update from another till does not undo a void that is still waiting to send', async () => {
    await launchInCloudEvent();
    const sale = await sell();
    goOffline();
    await act(async () => store.setVoided(sale.id, true));
    await settle();

    // The server still has the un-voided copy, and another till's sale.
    const other: Sale = { ...sale, id: 'from-other-till', tillName: 'Tombola' };
    await act(async () => onRemoteSales([{ ...sale, voided: false }, other]));

    expect(store.sales[sale.id].voided).toBe(true);
    expect(store.sales['from-other-till'].tillName).toBe('Tombola');
  });
});

describe('the app is killed with unsent sales', () => {
  test('sales and the outbox survive a restart and are sent once there is signal', async () => {
    const firstRun = await launchInCloudEvent();
    goOffline();
    const a = await sell();
    const b = await sell('card');
    await act(async () => store.setVoided(a.id, true));
    await settle();
    await firstRun.unmount(); // killed: nothing in memory survives

    cloud.pushOp.mockClear();
    cloud.joinAsMember.mockClear();
    await launch(); // relaunched, still no signal

    expect(store.session).toMatchObject({ eventId: 'ev1', code: 'ABC234', tillName: 'Cake stall', mode: 'cloud' });
    expect(store.sales[a.id]).toMatchObject({ total: 160, voided: true });
    expect(store.sales[b.id]).toMatchObject({ total: 160, method: 'card' });
    expect(store.outbox.map(opKey)).toEqual([`sale:${a.id}`, `sale:${b.id}`, `void:${a.id}`]);
    expect(store.syncStatus).toBe('waiting');
    expect(cloud.pushOp).not.toHaveBeenCalled(); // can't confirm membership yet

    goOnline();
    await settle(15_000);

    // A restart may bring a new anonymous user, so the till re-joins before sending.
    expect(cloud.joinAsMember).toHaveBeenLastCalledWith('ev1', 'ABC234', 'Cake stall');
    expect(pushedOps().map(opKey)).toEqual([`sale:${a.id}`, `sale:${b.id}`, `void:${a.id}`]);
    expect(store.outbox).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
  });

  test('being killed repeatedly never drops or duplicates a queued sale', async () => {
    let run = await launchInCloudEvent();
    goOffline();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await sell()).id);
      ids.push((await sell()).id);
      await run.unmount();
      run = await launch();
    }

    expect(store.outbox.map(opKey)).toEqual(ids.map((id) => `sale:${id}`));
    expect(Object.keys(store.sales).sort()).toEqual([...ids].sort());
  });

  test('a sale is on disk as soon as it is recorded, before any send finishes', async () => {
    await launchInCloudEvent();
    cloud.pushOp.mockReturnValue(new Promise(() => {})); // a send that never comes back
    const sale = await sell();

    const disk = await persisted();
    expect(disk.sales[sale.id]).toMatchObject({ id: sale.id, total: 160 });
    expect(disk.outbox).toHaveLength(1);
  });

  test('unreadable storage starts fresh instead of crashing', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await launch();

    expect(store.loaded).toBe(true);
    expect(store.session).toBeNull();
    expect(store.outbox).toEqual([]);
  });
});

describe('local-only events', () => {
  test('sales are saved and survive a restart, and nothing is sent', async () => {
    const firstRun = await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    const sale = await sell();
    await settle(60_000);
    await firstRun.unmount();
    await launch();

    expect(store.syncStatus).toBe('local');
    expect(store.outbox).toEqual([]); // so the Event tab never warns about unsent changes
    expect(store.sales[sale.id]).toMatchObject({ total: 160, tillName: 'Till 1' });
    expect(cloud.pushOp).not.toHaveBeenCalled();
    expect(cloud.joinAsMember).not.toHaveBeenCalled();
  });
});
