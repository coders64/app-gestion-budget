import { monthKey } from './dates';
import { r2 } from './money';
import { other, type CategoryRec, type ExpenseRec, type MemberKey, type Owner, type SettlementRec, type Snapshot } from './types';

/** Part d'une dépense qui revient à une membre, arrondie au centime. Pour le commun, « b » paie le reste. */
export function shareAmt(member: MemberKey, e: Pick<ExpenseRec, 'owner' | 'amount' | 'partA'>): number {
  if (e.owner !== 'commun') return e.owner === member ? e.amount : 0;
  const a = r2(e.amount * (e.partA ?? 0.5));
  return member === 'a' ? a : r2(e.amount - a);
}

/** La part (entre 0 et 1) de la membre qui utilise ce téléphone, d'après la part de « a » enregistrée. */
export const myShare = (me: MemberKey, partA = 0.5) => (me === 'a' ? partA : 1 - partA);
/** L'inverse : la part de « a » d'après la part de la membre de ce téléphone. */
export const partAFrom = (me: MemberKey, share: number) => (me === 'a' ? share : 1 - share);

export function categoriesOf(s: Snapshot, owner: Owner): CategoryRec[] {
  return s.categories.filter((c) => c.owner === owner).sort((x, y) => x.order - y.order || x.name.localeCompare(y.name));
}

export function expensesOfMonth(s: Snapshot, month: string): ExpenseRec[] {
  return s.expenses.filter((e) => monthKey(e.date) === month);
}

export interface MonthSummary {
  perso: number;
  commun: number;
  plafond: number | null;
  /** Dépenses d'abonnement du mois (sa part) : elles ne comptent pas dans le plafond du mois. */
  abos: number;
  /** Plafond moins dépenses perso et part du commun, hors abonnements ; null sans plafond. */
  reste: number | null;
}

export function monthSummary(s: Snapshot, member: MemberKey, month: string): MonthSummary {
  const all = expensesOfMonth(s, month);
  const list = all.filter((e) => !e.subId);
  const perso = list.filter((e) => e.owner === member).reduce((t, e) => t + e.amount, 0);
  const commun = list.filter((e) => e.owner === 'commun').reduce((t, e) => t + shareAmt(member, e), 0);
  const abos = all.filter((e) => e.subId).reduce((t, e) => t + shareAmt(member, e), 0);
  const plafond = s.members[member]?.plafond ?? null;
  return { perso, commun, abos, plafond, reste: plafond ? plafond - perso - commun : null };
}

export type CatState = 'none' | 'ok' | 'warn' | 'over';

/** Sans plafond : « none ». Au-delà du plafond : « over ». À partir du seuil (en %) : « warn ». */
export function catState(total: number, plafond: number | null, seuil: number): CatState {
  if (!plafond) return 'none';
  if (total > plafond + 0.004) return 'over';
  if (total >= (plafond * seuil) / 100 - 0.004) return 'warn';
  return 'ok';
}

export interface CategoryRow {
  cat: CategoryRec;
  spent: number;
  /** Prélèvements d'abonnements attendus plus tard dans le mois. */
  prevu: number;
  state: CatState;
}

/**
 * Les catégories perso d'une membre pour un mois : celles qui ont un plafond, des dépenses ou des prévus.
 * prevus : les prélèvements attendus (catégorie et montant) à ajouter, déjà filtrés sur cette membre.
 */
export function categoryRows(s: Snapshot, member: MemberKey, month: string, prevus: Array<{ cat: string; amount: number }> = []): CategoryRow[] {
  const list = expensesOfMonth(s, month).filter((e) => e.owner === member);
  const cats = categoriesOf(s, member);
  const known = new Set(cats.map((c) => c.id));
  const total = (items: Array<{ cat: string; amount: number }>, id: string) => items.filter((e) => e.cat === id).reduce((t, e) => t + e.amount, 0);
  const rows: CategoryRow[] = cats.map((cat) => {
    const spent = total(list, cat.id);
    const prevu = total(prevus, cat.id);
    return { cat, spent, prevu, state: catState(spent + prevu, cat.plafond, s.prefs.seuil) };
  });
  // Dépenses dont la catégorie a été supprimée : regroupées dans « Autre ».
  const orphan = list.filter((e) => !known.has(e.cat)).reduce((t, e) => t + e.amount, 0);
  const orphanPrevu = prevus.filter((e) => !known.has(e.cat)).reduce((t, e) => t + e.amount, 0);
  if (orphan > 0 || orphanPrevu > 0) {
    rows.push({ cat: otherCategory(member), spent: orphan, prevu: orphanPrevu, state: 'none' });
  }
  return rows.filter((r) => r.cat.plafond || r.spent > 0 || r.prevu > 0);
}

export function otherCategory(owner: Owner): CategoryRec {
  return { id: '__autre', type: 'category', owner, name: 'Autre', color: '#6B7A8F', plafond: null, order: 9999, updatedAt: 0, by: '' };
}

export function findCategory(s: Snapshot, id: string, owner: Owner): CategoryRec {
  return s.categories.find((c) => c.id === id) ?? otherCategory(owner);
}

/** Dépenses à montrer à une membre pour un mois : les siennes et les communes, les plus récentes d'abord. */
export function recentExpenses(s: Snapshot, member: MemberKey, month: string, limit = 50): ExpenseRec[] {
  return expensesOfMonth(s, month)
    .filter((e) => e.owner === member || e.owner === 'commun')
    .sort((x, y) => (x.date === y.date ? y.createdAt - x.createdAt : x.date < y.date ? 1 : -1))
    .slice(0, limit);
}

/** Premier mois où l'on a des dépenses (pour borner la navigation vers le passé). */
export function firstMonth(s: Snapshot, fallback: string): string {
  const dates = [...s.expenses.map((e) => e.date), ...s.settlements.map((r) => r.date)];
  return dates.reduce((m, d) => (monthKey(d) < m ? monthKey(d) : m), fallback);
}

export function categoryInUse(s: Snapshot, catId: string): boolean {
  return [...s.expenses, ...s.envExpenses, ...s.subscriptions, ...s.envSubs].some((x) => x.cat === catId);
}

/**
 * Ce que la membre « b » doit à la membre « a » depuis le début, remboursements déduits.
 * Une dépense commune payée par l'une crée une dette de la part de l'autre.
 */
export function balanceBOwesA(s: Snapshot): number {
  let bal = 0;
  for (const e of s.expenses) {
    if (e.owner !== 'commun') continue;
    if ((e.payer ?? 'a') === 'a') bal += shareAmt('b', e);
    else bal -= shareAmt('a', e);
  }
  for (const r of s.settlements) bal += r.from === 'b' ? -r.amount : r.amount;
  return r2(bal);
}

/** Le solde vu par une membre : positif si l'autre lui doit de l'argent. */
export function balanceFor(s: Snapshot, member: MemberKey): number {
  const bal = balanceBOwesA(s);
  return member === 'a' ? bal : r2(-bal);
}

/** Le remboursement qui remet le solde à zéro, ou null si vous êtes déjà quittes. */
export function settlementFor(s: Snapshot, member: MemberKey): { from: MemberKey; amount: number } | null {
  const owed = balanceFor(s, member);
  if (Math.abs(owed) < 0.005) return null;
  return owed > 0 ? { from: other(member), amount: owed } : { from: member, amount: -owed };
}

export function settlementsOfMonth(s: Snapshot, month: string): SettlementRec[] {
  return s.settlements.filter((r) => monthKey(r.date) === month);
}

/** Dépenses communes d'un mois, les plus récentes d'abord. */
export function communExpenses(s: Snapshot, month: string): ExpenseRec[] {
  return expensesOfMonth(s, month)
    .filter((e) => e.owner === 'commun')
    .sort((x, y) => (x.date === y.date ? y.createdAt - x.createdAt : x.date < y.date ? 1 : -1));
}
