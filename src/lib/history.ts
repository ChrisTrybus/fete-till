// Past events, kept on this phone only. An event is added when the phone leaves
// it. The list of events is one small entry; each event's sales are stored
// separately, so opening the list never loads every sale ever taken.
import { historyStorage } from './history-storage';
import { summarise } from './totals';
import type { PastEvent, Sale, Session } from './types';

const INDEX_KEY = 'cashtin:history:index';
const salesKey = (id: string) => `cashtin:history:sales:${id}`;

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
export function describeEvent(session: Session, sales: Sale[], endedAt: number): PastEvent {
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
  };
}

/** Past events, newest first. */
export const listPastEvents = (): Promise<PastEvent[]> =>
  inTurn(async () => (await readIndex()).sort((a, b) => b.startedAt - a.startedAt));

/** Adds an event to the history, replacing any earlier copy of the same event. */
export const savePastEvent = (event: PastEvent, sales: Sale[]): Promise<void> =>
  inTurn(async () => {
    // Sales first: an event is only listed once its sales are safely stored.
    await historyStorage.setItem(salesKey(event.id), JSON.stringify(sales));
    const rest = (await readIndex()).filter((e) => e.id !== event.id);
    await historyStorage.setItem(INDEX_KEY, JSON.stringify([event, ...rest]));
  });

/** One past event with its sales, or null if it isn't in the history. */
export const loadPastEvent = (id: string): Promise<{ event: PastEvent; sales: Sale[] } | null> =>
  inTurn(async () => {
    const event = (await readIndex()).find((e) => e.id === id);
    if (!event) return null;
    const raw = await historyStorage.getItem(salesKey(id));
    let sales: Sale[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) sales = parsed;
    } catch {
      // Unreadable sales: the event still shows, with the totals saved in the list.
    }
    return { event, sales };
  });

export const deletePastEvent = (id: string): Promise<void> =>
  inTurn(async () => {
    const rest = (await readIndex()).filter((e) => e.id !== id);
    await historyStorage.setItem(INDEX_KEY, JSON.stringify(rest));
    await historyStorage.removeItem(salesKey(id));
  });
