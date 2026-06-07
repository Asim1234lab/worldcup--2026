/*************************************************************
 *  FIFA WORLD CUP 2026 — BRACKET LEAGUE  ·  Google Apps Script
 *  Backend (database + API) on a Google Sheet.
 *
 *  Stores each player's full prediction state, scores it against
 *  real results, and serves login / save / leaderboard to the HTML.
 *
 *  SCORING
 *   - Group match correct  = 2 pts
 *   - Knockout: R32=1, R16=2, QF=4, SF=6, 3rd=4, Final=10
 *
 *  SETUP IS AT THE BOTTOM (read SETUP_STEPS).
 *************************************************************/

const CONFIG = {
  SHEETS: { USERS: 'users', RESULTS: 'results' },
  ROUND_POINTS: { GROUP: 2, R32: 1, R16: 2, QF: 4, SF: 6, THIRD: 4, FINAL: 10 },
  TIMEZONE: 'Asia/Riyadh'
};

/* ============ ROUTING ============ */
function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();
  try {
    if (action === 'login')       return jsonOut(handleLogin(e.parameter.phone));
    if (action === 'leaderboard') return jsonOut(handleLeaderboard());
    if (action === 'results')     return jsonOut({ ok: true, results: readResults() });
    if (action === 'ping')        return jsonOut({ ok: true });
    return jsonOut({ ok: false, error: 'Unknown action' });
  } catch (err) { return jsonOut({ ok: false, error: String(err) }); }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  const action = (body.action || '').toLowerCase();
  try {
    if (action === 'savestate') return jsonOut(handleSaveState(body));
    return jsonOut({ ok: false, error: 'Unknown action' });
  } catch (err) { return jsonOut({ ok: false, error: String(err) }); }
}

/* ============ HANDLERS ============ */

function handleLogin(phone) {
  phone = normPhone(phone);
  if (!phone) return { ok: false, error: 'No phone' };
  const row = findUserRow(phone);
  if (!row) return { ok: true, newUser: true };
  const sh = getSheet(CONFIG.SHEETS.USERS);
  const r = sh.getRange(row, 1, 1, 5).getValues()[0];
  let data = {};
  try { data = JSON.parse(r[4] || '{}'); } catch (e) {}
  return {
    ok: true, newUser: false,
    name: r[1],
    submitted: r[2] === true || r[2] === 'TRUE',
    data: data
  };
}

// Save the player's full state. Bracket locks after first submit;
// only group picks may change afterwards.
function handleSaveState(body) {
  const phone = normPhone(body.phone);
  if (!phone) return { ok: false, error: 'No phone' };
  const name = (body.name || '').trim();
  const incoming = body.data || {};
  const sh = getSheet(CONFIG.SHEETS.USERS);
  const row = findUserRow(phone);

  if (!row) {
    const sub = incoming.submitted === true;
    sh.appendRow([phone, name || 'Player', sub, sub ? new Date() : '', JSON.stringify(incoming)]);
    // store phone as plain text so leading zeros aren't lost (Sheets would coerce "0501..." to a number)
    sh.getRange(sh.getLastRow(), 1).setNumberFormat('@').setValue(phone);
    return { ok: true, created: true };
  }

  const cur = sh.getRange(row, 1, 1, 5).getValues()[0];
  const wasSubmitted = cur[2] === true || cur[2] === 'TRUE';
  let stored = {};
  try { stored = JSON.parse(cur[4] || '{}'); } catch (e) {}

  let merged;
  if (wasSubmitted) {
    // bracket is locked -- keep it, only refresh group picks
    merged = stored;
    merged.groupPicks = incoming.groupPicks || stored.groupPicks || {};
    merged.submitted = true;
  } else {
    merged = incoming;
  }
  const nowSub = merged.submitted === true;
  sh.getRange(row, 3, 1, 3).setValues([[
    nowSub,
    (nowSub && !wasSubmitted) ? new Date() : cur[3],
    JSON.stringify(merged)
  ]]);
  if (name && !cur[1]) sh.getRange(row, 2).setValue(name);
  return { ok: true, updated: true, locked: wasSubmitted };
}

function handleLeaderboard() {
  const sh = getSheet(CONFIG.SHEETS.USERS);
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, leaderboard: [] };
  const results = readResults();
  const rows = sh.getRange(2, 1, last - 1, 5).getValues();
  const board = rows.filter(r => r[0] !== '').map(r => {
    let data = {};
    try { data = JSON.parse(r[4] || '{}'); } catch (e) {}
    return {
      name: r[1],
      phone: maskPhone(r[0]),
      submitted: r[2] === true || r[2] === 'TRUE',
      points: scoreState(data, results)
    };
  });
  board.sort((a, b) => b.points - a.points);
  board.forEach((x, i) => x.rank = i + 1);
  return { ok: true, leaderboard: board };
}

/* ============ SCORING ============ */
function roundOf(m) {
  m = Number(m);
  if (m >= 73 && m <= 88) return 'R32';
  if (m <= 96) return 'R16';
  if (m <= 100) return 'QF';
  if (m <= 102) return 'SF';
  if (m === 103) return 'THIRD';
  if (m === 104) return 'FINAL';
  return null;
}
function scoreState(data, results) {
  if (!data) return 0;
  let pts = 0;
  const w = data.winners || {};
  for (const m in w) {
    const r = results[String(m)];
    if (!r || !r.actual_winner) continue;
    const rd = roundOf(m);
    const pred = w[m] && w[m].name;
    if (rd && pred && normName(pred) === normName(r.actual_winner)) pts += CONFIG.ROUND_POINTS[rd] || 0;
  }
  const gp = data.groupPicks || {};
  for (const id in gp) {
    const r = results[id];
    if (!r || !r.actual_winner) continue;
    if (String(gp[id]).toUpperCase() === String(r.actual_winner).toUpperCase()) pts += CONFIG.ROUND_POINTS.GROUP;
  }
  return pts;
}

/* ============ SHEET HELPERS ============ */
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function findUserRow(phone) {
  const sh = getSheet(CONFIG.SHEETS.USERS);
  const last = sh.getLastRow();
  if (last < 2) return null;
  const col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) if (normPhone(col[i][0]) === normPhone(phone)) return i + 2;
  return null;
}
function readResults() {
  const sh = getSheet(CONFIG.SHEETS.RESULTS);
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(r => {
    if (r[0] !== '') out[String(r[0])] = { round: r[1], actual_winner: r[2] };
  });
  return out;
}

/* ============ UTILS ============ */
function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function normPhone(p) { return String(p || '').replace(/[^\d+]/g, ''); }
function normName(n) { return String(n || '').trim().toLowerCase(); }
function maskPhone(p) { p = String(p); return p.length > 4 ? '\u2022\u2022\u2022\u2022' + p.slice(-3) : p; }

// Run ONCE to create the two tabs with headers.
function initSheet() {
  const u = getSheet(CONFIG.SHEETS.USERS);
  if (u.getLastRow() === 0) u.appendRow(['phone', 'name', 'submitted', 'submitted_at', 'data_json']);
  u.getRange(1, 1, u.getMaxRows(), 1).setNumberFormat('@'); // phone column = plain text (preserve leading zeros / + signs)
  const r = getSheet(CONFIG.SHEETS.RESULTS);
  if (r.getLastRow() === 0) r.appendRow(['match', 'round', 'actual_winner']);
}

/*************************************************************
 * SETUP_STEPS
 *
 * 1. sheet.new  -> name it (e.g. "WC2026 League").
 * 2. Extensions > Apps Script. Delete default code, paste THIS file.
 * 3. Run  initSheet  once (approve the permission prompt).
 *    Creates 2 tabs: users / results.
 * 4. Deploy > New deployment > Web app
 *      Execute as: Me   ·   Who has access: Anyone
 *    Deploy > copy the URL ending in /exec.
 * 5. Paste that URL into the HTML:  const API = { URL: 'https://.../exec' };
 *
 * ENTER RESULTS (in the `results` tab) as matches finish:
 *   Group match:  matchId      | GROUP  | HOME or DRAW or AWAY
 *        example:  A-0          | GROUP  | HOME
 *        (A-0 = Group A's 1st listed match; A-1 = 2nd; ... A-5 = 6th)
 *   Knockout:      matchNumber  | ROUND  | winningTeamName
 *        example:  104          | FINAL  | Brazil
 *   ROUND codes: GROUP, R32, R16, QF, SF, THIRD, FINAL
 *
 * Points recalculate automatically whenever the leaderboard loads.
 *************************************************************/
