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
import { listPastEvents, loadPastEvent } from '../history';
import { StoreProvider, useStore } from '../store';
import type { GiftAidDeclaration, Item, Member, OutboxOp, Sale, SaleLine } from '../types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// Past events go to the same in-memory storage as everything else.
jest.mock('../history-storage', () => ({
  historyStorage: require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('../firebase', () => ({ cloudEnabled: true }));
jest.mock('../cloud', () => ({
  createEvent: jest.fn(),
  joinEvent: jest.fn(),
  joinAsMember: jest.fn(),
  claimOrganiser: jest.fn(),
  pushOp: jest.fn(),
  saleExists: jest.fn(),
  watchEvent: jest.fn(),
  watchGiftAid: jest.fn(),
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
const opKey = (op: OutboxOp) => (op.kind === 'sale' ? `sale:${op.sale.id}` : op.kind === 'void' ? `void:${op.saleId}` : op.kind);

let onRemoteSales: (sales: Sale[]) => void;
let onRemoteEvent: (e: { name: string; items: Item[]; closedAt?: number | null; giftAidOver?: number | null }) => void;
let onRemoteMembers: (members: Member[]) => void;
let onRemoteGiftAid: ((list: GiftAidDeclaration[]) => void) | undefined;
let onGiftAidError: ((e: Error) => void) | undefined;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  onRemoteGiftAid = undefined;
  await AsyncStorage.clear();
  goOnline();
  cloud.createEvent.mockResolvedValue({ eventId: 'ev1', code: 'ABC234', organiserCode: 'QRSTUVWX' });
  cloud.joinEvent.mockResolvedValue({ eventId: 'ev1', code: 'ABC234', eventName: 'Summer Fete', items: [], float: 0, giftAidOver: null });
  cloud.claimOrganiser.mockResolvedValue(undefined);
  cloud.saleExists.mockResolvedValue(false);
  cloud.watchGiftAid.mockImplementation((_id, onDeclarations, onError) => {
    onGiftAidError = onError;
    onRemoteGiftAid = onDeclarations;
    return () => {};
  });
  cloud.watchEvent.mockImplementation((_id, onEvent, onSales, _onError, onMembers) => {
    onRemoteEvent = (e) => onEvent({ closedAt: null, ...e });
    onRemoteSales = onSales;
    onRemoteMembers = onMembers!;
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
    expect(cloud.joinAsMember).toHaveBeenLastCalledWith('ev1', 'ABC234', 'Cake stall', { deviceId: store.deviceId, float: 0 });
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

describe('a change the event refuses', () => {
  const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const longList = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `Item ${i}`, price: 100 }));
  /** The server accepts everything except what `refuse` picks out. */
  const refuseWhen = (refuse: (op: OutboxOp) => boolean) =>
    cloud.pushOp.mockImplementation(async (_id, op) => {
      if (refuse(op)) throw refusal();
    });

  test('a refused price list is set aside and the sales behind it still send', async () => {
    await launchInCloudEvent();
    refuseWhen((op) => op.kind === 'items' && op.items.length > 200);

    await act(async () => store.setItems(longList(201)));
    const sale = await sell();

    expect(store.outbox).toHaveLength(0);
    expect(store.parked).toHaveLength(1);
    expect(store.parked[0].op.kind).toBe('items');
    expect(store.parked[0].reason).toMatch(/201 items/);
    expect(store.syncStatus).toBe('attention');
    expect(cloud.pushOp).toHaveBeenCalledWith('ev1', { kind: 'sale', sale });
    expect(store.items).toHaveLength(201); // still on this phone, to be fixed
    expect((await persisted()).parked).toHaveLength(1);
  });

  test('saving a fixed price list replaces the refused one', async () => {
    await launchInCloudEvent();
    refuseWhen((op) => op.kind === 'items' && op.items.length > 200);
    await act(async () => store.setItems(longList(201)));
    await settle();

    await act(async () => store.setItems(longList(150)));
    await settle();

    expect(store.parked).toHaveLength(0);
    expect(store.outbox).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
    const last = pushedOps().at(-1);
    expect(last?.kind === 'items' && last.items.length).toBe(150);
  });

  test('discarding a refused price list goes back to the shared one', async () => {
    await launchInCloudEvent();
    const shared: Item[] = [{ id: 'tea', name: 'Tea', price: 80 }];
    await act(async () => onRemoteEvent({ name: 'Summer Fete', items: shared }));
    refuseWhen((op) => op.kind === 'items');
    await act(async () => store.setItems(longList(201)));
    await settle();

    // An update from the server must not wipe out the list being fixed.
    await act(async () => onRemoteEvent({ name: 'Summer Fete', items: shared }));
    expect(store.items).toHaveLength(201);

    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(0);
    expect(store.items).toEqual(shared);
    expect(store.syncStatus).toBe('synced');
  });

  test('a refused price list can still be discarded after a restart with no signal', async () => {
    const firstRun = await launchInCloudEvent();
    const shared: Item[] = [{ id: 'tea', name: 'Tea', price: 80 }];
    await act(async () => onRemoteEvent({ name: 'Summer Fete', items: shared }));
    refuseWhen((op) => op.kind === 'items');
    await act(async () => store.setItems(longList(201)));
    await settle();
    await firstRun.unmount();

    goOffline();
    cloud.watchEvent.mockImplementation(() => () => {}); // nothing is heard from the server
    await launch();
    expect(store.items).toHaveLength(201);

    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(0);
    expect(store.items).toEqual(shared);
  });

  test('a refused price list stays set aside until this phone has heard the shared one', async () => {
    await launchInCloudEvent(); // nothing heard from the server yet
    refuseWhen((op) => op.kind === 'items');
    await act(async () => store.setItems(longList(201)));
    await settle();

    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(1); // still flagged, not silently kept
    expect(store.items).toHaveLength(201);

    const shared: Item[] = [{ id: 'tea', name: 'Tea', price: 80 }];
    await act(async () => onRemoteEvent({ name: 'Summer Fete', items: shared }));
    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(0);
    expect(store.items).toEqual(shared);
  });

  test('a refused sale is kept on the phone, never dropped, and can be retried', async () => {
    await launchInCloudEvent();
    refuseWhen((op) => op.kind === 'sale');
    const bad = await sell();
    await act(async () => store.setVoided(bad.id, true)); // voided while set aside
    await settle();

    expect(store.sales[bad.id]).toMatchObject({ total: 160, voided: true });
    expect(store.parked.map((p) => opKey(p.op))).toEqual([`sale:${bad.id}`]);
    expect(store.outbox).toHaveLength(0); // the void is not queued on its own

    await act(async () => store.discardParked(store.parked[0].id));
    expect(store.parked).toHaveLength(1); // sales can't be discarded

    cloud.pushOp.mockClear();
    goOnline();
    await act(async () => store.retryParked(store.parked[0].id));
    await settle();

    expect(pushedOps()).toEqual([{ kind: 'sale', sale: { ...bad, voided: true } }]);
    expect(store.parked).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
  });

  test('a resent sale that is already on the server counts as sent', async () => {
    await launchInCloudEvent();
    refuseWhen((op) => op.kind === 'sale');
    cloud.saleExists.mockResolvedValue(true);

    const sale = await sell();

    expect(cloud.saleExists).toHaveBeenCalledWith('ev1', sale.id);
    expect(store.parked).toHaveLength(0);
    expect(store.outbox).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
  });

  test('a refusal is retried once after re-joining, in case membership had lapsed', async () => {
    await launchInCloudEvent();
    cloud.pushOp.mockRejectedValueOnce(refusal());
    cloud.joinAsMember.mockClear();

    await sell();

    expect(cloud.joinAsMember).toHaveBeenCalledTimes(1);
    expect(store.parked).toHaveLength(0);
    expect(store.outbox).toHaveLength(0);
  });

  test('a refused void is set aside, and discarding it restores the sale', async () => {
    await launchInCloudEvent();
    const sale = await sell();
    refuseWhen((op) => op.kind === 'void');
    await act(async () => store.setVoided(sale.id, true));
    const next = await sell();

    expect(store.parked.map((p) => opKey(p.op))).toEqual([`void:${sale.id}`]);
    expect(pushedOps().map(opKey)).toContain(`sale:${next.id}`);
    // The server's un-voided copy doesn't overwrite the choice made here.
    await act(async () => onRemoteSales([{ ...sale, voided: false }]));
    expect(store.sales[sale.id].voided).toBe(true);

    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(0);
    expect(store.sales[sale.id].voided).toBe(false);
  });

  test('no signal is never mistaken for a refusal', async () => {
    await launchInCloudEvent();
    goOffline();
    await sell();
    await settle(60_000);

    expect(store.parked).toHaveLength(0);
    expect(store.outbox).toHaveLength(1);
    expect(cloud.saleExists).not.toHaveBeenCalled();
  });

  test('set-aside changes survive the app being killed', async () => {
    const firstRun = await launchInCloudEvent();
    refuseWhen((op) => op.kind === 'sale');
    const bad = await sell();
    await firstRun.unmount();
    await launch();

    expect(store.parked.map((p) => opKey(p.op))).toEqual([`sale:${bad.id}`]);
    expect(store.sales[bad.id]).toMatchObject({ total: 160 });
    expect(store.syncStatus).toBe('attention');
  });
});

describe('the organiser role', () => {
  const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

  async function launchAsVolunteer() {
    const view = await launch();
    await act(() => store.joinCloudEvent('ABC234', 'Tombola'));
    await settle();
    return view;
  }

  test('the phone that starts an event is its organiser and holds the organiser code', async () => {
    await launchInCloudEvent();

    expect(store.isOrganiser).toBe(true);
    expect(store.session?.organiserCode).toBe('QRSTUVWX');
  });

  test('a phone that joins with the join code is not an organiser', async () => {
    await launchAsVolunteer();

    expect(store.isOrganiser).toBe(false);
    expect(cloud.claimOrganiser).not.toHaveBeenCalled();
  });

  test('a this-phone-only event has no one else to be organiser', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));

    expect(store.isOrganiser).toBe(true);
  });

  test('entering the organiser code makes a joined phone an organiser, and it lasts through a restart', async () => {
    const firstRun = await launchAsVolunteer();

    await act(() => store.claimOrganiser('qrst uvwx'));

    expect(cloud.claimOrganiser).toHaveBeenCalledWith('ev1', 'QRSTUVWX');
    expect(store.isOrganiser).toBe(true);

    await firstRun.unmount();
    cloud.claimOrganiser.mockClear();
    await launch();

    expect(store.isOrganiser).toBe(true);
    // A restart may bring a new anonymous user, so the role is claimed again.
    expect(cloud.claimOrganiser).toHaveBeenCalledWith('ev1', 'QRSTUVWX');
  });

  test('a wrong organiser code is turned down with a clear message', async () => {
    await launchAsVolunteer();
    cloud.claimOrganiser.mockRejectedValue(refusal());

    let error: unknown;
    await act(async () => {
      await store.claimOrganiser('WRONGWRO').catch((e) => (error = e));
    });

    expect((error as Error).message).toMatch(/organiser code/i);
    expect(store.isOrganiser).toBe(false);
  });

  test('no signal while entering the code is not reported as a wrong code', async () => {
    await launchAsVolunteer();
    cloud.claimOrganiser.mockRejectedValue(new Error('timeout'));

    let error: unknown;
    await act(async () => {
      await store.claimOrganiser('QRSTUVWX').catch((e) => (error = e));
    });

    expect((error as Error).message).toBe('timeout');
    expect(store.isOrganiser).toBe(false);
  });

  test('a stored code the event no longer accepts drops the role, and sales still send', async () => {
    const firstRun = await launchInCloudEvent();
    await firstRun.unmount();
    cloud.claimOrganiser.mockRejectedValue(refusal());
    await launch();

    expect(store.isOrganiser).toBe(false);
    await sell();
    expect(store.outbox).toHaveLength(0);
    expect(store.syncStatus).toBe('synced');
  });

  test('a volunteer’s void of another till’s sale is set aside, saying why', async () => {
    await launchAsVolunteer();
    const theirs: Sale = { id: 'theirs', at: 1, total: 160, method: 'cash', tendered: 200, lines: TEA, tillName: 'Cake stall', deviceId: 'other-phone', voided: false };
    await act(async () => onRemoteSales([theirs]));
    cloud.pushOp.mockImplementation(async (_id, op) => {
      if (op.kind === 'void') throw refusal();
    });

    await act(async () => store.setVoided('theirs', true));
    await settle();

    expect(store.parked.map((p) => opKey(p.op))).toEqual(['void:theirs']);
    expect(store.parked[0].reason).toMatch(/only the organiser/i);
  });
});

describe('closing the event', () => {
  const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const fete = { name: 'Summer Fete', items: [] as Item[] };

  test('closing is sent to the other tills, and reopening undoes it', async () => {
    await launchInCloudEvent();

    await act(async () => store.setClosed(true));
    await settle();

    const closedAt = store.session?.closedAt;
    expect(closedAt).toEqual(expect.any(Number));
    expect(pushedOps().at(-1)).toEqual({ kind: 'close', closedAt });
    expect(store.outbox).toHaveLength(0);

    await act(async () => store.setClosed(false));
    await settle();

    expect(store.session?.closedAt).toBeNull();
    expect(pushedOps().at(-1)).toEqual({ kind: 'close', closedAt: null });
  });

  test('a till hears that the organiser closed the event, and that it reopened', async () => {
    await launchInCloudEvent();

    await act(async () => onRemoteEvent({ ...fete, closedAt: 1700000000000 }));
    expect(store.session?.closedAt).toBe(1700000000000);

    await act(async () => onRemoteEvent({ ...fete, closedAt: null }));
    expect(store.session?.closedAt).toBeNull();
  });

  test('closing with no signal holds on this phone, survives a restart, and sends after the sales before it', async () => {
    const firstRun = await launchInCloudEvent();
    goOffline();
    const sale = await sell();
    await act(async () => store.setClosed(true));
    await settle();

    // The server still says open; that must not undo a close that is waiting to send.
    await act(async () => onRemoteEvent({ ...fete, closedAt: null }));
    expect(store.session?.closedAt).toEqual(expect.any(Number));

    await firstRun.unmount();
    await launch();
    expect(store.session?.closedAt).toEqual(expect.any(Number));

    cloud.pushOp.mockClear();
    goOnline();
    await settle(15_000);

    expect(pushedOps().map(opKey)).toEqual([`sale:${sale.id}`, 'close']);
    expect(store.outbox).toHaveLength(0);
  });

  test('closing then reopening before either is sent sends only the latest choice', async () => {
    await launchInCloudEvent();
    goOffline();
    await act(async () => store.setClosed(true));
    await act(async () => store.setClosed(false));
    await settle();

    expect(store.outbox).toEqual([{ kind: 'close', closedAt: null }]);
  });

  test('a close the event refuses is set aside, and discarding it goes back to what the other tills see', async () => {
    await launch();
    await act(() => store.joinCloudEvent('ABC234', 'Tombola'));
    await settle();
    cloud.pushOp.mockImplementation(async (_id, op) => {
      if (op.kind === 'close') throw refusal();
    });

    await act(async () => store.setClosed(true));
    await settle();

    expect(store.parked.map((p) => opKey(p.op))).toEqual(['close']);
    expect(store.parked[0].reason).toMatch(/only the organiser/i);

    // Nothing heard from the server yet, so there is no shared state to go back to.
    await act(async () => store.discardParked(store.parked[0].id));
    expect(store.parked).toHaveLength(1);
    expect(store.session?.closedAt).toEqual(expect.any(Number));

    await act(async () => onRemoteEvent({ ...fete, closedAt: null }));
    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(0);
    expect(store.session?.closedAt).toBeNull();
  });

  test('discarding a refused reopen after a restart with no signal keeps the event closed', async () => {
    const firstRun = await launch();
    await act(() => store.joinCloudEvent('ABC234', 'Tombola'));
    await settle();
    await act(async () => onRemoteEvent({ ...fete, closedAt: 1700000000000 }));
    cloud.pushOp.mockImplementation(async (_id, op) => {
      if (op.kind === 'close') throw refusal();
    });
    await act(async () => store.setClosed(false));
    await settle();
    await firstRun.unmount();

    goOffline();
    cloud.watchEvent.mockImplementation(() => () => {});
    await launch();
    expect(store.session?.closedAt).toBeNull();

    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(0);
    expect(store.session?.closedAt).toBe(1700000000000);
  });

  test('a sale that reaches a closed event from a till with no signal is still sent', async () => {
    await launchInCloudEvent();
    goOffline();
    const sale = await sell();
    await act(async () => onRemoteEvent({ ...fete, closedAt: Date.now() }));

    cloud.pushOp.mockClear();
    goOnline();
    await settle(15_000);

    expect(pushedOps().map(opKey)).toEqual([`sale:${sale.id}`]);
    expect(store.outbox).toHaveLength(0);
  });

  test('a this-phone-only event can be closed and reopened, with nothing queued', async () => {
    const firstRun = await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    await act(async () => store.setClosed(true));
    await firstRun.unmount();
    await launch();

    expect(store.session?.closedAt).toEqual(expect.any(Number));
    expect(store.outbox).toEqual([]);

    await act(async () => store.setClosed(false));
    expect(store.session?.closedAt).toBeNull();
  });
});

describe('the Gift Aid setting', () => {
  const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const fete = { name: 'Summer Fete', items: [] as Item[] };

  test('declarations are off until an organiser turns them on, which is sent to the other tills', async () => {
    await launchInCloudEvent();
    expect(store.session?.giftAidOver ?? null).toBeNull();

    await act(async () => store.setGiftAidOver(3000));
    await settle();

    expect(store.session?.giftAidOver).toBe(3000);
    expect(pushedOps().at(-1)).toEqual({ kind: 'giftAidSetting', over: 3000 });
    expect(store.outbox).toHaveLength(0);

    await act(async () => store.setGiftAidOver(null));
    await settle();

    expect(store.session?.giftAidOver).toBeNull();
    expect(pushedOps().at(-1)).toEqual({ kind: 'giftAidSetting', over: null });
  });

  test('a till hears the organiser’s setting, and an event that never set one has it off', async () => {
    await launchInCloudEvent();

    await act(async () => onRemoteEvent({ ...fete, giftAidOver: 2000 }));
    expect(store.session?.giftAidOver).toBe(2000);

    await act(async () => onRemoteEvent(fete));
    expect(store.session?.giftAidOver).toBeNull();
  });

  test('a setting waiting to send is not undone by what the server still says', async () => {
    await launchInCloudEvent();
    goOffline();
    await act(async () => store.setGiftAidOver(0));
    await act(async () => store.setGiftAidOver(1000));
    await settle();

    await act(async () => onRemoteEvent(fete));

    expect(store.session?.giftAidOver).toBe(1000);
    expect(store.outbox).toEqual([{ kind: 'giftAidSetting', over: 1000 }]);
  });

  test('a setting the event refuses is set aside, and discarding it goes back to what the other tills have', async () => {
    await launch();
    await act(() => store.joinCloudEvent('ABC234', 'Tombola'));
    await settle();
    await act(async () => onRemoteEvent(fete));
    cloud.pushOp.mockImplementation(async (_id, op) => {
      if (op.kind === 'giftAidSetting') throw refusal();
    });

    await act(async () => store.setGiftAidOver(3000));
    await settle();

    expect(store.parked.map((p) => opKey(p.op))).toEqual(['giftAidSetting']);
    expect(store.parked[0].reason).toMatch(/only the organiser/i);

    await act(async () => store.discardParked(store.parked[0].id));

    expect(store.parked).toHaveLength(0);
    expect(store.session?.giftAidOver).toBeNull();
  });

  test('a this-phone-only event keeps the setting across a restart', async () => {
    const firstRun = await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    await act(async () => store.setGiftAidOver(3000));
    await settle();
    await firstRun.unmount();

    await launch();

    expect(store.session?.giftAidOver).toBe(3000);
    expect(cloud.pushOp).not.toHaveBeenCalled();
  });
});

describe('tills and stock', () => {
  test('an item’s tills are sent with the price list', async () => {
    await launchInCloudEvent();
    const list: Item[] = [
      { id: 'tea', name: 'Tea', price: 80 },
      { id: 'cake', name: 'Cake', price: 150, tills: ['Cake stall'] },
    ];

    await act(async () => store.setItems(list));
    await settle();

    expect(pushedOps().at(-1)).toEqual({ kind: 'items', items: list });
  });

  test('the organiser hears which tills have joined, and still knows after a restart', async () => {
    const firstRun = await launchInCloudEvent();
    await act(async () =>
      onRemoteMembers([
        { deviceId: store.deviceId, tillName: 'Cake stall', float: 0 },
        { deviceId: 'other', tillName: 'Tombola', float: 0 },
      ]),
    );
    expect(store.tills).toEqual(['Cake stall', 'Tombola']);

    await firstRun.unmount();
    cloud.watchEvent.mockImplementation(() => () => {});
    await launch();

    expect(store.tills).toEqual(['Cake stall', 'Tombola']);
  });

  test('a till’s float is sent to the other tills, and theirs are heard', async () => {
    await launchInCloudEvent();
    cloud.joinAsMember.mockClear();

    await act(async () => store.setFloat(2000));
    await settle();

    expect(cloud.joinAsMember).toHaveBeenLastCalledWith('ev1', 'ABC234', 'Cake stall', { deviceId: store.deviceId, float: 2000 });
    expect(store.floats).toEqual([{ tillName: 'Cake stall', float: 2000 }]);

    // The server's copy of this phone's float is not added on top of its own.
    await act(async () =>
      onRemoteMembers([
        { deviceId: store.deviceId, tillName: 'Cake stall', float: 2000 },
        { deviceId: 'other', tillName: 'Tombola', float: 1500 },
      ]),
    );
    expect(store.floats).toEqual([
      { tillName: 'Cake stall', float: 2000 },
      { tillName: 'Tombola', float: 1500 },
    ]);
  });

  test('a float set with no signal counts on this phone straight away and is sent on reconnect', async () => {
    await launchInCloudEvent();
    goOffline();
    await act(async () => store.setFloat(2500));
    await settle();

    expect(store.floats).toEqual([{ tillName: 'Cake stall', float: 2500 }]);
    expect((await persisted()).session.float).toBe(2500);

    cloud.joinAsMember.mockClear();
    goOnline();
    await settle(15_000);
    expect(cloud.joinAsMember).toHaveBeenLastCalledWith('ev1', 'ABC234', 'Cake stall', { deviceId: store.deviceId, float: 2500 });
  });

  test('a phone that rejoins an event gets its float back and tells the other tills again', async () => {
    await launch();
    cloud.joinEvent.mockResolvedValue({ eventId: 'ev1', code: 'ABC234', eventName: 'Summer Fete', items: [], float: 1500, giftAidOver: null });

    await act(() => store.joinCloudEvent('ABC234', 'Tombola'));
    await settle();

    expect(cloud.joinEvent).toHaveBeenCalledWith('ABC234', 'Tombola', store.deviceId);
    expect(store.session?.float).toBe(1500);
    expect(store.floats).toEqual([{ tillName: 'Tombola', float: 1500 }]);
    expect(cloud.joinAsMember).toHaveBeenLastCalledWith('ev1', 'ABC234', 'Tombola', { deviceId: store.deviceId, float: 1500 });
  });

  test('floats are saved with the event when the phone leaves it', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Bake sale', 'Till 1'));
    await act(async () => store.setFloat(1000));
    await sell();
    await act(() => store.leaveEvent());

    const [event] = await listPastEvents();
    expect(event.floats).toEqual([{ tillName: 'Till 1', float: 1000 }]);
  });

  test('out of stock is kept on this phone only, survives a restart, and can be undone', async () => {
    const firstRun = await launchInCloudEvent();
    cloud.pushOp.mockClear();
    await act(async () => store.setOutOfStock('tea', true));
    await act(async () => store.setOutOfStock('tea', true)); // marking twice changes nothing
    await settle();

    expect(store.outOfStock).toEqual(['tea']);
    expect(cloud.pushOp).not.toHaveBeenCalled();

    await firstRun.unmount();
    await launch();
    expect(store.outOfStock).toEqual(['tea']);

    await act(async () => store.setOutOfStock('tea', false));
    expect(store.outOfStock).toEqual([]);
  });

  test('a new event starts with everything in stock', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    await act(async () => store.setOutOfStock('starter-0', true));
    await act(async () => store.leaveEvent());
    await act(async () => store.startLocalEvent('Autumn Fair', 'Till 1'));

    expect(store.outOfStock).toEqual([]);
  });
});

describe('leaving an event', () => {
  test('its sales are kept under past events', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    const kept = await sell('cash');
    const voided = await sell('card');
    await act(async () => store.setVoided(voided.id, true));
    await act(() => store.leaveEvent());

    expect(store.session).toBeNull();
    expect(store.sales).toEqual({});
    const [past] = await listPastEvents();
    expect(past).toMatchObject({ name: 'Village Fair', mode: 'local', takings: kept.total, cash: kept.total, card: 0, count: 1 });
    const found = await loadPastEvent(past.id);
    expect(found?.sales.map((s) => s.id).sort()).toEqual([kept.id, voided.id].sort());
  });

  test('an event with no sales is not kept', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    await act(() => store.leaveEvent());

    expect(await listPastEvents()).toEqual([]);
  });

  test('if the event cannot be saved, it stays until left without saving', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    const sale = await sell();
    const setItem = jest.mocked(AsyncStorage.setItem);
    const working = setItem.getMockImplementation()!;
    setItem.mockImplementation((key, value) => (key.startsWith('cashtin:history') ? Promise.reject(new Error('disk full')) : working(key, value)));

    await act(async () => {
      await expect(store.leaveEvent()).rejects.toThrow('disk full');
    });
    expect(store.session?.eventName).toBe('Village Fair');
    expect(store.sales[sale.id]).toBeDefined();

    await act(() => store.leaveEvent({ skipHistory: true }));
    expect(store.session).toBeNull();
    setItem.mockImplementation(working);
  });
});

describe('the price list for the next event', () => {
  const CAKE: Item = { id: 'cake', name: 'Cake', price: 150, tills: ['Cake stall'] };

  test('the last list is kept after leaving and survives a restart', async () => {
    const firstRun = await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    await act(async () => store.setItems([CAKE]));
    await act(() => store.leaveEvent());
    await settle();
    await firstRun.unmount();
    await launch();

    expect(store.lastItems).toEqual([CAKE]);
  });

  test('a this-phone-only event drops till assignments, a shared one keeps them', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Autumn Fair', 'Till 1', [CAKE]));
    expect(store.items).toEqual([{ id: 'cake', name: 'Cake', price: 150 }]);
    await act(() => store.leaveEvent());

    await act(() => store.createCloudEvent('Winter Fair', 'Cake stall', [CAKE]));
    expect(cloud.createEvent).toHaveBeenCalledWith('Winter Fair', 'Cake stall', [CAKE]);
    expect(store.items).toEqual([CAKE]);
  });

  test('a list from an event this phone only joined is not offered', async () => {
    cloud.joinEvent.mockResolvedValue({ eventId: 'ev1', code: 'ABC234', eventName: 'Summer Fete', items: [CAKE], float: 0, giftAidOver: null });
    await launch();
    await act(() => store.joinCloudEvent('ABC234', 'Cake stall'));
    await act(() => store.leaveEvent());

    expect(store.lastItems).toBeNull();
  });
});

describe('Gift Aid', () => {
  const DONATION: SaleLine[] = [
    { itemId: 'cake', name: 'Slice of cake', price: 150, qty: 1 },
    { itemId: 'don', name: 'Donation', price: 100, qty: 5, donation: true },
  ];
  const ADA = { firstName: ' Ada ', lastName: 'Lovelace', house: '12', postcode: 'sw1a1aa' };

  async function sellDonation() {
    let sale!: Sale;
    await act(async () => {
      sale = store.recordSale(DONATION, 'cash', 1000);
    });
    await settle();
    return sale;
  }

  test('a declaration is kept against the sale, for the donation only, and sent after it', async () => {
    await launchInCloudEvent();
    const sale = await sellDonation();
    await act(async () => {
      store.recordGiftAid(sale.id, ADA);
    });
    await settle();

    const declaration = store.giftAid[sale.id];
    expect(declaration).toMatchObject({ saleId: sale.id, amount: 500, firstName: 'Ada', postcode: 'SW1A 1AA', tillName: 'Cake stall', donatedAt: sale.at });
    expect(pushedOps().map(opKey)).toEqual([`sale:${sale.id}`, 'giftAid']);
    expect(cloud.pushOp).toHaveBeenLastCalledWith('ev1', { kind: 'giftAid', declaration });
    expect(store.outbox).toHaveLength(0);
  });

  test('a sale with no donation in it cannot have Gift Aid', async () => {
    await launchInCloudEvent();
    const sale = await sell();
    expect(() => store.recordGiftAid(sale.id, ADA)).toThrow(/donation/);
  });

  test('a declaration taken with no signal survives a restart and is sent on reconnect', async () => {
    const firstRun = await launchInCloudEvent();
    goOffline();
    const sale = await sellDonation();
    await act(async () => {
      store.recordGiftAid(sale.id, ADA);
    });
    await settle();
    await firstRun.unmount();

    goOnline();
    await launch();
    await settle(15_000);
    expect(store.giftAid[sale.id]).toBeDefined();
    expect(pushedOps().filter((op) => op.kind === 'giftAid')).toHaveLength(1);
    expect(store.outbox).toHaveLength(0);
  });

  test('the organiser hears every till’s declarations; a volunteer does not listen for them', async () => {
    await launchInCloudEvent();
    expect(cloud.watchGiftAid).toHaveBeenCalledWith('ev1', expect.any(Function), expect.any(Function));
    const remote = { saleId: 'other', at: 1, amount: 300, firstName: 'Grace', lastName: 'Hopper', house: '3', postcode: 'M1 1AE', tillName: 'Tombola', deviceId: 'd2' };
    await act(async () => onRemoteGiftAid!([remote]));
    expect(store.giftAid.other).toEqual(remote);
  });

  test('after a restart the organiser waits until it has registered again before listening', async () => {
    const firstRun = await launchInCloudEvent();
    await firstRun.unmount();
    cloud.watchGiftAid.mockClear();

    goOffline(); // a new sign-in can't re-claim the organiser role yet
    await launch();
    await settle(15_000);
    expect(cloud.watchGiftAid).not.toHaveBeenCalled();

    goOnline();
    await settle(15_000);
    expect(cloud.claimOrganiser).toHaveBeenCalled();
    expect(cloud.watchGiftAid).toHaveBeenCalledTimes(1);
  });

  test('a listener the server ends is started again, so declarations keep arriving', async () => {
    await launchInCloudEvent();
    expect(cloud.watchGiftAid).toHaveBeenCalledTimes(1);

    await act(async () => onGiftAidError!(Object.assign(new Error('denied'), { code: 'permission-denied' })));
    await settle(15_000);
    expect(cloud.watchGiftAid).toHaveBeenCalledTimes(2);

    const remote = { saleId: 'late', at: 1, amount: 100, firstName: 'Grace', lastName: 'Hopper', house: '3', postcode: 'M1 1AE', tillName: 'Tombola', deviceId: 'd2' };
    await act(async () => onRemoteGiftAid!([remote]));
    expect(store.giftAid.late).toEqual(remote);
  });

  test('a phone that joins as a volunteer does not try to read the declarations', async () => {
    await launch();
    await act(() => store.joinCloudEvent('ABC234', 'Tombola'));
    await settle();
    expect(cloud.watchGiftAid).not.toHaveBeenCalled();
  });

  test('a refused declaration is set aside; discarding it stops the sending but keeps it on the phone', async () => {
    await launchInCloudEvent();
    cloud.pushOp.mockImplementation(async (_id, op) => {
      if (op.kind === 'giftAid') throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    });
    const sale = await sellDonation();
    await act(async () => {
      store.recordGiftAid(sale.id, ADA);
    });
    await settle();

    expect(store.parked).toHaveLength(1);
    expect(store.parked[0].reason).toMatch(/Gift Aid/);
    await act(async () => store.discardParked(store.parked[0].id));
    expect(store.parked).toHaveLength(0);
    expect(store.giftAid[sale.id]).toBeDefined();
  });

  test('declarations are saved with the event when the phone leaves it', async () => {
    await launch();
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    const sale = await sellDonation();
    await act(async () => {
      store.recordGiftAid(sale.id, ADA);
    });
    await act(() => store.leaveEvent());

    expect(store.giftAid).toEqual({});
    const [past] = await listPastEvents();
    const found = await loadPastEvent(past.id);
    expect(found?.giftAid).toEqual([expect.objectContaining({ saleId: sale.id, lastName: 'Lovelace' })]);
  });
});

describe('card payments through SumUp', () => {
  const paid = (id: string | null, txCode = 'TX1') => ({ ok: true, id, txCode, message: 'Card payment taken.' });
  const declined = (id: string) => ({ ok: false, id, txCode: null, message: 'Card declined.' });

  async function begin() {
    let pending!: ReturnType<typeof store.beginCardPayment>;
    await act(async () => {
      pending = store.beginCardPayment(TEA);
    });
    return pending;
  }

  test('nothing is recorded until SumUp says it was paid, then the sale takes the payment’s id', async () => {
    await launchInCloudEvent();
    const pending = await begin();
    expect(store.pendingCard).toMatchObject({ id: pending.id, total: 160 });
    expect(Object.keys(store.sales)).toHaveLength(0);

    await act(async () => store.finishCardPayment(paid(pending.id)));
    await settle();

    expect(store.sales[pending.id]).toMatchObject({ method: 'card', total: 160, tendered: 160, cardRef: 'TX1' });
    expect(store.pendingCard).toBeNull();
    expect(store.cardResult).toMatchObject({ ok: true, message: 'Card payment of £1.60 taken.' });
    expect(pushedOps().map(opKey)).toEqual([`sale:${pending.id}`]);
  });

  test('a declined card records nothing and says nothing was charged', async () => {
    await launchInCloudEvent();
    const pending = await begin();
    await act(async () => store.finishCardPayment(declined(pending.id)));

    expect(store.sales).toEqual({});
    expect(store.pendingCard).toBeNull();
    expect(store.cardResult).toMatchObject({ ok: false, message: 'Card declined. Nothing was charged.' });
  });

  test('the same result arriving twice records one sale', async () => {
    await launchInCloudEvent();
    const pending = await begin();
    await act(async () => store.finishCardPayment(paid(pending.id)));
    await act(async () => store.finishCardPayment(paid(pending.id)));
    await settle();

    expect(Object.keys(store.sales)).toEqual([pending.id]);
    expect(pushedOps()).toHaveLength(1);
  });

  test('a result for a payment this till wasn’t waiting for is not recorded', async () => {
    await launchInCloudEvent();
    const pending = await begin();
    await act(async () => store.finishCardPayment(paid('someone-else')));

    expect(store.sales).toEqual({});
    expect(store.pendingCard?.id).toBe(pending.id); // still waiting for its own result
    expect(store.cardResult?.message).toMatch(/wasn’t waiting for/);
  });

  test('the phone closing this app while SumUp is open loses nothing: the result still records the sale', async () => {
    const firstRun = await launchInCloudEvent();
    const pending = await begin();
    await firstRun.unmount();

    await launch();
    expect(store.pendingCard?.id).toBe(pending.id);
    await act(async () => store.finishCardPayment(paid(pending.id)));
    expect(store.sales[pending.id]).toMatchObject({ lines: TEA, method: 'card' });
  });

  test('if SumUp never reports back, the volunteer can settle it by hand either way', async () => {
    await launchInCloudEvent();
    const first = await begin();
    await act(async () => store.settlePendingCard(true));
    expect(store.sales[first.id]).toMatchObject({ method: 'card', cardUnconfirmed: true });
    expect(store.sales[first.id].cardRef).toBeUndefined();

    const second = await begin();
    await act(async () => store.settlePendingCard(false));
    expect(store.sales[second.id]).toBeUndefined();
    expect(store.pendingCard).toBeNull();

    // A late result for the payment settled by hand changes nothing.
    await act(async () => store.finishCardPayment(paid(first.id)));
    expect(Object.keys(store.sales)).toEqual([first.id]);
  });

  test('the card setting is kept on this phone across events and restarts', async () => {
    const firstRun = await launch();
    expect(store.cardMode).toBe('record');
    await act(async () => store.setCardMode('sumup'));
    await act(async () => store.startLocalEvent('Village Fair', 'Till 1'));
    await firstRun.unmount();

    await launch();
    expect(store.cardMode).toBe('sumup');
  });
});
