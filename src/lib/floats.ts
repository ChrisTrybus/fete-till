// Opening floats: the cash put in each till's tin before the first sale. Adding
// a till's float to its cash sales gives what should be in the tin when counted.
import { tillKey } from './tills';
import type { DayTotals } from './totals';
import type { Member, Session, TillFloat } from './types';

export type TinRow = { tillName: string; float: number; cash: number; inTin: number };
export type CashToCount = { rows: TinRow[]; float: number; inTin: number };

/**
 * One entry per phone. A phone that restarts can come back with a new anonymous
 * sign-in, which leaves its earlier member record behind; only its latest
 * registration counts, so its float isn't added in twice. Records with no device
 * id (from before floats existed) are kept as they are.
 */
export function latestPerDevice(members: Member[]): Member[] {
  const unknown: Member[] = [];
  const latest = new Map<string, Member>();
  for (const m of members) {
    if (!m.deviceId) unknown.push(m);
    else if ((m.joinedAt ?? 0) >= (latest.get(m.deviceId)?.joinedAt ?? -1)) latest.set(m.deviceId, m);
  }
  return [...unknown, ...latest.values()];
}

/**
 * Every till's float. In a shared event these come from the phones that have
 * joined; this phone's own figure is taken from the phone itself, so a float
 * entered with no signal counts straight away. Phones sharing a till name are
 * added together.
 */
export function tillFloats(session: Session | null, deviceId: string, members: Member[]): TillFloat[] {
  if (!session) return [];
  const all: TillFloat[] = [
    { tillName: session.tillName, float: session.float ?? 0 },
    ...(session.mode === 'cloud' ? latestPerDevice(members).filter((m) => m.deviceId !== deviceId) : []),
  ];
  const byTill = new Map<string, TillFloat>();
  for (const { tillName, float } of all) {
    if (!(float > 0)) continue;
    const seen = byTill.get(tillKey(tillName));
    if (seen) seen.float += float;
    else byTill.set(tillKey(tillName), { tillName: tillName.trim() || 'Unnamed till', float });
  }
  return [...byTill.values()];
}

/** What each tin should hold: its float plus the cash it took. Tills with neither are left out. */
export function cashToCount(totals: Pick<DayTotals, 'byTill' | 'cash'>, floats: TillFloat[]): CashToCount {
  const rows = new Map<string, TinRow>();
  const row = (tillName: string) => {
    const key = tillKey(tillName);
    if (!rows.has(key)) rows.set(key, { tillName, float: 0, cash: 0, inTin: 0 });
    return rows.get(key)!;
  };
  for (const f of floats) row(f.tillName).float += f.float;
  for (const t of totals.byTill) if (t.cash) row(t.tillName).cash += t.cash;
  const list = [...rows.values()].map((r) => ({ ...r, inTin: r.float + r.cash })).sort((a, b) => b.inTin - a.inTin);
  const float = list.reduce((sum, r) => sum + r.float, 0);
  return { rows: list, float, inTin: float + totals.cash };
}
