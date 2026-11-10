// App state, saved on the device first and synced to Firestore when there's signal.
//
// Local-first: every sale is written to AsyncStorage before anything else, then
// queued in an outbox. The outbox is flushed in order whenever we can reach
// Firestore. Sale ids are generated on the device and used as the Firestore doc
// id, so sending the same sale twice is harmless.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Cloud from './cloud';
import { cloudEnabled } from './firebase';
import type { Item, OutboxOp, ParkedOp, PaymentMethod, Sale, SaleLine, Session } from './types';

const STORAGE_KEY = 'fetetill:v1';
const FLUSH_INTERVAL_MS = 15000;

type Persisted = {
  deviceId: string;
  session: Session | null;
  items: Item[];
  sales: Record<string, Sale>;
  outbox: OutboxOp[];
  parked: ParkedOp[];
};

export type SyncStatus = 'local' | 'synced' | 'sending' | 'waiting' | 'attention';

type Store = Persisted & {
  loaded: boolean;
  cloudEnabled: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  startLocalEvent: (name: string, tillName: string) => void;
  createCloudEvent: (name: string, tillName: string) => Promise<void>;
  joinCloudEvent: (code: string, tillName: string) => Promise<void>;
  leaveEvent: () => void;
  setTillName: (name: string) => void;
  setItems: (items: Item[]) => void;
  recordSale: (lines: SaleLine[], method: PaymentMethod, tendered: number) => Sale;
  setVoided: (saleId: string, voided: boolean) => void;
  flushNow: () => void;
  /** Puts a refused change back in the queue to try again. */
  retryParked: (id: string) => void;
  /** Drops a refused price list or void, going back to what the other tills have. Sales are never dropped. */
  discardParked: (id: string) => void;
};

export const STARTER_ITEMS: Item[] = [
  ['Tea', 80],
  ['Coffee', 100],
  ['Squash', 50],
  ['Slice of cake', 150],
  ['Tombola ticket', 100],
  ['Raffle strip (5)', 200],
].map(([name, price], i) => ({ id: `starter-${i}`, name: name as string, price: price as number }));

// Firestore error codes that mean "the server said no", as opposed to "couldn't reach it".
const REFUSAL_CODES = new Set(['permission-denied', 'invalid-argument', 'not-found', 'failed-precondition', 'out-of-range']);
const isRefusal = (e: unknown) => REFUSAL_CODES.has((e as { code?: string } | null)?.code ?? '');

export const MAX_ITEMS = 200; // matches firestore.rules
const MAX_SALE_LINES = 100; // matches firestore.rules

function refusalReason(op: OutboxOp): string {
  if (op.kind === 'items') {
    return op.items.length > MAX_ITEMS
      ? `The price list has ${op.items.length} items. The most that can be shared is ${MAX_ITEMS}.`
      : 'The event would not accept this price list.';
  }
  if (op.kind === 'sale') {
    return op.sale.lines.length > MAX_SALE_LINES
      ? `This sale has more than ${MAX_SALE_LINES} different items, which is too many to share.`
      : 'The event would not accept this sale.';
  }
  return 'The event would not accept this change.';
}

/** Moves a refused change out of the queue. Order only matters for a sale and its own voids. */
function park(s: Persisted, op: OutboxOp): Persisted {
  const sameTarget = (o: OutboxOp) =>
    (op.kind === 'items' && o.kind === 'items') ||
    (op.kind === 'void' && o.kind === 'void' && o.saleId === op.saleId) ||
    (op.kind === 'sale' && o.kind === 'sale' && o.sale.id === op.sale.id);
  return {
    ...s,
    // Voids of a parked sale can't be sent on their own. The sale carries its
    // voided state when it is retried, so they are simply dropped.
    outbox: s.outbox.filter((o) => o !== op && !(op.kind === 'sale' && o.kind === 'void' && o.saleId === op.sale.id)),
    parked: [...s.parked.filter((p) => !sameTarget(p.op)), { id: randomUUID(), op, reason: refusalReason(op) }],
  };
}

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Persisted>({ deviceId: '', session: null, items: [], sales: {}, outbox: [], parked: [] });
  const [loaded, setLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local');
  const [syncError, setSyncError] = useState<string | null>(null);

  // The ref is the source of truth for async sync code, which must read the latest
  // state without stale closures. Every change goes through `update`, which writes
  // the ref first and then hands the same value to React.
  const stateRef = useRef(state);
  const flushing = useRef(false);
  const memberOk = useRef<string | null>(null); // eventId we've confirmed membership for this run
  const remoteItems = useRef<Item[] | null>(null); // the shared price list, as last heard from the server

  // ---- load & save ----------------------------------------------------------
  useEffect(() => {
    (async () => {
      let saved: Partial<Persisted> = {};
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
      } catch {
        // Corrupt or unreadable storage: start fresh rather than crash at the till.
      }
      const initial: Persisted = {
        deviceId: saved.deviceId || randomUUID(),
        session: saved.session ?? null,
        items: saved.items ?? [],
        sales: saved.sales ?? {},
        // Local-only events never send, so drop anything an older build queued for them.
        outbox: saved.session?.mode === 'cloud' ? (saved.outbox ?? []) : [],
        parked: saved.session?.mode === 'cloud' ? (saved.parked ?? []) : [],
      };
      stateRef.current = initial;
      setState(initial);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, loaded]);

  const update = useCallback((fn: (s: Persisted) => Persisted) => {
    // Apply to the ref first, synchronously. The sync loop reads the ref straight
    // after each send, so it must not depend on when React next renders.
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  // ---- sync -----------------------------------------------------------------
  /** Sends one change. False means the server refused it and retrying as-is won't help. */
  const send = useCallback(async (session: Session, op: OutboxOp) => {
    try {
      await Cloud.pushOp(session.eventId, op);
      return true;
    } catch (e) {
      if (!isRefusal(e)) throw e; // no signal: leave it queued
    }
    // A refusal can also mean this phone's membership lapsed, so re-join and try once more.
    await Cloud.joinAsMember(session.eventId, session.code, session.tillName);
    try {
      await Cloud.pushOp(session.eventId, op);
      return true;
    } catch (e) {
      if (!isRefusal(e)) throw e;
    }
    // A sale that arrived earlier, but whose confirmation was lost, is refused when
    // resent after a restart. It is already safe on the server, so that counts as sent.
    if (op.kind === 'sale' && (await Cloud.saleExists(session.eventId, op.sale.id))) return true;
    return false;
  }, []);

  const flush = useCallback(async () => {
    const { session } = stateRef.current;
    if (!session || session.mode !== 'cloud' || flushing.current) return;
    flushing.current = true;
    try {
      if (memberOk.current !== session.eventId) {
        await Cloud.joinAsMember(session.eventId, session.code, session.tillName);
        memberOk.current = session.eventId;
      }
      while (stateRef.current.outbox.length) {
        setSyncStatus('sending');
        const op = stateRef.current.outbox[0];
        if (await send(session, op)) {
          update((s) => ({ ...s, outbox: s.outbox[0] === op ? s.outbox.slice(1) : s.outbox }));
        } else {
          // Refused for good. Set it aside so the changes behind it still get through.
          update((s) => park(s, op));
        }
      }
      setSyncStatus('synced');
      setSyncError(null);
    } catch (e) {
      setSyncStatus('waiting');
      const msg = e instanceof Error ? e.message : String(e);
      setSyncError(msg === 'timeout' ? 'No connection. Sales are saved on this phone.' : msg);
    } finally {
      flushing.current = false;
    }
  }, [update, send]);

  const enqueue = useCallback(
    (op: OutboxOp) => {
      // Local-only events have nowhere to send to, so nothing is queued.
      if (stateRef.current.session?.mode !== 'cloud') return;
      update((s) => ({ ...s, outbox: [...s.outbox, op] }));
      setTimeout(flush, 0);
    },
    [update, flush],
  );

  // Live updates from other tills, plus a periodic retry of the outbox.
  const sessionKey = state.session ? `${state.session.mode}:${state.session.eventId}` : '';
  useEffect(() => {
    const session = stateRef.current.session;
    if (!loaded || !session || session.mode === 'local') return;
    flush();
    const timer = setInterval(flush, FLUSH_INTERVAL_MS);
    let unsub: (() => void) | undefined;
    try {
      unsub = Cloud.watchEvent(
        session.eventId,
        (ev) =>
          update((s) => {
            remoteItems.current = ev.items;
            const itemsPending = s.outbox.some((o) => o.kind === 'items') || s.parked.some((p) => p.op.kind === 'items');
            return {
              ...s,
              items: itemsPending ? s.items : ev.items,
              session: s.session ? { ...s.session, eventName: ev.name } : s.session,
            };
          }),
        (remote) =>
          update((s) => {
            const pendingVoids = new Set([...s.outbox, ...s.parked.map((p) => p.op)].flatMap((o) => (o.kind === 'void' ? [o.saleId] : [])));
            const sales = { ...s.sales };
            for (const r of remote) {
              const { createdBy: _ignored, ...sale } = r as Sale & { createdBy?: string };
              sales[sale.id] = pendingVoids.has(sale.id) && sales[sale.id] ? { ...sale, voided: sales[sale.id].voided } : sale;
            }
            return { ...s, sales };
          }),
        // A listener error (e.g. not yet a member) is retried by the next flush.
        () => setSyncStatus('waiting'),
      );
    } catch {
      // Couldn't even start listening (Firebase misconfigured). Reported the same
      // way as a listener error, which arrives through the callback above.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSyncStatus('waiting');
    }
    return () => {
      clearInterval(timer);
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, sessionKey]);

  // ---- actions --------------------------------------------------------------
  const startLocalEvent = useCallback(
    (name: string, tillName: string) =>
      update((s) => ({
        ...s,
        session: { eventId: randomUUID(), eventName: name, code: '', tillName, mode: 'local' },
        items: STARTER_ITEMS,
        sales: {},
        outbox: [],
        parked: [],
      })),
    [update],
  );

  const createCloudEvent = useCallback(
    async (name: string, tillName: string) => {
      const { eventId, code } = await Cloud.createEvent(name, tillName, STARTER_ITEMS);
      memberOk.current = eventId;
      update((s) => ({
        ...s,
        session: { eventId, eventName: name, code, tillName, mode: 'cloud' },
        items: STARTER_ITEMS,
        sales: {},
        outbox: [],
        parked: [],
      }));
    },
    [update],
  );

  const joinCloudEvent = useCallback(
    async (code: string, tillName: string) => {
      const ev = await Cloud.joinEvent(code, tillName);
      memberOk.current = ev.eventId;
      update((s) => ({
        ...s,
        session: { eventId: ev.eventId, eventName: ev.eventName, code: ev.code, tillName, mode: 'cloud' },
        items: ev.items,
        sales: {},
        outbox: [],
        parked: [],
      }));
    },
    [update],
  );

  const leaveEvent = useCallback(
    () => update((s) => ({ ...s, session: null, items: [], sales: {}, outbox: [], parked: [] })),
    [update],
  );

  const setTillName = useCallback(
    (tillName: string) => {
      memberOk.current = null; // re-register so other tills see the new name
      update((s) => (s.session ? { ...s, session: { ...s.session, tillName } } : s));
      setTimeout(flush, 0);
    },
    [update, flush],
  );

  const setItems = useCallback(
    (items: Item[]) => {
      // A new save replaces any earlier one, whether still queued or refused.
      update((s) => ({
        ...s,
        items,
        outbox: s.outbox.filter((o) => o.kind !== 'items'),
        parked: s.parked.filter((p) => p.op.kind !== 'items'),
      }));
      enqueue({ kind: 'items', items });
    },
    [update, enqueue],
  );

  const recordSale = useCallback(
    (lines: SaleLine[], method: PaymentMethod, tendered: number) => {
      const { session, deviceId } = stateRef.current;
      const total = lines.reduce((t, l) => t + l.price * l.qty, 0);
      const sale: Sale = {
        id: randomUUID(),
        at: Date.now(),
        total,
        method,
        tendered: method === 'cash' ? tendered : total,
        lines,
        tillName: session?.tillName ?? '',
        deviceId,
        voided: false,
      };
      update((s) => ({ ...s, sales: { ...s.sales, [sale.id]: sale } }));
      enqueue({ kind: 'sale', sale });
      return sale;
    },
    [update, enqueue],
  );

  const setVoided = useCallback(
    (saleId: string, voided: boolean) => {
      update((s) => ({
        ...s,
        sales: s.sales[saleId] ? { ...s.sales, [saleId]: { ...s.sales[saleId], voided } } : s.sales,
        // This replaces any earlier void of the same sale that was refused.
        parked: s.parked.filter((p) => !(p.op.kind === 'void' && p.op.saleId === saleId)),
      }));
      // A sale that was itself refused isn't on the server to be voided. It takes
      // its voided state with it when it is retried.
      const saleParked = stateRef.current.parked.some((p) => p.op.kind === 'sale' && p.op.sale.id === saleId);
      if (!saleParked) enqueue({ kind: 'void', saleId, voided });
    },
    [update, enqueue],
  );

  const retryParked = useCallback(
    (id: string) => {
      const entry = stateRef.current.parked.find((p) => p.id === id);
      if (!entry) return;
      // A sale goes back as it stands now, so a void made while it was parked is kept.
      const op: OutboxOp =
        entry.op.kind === 'sale' ? { kind: 'sale', sale: stateRef.current.sales[entry.op.sale.id] ?? entry.op.sale } : entry.op;
      update((s) => ({ ...s, parked: s.parked.filter((p) => p.id !== id), outbox: [...s.outbox, op] }));
      setTimeout(flush, 0);
    },
    [update, flush],
  );

  const discardParked = useCallback(
    (id: string) => {
      const entry = stateRef.current.parked.find((p) => p.id === id);
      // A sale is a record of money taken, so it is never thrown away. Void it instead.
      if (!entry || entry.op.kind === 'sale') return;
      const { op } = entry;
      update((s) => {
        const parked = s.parked.filter((p) => p.id !== id);
        if (op.kind === 'items') return { ...s, parked, items: remoteItems.current ?? s.items };
        const sale = s.sales[op.saleId];
        return { ...s, parked, sales: sale ? { ...s.sales, [op.saleId]: { ...sale, voided: !op.voided } } : s.sales };
      });
    },
    [update],
  );

  const value = useMemo<Store>(
    () => ({
      ...state,
      loaded,
      cloudEnabled,
      syncStatus:
        state.session?.mode !== 'cloud' ? 'local' : syncStatus === 'synced' && state.parked.length ? 'attention' : syncStatus,
      syncError,
      startLocalEvent,
      createCloudEvent,
      joinCloudEvent,
      leaveEvent,
      setTillName,
      setItems,
      recordSale,
      setVoided,
      flushNow: () => void flush(),
      retryParked,
      discardParked,
    }),
    [state, loaded, syncStatus, syncError, startLocalEvent, createCloudEvent, joinCloudEvent, leaveEvent, setTillName, setItems, recordSale, setVoided, flush, retryParked, discardParked],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
