/**
 * Musiktrainer Tracking - Google Apps Script
 * Version 3.0 - Append-only Event-Log (Tab "Events"), additiv & abwärtskompatibel
 *
 * MIGRATIONSPRINZIP (wichtig):
 *  - NEUE Events (page_view, quiz_start, quiz_complete, heartbeat,
 *    node_select, card_view) → Tab "Events"
 *    (append-only, 9 feste Spalten, alles Trainer-Spezifische in payload-JSON).
 *  - ALLE alten Events (session_start/_end/_heartbeat, landing_click, quiz_result,
 *    legacy) laufen WEITER GENAU WIE BISHER ins aktive Sheet ("Raw Data").
 *    → Dein bestehendes Dashboard/Analyse bleibt ununterbrochen funktionsfähig.
 *  - Erst wenn die neuen Events-basierten Dashboards stehen, wird der Alt-Pfad
 *    in einem späteren Schritt stillgelegt.
 *
 * INSTALLATION:
 * 1. Öffne https://script.google.com
 * 2. Öffne das bestehende Projekt
 * 3. Ersetze den Code mit diesem Script
 * 4. "Bereitstellen" → "Bereitstellung verwalten" → Stift → Version: "Neue Version"
 * 5. "Bereitstellen" (URL bleibt gleich, Code wird aktualisiert)
 */

// Google Sheet ID - aus der URL deines Sheets
const SHEET_ID = '1W7lLRY7qiu-7QWiJFTba-Ax-MiaGMVshnkWrgB2UaQM';

// Pre-shared Token für Schulsession-Marker. MUSS identisch sein in admin.html
// (Konstante SCHOOL_MARKER_TOKEN) und in jedem Bookmarklet-Snippet.
// Empfehlung: bei jedem Deploy einen neuen Wert generieren (16+ Zeichen,
// alphanumerisch). Wert ist nicht hochgradig geheim (steht in admin.html),
// stoppt aber zufälliges Endpoint-Probing durch Dritte.
const SCHOOL_MARKER_TOKEN = 'mt-2026-k7zQ9pX4vB8nL3cF';

// Neue Schema-3 Event-Typen → Tab "Events"
const EVENTS_TYPES = ['page_view', 'quiz_start', 'quiz_complete', 'heartbeat',
  'node_select', 'card_view', 'quiz_abandon', 'landing_click', 'card_dismiss'];
const EVENTS_HEADERS = ['ts', 'schema', 'env', 'eventType', 'trainer',
  'device', 'referrer', 'sessionId', 'payload'];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ---- NEUER PFAD: append-only Event-Log ----
    if (data.eventType && EVENTS_TYPES.indexOf(data.eventType) !== -1) {
      const lock = LockService.getScriptLock();
      try { lock.waitLock(20000); } catch (lockErr) { /* best effort, trotzdem appenden */ }
      try {
        const ss = SpreadsheetApp.openById(SHEET_ID);
        let ev = ss.getSheetByName('Events');
        if (!ev) {
          ev = ss.insertSheet('Events');
          ev.appendRow(EVENTS_HEADERS);
        }
        ev.appendRow([
          data.ts || data.timestamp || new Date().toISOString(),
          data.schema || '',
          data.env || '',
          data.eventType,
          data.trainer || data.app || '',
          data.device || '',
          data.referrer || '',
          data.sessionId || '',
          JSON.stringify(data.payload || {})
        ]);
      } finally {
        try { lock.releaseLock(); } catch (relErr) { /* ignore */ }
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ---- MARKER-PFAD: Schulsession-Marker (admin.html / Bookmarklet) ----
    // Schreibt Start/End-Marker in das Sheet "School_Sessions". Auto-Close
    // offener Starts > 90 Min vor jedem Append (Reihenfolge bleibt chronologisch).
    // Schutz: Pre-shared Token muss matchen — verhindert Endpoint-Spam durch
    // Dritte, die nur die URL kennen. Token-Wert siehe SCHOOL_MARKER_TOKEN
    // (oben in dieser Datei); muss identisch sein in admin.html + Bookmarklet.
    if (data.type === 'session_marker') {
      if (String(data.token || '') !== SCHOOL_MARKER_TOKEN) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'invalid_token' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      const lock = LockService.getScriptLock();
      try { lock.waitLock(20000); } catch (lockErr) { /* best effort */ }
      try {
        const ss = SpreadsheetApp.openById(SHEET_ID);
        let sh = ss.getSheetByName('School_Sessions');
        if (!sh) {
          sh = ss.insertSheet('School_Sessions');
          sh.appendRow(['ts', 'klass', 'marker', 'note']);
        }
        _school_autoCloseStale90(sh);
        sh.appendRow([
          data.ts || new Date().toISOString(),
          String(data.klass || '').trim(),
          String(data.marker || '').trim(),
          String(data.note || '').trim()
        ]);
      } finally {
        try { lock.releaseLock(); } catch (relErr) { /* ignore */ }
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true, type: 'session_marker' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ---- ALT-PFAD: unverändert, schreibt weiter ins aktive Sheet ----
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();

    // Event-Typ bestimmen (neu: session_start/session_end, alt: ohne eventType)
    const eventType = data.eventType || 'session_end'; // Abwärtskompatibel

    if (eventType === 'session_start') {
      // SESSION START: Neue Zeile mit Session-ID erstellen
      const sessionId = data.sessionId || '';
      const row = [
        data.timestamp,           // A: Timestamp
        data.app,                 // B: App
        '',                       // C: Duration (wird bei session_end gefüllt)
        '',                       // D: Questions (wird bei session_end gefüllt)
        '',                       // E: Success Rate (wird bei session_end gefüllt)
        data.device,              // F: Device
        data.referrer,            // G: Referrer
        sessionId,                // H: Session ID (für späteres Update)
        'active'                  // I: Status
      ];
      sheet.appendRow(row);

    } else if (eventType === 'session_end') {
      // SESSION END: Versuche bestehende Zeile zu aktualisieren
      const sessionId = data.sessionId || '';
      let updated = false;

      if (sessionId) {
        // Suche nach Session-ID in Spalte H
        const dataRange = sheet.getDataRange();
        const values = dataRange.getValues();

        for (let i = values.length - 1; i >= 1; i--) { // Von unten nach oben suchen
          if (values[i][7] === sessionId) { // Spalte H (Index 7)
            // Zeile gefunden - aktualisieren
            const rowNum = i + 1;
            sheet.getRange(rowNum, 3).setValue(data.duration);      // C: Duration
            sheet.getRange(rowNum, 4).setValue(data.questionsAnswered); // D: Questions
            sheet.getRange(rowNum, 5).setValue(data.successRate + '%'); // E: Success Rate
            sheet.getRange(rowNum, 9).setValue('completed');        // I: Status
            updated = true;
            break;
          }
        }
      }

      // Falls keine passende Zeile gefunden (z.B. alte App-Version ohne sessionId)
      if (!updated) {
        const row = [
          data.timestamp,
          data.app,
          data.duration,
          data.questionsAnswered,
          data.successRate + '%',
          data.device,
          data.referrer,
          sessionId,
          'completed'
        ];
        sheet.appendRow(row);
      }

    } else if (eventType === 'session_heartbeat') {
      // HEARTBEAT: Bestehende Zeile mit aktuellen Daten aktualisieren
      const sessionId = data.sessionId || '';
      if (sessionId) {
        const dataRange = sheet.getDataRange();
        const values = dataRange.getValues();

        for (let i = values.length - 1; i >= 1; i--) {
          if (values[i][7] === sessionId) {
            const rowNum = i + 1;
            sheet.getRange(rowNum, 3).setValue(data.duration);          // C: Duration
            sheet.getRange(rowNum, 4).setValue(data.questionsAnswered); // D: Questions
            sheet.getRange(rowNum, 5).setValue(data.successRate + '%'); // E: Success Rate
            // Status bleibt 'active' (wird erst bei session_end zu 'completed')
            break;
          }
        }
      }

    } else if (eventType === 'landing_click') {
      // LANDING PAGE KLICK: Welcher Trainer wurde von der Startseite aus angeklickt?
      const row = [
        data.timestamp,           // A: Timestamp
        data.app,                 // B: Angeklickter Trainer
        '',                       // C: Duration (nicht relevant)
        '',                       // D: Questions (nicht relevant)
        '',                       // E: Success Rate (nicht relevant)
        data.device,              // F: Device
        data.referrer,            // G: Referrer/UTM-Source
        '',                       // H: Session ID (nicht relevant)
        'landing_click'           // I: Status
      ];
      sheet.appendRow(row);

    } else if (eventType === 'quiz_result') {
      // GF-Zwischenstufe (flag-gated, default aus). Bleibt vorerst erhalten,
      // wird vom Redesign durch 'quiz_complete' abgelöst.
      const ss = SpreadsheetApp.openById(SHEET_ID);
      let gf = ss.getSheetByName('GF_QuizResults');
      if (!gf) {
        gf = ss.insertSheet('GF_QuizResults');
        gf.appendRow(['Timestamp', 'Trainer', 'Level', 'Subskill', 'Mode',
          'InputType', 'AudioUsed', 'Answered', 'Correct', 'Pct',
          'RetryCount', 'LockCase', 'Dims (JSON)', 'Patterns', 'Device', 'Session ID']);
      }
      gf.appendRow([
        data.timestamp,
        data.trainer || data.app || '',
        data.level || '',
        data.subskill || '',
        data.mode || '',
        data.inputType || '',
        data.audioUsed === true ? 'yes' : 'no',
        data.answered || 0,
        data.correct || 0,
        (data.pct != null ? data.pct + '%' : ''),
        data.retryCount || 0,
        data.lockCase === true ? 'yes' : 'no',
        JSON.stringify(data.dims || {}),
        Array.isArray(data.patterns) ? data.patterns.join(', ') : '',
        data.device || '',
        data.sessionId || ''
      ]);

    } else {
      // LEGACY: Alte Apps ohne eventType (abwärtskompatibel)
      const row = [
        data.timestamp,
        data.app,
        data.duration,
        data.questionsAnswered,
        data.successRate + '%',
        data.device,
        data.referrer,
        '',
        'legacy'
      ];
      sheet.appendRow(row);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || '');

  // ?action=list_sessions&token=…&n=200 → JSON {success, rows:[{ts,klass,marker,note}, …]}
  // Wird vom _admin.html-loadSessions() statt direkter gviz-Fetch genutzt
  // (gviz schickt kein Access-Control-Allow-Credentials:true, daher
  // credentials:'include' cross-origin blockiert). Apps Script hat per
  // SpreadsheetApp Vollzugriff; Token-Check schützt gegen Endpoint-Spam.
  if (action === 'list_sessions') {
    if (String(params.token || '') !== SCHOOL_MARKER_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'invalid_token' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    try {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      const sh = ss.getSheetByName('School_Sessions');
      if (!sh) {
        return ContentService.createTextOutput(JSON.stringify({ success: true, rows: [] }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // Vor dem Lesen: stale Starts > 90 Min schließen, damit Offene-Liste stimmt
      try { _school_autoCloseStale90(sh); } catch (acErr) { /* best effort */ }
      const values = sh.getDataRange().getValues();
      // values[0] = Header [ts, klass, marker, note]; ab values[1] = Daten
      const n = Math.max(1, parseInt(params.n, 10) || 200);
      const all = values.slice(1).map(r => ({
        ts: (r[0] instanceof Date) ? r[0].toISOString() : String(r[0] || ''),
        klass: String(r[1] || ''),
        marker: String(r[2] || ''),
        note: String(r[3] || '')
      }));
      const rows = all.slice(Math.max(0, all.length - n));
      return ContentService.createTextOutput(JSON.stringify({ success: true, rows: rows }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Default: Status-Banner (wie bisher)
  return ContentService.createTextOutput('Musiktrainer Tracking API v3.0 - Use POST to send data')
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Optional einmalig ausführen: Tabs + Überschriften vorab anlegen.
 * (Nicht zwingend — Tabs werden beim ersten Event automatisch erstellt.)
 */
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Alt-Sheet (Raw Data) Header wie bisher
  const raw = ss.getActiveSheet();
  const rawHeaders = ['Timestamp', 'App', 'Duration', 'Questions', 'Success Rate', 'Device', 'Referrer', 'Session ID', 'Status'];
  raw.getRange(1, 1, 1, rawHeaders.length).setValues([rawHeaders]);

  // Neuer Events-Tab
  let ev = ss.getSheetByName('Events');
  if (!ev) ev = ss.insertSheet('Events');
  ev.getRange(1, 1, 1, EVENTS_HEADERS.length).setValues([EVENTS_HEADERS]);
}

// =====================================================================
// SCHULSESSION-MARKER (admin.html / Bookmarklet) — Helper
// =====================================================================
// Scannt School_Sessions, schließt offene Starts > 90 Min mit
// marker='auto_end_90min' am Zeitpunkt start+90min. Idempotent.
function _school_autoCloseStale90(sh) {
  const NINETY_MS = 90 * 60 * 1000;
  const now = Date.now();
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return;
  const rows = vals.slice(1); // ohne Header

  const byKlass = {};
  rows.forEach(function (r) {
    const ts = (r[0] instanceof Date) ? r[0].getTime() : new Date(r[0]).getTime();
    if (isNaN(ts)) return;
    const klass = String(r[1] || '').trim();
    const marker = String(r[2] || '').trim();
    if (!klass) return;
    if (!byKlass[klass]) byKlass[klass] = [];
    byKlass[klass].push({ ts: ts, marker: marker });
  });

  const toAppend = [];
  Object.keys(byKlass).forEach(function (klass) {
    const events = byKlass[klass].sort(function (a, b) { return a.ts - b.ts; });
    let openTs = null;
    events.forEach(function (e) {
      if (e.marker === 'start') openTs = e.ts;
      else if (e.marker === 'end' || e.marker === 'auto_end_90min') openTs = null;
    });
    if (openTs !== null && (now - openTs) > NINETY_MS) {
      toAppend.push([
        new Date(openTs + NINETY_MS).toISOString(),
        klass,
        'auto_end_90min',
        'auto closed after 90min'
      ]);
    }
  });

  toAppend.forEach(function (r) { sh.appendRow(r); });
}

// Time-driven Trigger (alle 10 Min): Backup für nicht manuell beendete Sessions.
function school_autoCloseTick() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('School_Sessions');
  if (!sh) return;
  _school_autoCloseStale90(sh);
}

// Einmalig manuell ausführen: installiert den 10-Min-Trigger. Idempotent
// (löscht alten Trigger gleichen Namens vor neuer Installation).
function installSchoolSessionAutoCloseTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'school_autoCloseTick') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('school_autoCloseTick')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Trigger school_autoCloseTick installiert (alle 10 Min).');
}

// =====================================================================
// HEARTBEAT-CLEANUP — Heartbeats älter 30 Tage aus 'Events' löschen
// =====================================================================
// Warum: Heartbeats sind ~35–40 % des Events-Volumens. Nach der
// Klassifikation (PLAN_Auswertung §2a) und Einfrieren in Daily_Aggregates
// (>2 Tage alt) tragen sie kein neues Signal mehr. 30 Tage Puffer für
// Bedarfsfälle (Schwellen-Tuning rückwirkend, Tracking-Forensik).
//
// SICHERHEIT: Cleanup läuft 04:00, NACH runAnalyse (03:00). Falls
// runAnalyse fehlschlägt, schreibt es keinen neuen Daily_Aggregates-Tag —
// dann wäre dieser Tag schon vor dem Einfrieren ohne HBs. Mitigation:
// Cleanup-Cutoff ist 30 Tage, runAnalyse hätte 28+ Tage Reserve um zu laufen.

const HB_CLEANUP_DAYS = 30;

function cleanupOldHeartbeats() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('Events');
  if (!sh) { Logger.log('cleanupOldHeartbeats: Events-Tab fehlt, nichts zu tun'); return; }

  const cutoffMs = Date.now() - (HB_CLEANUP_DAYS * 86400000);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) { Logger.log('cleanupOldHeartbeats: Events-Tab leer'); return; }

  const header = data[0];
  const keep = [header];
  let removed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const tsRaw = row[0];
    const ts = (tsRaw instanceof Date) ? tsRaw.getTime() : new Date(String(tsRaw)).getTime();
    const eventType = String(row[3] || '');
    if (eventType === 'heartbeat' && ts && !isNaN(ts) && ts < cutoffMs) {
      removed++;
    } else {
      keep.push(row);
    }
  }

  if (removed === 0) {
    Logger.log('cleanupOldHeartbeats: keine alten Heartbeats gefunden (Cutoff ' + new Date(cutoffMs).toISOString() + ')');
    return;
  }

  // Komplett-Rewrite: schneller als einzelne deleteRow()-Aufrufe bei vielen Zeilen.
  // Lock gegen gleichzeitige Schreibvorgänge (doPost appendRow).
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) {
    Logger.log('cleanupOldHeartbeats: Lock nicht verfügbar, abbrechen');
    return;
  }
  try {
    sh.clearContents();
    sh.getRange(1, 1, keep.length, header.length).setValues(keep);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ignore */ }
  }

  Logger.log('cleanupOldHeartbeats: ' + removed + ' Heartbeat-Zeilen gelöscht, ' +
    (keep.length - 1) + ' verbleiben (Cutoff ' + new Date(cutoffMs).toISOString() + ')');
}

// Einmalig manuell ausführen: installiert den täglichen 04:00-Trigger.
// Idempotent. Voraussetzung: Daily_Aggregates läuft täglich 03:00 (installAnalyseTrigger).
function installHeartbeatCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cleanupOldHeartbeats') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('cleanupOldHeartbeats')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
  Logger.log('Trigger cleanupOldHeartbeats installiert (täglich 04:00, ' + HB_CLEANUP_DAYS + ' Tage Puffer).');
}
