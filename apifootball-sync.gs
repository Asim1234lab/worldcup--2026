/*************************************************************
 *  API-FOOTBALL AUTO-SYNC  ·  FIFA World Cup 2026 league
 *
 *  Add this to the SAME Apps Script project as wc2026-backend.gs.
 *  It reuses that file's getSheet(), readResults() and CONFIG.
 *
 *  SETUP (all from a menu inside the Sheet — no settings screens needed)
 *   1. Paste this file into the Sheet's Apps Script project, Save, then
 *      RELOAD the Google Sheet tab. A new "⚽ WC2026" menu appears.
 *   2. ⚽ WC2026 ▸ "Set API key…"  → paste your api-sports key (stored
 *      privately in Script Properties — never in the public HTML).
 *   3. ⚽ WC2026 ▸ "Verify API (peek)"  → confirms it connects; full
 *      detail also goes to the Executions log (paste it back to verify
 *      league id / round labels / team spellings).
 *   4. ⚽ WC2026 ▸ "Set up daily auto-sync"  → creates the daily trigger.
 *   5. ⚽ WC2026 ▸ "Sync results now"  → run on demand anytime (testing).
 *  (The first menu click triggers Google's one-time permission prompt — approve it.)
 *
 *  PHASE 1 (this file): writes finished GROUP matches into the `results`
 *  tab as  A-0 | GROUP | HOME/DRAW/AWAY  — which the existing scoring and
 *  the "guess the match" group mode already read.
 *
 *  PHASE 2/3 (next, after we confirm the API shape): real group standings
 *  → score "who qualifies" guesses; real knockout bracket + winners → the
 *  round-by-round knockout "guess the match".
 *************************************************************/

const AF = {
  HOST: 'https://v3.football.api-sports.io',
  LEAGUE: 1,     // World Cup — CONFIRM with peekApi()
  SEASON: 2026
};

function afKey() { return PropertiesService.getScriptProperties().getProperty('APIFOOTBALL_KEY'); }
function afGet(path) {
  const r = UrlFetchApp.fetch(AF.HOST + path, { headers: { 'x-apisports-key': afKey() }, muteHttpExceptions: true });
  return JSON.parse(r.getContentText());
}

/* Run ONCE to verify the API contract. Paste me the Execution log. */
function peekApi() {
  if (!afKey()) { Logger.log('❌ No APIFOOTBALL_KEY in Script Properties.'); return; }
  const fx = afGet(`/fixtures?league=${AF.LEAGUE}&season=${AF.SEASON}`);
  Logger.log('FIXTURES results=' + fx.results + '  errors=' + JSON.stringify(fx.errors));
  Logger.log('SAMPLE FIXTURE:\n' + JSON.stringify((fx.response || [])[0], null, 2));
  Logger.log('ROUND LABELS: ' + JSON.stringify([...new Set((fx.response || []).map(f => f.league && f.league.round))]));
  const st = afGet(`/standings?league=${AF.LEAGUE}&season=${AF.SEASON}`);
  Logger.log('SAMPLE STANDINGS (truncated):\n' + JSON.stringify(st.response, null, 2).slice(0, 2500));
}

/* App group schedule — home/away pairs in the app's A-0 … A-5 order */
const GROUP_FIX = {
  A:[['Mexico','South Africa'],['South Korea','Czechia'],['Czechia','South Africa'],['Mexico','South Korea'],['Czechia','Mexico'],['South Africa','South Korea']],
  B:[['Canada','Bosnia & H.'],['Qatar','Switzerland'],['Switzerland','Bosnia & H.'],['Canada','Qatar'],['Switzerland','Canada'],['Bosnia & H.','Qatar']],
  C:[['Brazil','Morocco'],['Haiti','Scotland'],['Scotland','Morocco'],['Brazil','Haiti'],['Scotland','Brazil'],['Morocco','Haiti']],
  D:[['USA','Paraguay'],['Australia','Türkiye'],['USA','Australia'],['Türkiye','Paraguay'],['Türkiye','USA'],['Paraguay','Australia']],
  E:[['Germany','Curaçao'],['Ivory Coast','Ecuador'],['Germany','Ivory Coast'],['Ecuador','Curaçao'],['Curaçao','Ivory Coast'],['Ecuador','Germany']],
  F:[['Netherlands','Japan'],['Sweden','Tunisia'],['Netherlands','Sweden'],['Tunisia','Japan'],['Japan','Sweden'],['Tunisia','Netherlands']],
  G:[['Belgium','Egypt'],['Iran','New Zealand'],['Belgium','Iran'],['New Zealand','Egypt'],['Egypt','Iran'],['New Zealand','Belgium']],
  H:[['Spain','Cape Verde'],['Saudi Arabia','Uruguay'],['Spain','Saudi Arabia'],['Uruguay','Cape Verde'],['Cape Verde','Saudi Arabia'],['Uruguay','Spain']],
  I:[['France','Senegal'],['Iraq','Norway'],['France','Iraq'],['Norway','Senegal'],['Norway','France'],['Senegal','Iraq']],
  J:[['Argentina','Algeria'],['Austria','Jordan'],['Argentina','Austria'],['Jordan','Algeria'],['Algeria','Austria'],['Jordan','Argentina']],
  K:[['Portugal','Congo DR'],['Uzbekistan','Colombia'],['Portugal','Uzbekistan'],['Colombia','Congo DR'],['Colombia','Portugal'],['Congo DR','Uzbekistan']],
  L:[['England','Croatia'],['Ghana','Panama'],['England','Ghana'],['Panama','Croatia'],['Panama','England'],['Croatia','Ghana']]
};

/* API team name -> app team name. Extend after peekApi() shows real names. */
const AF_ALIAS = {
  'korea republic':'South Korea','south korea':'South Korea',
  'turkey':'Türkiye','turkiye':'Türkiye',
  'dr congo':'Congo DR','congo dr':'Congo DR','democratic republic of congo':'Congo DR',
  'bosnia and herzegovina':'Bosnia & H.','bosnia':'Bosnia & H.',
  'czech republic':'Czechia','czechia':'Czechia',
  'cote divoire':'Ivory Coast','ivory coast':'Ivory Coast',
  'cabo verde':'Cape Verde','cape verde':'Cape Verde',
  'curacao':'Curaçao',
  'usa':'USA','united states':'USA','united states of america':'USA'
};
function afNorm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z ]/g,'').trim(); }
const _APP_BYNORM = (function(){ const m={}; for (const g in GROUP_FIX) GROUP_FIX[g].forEach(p=>p.forEach(n=>m[afNorm(n)]=n)); return m; })();
function toApp(apiName){ const n=afNorm(apiName); return AF_ALIAS[n] || _APP_BYNORM[n] || apiName; }

function findGroupSlot(t1,t2){
  for (const g in GROUP_FIX){ const arr=GROUP_FIX[g];
    for (let i=0;i<arr.length;i++){ const h=arr[i][0], a=arr[i][1];
      if ((h===t1&&a===t2)||(h===t2&&a===t1)) return { slot:g+'-'+i, home:h, away:a };
    }
  }
  return null;
}

/* DAILY job: finished group matches -> results tab (A-x | GROUP | HOME/DRAW/AWAY) */
function syncGroupResults(){
  const fx = (afGet(`/fixtures?league=${AF.LEAGUE}&season=${AF.SEASON}`).response) || [];
  const sh = getSheet(CONFIG.SHEETS.RESULTS);
  const have = readResults();
  let wrote = 0;
  fx.forEach(f=>{
    const st = f.fixture && f.fixture.status && f.fixture.status.short;
    if (['FT','AET','PEN'].indexOf(st) < 0) return;        // finished only
    if (!/group/i.test((f.league && f.league.round) || '')) return; // group stage only
    const home = toApp(f.teams.home.name), away = toApp(f.teams.away.name);
    const m = findGroupSlot(home, away);
    if (!m) { Logger.log('⚠️ no slot for ' + f.teams.home.name + ' vs ' + f.teams.away.name); return; }
    if (have[m.slot]) return;                               // already recorded
    const gh = f.goals.home, ga = f.goals.away;
    let outcome;
    if (gh === ga) outcome = 'DRAW';
    else outcome = ((gh > ga ? home : away) === m.home) ? 'HOME' : 'AWAY';
    sh.appendRow([m.slot, 'GROUP', outcome]);
    have[m.slot] = true; wrote++;
  });
  Logger.log('syncGroupResults wrote ' + wrote + ' row(s)');
  return wrote;
}

/* ============ IN-SHEET MENU (so setup is just clicks) ============ */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚽ WC2026')
    .addItem('Set API key…', 'menuSetKey')
    .addItem('Verify API (peek)', 'menuVerify')
    .addItem('Sync results now', 'menuSyncNow')
    .addSeparator()
    .addItem('Set up daily auto-sync', 'menuSetupDaily')
    .addToUi();
}
function menuSetKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('API-Football key', 'Paste your api-sports key:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const k = (res.getResponseText() || '').trim();
  if (!k) { ui.alert('No key entered.'); return; }
  PropertiesService.getScriptProperties().setProperty('APIFOOTBALL_KEY', k);
  ui.alert('✅ Key saved privately. Now run "Verify API (peek)".');
}
function menuVerify() {
  const ui = SpreadsheetApp.getUi();
  if (!afKey()) { ui.alert('Set the API key first (⚽ WC2026 ▸ Set API key…).'); return; }
  const fx = afGet(`/fixtures?league=${AF.LEAGUE}&season=${AF.SEASON}`);
  peekApi(); // full detail to the Executions log
  const rounds = [...new Set((fx.response || []).map(f => f.league && f.league.round))];
  const f0 = (fx.response || [])[0];
  ui.alert('API check',
    'league=' + AF.LEAGUE + ' season=' + AF.SEASON +
    '\nfixtures returned: ' + fx.results +
    '\nerrors: ' + JSON.stringify(fx.errors) +
    '\n\nround labels:\n' + JSON.stringify(rounds).slice(0, 500) +
    (f0 ? '\n\nsample: ' + f0.teams.home.name + ' vs ' + f0.teams.away.name + '  (' + (f0.league && f0.league.round) + ')' : '') +
    '\n\nFull detail is in Apps Script ▸ Executions — copy it to your developer.',
    ui.ButtonSet.OK);
}
function menuSyncNow() {
  const ui = SpreadsheetApp.getUi();
  if (!afKey()) { ui.alert('Set the API key first.'); return; }
  const n = syncGroupResults();
  ui.alert('Sync complete', 'Wrote ' + n + ' new group result row(s) to the results tab.', ui.ButtonSet.OK);
}
function menuSetupDaily() {
  const ui = SpreadsheetApp.getUi();
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'syncGroupResults') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncGroupResults').timeBased().everyDays(1).atHour(4).create();
  ui.alert('✅ Daily auto-sync enabled', 'syncGroupResults runs automatically every day (~4 AM).', ui.ButtonSet.OK);
}
