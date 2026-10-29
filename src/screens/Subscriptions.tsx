import { useState } from 'react';
import { shareAmt } from '../domain/budget';
import { dateShort, daysBetween, inDays, monthName } from '../domain/dates';
import { chargesFromToday, envisaged } from '../domain/forecast';
import { eur } from '../domain/money';
import { FREQ, deadline, inTrial, isActive, monthlyEq, monthlyTotal, nextDue, sortByDeadline } from '../domain/subs';
import { other, type MemberKey, type SubscriptionRec } from '../domain/types';
import { useStore } from '../data/store';
import { IconBell, IconBellOff, IconBulb, IconCheck, IconWarn } from '../ui/icons';
import { Seg, toast } from '../ui/kit';
import { RefreshButton, SyncLine } from './Budget';

type Filter = 'tous' | 'perso' | 'communs' | 'soeur';

export function Subscriptions(props: { today: string; onOpen: (sub: SubscriptionRec) => void; onSim: (sub?: SubscriptionRec) => void }) {
  const store = useStore();
  const s = store.snapshot();
  const me = store.config!.me;
  const herKey = other(me);
  const her = s.members[herKey].name;
  const [filter, setFilter] = useState<Filter>('tous');
  const total = monthlyTotal(s, me, props.today);

  const keep = (x: SubscriptionRec) =>
    filter === 'tous' ? x.owner !== herKey : filter === 'perso' ? x.owner === me : filter === 'communs' ? x.owner === 'commun' : x.owner === herKey;
  const list = sortByDeadline(s.subscriptions.filter((x) => isActive(x) && keep(x)), props.today);
  const stopped = s.subscriptions.filter((x) => !isActive(x) && keep(x)).sort((x, y) => x.name.localeCompare(y.name));
  const envMonthly = envisaged(s, me, props.today).monthly;
  const envList = s.envSubs.filter(keep).sort((x, y) => x.name.localeCompare(y.name));
  const month = props.today.slice(0, 7);

  function take(sub: SubscriptionRec) {
    const { envisage: _drop, ...rest } = sub;
    store.put<SubscriptionRec>({ ...rest, id: sub.id, createdAt: Date.now() });
    store.materialize(props.today);
    toast(`${sub.name} ajouté à tes abonnements`);
  }

  return (
    <main className="screen">
      <header className="head">
        <h1 className="title-hand"><span className="hl">Abonnements</span></h1>
        <div className="head-actions"><RefreshButton store={store} /></div>
      </header>
      <SyncLine store={store} />

      <section className="card" aria-label="Coût de tes abonnements">
        <span className="label">Tes abonnements te coûtent</span>
        <span><span className="big-num">{eur(total)}</span> <span className="per" style={{ fontSize: 18 }}>/mois</span></span>
        <span className="muted">soit {eur(total * 12)} par an, ta part du commun comprise</span>
        {envMonthly > 0 && (
          <span className="env-line" style={{ minHeight: 0 }}>
            <span>Avec ce que tu envisages : <b style={{ fontSize: 16 }}>{eur(total + envMonthly)}/mois</b>, soit {eur((total + envMonthly) * 12)}/an</span>
          </span>
        )}
      </section>
      {filter !== 'soeur' && (
        <button className="btn dashed block" type="button" onClick={() => props.onSim()}><IconBulb />Et si je prenais un abonnement ?</button>
      )}

      <Seg<Filter> wide extra="tight" items={[['tous', 'Tous'], ['perso', 'Perso'], ['communs', 'Communs'], ['soeur', her]]} value={filter} onChange={setFilter} label="Abonnements à montrer" />
      {filter === 'soeur' && <p className="pill-note">Abonnements de {her} · lecture seule</p>}

      {envList.length > 0 && (
        <>
          <h2 className="section-label">Envisagés</h2>
          {envList.map((x) => {
            const can = x.owner !== herKey;
            const charges = chargesFromToday(x, month, props.today).length;
            const cost = charges * shareAmt(can ? me : herKey, x);
            const line = !charges
              ? x.essai ? `Gratuit jusqu'au ${dateShort(x.anchor, props.today)}` : `Rien à payer en ${monthName(month)}`
              : `Coûterait ${eur(cost)} en ${monthName(month)}, hors plafond du mois`;
            const head = (
              <>
                <span className="li-main">
                  <span className="sub-name">
                    <b>{x.name}</b>
                    <span className="badge plain">Envisagé</span>
                    {x.essai && <span className="badge warn">Essai gratuit</span>}
                    {x.owner === 'commun' && <span className="badge soft">Commun</span>}
                  </span>
                  <span className="li-sub">{line}</span>
                </span>
                <span className="li-amt">
                  <span>{eur(x.amount)}<span className="per">{FREQ[x.freq].per}</span></span>
                  <span className="sm muted">{eur(monthlyEq(x) * 12)}/an</span>
                </span>
              </>
            );
            return (
              <div className="dash-card" key={x.id}>
                <button type="button" className="env-head" onClick={() => props.onSim(x)}>{head}</button>
                {can && (
                  <div className="grid2" style={{ marginTop: 8 }}>
                    <button className="btn sm" type="button" onClick={() => props.onSim(x)}>Voir l'impact</button>
                    <button className="btn sm primary" type="button" onClick={() => take(x)}><IconCheck />Je le prends</button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      <h2 className="section-label">Par date limite de résiliation</h2>
      {list.length === 0 && (
        <p className="empty">{filter === 'soeur' ? `${her} n'a pas encore d'abonnement.` : 'Aucun abonnement ici. Touche « Abonnement » pour en ajouter un.'}</p>
      )}
      {list.map((x) => <SubCard key={x.id} sub={x} me={me} herName={her} today={props.today} onOpen={() => props.onOpen(x)} />)}

      {stopped.length > 0 && (
        <>
          <h2 className="section-label">Résiliés</h2>
          {stopped.map((x) => <SubCard key={x.id} sub={x} me={me} herName={her} today={props.today} onOpen={() => props.onOpen(x)} />)}
        </>
      )}
    </main>
  );
}

function PriceBlock({ sub, me, today }: { sub: SubscriptionRec; me: MemberKey; today: string }) {
  if (inTrial(sub, today)) {
    return <span className="li-amt">{eur(0)}<span className="sm muted">puis {eur(sub.amount)}{FREQ[sub.freq].per}</span></span>;
  }
  const second =
    sub.owner === 'commun' ? `ta part ${eur(shareAmt(me, sub))}` : sub.freq === 'mois' ? `${eur(sub.amount * 12)}/an` : `${eur(monthlyEq(sub))}/mois`;
  return (
    <span className="li-amt">
      <span>{eur(sub.amount)}<span className="per">{FREQ[sub.freq].per}</span></span>
      <span className="sm muted">{second}</span>
    </span>
  );
}

function SubCard({ sub, me, herName, today, onOpen }: { sub: SubscriptionRec; me: MemberKey; herName: string; today: string; onOpen: () => void }) {
  const stopped = !isActive(sub);
  const dl = deadline(sub, today);
  const days = daysBetween(today, dl);
  const mine = sub.owner !== other(me);
  const urgent = !stopped && mine && sub.alerte && days >= 0 && days <= sub.alerteJours;
  const part = Math.round((sub.partA ?? 0.5) * 100);
  const payer = sub.payer ?? 'a';
  const subLine =
    sub.owner === 'commun'
      ? `Payé par ${payer === me ? 'toi' : herName} · ${me === 'a' ? part : 100 - part}/${me === 'a' ? 100 - part : part}`
      : inTrial(sub, today)
        ? `Gratuit jusqu'au ${dateShort(sub.anchor, today)}`
        : FREQ[sub.freq].name + (sub.preavis ? ` · préavis ${sub.preavis} j` : '');

  let status;
  if (stopped) status = <span className="sub-status muted">Résilié le {dateShort(sub.resilieLe!, today)} · plus de dépense</span>;
  else if (urgent) status = <span className="alert-banner"><IconBell />Résilier avant le {dateShort(dl, today)} · {inDays(days)}</span>;
  else if (days < 0) status = <span className="sub-status"><IconWarn />Date limite passée pour le prélèvement du {dateShort(nextDue(sub, today), today)}</span>;
  else if (!mine) status = <span className="sub-status muted">Résilier avant le {dateShort(dl, today)}</span>;
  else {
    status = (
      <span className={'sub-status' + (sub.alerte ? '' : ' muted')}>
        {sub.alerte ? <IconBell /> : <IconBellOff />}Résilier avant le {dateShort(dl, today)}{sub.alerte ? '' : ' · alerte coupée'}
      </span>
    );
  }

  return (
    <button type="button" className={'sub-card' + (stopped ? ' is-resilie' : '')} onClick={onOpen}>
      <span className="sub-top">
        <span className="li-main">
          <span className="sub-name">
            <b>{sub.name}</b>
            {inTrial(sub, today) && !stopped && <span className="badge warn">Essai gratuit</span>}
            {sub.owner === 'commun' && <span className="badge soft">Commun</span>}
            {stopped && <span className="badge plain">Résilié</span>}
          </span>
          <span className="li-sub">{subLine}</span>
        </span>
        <PriceBlock sub={sub} me={me} today={today} />
      </span>
      {status}
    </button>
  );
}
