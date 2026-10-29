import { describe, expect, it } from 'vitest';
import { balanceFor, balanceBOwesA, categoryRows, settlementFor } from './budget';
import { catId, defaultRecords } from './defaults';
import { autoExpenseId, deadline, dueAutoExpenses, dueDates, monthlyTotal, nextDue, occurrence, prevus } from './subs';
import { envisaged, simImpact } from './forecast';
import { plannedAlerts } from './alerts';
import { snapshotOf } from './testkit';
import type { ExpenseRec, SettlementRec, SubscriptionRec } from './types';

const OCT_1 = new Date(2026, 9, 1, 9).getTime();

function sub(extra: Partial<SubscriptionRec>): SubscriptionRec {
  return {
    id: 'netflix', type: 'subscription', owner: 'a', name: 'Netflix', amount: 13.49, freq: 'mois', anchor: '2026-10-05',
    preavis: 0, essai: false, cat: catId('a', 'abonnements'), alerte: true, alerteJours: 3, resilieLe: null,
    createdAt: OCT_1, updatedAt: OCT_1, by: 'x', ...extra
  };
}

let n = 0;
function exp(extra: Partial<ExpenseRec>): ExpenseRec {
  n++;
  return { id: `e${n}`, type: 'expense', owner: 'commun', date: '2026-10-06', amount: 40, label: '', cat: catId('commun', 'courses'), payer: 'a', partA: 0.5, createdAt: n, updatedAt: n, by: 'x', ...extra };
}

describe('échéances', () => {
  it('garde le jour d\'origine malgré les fins de mois courtes', () => {
    expect(occurrence('2026-01-31', 'mois', 1)).toBe('2026-02-28');
    expect(occurrence('2026-01-31', 'mois', 2)).toBe('2026-03-31');
    expect(occurrence('2026-10-05', 'trimestre', 1)).toBe('2027-01-05');
    expect(occurrence('2026-10-05', 'semaine', 2)).toBe('2026-10-19');
    expect(occurrence('2024-02-29', 'an', 1)).toBe('2025-02-28');
  });

  it('prend la prochaine échéance après aujourd\'hui, et la date limite moins le préavis', () => {
    const salle = sub({ anchor: '2026-01-01', freq: 'an', preavis: 31 });
    expect(nextDue(salle, '2026-10-12')).toBe('2027-01-01');
    expect(deadline(salle, '2026-10-12')).toBe('2026-12-01');
    // Le jour de l'échéance, elle est déjà prélevée : on passe à la suivante.
    expect(nextDue(sub({}), '2026-10-05')).toBe('2026-11-05');
  });
});

describe('dépenses ajoutées toutes seules', () => {
  it('ajoute chaque échéance passée, mais rien avant le mois de création', () => {
    const s = sub({ anchor: '2026-08-05', createdAt: OCT_1 });
    expect(dueDates(s, '2026-12-20')).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);
  });

  it('s\'arrête à la résiliation', () => {
    expect(dueDates(sub({ resilieLe: '2026-11-05' }), '2026-12-20')).toEqual(['2026-10-05']);
    expect(dueDates(sub({ resilieLe: '2026-11-04' }), '2026-12-20')).toEqual(['2026-10-05']);
    expect(dueDates(sub({ resilieLe: '2026-11-06' }), '2026-12-20')).toEqual(['2026-10-05', '2026-11-05']);
  });

  it('donne le même identifiant et la même date de modification sur les deux téléphones', () => {
    const [a] = dueAutoExpenses([sub({})], '2026-10-12');
    const [b] = dueAutoExpenses([sub({})], '2026-10-20');
    expect(a).toEqual(b);
    expect(a.id).toBe(autoExpenseId('netflix', '2026-10-05'));
    expect(a.updatedAt).toBe(new Date(2026, 9, 5).getTime());
    expect(a.updatedAt).toBeLessThan(Date.now());
  });

  it('n\'ajoute pas une deuxième dépense quand l\'échéance est décalée de quelques jours', () => {
    const moved = sub({ anchor: '2026-10-03' });
    expect(dueAutoExpenses([moved], '2026-11-10', [{ subId: 'netflix', date: '2026-10-05' }]).map((e) => e.date)).toEqual(['2026-11-03']);
    expect(dueAutoExpenses([moved], '2026-11-10', [{ subId: 'autre', date: '2026-10-05' }]).map((e) => e.date)).toEqual(['2026-10-03', '2026-11-03']);
  });

  it('recopie la payeuse et la part pour un abonnement commun', () => {
    const [e] = dueAutoExpenses([sub({ owner: 'commun', payer: 'b', partA: 0.5, cat: catId('commun', 'abos') })], '2026-10-12');
    expect(e).toMatchObject({ owner: 'commun', payer: 'b', partA: 0.5, amount: 13.49, subId: 'netflix' });
  });
});

describe('coût et prévus', () => {
  it('compte le coût par mois, ta part du commun comprise, sans les essais en cours', () => {
    const s = snapshotOf([
      ...defaultRecords('Jess', 'Léa', 'd', 1),
      sub({ id: 'box', amount: 29.99 }),
      sub({ id: 'antivirus', amount: 39.99, freq: 'an' }),
      sub({ id: 'netflix', owner: 'commun', payer: 'b', partA: 0.5 }),
      sub({ id: 'medit', amount: 6.99, essai: true, anchor: '2026-10-20' }),
      sub({ id: 'old', amount: 50, resilieLe: '2026-10-01' }),
      sub({ id: 'sport', owner: 'b', amount: 24.9 })
    ]);
    expect(monthlyTotal(s, 'a', '2026-10-12')).toBeCloseTo(29.99 + 39.99 / 12 + 13.49 / 2, 6);
    expect(monthlyTotal(s, 'b', '2026-10-12')).toBeCloseTo(24.9 + 13.49 / 2, 6);
  });

  it('prévoit les échéances de la fin du mois, essai gratuit compris, pour le mois en cours seulement', () => {
    const s = snapshotOf([
      ...defaultRecords('Jess', 'Léa', 'd', 1),
      sub({ id: 'mobile', amount: 9.99, anchor: '2026-10-18' }),
      sub({ id: 'medit', amount: 6.99, essai: true, anchor: '2026-10-14' }),
      sub({ id: 'box', amount: 29.99, anchor: '2026-10-05' }),
      sub({ id: 'netflix', owner: 'commun', anchor: '2026-10-25', payer: 'b', partA: 0.5 })
    ]);
    const p = prevus(s, 'a', '2026-10', '2026-10-12');
    expect(p.map((x) => [x.sub.id, x.date, x.amount])).toEqual([
      ['mobile', '2026-10-18', 9.99],
      ['medit', '2026-10-14', 6.99],
      ['netflix', '2026-10-25', 6.75]
    ]);
    expect(prevus(s, 'a', '2026-09', '2026-10-12')).toEqual([]);
    const rows = categoryRows(s, 'a', '2026-10', p.filter((x) => x.sub.owner === 'a').map((x) => ({ cat: x.sub.cat, amount: x.amount })));
    const abos = rows.find((r) => r.cat.id === catId('a', 'abonnements'))!;
    expect(abos.prevu).toBeCloseTo(16.98, 6);
  });
});

describe('solde du commun', () => {
  const base = defaultRecords('Jess', 'Léa', 'd', 1);

  it('fait la différence entre ce que chacune a avancé et sa part', () => {
    const s = snapshotOf([
      ...base,
      exp({ amount: 40, payer: 'a' }),
      exp({ amount: 30, payer: 'a' }),
      exp({ amount: 13.49, payer: 'b' })
    ]);
    // Léa doit 20 + 15 = 35 €, Jess doit 6,75 € : Léa doit 28,25 € à Jess.
    expect(balanceBOwesA(s)).toBe(28.25);
    expect(balanceFor(s, 'a')).toBe(28.25);
    expect(balanceFor(s, 'b')).toBe(-28.25);
  });

  it('suit la part réglée au cas par cas', () => {
    const s = snapshotOf([...base, exp({ amount: 100, payer: 'b', partA: 0.7 })]);
    expect(balanceFor(s, 'b')).toBe(70);
  });

  it('repart de zéro après « On est quittes », et compte ce qui est ajouté ensuite', () => {
    const before = [...base, exp({ amount: 40, payer: 'a' }), exp({ amount: 13.49, payer: 'b' })];
    const st = settlementFor(snapshotOf(before), 'b')!;
    expect(st).toEqual({ from: 'b', amount: 13.25 });
    const r: SettlementRec = { id: 'r1', type: 'settlement', date: '2026-10-12', ...st, createdAt: 1, updatedAt: 1, by: 'x' };
    expect(balanceFor(snapshotOf([...before, r]), 'a')).toBe(0);
    expect(settlementFor(snapshotOf([...before, r]), 'a')).toBeNull();
    expect(balanceFor(snapshotOf([...before, r, exp({ amount: 10, payer: 'b' })]), 'a')).toBe(-5);
  });
});

describe('prévisions', () => {
  const base = () => {
    const recs = defaultRecords('Jess', 'Léa', 'd', 1);
    const s = snapshotOf([
      ...recs,
      sub({ id: 'box', amount: 29.99, anchor: '2026-10-05' }),
      sub({ id: 'spotify', amount: 12, anchor: '2026-10-11', envisage: true }),
      sub({ id: 'disney', owner: 'commun', amount: 10, anchor: '2026-11-02', envisage: true, partA: 0.5, payer: 'b' }),
      exp({ id: 'box-oct', owner: 'a', amount: 29.99, cat: catId('a', 'abonnements'), date: '2026-10-05' }),
      exp({ id: 'baskets', owner: 'a', amount: 60, cat: catId('a', 'shopping'), date: '2026-10-20', envisage: true }),
      exp({ id: 'velo', owner: 'a', amount: 200, cat: catId('a', 'loisirs'), date: '2026-09-15', envisage: true }),
      exp({ id: 'lea', owner: 'b', amount: 30, cat: catId('b', 'shopping'), date: '2026-10-20', envisage: true })
    ]);
    s.members.a.plafond = 600;
    s.categories.find((c) => c.id === catId('a', 'abonnements'))!.plafond = 50;
    return s;
  };

  it('garde les envisagés hors des vrais chiffres', () => {
    const s = base();
    expect(s.expenses.map((e) => e.id)).toEqual(['box-oct']);
    expect(s.subscriptions.map((x) => x.id)).toEqual(['box']);
    expect(dueAutoExpenses(s.subscriptions, '2026-12-31').every((e) => e.subId === 'box')).toBe(true);
  });

  it('liste ce que tu envisages, l\'achat du mois passé en premier', () => {
    const env = envisaged(base(), 'a', '2026-10-11');
    expect(env.items.map((x) => x.item.id)).toEqual(['velo', 'baskets', 'spotify', 'disney']);
    expect(env.items[0]).toMatchObject({ kind: 'achat', when: 'passe' });
    // Baskets 60 ce mois-ci ; les abonnements sont hors plafond ; le vélo de septembre est passé.
    expect(env.thisMonth).toBeCloseTo(60, 6);
    expect(env.months).toEqual([{ month: '2026-10', amount: 60 }]);
    expect(env.monthly).toBeCloseTo(12 + 5, 6);
    expect(envisaged(base(), 'b', '2026-10-11').items.map((x) => x.item.id)).toEqual(['lea', 'disney']);
  });

  it('montre l\'impact d\'un abonnement : reste, coût par mois, catégorie', () => {
    const imp = simImpact(base(), 'a', '2026-10-11', { owner: 'a', amount: 12, freq: 'mois', anchor: '2026-10-11', cat: catId('a', 'abonnements') });
    expect(imp.delta).toBe(12);
    expect(imp.resteBefore).toBeCloseTo(600 - 29.99, 6);
    expect(imp.monthlyAfter - imp.monthlyBefore).toBeCloseTo(12, 6);
    expect(imp.cat).toMatchObject({ before: 29.99, plafond: 50 });
    expect(imp.cat!.after).toBeCloseTo(41.99, 6);
    const later = simImpact(base(), 'a', '2026-10-11', { owner: 'commun', amount: 10, freq: 'mois', anchor: '2026-11-02', partA: 0.5, cat: catId('commun', 'abos') });
    expect(later.delta).toBe(0);
    expect(later.cat).toBeNull();
    expect(later.monthlyAfter - later.monthlyBefore).toBeCloseTo(5, 6);
  });

  it('ne compte rien ce mois-ci pendant un essai gratuit, mais montre le coût après l\'essai', () => {
    const trial = simImpact(base(), 'a', '2026-10-11', { owner: 'a', amount: 9.99, freq: 'mois', anchor: '2026-11-11', cat: catId('a', 'abonnements'), essai: true });
    expect(trial.delta).toBe(0);
    expect(trial.cat!.after).toBe(trial.cat!.before);
    expect(trial.monthlyAfter - trial.monthlyBefore).toBeCloseTo(9.99, 6);
    const endsThisMonth = simImpact(base(), 'a', '2026-10-11', { owner: 'a', amount: 9.99, freq: 'mois', anchor: '2026-10-25', cat: catId('a', 'abonnements'), essai: true });
    expect(endsThisMonth.delta).toBe(9.99);
  });
});

describe('alertes', () => {
  const s = () => snapshotOf([
    ...defaultRecords('Jess', 'Léa', 'd', 1),
    sub({ id: 'netflix', anchor: '2026-10-20', alerteJours: 3 }),
    sub({ id: 'salle', anchor: '2027-01-01', freq: 'an', preavis: 31, alerteJours: 3, amount: 24.9 }),
    sub({ id: 'mobile', anchor: '2026-10-18', alerte: false }),
    sub({ id: 'medit', anchor: '2026-10-25', essai: true, alerte: false, alerteJours: 2, amount: 6.99 }),
    sub({ id: 'commun', owner: 'commun', anchor: '2026-11-02', partA: 0.5, payer: 'b' }),
    sub({ id: 'lea', owner: 'b', anchor: '2026-10-22' }),
    sub({ id: 'stop', anchor: '2026-10-22', resilieLe: '2026-10-10' })
  ]);

  it('prévient le nombre de jours choisi avant la date limite, pour les siens et les communs', () => {
    const list = plannedAlerts(s(), 'a', '2026-10-12', 1);
    expect(list.map((a) => [a.subId, a.day, a.deadline])).toEqual([
      ['netflix', '2026-10-17', '2026-10-20'],
      ['medit', '2026-10-23', '2026-10-25'],
      ['commun', '2026-10-30', '2026-11-02'],
      ['salle', '2026-11-28', '2026-12-01']
    ]);
    expect(list.find((a) => a.subId === 'medit')!.title).toContain("Fin de l'essai");
    expect(list.find((a) => a.subId === 'salle')!.body).toContain('1 déc.');
  });

  it('prévoit plusieurs échéances, sans alerte forcée après la fin de l\'essai', () => {
    const list = plannedAlerts(s(), 'a', '2026-10-12');
    expect(list.filter((a) => a.subId === 'netflix').map((a) => a.due)).toEqual(['2026-10-20', '2026-11-20', '2026-12-20']);
    expect(list.filter((a) => a.subId === 'medit').map((a) => a.due)).toEqual(['2026-10-25']);
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
    expect(list.every((a) => Number.isInteger(a.id) && a.id > 0 && a.id <= 0x7fffffff)).toBe(true);
  });

  it('garde une alerte dont le jour est passé tant que la date limite ne l\'est pas', () => {
    const list = plannedAlerts(s(), 'a', '2026-10-19', 1);
    expect(list.find((a) => a.subId === 'netflix')).toMatchObject({ day: '2026-10-17', deadline: '2026-10-20' });
    expect(plannedAlerts(s(), 'a', '2026-10-21', 1).find((a) => a.due === '2026-10-20')).toBeUndefined();
  });
});
