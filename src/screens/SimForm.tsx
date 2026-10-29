import { useState } from 'react';
import { catState, categoriesOf, myShare, partAFrom } from '../domain/budget';
import { catId } from '../domain/defaults';
import { addMonths, dateShort, monthName } from '../domain/dates';
import { simImpact, type SimInput } from '../domain/forecast';
import { eur, eurShort, evalExpr, numToInput, parseAmount } from '../domain/money';
import { FREQ } from '../domain/subs';
import { other, type Freq, type Owner, type Snapshot, type SubscriptionRec, type MemberKey } from '../domain/types';
import { newId } from '../data/ids';
import { useStore } from '../data/store';
import { IconArrow, IconCheck, IconWarn } from '../ui/icons';
import { PayerAndPart, Seg, SelectBox, Sheet, SubHead, SwitchRow, toast } from '../ui/kit';

type Kind = 'perso' | 'commun';
const FREQS: Array<[Freq, string]> = (Object.keys(FREQ) as Freq[]).map((f) => [f, FREQ[f].short]);

/** « Et si je le prenais ? » : un abonnement envisagé, et ce qu'il changerait. */
export function SimForm(props: { existing?: SubscriptionRec; today: string; onDone: () => void }) {
  const store = useStore();
  const s = store.snapshot();
  const me = store.config!.me;
  const herKey = other(me);
  const her = s.members[herKey].name;
  const ex = props.existing;
  const ro = !!ex && ex.owner === herKey;

  const defaultCat = (k: Kind) => {
    const owner: Owner = k === 'commun' ? 'commun' : me;
    const list = categoriesOf(s, owner);
    const wanted = catId(owner, k === 'commun' ? 'abos' : 'abonnements');
    return list.find((c) => c.id === wanted)?.id ?? list[0]?.id ?? '';
  };

  const [name, setName] = useState(ex?.name ?? '');
  const [amount, setAmount] = useState(ex ? numToInput(ex.amount) : '');
  const [freq, setFreq] = useState<Freq>(ex?.freq ?? 'mois');
  const [kind, setKind] = useState<Kind>(ex?.owner === 'commun' ? 'commun' : 'perso');
  const [payerIsMe, setPayerIsMe] = useState(ex?.payer ? ex.payer === me : true);
  const [share, setShare] = useState(myShare(me, ex?.partA ?? 0.5));
  const [cat, setCat] = useState(ex?.cat ?? defaultCat('perso'));
  const [start, setStart] = useState(ex?.anchor ?? props.today);
  const [essai, setEssai] = useState(ex?.essai ?? false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isC = kind === 'commun';
  const owner: Owner = isC ? 'commun' : ro ? herKey : me;
  const options = categoriesOf(s, owner).map((c) => ({ id: c.id, name: c.name }));
  if (cat && !options.some((o) => o.id === cat)) options.unshift({ id: cat, name: 'Autre' });
  const value = evalExpr(amount);
  const amt = Number.isFinite(value) && value > 0 ? value : null;
  const eq = amt ? `Soit ${eur(amt * FREQ[freq].perMonth)}/mois et ${eur(amt * FREQ[freq].perMonth * 12)}/an` : '';

  function changeEssai(on: boolean) {
    setEssai(on);
    // Un essai qui finirait aujourd'hui n'a pas de sens : on propose un mois d'essai, à corriger si besoin.
    if (on && (!start || start <= props.today)) setStart(addMonths(props.today, 1));
  }

  function changeKind(k: Kind) {
    setKind(k);
    setCat(defaultCat(k));
  }

  function save(keep: boolean) {
    const a = parseAmount(amount);
    if (a === null) return setError('Entre un montant, par exemple 12,00.');
    if (!start) return setError(essai ? "Choisis la date de fin de l'essai." : 'Choisis la date du premier prélèvement.');
    const now = Date.now();
    const rec: SubscriptionRec = {
      id: ex?.id ?? newId('abo'),
      type: 'subscription',
      owner: isC ? 'commun' : me,
      name: name.trim() || 'Abonnement',
      amount: a,
      freq,
      anchor: start,
      preavis: ex?.preavis ?? 0,
      essai,
      cat,
      alerte: ex?.alerte ?? true,
      alerteJours: ex?.alerteJours ?? s.prefs.alerteJours,
      resilieLe: null,
      // Pris pour de bon : on compte à partir de maintenant, sans rattraper les mois passés.
      createdAt: keep ? ex?.createdAt ?? now : now,
      updatedAt: 0,
      by: ''
    };
    if (isC) {
      rec.payer = payerIsMe ? me : herKey;
      rec.partA = partAFrom(me, share);
    }
    if (keep) rec.envisage = true;
    store.put<SubscriptionRec>(rec);
    if (!keep) store.materialize(props.today);
    toast(keep ? `${rec.name} gardé en envisagé` : `${rec.name} ajouté à tes abonnements`);
    props.onDone();
  }

  function remove() {
    if (!ex) return;
    store.remove(ex.id);
    toast('Simulation supprimée');
    props.onDone();
  }

  const sim: SimInput | null = amt
    ? { owner, amount: amt, freq, anchor: start || props.today, partA: isC ? partAFrom(me, share) : undefined, cat, essai }
    : null;

  return (
    <>
      <SubHead title="Et si je le prenais ?" onBack={props.onDone} />
      <main className="screen sub" style={{ paddingTop: 8 }}>
        {ro ? (
          <p className="pill-note">Envisagé par {her} · lecture seule</p>
        ) : (
          <p className="muted">Remplis-le comme un vrai abonnement. Rien n'est compté tant que tu ne l'as pas pris.</p>
        )}
        <div className="field">
          <label className="flabel" htmlFor="s-name">Nom</label>
          <input id="s-name" className="input" placeholder="Spotify, salle de sport…" autoComplete="off" value={name} disabled={ro} onChange={(e) => setName(e.target.value)} />
        </div>
        <SwitchRow title="Essai gratuit" desc="La fin de l'essai devient le premier prélèvement" on={essai} onChange={changeEssai} disabled={ro} />
        <div className="field">
          <label className="flabel" htmlFor="s-amount">{essai ? "Prix après l'essai" : 'Montant'}</label>
          <input id="s-amount" className="input" inputMode="decimal" placeholder="0,00" autoComplete="off" value={amount} disabled={ro} onChange={(e) => { setAmount(e.target.value); setError(''); }} />
        </div>
        <div className="field">
          <span className="flabel">Prélevé tous les…</span>
          {ro ? <span>{FREQ[freq].name}</span> : <Seg<Freq> wide extra="sq" items={FREQS} value={freq} onChange={setFreq} label="Fréquence" />}
          <span className="muted sm" aria-live="polite">{eq}</span>
        </div>
        {!ro && (
          <div className="field">
            <span className="flabel">À qui</span>
            <Seg<Kind> wide items={[['perso', 'Perso'], ['commun', 'Commun']]} value={kind} onChange={changeKind} label="À qui" />
          </div>
        )}
        {isC && (
          <PayerAndPart herName={her} payerIsMe={payerIsMe} onPayer={setPayerIsMe} share={share} onShare={setShare} amount={amt} disabled={ro} />
        )}
        <div className="grid2">
          <div className="field">
            <label className="flabel" htmlFor="s-cat">Catégorie</label>
            <SelectBox id="s-cat" value={cat} options={options} onChange={setCat} disabled={ro} />
          </div>
          <div className="field">
            <label className="flabel" htmlFor="s-start">{essai ? "Fin de l'essai" : '1er prélèvement'}</label>
            <input id="s-start" className="input" type="date" value={start} disabled={ro} onChange={(e) => setStart(e.target.value)} />
          </div>
        </div>
        <section className="card" id="impact" aria-live="polite">
          <Impact s={s} member={ro ? herKey : me} today={props.today} sim={sim} ro={ro} />
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!ro && (
          <div className="stack">
            <button className="btn primary block" type="button" onClick={() => save(false)}><IconCheck />Je le prends</button>
            <button className="btn dashed block" type="button" onClick={() => save(true)}>Garder en envisagé</button>
            {ex && <button className="link-btn" type="button" onClick={() => setConfirmDelete(true)}>Supprimer la simulation</button>}
          </div>
        )}
      </main>
      {confirmDelete && ex && (
        <Sheet title="Supprimer la simulation ?" onClose={() => setConfirmDelete(false)} actions={<button className="btn block danger" type="button" onClick={remove}>Supprimer</button>}>
          <p className="muted">{ex.name} n'apparaîtra plus dans ce que tu envisages.</p>
        </Sheet>
      )}
    </>
  );
}

function Impact({ s, member, today, sim, ro }: { s: Snapshot; member: MemberKey; today: string; sim: SimInput | null; ro: boolean }) {
  const ta = ro ? 'sa' : 'ta';
  const tes = ro ? 'Ses' : 'Tes';
  if (!sim) {
    return (
      <>
        <h2>Si tu le prends</h2>
        <p className="muted">Entre un montant pour voir ce que ça change dans {ro ? 'son' : 'ton'} budget.</p>
      </>
    );
  }
  const imp = simImpact(s, member, today, sim);
  const month = monthName(today.slice(0, 7));
  const arrow = <span className="muted"><IconArrow /></span>;
  const isC = sim.owner === 'commun';
  const c = s.categories.find((x) => x.id === sim.cat);
  return (
    <>
      <h2>{ro ? 'Si elle le prend' : 'Si tu le prends'}</h2>
      {(
        <div className="imp">
          <span className="flabel">Ce mois-ci, hors plafond du mois</span>
          <span>
            {imp.delta > 0
              ? `${sim.essai ? `Fin de l'essai le ${dateShort(sim.anchor, today)} : ` : ''}−${eur(imp.delta)} en ${month}${isC ? ` (${ta} part)` : ''}`
              : sim.essai
                ? `Gratuit jusqu'au ${dateShort(sim.anchor, today)} : ce mois-ci ne change pas.`
                : `Premier prélèvement après ${month} : ce mois-ci ne change pas.`}
          </span>
        </div>
      )}
      <div className="imp">
        <span className="flabel">{tes} abonnements</span>
        <div className="ba">
          <span className="before">{eur(imp.monthlyBefore)}</span>
          {arrow}
          <span className="after">{eur(imp.monthlyAfter)}</span>
          <span className="per">/mois</span>
        </div>
        <span className="muted sm">
          {sim.essai ? `Après l'essai (à partir du ${dateShort(sim.anchor, today)}), soit ` : 'Soit '}{eur(imp.monthlyAfter * 12)} par an au lieu de {eur(imp.monthlyBefore * 12)}
        </span>
      </div>
      {isC && (
        <div className="imp">
          <span className="flabel">{c?.name ?? 'Commun'}</span>
          <span>Le commun n'a pas de plafond.</span>
        </div>
      )}
      {imp.cat && <CatImpact name={c?.name ?? 'Autre'} color={c?.color ?? '#6B7A8F'} month={month} seuil={s.prefs.seuil} ro={ro} {...imp.cat} />}
    </>
  );
}

function CatImpact(props: { name: string; color: string; month: string; seuil: number; ro: boolean; before: number; after: number; plafond: number | null }) {
  const { before, after, plafond } = props;
  const arrow = <span className="muted"><IconArrow /></span>;
  const label = `${props.ro ? 'Sa' : 'Ta'} catégorie ${props.name} en ${props.month}`;
  if (!plafond) {
    return (
      <div className="imp">
        <span className="flabel">{label}</span>
        <div className="ba"><span className="before">{eur(before)}</span>{arrow}<span className="after">{eur(after)}</span></div>
        <span className="muted sm">Pas de plafond pour cette catégorie.</span>
      </div>
    );
  }
  const st = catState(after, plafond, props.seuil);
  const scale = Math.max(plafond * 1.4, after * 1.05);
  const fill = st === 'over' ? 'var(--over)' : st === 'warn' ? 'var(--warn)' : props.color;
  const pct = Math.round((after / plafond) * 100);
  return (
    <div className="imp">
      <span className="flabel">{label}</span>
      <div className="ba">
        <span className="before">{eur(before)}</span>
        {arrow}
        <span className={'after' + (st === 'over' ? ' t-over' : '')}>{eur(after)}</span>
        <span className="per">/ {eurShort(plafond)}</span>
      </div>
      <div className="mbar" style={{ ['--c' as string]: props.color, ['--fill' as string]: fill }} aria-hidden="true">
        <i className="m-after" style={{ width: `${(after / scale) * 100}%` }} />
        <i className="m-before" style={{ width: `${(before / scale) * 100}%` }} />
        <i className="m-cap" style={{ left: `${(plafond / scale) * 100}%` }} />
      </div>
      {st === 'over' ? (
        <span className="alert-banner" style={{ background: 'var(--over)', color: 'var(--over-ink)' }}><IconWarn />{props.ro ? 'Elle dépasserait' : 'Tu dépasserais'} le plafond de {eur(after - plafond)}</span>
      ) : st === 'warn' ? (
        <span className="alert-banner"><IconWarn />{props.ro ? 'Elle serait' : 'Tu serais'} à {pct}&nbsp;% du plafond</span>
      ) : (
        <span className="muted sm">{props.ro ? 'Elle resterait' : 'Tu resterais'} sous le plafond ({pct}&nbsp;%).</span>
      )}
    </div>
  );
}
