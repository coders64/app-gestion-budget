import { categoryRows, monthSummary, shareAmt } from './budget';
import { monthKey } from './dates';
import { monthlyEq, monthlyTotal, occurrence, prevus, shareFraction } from './subs';
import type { ExpenseRec, Freq, MemberKey, Owner, Snapshot, SubscriptionRec } from './types';

/** Prélèvements d'un abonnement dans le mois, à partir d'aujourd'hui compris : ce qu'il coûterait ce mois-ci si on le prenait. */
export function chargesFromToday(sub: { anchor: string; freq: Freq }, month: string, today: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < 600; k++) {
    const d = occurrence(sub.anchor, sub.freq, k);
    if (monthKey(d) > month) break;
    if (monthKey(d) === month && d >= today) out.push(d);
  }
  return out;
}

export type EnvItem =
  | { kind: 'achat'; item: ExpenseRec; share: number; when: 'passe' | 'ce-mois' | 'plus-tard' }
  | { kind: 'abo'; item: SubscriptionRec; share: number; charges: number };

export interface Envisaged {
  items: EnvItem[];
  /** Ce que les achats envisagés retireraient du reste de ce mois-ci (part de la membre). Les abonnements sont hors plafond. */
  thisMonth: number;
  /** Total des achats envisagés à venir (part de la membre). */
  achats: number;
  /** Achats envisagés par mois (ce mois-ci et plus tard), dans l'ordre. */
  months: Array<{ month: string; amount: number }>;
  /** Ce que les abonnements envisagés ajouteraient au coût mensuel. */
  monthly: number;
}

/** Ce qu'une membre envisage (le sien et le commun), pour le mois en cours. */
export function envisaged(s: Snapshot, member: MemberKey, today: string): Envisaged {
  const month = monthKey(today);
  const items: EnvItem[] = [];
  let thisMonth = 0;
  const byMonth = new Map<string, number>();
  let monthly = 0;
  const achats = s.envExpenses.filter((e) => shareFraction(member, e) > 0).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  for (const e of achats) {
    const m = monthKey(e.date);
    const when = m < month ? 'passe' : m === month ? 'ce-mois' : 'plus-tard';
    const share = shareAmt(member, e);
    if (when === 'ce-mois') thisMonth += share;
    if (when !== 'passe') byMonth.set(m, (byMonth.get(m) ?? 0) + share);
    items.push({ kind: 'achat', item: e, share, when });
  }
  for (const sub of s.envSubs) {
    if (!shareFraction(member, sub)) continue;
    const share = shareAmt(member, sub);
    const charges = chargesFromToday(sub, month, today).length;
    monthly += monthlyEq(sub) * shareFraction(member, sub);
    items.push({ kind: 'abo', item: sub, share, charges });
  }
  // Les achats dont le mois est passé d'abord : l'appli demande « Tu l'as acheté ? ».
  items.sort((x, y) => Number(y.kind === 'achat' && y.when === 'passe') - Number(x.kind === 'achat' && x.when === 'passe'));
  const months = [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, amount]) => ({ month, amount }));
  return { items, thisMonth, achats: months.reduce((t, x) => t + x.amount, 0), months, monthly };
}

export interface SimInput {
  owner: Owner;
  amount: number;
  freq: Freq;
  /** 1er prélèvement. */
  anchor: string;
  partA?: number;
  cat: string;
  /** Essai gratuit : le 1er prélèvement est la fin de l'essai. */
  essai?: boolean;
}

export interface SimImpact {
  /** Ce que l'abonnement coûterait ce mois-ci (part de la membre). */
  delta: number;
  /** Reste du mois actuel, ou null sans plafond. */
  resteBefore: number | null;
  monthlyBefore: number;
  monthlyAfter: number;
  /** Pour un abonnement perso : la catégorie ce mois-ci, prévus compris. */
  cat: { before: number; after: number; plafond: number | null } | null;
}

/** Ce que changerait un abonnement si la membre le prenait. Ses vrais chiffres ne bougent pas. */
export function simImpact(s: Snapshot, member: MemberKey, today: string, sim: SimInput): SimImpact {
  const month = monthKey(today);
  const share = shareAmt(member, sim);
  const delta = chargesFromToday(sim, month, today).length * share;
  const monthlyBefore = monthlyTotal(s, member, today);
  const monthlyAfter = monthlyBefore + monthlyEq(sim) * shareFraction(member, sim);
  let cat: SimImpact['cat'] = null;
  if (sim.owner === member) {
    const planned = prevus(s, member, month, today).filter((p) => p.sub.owner === member).map((p) => ({ cat: p.sub.cat, amount: p.amount }));
    const row = categoryRows(s, member, month, planned).find((r) => r.cat.id === sim.cat);
    const before = row ? row.spent + row.prevu : 0;
    const plafond = s.categories.find((c) => c.id === sim.cat)?.plafond ?? null;
    cat = { before, after: before + delta, plafond };
  }
  return { delta, resteBefore: monthSummary(s, member, month).reste, monthlyBefore, monthlyAfter, cat };
}
