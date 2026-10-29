// Parcours complet sur deux « téléphones » qui partagent un faux script Google (le vrai Code.gs, exécuté en local).
// Lancer : npm run build && npx vite preview --port 4173 &  puis  node test/e2e.mjs [dossier-captures]
import { readFileSync, mkdirSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

const BASE = process.env.BASE || 'http://localhost:4173/';
const SHOTS = process.argv[2] || 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbTEST_e2e-123/exec';

function fakeScript() {
  const props = new Map();
  const grid = [];
  let created = false;
  const sheet = {
    getLastRow: () => grid.length,
    getRange: (row, _c, n, m) => ({
      getValues: () => grid.slice(row - 1, row - 1 + n).map((r) => r.slice(0, m)),
      setValues: (vals) => vals.forEach((v, i) => { grid[row - 1 + i] = [...v]; })
    }),
    setFrozenRows: () => {}
  };
  const ctx = createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => (created ? sheet : null), insertSheet: () => { created = true; return sheet; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) }
  });
  runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  return { ctx, grid };
}

const server = fakeScript();
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };

async function phone(browser, scheme = 'light') {
  const net = { down: false };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block', hasTouch: true, isMobile: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  // Comme dans les Chrome récents : les méthodes de défilement renvoient une promesse.
  await context.addInitScript(() => {
    for (const target of [window, Element.prototype]) {
      for (const name of ['scrollTo', 'scrollBy', 'scroll']) {
        const original = target[name];
        if (typeof original !== 'function') continue;
        target[name] = function (...args) {
          original.apply(this, args);
          return Promise.resolve();
        };
      }
    }
    const intoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      intoView.apply(this, args);
      return Promise.resolve();
    };
  });
  await context.route('https://script.google.com/**', async (route) => {
    if (net.down) return route.abort('internetdisconnected');
    const req = route.request();
    const out = req.method() === 'GET' ? server.ctx.doGet() : server.ctx.doPost({ postData: { contents: req.postData() } });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.body });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED') && errors.push(m.text()));
  return { page, errors, context, net };
}
const text = (page) => page.locator('#root').innerText();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

const browser = await chromium.launch();
try {
  // --- Téléphone A : première configuration ---
  const A = await phone(browser);
  await A.page.goto(BASE);
  await shot(A.page, '01-accueil');
  await A.page.getByText("C'est moi qui ai installé le script Google").click();
  await A.page.fill('#s-url', 'https://exemple.fr/pas-un-script');
  await A.page.fill('#s-a', 'Jess');
  await A.page.fill('#s-b', 'Léa');
  await A.page.getByRole('button', { name: 'Relier mon téléphone' }).click();
  ok((await text(A.page)).includes('ne ressemble pas'), 'A : adresse invalide refusée');
  await A.page.fill('#s-url', SCRIPT_URL);
  await A.page.getByRole('button', { name: 'Relier mon téléphone' }).click();
  await A.page.getByText("C'est prêt").waitFor();
  const link = await A.page.locator('textarea').inputValue();
  ok(link.includes('#rejoindre='), 'A : lien d\'invitation créé');
  await shot(A.page, '02-invitation');
  await A.page.getByRole('button', { name: 'Retour' }).click();
  ok((await text(A.page)).toLowerCase().includes('dépensé ce mois'), 'A : budget sans plafond');

  // Paramètres : plafond du mois, plafond de Courses
  await A.page.getByRole('button', { name: 'Paramètres' }).click();
  await A.page.fill('#p-plafond', '600');
  await A.page.locator('#p-plafond').blur();
  await A.page.getByLabel('Plafond de Courses').fill('200');
  await A.page.getByLabel('Plafond de Courses').blur();
  await A.page.getByLabel('Couleur de Restos & sorties').click();
  await A.page.getByLabel('Couleur #9B7BF2').click();
  await shot(A.page, '03-parametres');
  await A.page.getByRole('button', { name: 'Retour' }).click();
  ok((await text(A.page)).includes('600,00'), 'A : plafond du mois appliqué');

  // Ajout d'une dépense avec calcul
  await A.page.getByRole('button', { name: 'Dépense' }).click();
  await A.page.fill('#f-amount', '12,40');
  await A.page.getByRole('button', { name: 'Plus' }).click();
  await A.page.keyboard.type('8,90');
  ok((await text(A.page)).includes('= 21,30'), 'A : calcul 12,40+8,90 = 21,30');
  await A.page.fill('#f-label', 'Carrefour');
  await A.page.getByRole('button', { name: 'Ajouter la dépense' }).click();
  let t = await text(A.page);
  ok(t.includes('578,70'), 'A : reste du mois 578,70');
  await A.page.getByRole('button', { name: 'Dépense' }).click();
  await A.page.fill('#f-amount', '190');
  await A.page.getByRole('button', { name: 'Ajouter la dépense' }).click();
  t = await text(A.page);
  ok(t.includes('Dépassé de 11,30'), 'A : Courses dépassé de 11,30');
  // Modifier puis supprimer
  await A.page.getByRole('button', { name: /^Courses.*190,00/ }).click();
  await A.page.fill('#f-amount', '150');
  await A.page.getByRole('button', { name: 'Enregistrer' }).click();
  t = await text(A.page);
  ok(t.includes('Plus que 28,70') || t.includes('PLUS QUE 28,70'), 'A : modification → plus que 28,70');
  await A.page.getByRole('button', { name: 'Dépense' }).click();
  await A.page.fill('#f-amount', '5');
  await A.page.getByRole('button', { name: 'Ajouter la dépense' }).click();
  await A.page.getByRole('button', { name: /^Courses.*5,00/ }).click();
  await A.page.getByRole('button', { name: 'Supprimer cette dépense' }).click();
  await A.page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  ok(!(await text(A.page)).includes('5,00 €\n'), 'A : dépense supprimée');
  await A.page.getByRole('button', { name: 'Mettre à jour' }).click();
  await A.page.waitForTimeout(300);
  ok((await text(A.page)).includes('Synchronisé à'), 'A : synchronisé');
  await shot(A.page, '04-budget-A');

  // --- Téléphone B : rejoint avec le lien (mode sombre) ---
  const B = await phone(browser, 'dark');
  await B.page.goto(link);
  ok((await B.page.locator('#s-inv').inputValue()).includes('rejoindre='), 'B : lien prérempli');
  await B.page.getByRole('button', { name: 'Continuer' }).click();
  await B.page.getByText('Qui es-tu').first().waitFor();
  await shot(B.page, '05-qui-es-tu');
  await B.page.getByRole('button', { name: "C'est parti" }).click();
  t = await text(B.page);
  ok(t.includes('Jess'), 'B : voit le prénom de sa sœur');
  await B.page.getByRole('button', { name: 'Jess' }).click();
  t = await text(B.page);
  ok(t.includes('Carrefour') && t.includes('lecture seule'), 'B : voit les dépenses de Jess en lecture seule');
  ok((await B.page.locator('.fab').count()) === 0, 'B : pas de bouton Dépense sur le budget de Jess');
  await B.page.getByRole('button', { name: 'Toi' }).click();
  await B.page.getByRole('button', { name: 'Dépense' }).click();
  await B.page.fill('#f-amount', '42');
  await B.page.fill('#f-label', 'Cinéma');
  await B.page.getByRole('button', { name: /Loisirs/ }).click();
  await B.page.getByRole('button', { name: 'Ajouter la dépense' }).click();
  await B.page.waitForTimeout(2200); // synchro automatique après une modification
  await shot(B.page, '06-budget-B-sombre');

  // A récupère la dépense de B
  await A.page.getByRole('button', { name: 'Mettre à jour' }).click();
  await A.page.waitForTimeout(300);
  await A.page.getByRole('button', { name: 'Léa' }).click();
  ok((await text(A.page)).includes('Cinéma'), 'A : voit la dépense de Léa après synchro');

  // Calculatrice
  await A.page.getByRole('button', { name: 'Calculatrice' }).click();
  for (const k of ['1', '2', 'Virgule', '4', 'Plus', '8', 'Virgule', '9']) await A.page.getByRole('button', { name: k, exact: true }).click();
  ok((await text(A.page)).includes('21,3'), 'A : calculatrice 12,4+8,9');
  await shot(A.page, '07-calculatrice');

  // Mode sombre forcé puis automatique
  await A.page.getByRole('button', { name: 'Budget' }).click();
  await A.page.getByRole('button', { name: 'Paramètres' }).click();
  await A.page.getByRole('button', { name: 'Sombre' }).click();
  ok((await A.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--is-dark').trim())) === '1', 'A : mode sombre forcé');
  await shot(A.page, '08-parametres-sombre');
  await A.page.getByRole('button', { name: 'Automatique' }).click();
  ok((await A.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--is-dark').trim())) === '0', 'A : retour au mode du téléphone');

  // Hors ligne : le changement attend puis part
  A.net.down = true;
  await A.page.getByRole('button', { name: 'Retour' }).click();
  await A.page.getByRole('button', { name: 'Toi' }).click();
  await A.page.getByRole('button', { name: 'Dépense' }).click();
  await A.page.fill('#f-amount', '3');
  await A.page.getByRole('button', { name: 'Ajouter la dépense' }).click();
  await A.page.waitForTimeout(2200);
  ok((await text(A.page)).includes('1 changement en attente'), 'A : hors ligne, changement en attente');
  A.net.down = false;
  await A.page.getByRole('button', { name: 'Mettre à jour' }).click();
  await A.page.waitForTimeout(400);
  ok((await text(A.page)).includes('Synchronisé à'), 'A : de retour en ligne, synchronisé');

  // Rechargement : les données restent
  await B.page.reload();
  await B.page.waitForTimeout(500);
  ok((await text(B.page)).includes('Cinéma'), 'B : données gardées après rechargement');

  // --- Étape 2 : le commun, le solde et les abonnements ---
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const today = isoOf(now);
  const soon = isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3));
  const soonSameMonth = soon.slice(0, 7) === today.slice(0, 7);
  const sync = async (P) => { await P.page.getByRole('button', { name: 'Mettre à jour' }).click(); await P.page.waitForTimeout(400); };

  await A.page.getByRole('button', { name: 'Commun' }).click();
  ok((await text(A.page)).toLowerCase().includes('vous êtes quittes'), 'A : commun vide, vous êtes quittes');
  await A.page.getByRole('button', { name: 'Dépense commune' }).click();
  await A.page.fill('#f-amount', '40');
  await A.page.fill('#f-label', 'Courses du week-end');
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('payé par') && (await A.page.locator('#part-me').inputValue()) === '20,00' && (await A.page.locator('#part-her').inputValue()) === '20,00', 'A : part de 50 % affichée (20,00 chacune)');
  await A.page.getByRole('button', { name: 'Ajouter la dépense' }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('léa te doit') && t.includes('20,00'), 'A : Léa te doit 20,00');
  await A.page.getByRole('button', { name: 'Dépense commune' }).click();
  await A.page.fill('#f-amount', '30');
  await A.page.fill('#f-label', 'Cadeau maman');
  await A.page.getByRole('button', { name: 'Léa', exact: true }).click();
  await A.page.locator('#f-part').fill('70');
  ok((await A.page.locator('#part-me').inputValue()) === '21,00', 'A : part réglée à 70 % (21,00)');
  await A.page.getByRole('button', { name: 'Ajouter la dépense' }).click();
  // Léa doit 20 ; Jess doit 21 sur le cadeau payé par Léa : Jess doit 1,00.
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('tu dois à léa') && t.includes('1,00'), 'A : tu dois 1,00 à Léa');

  // Part tapée à la main : 40 € sur 63 €, Léa paie le reste.
  await A.page.getByRole('button', { name: 'Dépense commune' }).click();
  await A.page.fill('#f-amount', '63');
  await A.page.locator('#part-me').fill('40');
  t = (await text(A.page)).toLowerCase();
  ok((await A.page.locator('#part-her').inputValue()) === '23,00' && t.includes('≈ 63'), 'A : part tapée à la main (40 € → Léa 23 €, ≈ 63 %)');
  await A.page.locator('#part-her').fill('30');
  await A.page.locator('#f-label').click();
  ok((await A.page.locator('#part-me').inputValue()) === '33,00', 'A : part de Léa tapée → la tienne suit (33 €)');
  await shot(A.page, '09b-part-a-la-main');
  await A.page.getByRole('button', { name: 'Retour' }).click();

  // Abonnement commun prélevé aujourd'hui, payé par Léa : la dépense s'ajoute toute seule.
  await A.page.getByRole('button', { name: 'Abonnements', exact: true }).click();
  await A.page.getByRole('button', { name: 'Abonnement', exact: true }).click();
  await A.page.fill('#a-name', 'Netflix');
  await A.page.fill('#a-amount', '13,49');
  ok((await text(A.page)).toLowerCase().includes('161,88'), 'A : Netflix soit 161,88 €/an');
  await A.page.fill('#a-next', today);
  await A.page.getByRole('button', { name: 'Commun', exact: true }).first().click();
  await A.page.getByRole('button', { name: 'Léa', exact: true }).click();
  await shot(A.page, '09-abonnement-commun');
  await A.page.getByRole('button', { name: "Ajouter l'abonnement" }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('netflix') && t.includes('6,75'), 'A : Netflix dans la liste, ta part 6,75');
  // Abonnement perso dans 3 jours, avec un préavis.
  await A.page.getByRole('button', { name: 'Abonnement', exact: true }).click();
  await A.page.fill('#a-name', 'Spotify');
  await A.page.fill('#a-amount', '12');
  await A.page.fill('#a-next', soon);
  await A.page.fill('#a-pre', '1');
  ok((await text(A.page)).toLowerCase().includes('moins 1 jour de préavis'), 'A : date limite = échéance moins le préavis');
  await A.page.getByRole('button', { name: "Ajouter l'abonnement" }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('spotify') && t.includes('résilier avant le'), 'A : Spotify avec sa date limite');
  ok(t.includes('25,49') || t.includes('18,75'), 'A : coût par mois (12 + 6,75 = 18,75, ou 25,49 hors mois)');
  await shot(A.page, '10-abonnements');

  await A.page.getByRole('button', { name: 'Commun', exact: true }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('ajoutée toute seule') && t.includes('netflix'), 'A : dépense Netflix ajoutée toute seule');
  // 1,00 + 6,75 (part de Jess sur Netflix payé par Léa) = 7,75
  ok(t.includes('tu dois à léa') && t.includes('7,75'), 'A : tu dois 7,75 à Léa');
  await shot(A.page, '11-commun-A');
  await A.page.getByRole('button', { name: 'Budget', exact: true }).click();
  t = (await text(A.page)).toLowerCase();
  if (soonSameMonth) ok(t.includes("d'abonnements ce mois-ci, hors plafond"), 'A : abonnements montrés à part, hors plafond');
  await shot(A.page, '13-budget-prevus');
  await sync(A);

  // Léa récupère tout, rembourse, et ne voit qu'une seule dépense Netflix.
  await sync(B);
  await B.page.getByRole('button', { name: 'Commun', exact: true }).click();
  t = (await text(B.page)).toLowerCase();
  ok(t.includes('jess te doit') && t.includes('7,75'), 'B : Jess te doit 7,75');
  await shot(B.page, '12-commun-B-sombre');
  await B.page.getByRole('button', { name: 'On est quittes' }).click();
  ok(((await text(B.page)).toLowerCase()).includes("jess t'a remboursé 7,75"), 'B : confirmation du remboursement');
  await B.page.getByRole('button', { name: 'Oui, on est quittes' }).click();
  t = (await text(B.page)).toLowerCase();
  ok(t.includes('vous êtes quittes') && t.includes('remboursement'), 'B : quittes, remboursement noté');
  await B.page.waitForTimeout(2200);
  await sync(B);
  await sync(A);
  await A.page.getByRole('button', { name: 'Commun', exact: true }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('vous êtes quittes'), 'A : quittes après la synchro');
  const netflixRows = await A.page.locator('.li-title', { hasText: /^Netflix$/ }).count();
  ok(netflixRows === 1, `une seule dépense Netflix malgré les deux téléphones (${netflixRows})`);

  await B.page.getByRole('button', { name: 'Abonnements', exact: true }).click();
  ok(((await text(B.page)).toLowerCase()).includes('6,74'), 'B : ses abonnements, sa part de Netflix 6,74');
  await B.page.getByRole('button', { name: 'Jess', exact: true }).click();
  await B.page.getByRole('button', { name: /Spotify/ }).click();
  t = (await text(B.page)).toLowerCase();
  ok(t.includes('lecture seule') && !t.includes("j'ai résilié"), 'B : abonnement de Jess en lecture seule');
  await B.page.getByRole('button', { name: 'Retour' }).click();

  // Jess résilie Spotify.
  await A.page.getByRole('button', { name: 'Abonnements', exact: true }).click();
  await A.page.getByRole('button', { name: /Spotify/ }).click();
  await A.page.getByRole('button', { name: "J'ai résilié" }).click();
  await A.page.getByRole('button', { name: "Oui, j'ai résilié" }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('résiliés') && t.includes('plus de dépense'), 'A : Spotify rangé dans les résiliés');

  // --- Prévisions : achat et abonnement envisagés ---
  const reste = async () => (await A.page.locator('.note .big-hand').innerText()).trim();
  await A.page.getByRole('button', { name: 'Budget', exact: true }).click();
  const resteAvant = await reste();
  await A.page.getByRole('button', { name: 'Dépense', exact: true }).click();
  await A.page.fill('#f-amount', '60');
  await A.page.fill('#f-label', 'Baskets');
  await A.page.getByRole('switch', { name: /Pas encore acheté/ }).click();
  await A.page.getByRole('button', { name: /Shopping/ }).click();
  ok((await text(A.page)).includes('Prévu pour'), 'A : la date devient « Prévu pour »');
  await A.page.getByRole('button', { name: 'Garder en envisagé' }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('ce que tu envisages') && t.includes('baskets') && t.includes('avec ce que tu envisages'), 'A : Baskets dans « Ce que tu envisages »');
  ok((await reste()) === resteAvant, `A : le vrai reste du mois ne bouge pas (${resteAvant})`);
  ok(t.includes('total des achats') && t.includes('reste passerait de'), 'A : total des envisagés et impact sur le plafond');
  await shot(A.page, '14-envisage-budget');

  await A.page.getByRole('button', { name: 'Abonnements', exact: true }).click();
  await A.page.getByRole('button', { name: 'Et si je prenais un abonnement ?' }).click();
  await A.page.fill('#s-name', 'Deezer');
  await A.page.fill('#s-amount', '11');
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('si tu le prends') && t.includes('−11,00') && t.includes('/ 50 €') === false, 'A : impact affiché (−11,00 ce mois-ci)');
  await shot(A.page, '15-et-si');
  // Avec un essai gratuit : rien ce mois-ci, le coût vient après l'essai.
  await A.page.getByRole('switch', { name: /Essai gratuit/ }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes("fin de l'essai") && t.includes("prix après l'essai") && t.includes('gratuit jusqu'), 'A : essai gratuit dans « Et si je le prenais ? »');
  await shot(A.page, '15b-et-si-essai');
  await A.page.getByRole('switch', { name: /Essai gratuit/ }).click();
  await A.page.fill('#s-start', today);
  ok((await text(A.page)).toLowerCase().includes('−11,00'), 'A : sans essai, de nouveau −11,00 ce mois-ci');
  await A.page.getByRole('button', { name: 'Garder en envisagé' }).click();
  t = (await text(A.page)).toLowerCase();
  ok(t.includes('envisagés') && t.includes('deezer') && t.includes('avec ce que tu envisages'), 'A : Deezer dans les envisagés');
  ok(!t.includes('résilier avant le') || !(await A.page.locator('.sub-card', { hasText: 'Deezer' }).count()), 'A : Deezer pas dans les vrais abonnements');
  await sync(A);

  await sync(B);
  await B.page.getByRole('button', { name: 'Jess', exact: true }).click();
  t = (await text(B.page)).toLowerCase();
  ok(t.includes('deezer') && (await B.page.getByRole('button', { name: 'Je le prends' }).count()) === 0, 'B : voit Deezer envisagé par Jess, sans pouvoir le prendre');

  await A.page.getByRole('button', { name: 'Budget', exact: true }).click();
  await A.page.locator('.env-item', { hasText: 'Deezer' }).getByRole('button', { name: 'Je le prends' }).click();
  await A.page.locator('.env-item', { hasText: 'Baskets' }).getByRole('button', { name: "Je l'achète" }).click();
  t = (await text(A.page)).toLowerCase();
  ok(!t.includes('ce que tu envisages'), 'A : plus rien d\'envisagé');
  ok((await A.page.locator('.li', { hasText: 'Deezer' }).filter({ hasText: 'ajoutée toute seule' }).count()) === 1, 'A : Deezer pris, sa dépense du jour ajoutée toute seule');
  ok((await A.page.locator('.li', { hasText: 'Baskets' }).count()) === 1, 'A : Baskets achetées, dans les dernières dépenses');
  ok((await reste()) !== resteAvant, 'A : le reste du mois tient compte des achats faits');

  // --- Nouvelle adresse de l'appli : Jess relie un téléphone vierge avec le code secret du script ---
  const C = await phone(browser);
  await C.page.goto(BASE);
  await C.page.getByText("C'est moi qui ai installé le script Google").click();
  await C.page.fill('#s-url', SCRIPT_URL);
  await C.page.getByRole('button', { name: 'Relier mon téléphone' }).click();
  await C.page.getByText('Ce script est déjà configuré').waitFor({ timeout: 5000 }).catch(() => {});
  t = (await text(C.page)).toLowerCase();
  ok(t.includes('ce script est déjà configuré') && t.includes('code secret'), 'C : script déjà configuré, on demande le code secret');
  await C.page.fill('#s-code', 'mauvais-code-mauvais-code-123');
  await C.page.getByRole('button', { name: 'Relier avec ce code' }).click();
  await C.page.getByText(/ne correspond plus/).waitFor({ timeout: 5000 }).catch(() => {});
  ok((await text(C.page)).includes('ne correspond plus'), 'C : mauvais code refusé');
  const secret = await A.page.evaluate(() => JSON.parse(localStorage.getItem('pasdtal-config')).code);
  await C.page.fill('#s-code', secret);
  await C.page.getByRole('button', { name: 'Relier avec ce code' }).click();
  await C.page.getByRole('button', { name: 'Paramètres' }).waitFor();
  t = (await text(C.page)).toLowerCase();
  ok(t.includes('toi') && t.includes('léa') && t.includes('baskets'), 'C : relié comme Jess, retrouve ses dépenses');
  await shot(C.page, '16-relier-avec-code');

  const width = await A.page.evaluate(() => document.documentElement.scrollWidth);
  ok(width <= 390, `pas de défilement horizontal (${width})`);
  ok(A.errors.length === 0 && B.errors.length === 0 && C.errors.length === 0, 'aucune erreur JavaScript ' + JSON.stringify([...A.errors, ...B.errors, ...C.errors].slice(0, 3)));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
process.exit(failures ? 1 : 0);
