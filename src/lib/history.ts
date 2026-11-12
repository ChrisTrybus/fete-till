// Past events, kept on this phone only. An event is added when the phone leaves
// it. The list of events is one small entry; each event's sales are stored
// separately, so opening the list never loads every sale ever taken.
import { historyStorage } from './history-storage';
import { summarise } from './totals';
import type { GiftAidDeclaration, PastEvent, Sale, Session, TillFloat } from './types';

const INDEX_KEY = 'cashtin:history:index';
const salesKey = (id: string) => `cashtin:history:sales:${id}`;
const giftAidKey = (id: string) => `cashtin:history:giftaid:${id}`;

// Changes run one after another, so two can't both read the list and overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readIndex(): Promise<PastEvent[]> {
  const raw = await historyStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // unreadable list: show none rather than crash
  }
}

/** The figures shown in the list of past events, worked out once when the event ends. */
export function describeEvent(session: Session, sales: Sale[], endedAt: number, floats: TillFloat[] = []): PastEvent {
  const totals = summarise(sales);
  const first = sales.length ? Math.min(...sales.map((s) => s.at)) : endedAt;
  return {
    id: session.eventId,
    name: session.eventName,
    mode: session.mode,
    tillName: session.tillName,
    startedAt: session.startedAt ?? first,
    endedAt,
    closedAt: session.closedAt ?? null,
    takings: totals.takings,
    cash: totals.cash,
    card: totals.card,
    count: totals.count,
    ...(floats.length ? { floats } : {}),
  };
}

/** Past events, newest first. */
export const listPastEvents = (): Promise<PastEvent[]> =>
  inTurn(async () => (await readIndex()).sort((a, b) => b.startedAt - a.startedAt));

async function readList<T>(key: string): Promise<T[]> {
  const raw = await historyStorage.getItem(key);
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // unreadable: the event still shows, with the totals saved in the list
  }
}
const readSales = (id: string) => readList<Sale>(salesKey(id));
const readGiftAid = (id: string) => readList<GiftAidDeclaration>(giftAidKey(id));

/**
 * Adds an event to the history when this phone leaves it.
 *
 * A phone can leave an event, join it again and leave a second time. The second
 * time it may hold fewer sales than the first: a sale that never reached the
 * other tills exists only in the copy saved here. So sales already saved for the
 * event are kept, and the phone's current copy of a sale wins where both have it.
 */
export const savePastEvent = (
  session: Session,
  sales: Sale[],
  endedAt: number,
  floats: TillFloat[] = [],
  giftAid: GiftAidDeclaration[] = [],
): Promise<void> =>
  inTurn(async () => {
    const index = await readIndex();
    const earlier = index.find((e) => e.id === session.eventId);
    const merged = new Map<string, Sale>();
    if (earlier) for (const sale of await readSales(session.eventId)) merged.set(sale.id, sale);
    for (const sale of sales) merged.set(sale.id, sale);
    const all = [...merged.values()];
    // Gift Aid declarations are kept the same way: none saved earlier is lost.
    const declarations = new Map<string, GiftAidDeclaration>();
    if (earlier) for (const d of await readGiftAid(session.eventId)) declarations.set(d.saleId, d);
    for (const d of giftAid) declarations.set(d.saleId, d);

    const event = describeEvent(session, all, endedAt, floats);
    if (earlier) event.startedAt = Math.min(earlier.startedAt, event.startedAt);

    // Sales first: an event is only listed once its sales are safely stored.
    await historyStorage.setItem(salesKey(event.id), JSON.stringify(all));
    if (declarations.size) await historyStorage.setItem(giftAidKey(event.id), JSON.stringify([...declarations.values()]));
    await historyStorage.setItem(INDEX_KEY, JSON.stringify([event, ...index.filter((e) => e.id !== event.id)]));
  });

/** One past event with its sales, or null if it isn't in the history. */
export const loadPastEvent = (id: string): Promise<{ event: PastEvent; sales: Sale[]; giftAid: GiftAidDeclaration[] } | null> =>
  inTurn(async () => {
    const event = (await readIndex()).find((e) => e.id === id);
    if (!event) return null;
    return { event, sales: await readSales(id), giftAid: await readGiftAid(id) };
  });

export const deletePastEvent = (id: string): Promise<void> =>
  inTurn(async () => {
    const rest = (await readIndex()).filter((e) => e.id !== id);
    await historyStorage.setItem(INDEX_KEY, JSON.stringify(rest));
    await historyStorage.removeItem(salesKey(id));
    await historyStorage.removeItem(giftAidKey(id));
  });
