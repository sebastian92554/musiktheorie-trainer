/**
 * ACCOUNT-BACKEND — Phase 1 (Server-Account für Fortschritt)
 * ===========================================================
 *
 * EIGENES, SEPARATES Apps-Script-Projekt (NICHT das Tracking-Projekt).
 * So bleibt die Tracking-Pipeline zu 100 % unangetastet.
 *
 * DEPLOY:
 *  1. script.google.com → Neues Projekt → diesen Code in Code.gs einfügen.
 *  2. Bereitstellen → Neue Bereitstellung → Web-App
 *       Ausführen als: Ich · Zugriff: Jede:r (auch anonym)
 *  3. Web-App-URL (…/exec) notieren → kommt später in account.js.
 *
 * SHEET: schreibt in Tab "Accounts" im bestehenden Tracking-Sheet
 *  (SHEET_ID unten). Tab wird automatisch angelegt, falls nicht vorhanden.
 *  Wer Account- und Tracking-Daten strikt trennen will: SHEET_ID auf ein
 *  neues, eigenes Sheet umstellen.
 *
 * CORS-REGELN (aus Phase 0 bestätigt):
 *  - Client postet IMMER mit Content-Type text/plain → kein OPTIONS-Preflight.
 *  - Body wird hier via JSON.parse(e.postData.contents) gelesen.
 *  - ContentService-JSON liefert Access-Control-Allow-Origin: * → cross-origin lesbar.
 *
 * SICHERHEIT:
 *  - Passwörter & Recovery-Codes NUR als SHA-256(salt + ":" + wert) gespeichert.
 *  - Salt pro Nutzer (Utilities.getUuid()).
 *  - LockService NUR für Schreib-Aktionen (register/save/reset_password/delete).
 *    login/load sind lock-freie Lesezugriffe → kein Stau beim Klassen-Login.
 */

var SHEET_ID = '1W7lLRY7qiu-7QWiJFTba-Ax-MiaGMVshnkWrgB2UaQM'; // bestehendes Tracking-Sheet
var TAB = 'Accounts';
var LOCK_MS = 15000;       // max. Wartezeit auf den Schreib-Lock
var MAX_DATA_CHARS = 100000; // Schutz gegen aufgeblähte Payloads

// Spalten: 1=username 2=salt 3=pw_hash 4=recovery_hash 5=data 6=created_at 7=updated_at
var COL = { user: 1, salt: 2, pw: 3, rec: 4, data: 5, created: 6, updated: 7 };

// ---------- HTTP-Einstiegspunkte ----------

function doGet() {
  return _json({ ok: true, service: 'account-backend', ts: new Date().toISOString() });
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.action) {
      case 'register':        out = handleRegister(body); break;
      case 'login':           out = handleLogin(body);    break;
      case 'save':            out = handleSave(body);     break;
      case 'load':            out = handleLoad(body);     break;
      case 'reset_password':  out = handleReset(body);    break;
      case 'delete':          out = handleDelete(body);   break;
      default:                out = { ok: false, error: 'unknown_action' };
    }
  } catch (err) {
    out = { ok: false, error: 'server_error', detail: String(err) };
  }
  return _json(out);
}

// ---------- Aktionen ----------

function handleRegister(body) {
  var username = String(body.username || '').trim();
  var password = String(body.password || '');
  var data = _normData(body.data);
  if (username.length < 3 || username.length > 30) return { ok: false, error: 'bad_username' };
  if (password.length < 4)  return { ok: false, error: 'bad_password' };
  if (data === null)        return { ok: false, error: 'bad_data' };

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var sh = _sheet();
    if (_findRow(sh, username) !== -1) return { ok: false, error: 'username_taken' };
    var salt = Utilities.getUuid();
    var recovery = _recoveryCode();
    var now = new Date().toISOString();
    sh.appendRow([
      username,
      salt,
      _sha256(salt + ':' + password),
      _sha256(salt + ':' + recovery),
      data,
      now,
      now
    ]);
    return { ok: true, recovery_code: recovery };
  } finally {
    lock.releaseLock();
  }
}

function handleLogin(body) {
  var rec = _verify(body.username, body.password); // lock-frei (Lesezugriff)
  if (!rec.ok) return rec;
  return { ok: true, data: rec.row[COL.data - 1] };
}

function handleLoad(body) {
  return handleLogin(body); // identischer Lesezugriff
}

function handleSave(body) {
  var data = _normData(body.data);
  if (data === null) return { ok: false, error: 'bad_data' };

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var sh = _sheet();
    var rowNum = _findRow(sh, body.username);
    if (rowNum === -1) return { ok: false, error: 'invalid_credentials' };
    var row = sh.getRange(rowNum, 1, 1, 7).getValues()[0];
    if (_sha256(row[COL.salt - 1] + ':' + String(body.password || '')) !== row[COL.pw - 1]) {
      return { ok: false, error: 'invalid_credentials' };
    }
    sh.getRange(rowNum, COL.data).setValue(data);
    sh.getRange(rowNum, COL.updated).setValue(new Date().toISOString());
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function handleReset(body) {
  var username = String(body.username || '').trim();
  var recovery = String(body.recovery_code || '').trim().toUpperCase();
  var newPw = String(body.new_password || '');
  if (newPw.length < 4) return { ok: false, error: 'bad_password' };

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var sh = _sheet();
    var rowNum = _findRow(sh, username);
    if (rowNum === -1) return { ok: false, error: 'invalid_recovery' };
    var row = sh.getRange(rowNum, 1, 1, 7).getValues()[0];
    var salt = row[COL.salt - 1];
    if (_sha256(salt + ':' + recovery) !== row[COL.rec - 1]) {
      return { ok: false, error: 'invalid_recovery' };
    }
    var newRecovery = _recoveryCode();
    sh.getRange(rowNum, COL.pw).setValue(_sha256(salt + ':' + newPw));
    sh.getRange(rowNum, COL.rec).setValue(_sha256(salt + ':' + newRecovery));
    sh.getRange(rowNum, COL.updated).setValue(new Date().toISOString());
    return { ok: true, recovery_code: newRecovery };
  } finally {
    lock.releaseLock();
  }
}

function handleDelete(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var sh = _sheet();
    var rowNum = _findRow(sh, body.username);
    if (rowNum === -1) return { ok: false, error: 'invalid_credentials' };
    var row = sh.getRange(rowNum, 1, 1, 7).getValues()[0];
    if (_sha256(row[COL.salt - 1] + ':' + String(body.password || '')) !== row[COL.pw - 1]) {
      return { ok: false, error: 'invalid_credentials' };
    }
    sh.deleteRow(rowNum);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Helfer ----------

// Lock-freie Credential-Prüfung für Lesezugriffe (login/load).
function _verify(username, password) {
  var sh = _sheet();
  var rowNum = _findRow(sh, username);
  if (rowNum === -1) return { ok: false, error: 'invalid_credentials' };
  var row = sh.getRange(rowNum, 1, 1, 7).getValues()[0];
  if (_sha256(row[COL.salt - 1] + ':' + String(password || '')) !== row[COL.pw - 1]) {
    return { ok: false, error: 'invalid_credentials' };
  }
  return { ok: true, row: row, rowNum: rowNum };
}

function _sheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.appendRow(['username', 'salt', 'pw_hash', 'recovery_hash', 'data', 'created_at', 'updated_at']);
  }
  return sh;
}

// Gibt Zeilennummer (>=2) zurück oder -1. Username-Vergleich case-insensitiv.
function _findRow(sh, username) {
  var key = String(username || '').trim().toLowerCase();
  if (!key) return -1;
  var n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  var col = sh.getRange(2, COL.user, n, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toLowerCase() === key) return i + 2;
  }
  return -1;
}

// data muss ein JSON-String (oder Objekt) sein; gibt String zurück oder null bei ungültig/zu groß.
function _normData(data) {
  var str;
  if (typeof data === 'string') str = data;
  else if (data && typeof data === 'object') str = JSON.stringify(data);
  else str = '{}';
  if (str.length > MAX_DATA_CHARS) return null;
  return str;
}

function _sha256(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    var h = b.toString(16);
    hex += (h.length < 2 ? '0' : '') + h;
  }
  return hex;
}

// Menschlich abschreibbarer Code: 3×4 Zeichen, ohne O/0/I/1. z.B. K7MQ-3XPZ-RT9N
function _recoveryCode() {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var groups = [];
  for (var g = 0; g < 3; g++) {
    var s = '';
    for (var i = 0; i < 4; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
    groups.push(s);
  }
  return groups.join('-');
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
