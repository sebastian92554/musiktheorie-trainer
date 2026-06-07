/**
 * Musiktrainer — Auswertungs-Generator (Events → Events_Analyse + GF_Analyse)
 * Version 1.1
 *
 * Liest 'Events', rekonstruiert Sessions, klassifiziert (PLAN_Auswertung §2a),
 * segmentiert, rechnet Funnel-/Bounce-Kennzahlen + Validität + GF-dims.
 *
 * ANLEITUNG (gleicher Weg wie beim Analyse-Dashboard-Script):
 * 1. Im Google Sheet: Erweiterungen → Apps Script
 *    → DASSELBE Projekt wie Code.gs (Tracking) + Dashboard-Script
 * 2. Links auf "+" → "Skript" → neue Datei → DIESEN Code komplett einfügen
 * 3. Oben Funktion `installAnalyseTrigger` wählen → ausführen →
 *    Berechtigungen bestätigen. Danach läuft es täglich 03:00 automatisch.
 *    (`runAnalyse` kann man jederzeit manuell ausführen für Sofort-Lauf.)
 *
 * HINWEIS: SHEET_ID kommt aus der Tracking-Datei (Code.gs) — hier NICHT
 * erneut deklarieren (exakt dieselbe Konvention wie das Dashboard-Script).
 */

const CFG = {
  CUTOFF: '2026-05-16T00:00:00Z',     // v3 live / Events geleert
  SHORT_MS: 45000,                    // <45s ohne Quiz = Sofort-Absprung
  INTERRUPT_MS: 20000,                // quiz_start, dann ≤20s Ende = unterbrochen
  IDLE_MS: 600000,                    // >10min, nur HBs = idle-offen
  BURST_WINDOW_MS: 30 * 60000,        // 30min-Fenster
  BURST_MIN: 8,                       // ≥8 Sessions/Trainer = Klassenraum
  BURST_TABLET_SHARE: 0.5,            // ≥50% Tablet
  BURST_ACTIVE_SHARE: 0.5,            // ≥50% mit quiz_start (echte Lern-Aktivität)
  MIN_ORGANIK_SESSIONS: 200,          // Validitäts-Gate
  MIN_SPAN_DAYS: 7,
  OLD_BOUNCE_REF: 58                  // alte Raw-Data-Zahl (%) für Gegenprobe
};

// Skilltree-Klartext: (trainer|level|subskill) → "<KÜRZEL> <Code> — <Knoten> · <Subskill>"
// Quelle: Skilltree-Definitionen der 5 Trainer (Stand 2026-05-16). Code = Knoten-Nr
// + Buchstabe nach Subskill-Index. Unbekannte/neue Kombis → Fallback (roh).
const SKILL = {
  'Notentrainer|einsteiger|basis':'NT 1a — Violinschlüssel — Noten lesen · Stammtöne',
  'Notentrainer|einsteiger|vorzeichen':'NT 1b — Violinschlüssel — Noten lesen · Mit Vorzeichen',
  'Notentrainer|einsteiger|lagen':'NT 1c — Violinschlüssel — Noten lesen · Mit Lagen',
  'Notentrainer|einsteiger|hilfslinien':'NT 1d — Violinschlüssel — Noten lesen · Mit Hilfslinien',
  'Notentrainer|aufsteiger|basis':'NT 2a — Bassschlüssel — Noten lesen · Stammtöne',
  'Notentrainer|aufsteiger|vorzeichen':'NT 2b — Bassschlüssel — Noten lesen · Mit Vorzeichen',
  'Notentrainer|aufsteiger|lagen':'NT 2c — Bassschlüssel — Noten lesen · Mit Lagen',
  'Notentrainer|aufsteiger|hilfslinien':'NT 2d — Bassschlüssel — Noten lesen · Mit Hilfslinien',
  'Notentrainer|profi|basis':'NT 3a — Beide Schlüssel — Noten lesen · Stammtöne',
  'Notentrainer|profi|vorzeichen':'NT 3b — Beide Schlüssel — Noten lesen · Mit Vorzeichen',
  'Notentrainer|profi|lagen':'NT 3c — Beide Schlüssel — Noten lesen · Mit Lagen',
  'Notentrainer|profi|hilfslinien':'NT 3d — Beide Schlüssel — Noten lesen · Mit Hilfslinien',
  'Notentrainer|bild_violin|basis':'NT 4a — Violinschlüssel — Noten schreiben · Stammtöne',
  'Notentrainer|bild_violin|vorzeichen':'NT 4b — Violinschlüssel — Noten schreiben · Mit Vorzeichen',
  'Notentrainer|bild_violin|lagen':'NT 4c — Violinschlüssel — Noten schreiben · Mit Lagen',
  'Notentrainer|bild_violin|hilfslinien':'NT 4d — Violinschlüssel — Noten schreiben · Mit Hilfslinien',
  'Notentrainer|bild_bass|basis':'NT 5a — Bassschlüssel — Noten schreiben · Stammtöne',
  'Notentrainer|bild_bass|vorzeichen':'NT 5b — Bassschlüssel — Noten schreiben · Mit Vorzeichen',
  'Notentrainer|bild_bass|lagen':'NT 5c — Bassschlüssel — Noten schreiben · Mit Lagen',
  'Notentrainer|bild_bass|hilfslinien':'NT 5d — Bassschlüssel — Noten schreiben · Mit Hilfslinien',
  'Notentrainer|bild_beide|basis':'NT 6a — Beide Schlüssel — Noten schreiben · Stammtöne',
  'Notentrainer|bild_beide|vorzeichen':'NT 6b — Beide Schlüssel — Noten schreiben · Mit Vorzeichen',
  'Notentrainer|bild_beide|lagen':'NT 6c — Beide Schlüssel — Noten schreiben · Mit Lagen',
  'Notentrainer|bild_beide|hilfslinien':'NT 6d — Beide Schlüssel — Noten schreiben · Mit Hilfslinien',
  'Intervalltrainer|einsteiger|basis':'IT 1a — Intervall grob bestimmen · Grundintervalle (Prime bis Oktave)',
  'Intervalltrainer|einsteiger|extended':'IT 1b — Intervall grob bestimmen · Erweiterte Intervalle (None bis Duodezime)',
  'Intervalltrainer|einsteiger|nohelp':'IT 1c — Intervall grob bestimmen · Ohne Dropdown (freie Eingabe)',
  'Intervalltrainer|aufsteiger|basis':'IT 2a — Intervalle auf der Tastatur · Stammtöne auf der Tastatur',
  'Intervalltrainer|aufsteiger|augdim':'IT 2b — Intervalle auf der Tastatur · Mit Vorzeichen',
  'Intervalltrainer|aufsteiger|bothclefs':'IT 2c — Intervalle auf der Tastatur · Beide Schlüssel',
  'Intervalltrainer|profi|basis':'IT 3a — Halbtonschritte zählen · Halbtonschritte zählen',
  'Intervalltrainer|profi|augdim':'IT 3b — Halbtonschritte zählen · Mit übermäßigen/verminderten Intervallen',
  'Intervalltrainer|profi|bothclefs':'IT 3c — Halbtonschritte zählen · Beide Schlüssel',
  'Intervalltrainer|profi|noaudio':'IT 3d — Halbtonschritte zählen · Ohne Hörbeispiel',
  'Intervalltrainer|meister|rein':'IT 4a — Feinbestimmung lernen · Reine Intervalle (r1, r4, r5, r8)',
  'Intervalltrainer|meister|grossklein':'IT 4b — Feinbestimmung lernen · Große & kleine Intervalle',
  'Intervalltrainer|meister|komplement':'IT 4c — Feinbestimmung lernen · Komplementärintervalle',
  'Intervalltrainer|meister|augdim':'IT 4d — Feinbestimmung lernen · Übermäßig & vermindert',
  'Intervalltrainer|meister|alles':'IT 4e — Feinbestimmung lernen · Alle Typen gemischt',
  'Intervalltrainer|experte|basis':'IT 5a — Intervalle präzise bestimmen · Grundbestimmung (rein, groß, klein)',
  'Intervalltrainer|experte|augdim':'IT 5b — Intervalle präzise bestimmen · Mit übermäßig/vermindert',
  'Intervalltrainer|experte|extended':'IT 5c — Intervalle präzise bestimmen · Erweiterte Intervalle',
  'Intervalltrainer|experte|bothclefs':'IT 5d — Intervalle präzise bestimmen · Beide Schlüssel',
  'Intervalltrainer|experte|noaudio':'IT 5e — Intervalle präzise bestimmen · Ohne Hörbeispiel',
  'Intervalltrainer|bilden_tastatur|rein':'IT 6a — Tastatur bilden · Reine Intervalle',
  'Intervalltrainer|bilden_tastatur|grossklein':'IT 6b — Tastatur bilden · Große & kleine',
  'Intervalltrainer|bilden_tastatur|augdim':'IT 6c — Tastatur bilden · Übermäßig & vermindert',
  'Intervalltrainer|bilden_tastatur|erweitert':'IT 6d — Tastatur bilden · Erweiterte (None–Tredezime)',
  'Intervalltrainer|bilden_staff|rein':'IT 7a — Notensystem schreiben · Reine Intervalle',
  'Intervalltrainer|bilden_staff|grossklein':'IT 7b — Notensystem schreiben · Große & kleine',
  'Intervalltrainer|bilden_staff|augdim':'IT 7c — Notensystem schreiben · Übermäßig & vermindert',
  'Intervalltrainer|bilden_staff|erweitert':'IT 7d — Notensystem schreiben · Erweiterte (None–Tredezime)',
  'Intervalltrainer|bilden_staff|noaudio':'IT 7e — Notensystem schreiben · Ohne Hörbeispiel',
  'Dreiklangstrainer|einsteiger|basis':'DT 1a — Tastaturorientierung · Basis (Dur/Moll)',
  'Dreiklangstrainer|einsteiger|vorzeichen':'DT 1b — Tastaturorientierung · Mit Vorzeichen',
  'Dreiklangstrainer|einsteiger|range':'DT 1c — Tastaturorientierung · Großer Tonumfang',
  'Dreiklangstrainer|aufsteiger|basis':'DT 2a — Terzen bestimmen · Basis (Dur & Moll)',
  'Dreiklangstrainer|aufsteiger|vorzeichen':'DT 2b — Terzen bestimmen · Mit Vorzeichen',
  'Dreiklangstrainer|aufsteiger|augmented':'DT 2c — Terzen bestimmen · Übermäßig & vermindert',
  'Dreiklangstrainer|aufsteiger|range':'DT 2d — Terzen bestimmen · Großer Tonumfang',
  'Dreiklangstrainer|aufsteiger|noaudio':'DT 2e — Terzen bestimmen · Ohne Hörbeispiel',
  'Dreiklangstrainer|profi|basis':'DT 3a — Dreiklänge benennen · Basis (Dur & Moll)',
  'Dreiklangstrainer|profi|vorzeichen':'DT 3b — Dreiklänge benennen · Mit Vorzeichen',
  'Dreiklangstrainer|profi|augmented':'DT 3c — Dreiklänge benennen · Übermäßig & vermindert',
  'Dreiklangstrainer|profi|range':'DT 3d — Dreiklänge benennen · Großer Tonumfang',
  'Dreiklangstrainer|profi|noaudio':'DT 3e — Dreiklänge benennen · Ohne Hörbeispiel',
  'Dreiklangstrainer|profi|doubleAccidentals':'DT 3f — Dreiklänge benennen · Mit Doppelvorzeichen',
  'Dreiklangstrainer|meister|basis':'DT 4a — Umkehrungen · Basis (Dur & Moll)',
  'Dreiklangstrainer|meister|vorzeichen':'DT 4b — Umkehrungen · Mit Vorzeichen',
  'Dreiklangstrainer|meister|augmented':'DT 4c — Umkehrungen · Übermäßig & vermindert',
  'Dreiklangstrainer|meister|range':'DT 4d — Umkehrungen · Großer Tonumfang',
  'Dreiklangstrainer|meister|noaudio':'DT 4e — Umkehrungen · Ohne Hörbeispiel',
  'Dreiklangstrainer|meister|doubleAccidentals':'DT 4f — Umkehrungen · Mit Doppelvorzeichen',
  'Dreiklangstrainer|bilden_key|basis':'DT 5a — Dreiklänge bilden · Dur & Moll (einfach)',
  'Dreiklangstrainer|bilden_key|vorzeichen':'DT 5b — Dreiklänge bilden · Mehr Vorzeichen',
  'Dreiklangstrainer|bilden_key|augdim':'DT 5c — Dreiklänge bilden · Übermäßig & vermindert',
  'Dreiklangstrainer|bilden_staff|basis':'DT 6a — Dreiklänge notieren · Dur & Moll (einfach)',
  'Dreiklangstrainer|bilden_staff|vorzeichen':'DT 6b — Dreiklänge notieren · Mehr Vorzeichen',
  'Dreiklangstrainer|bilden_staff|augdim':'DT 6c — Dreiklänge notieren · Übermäßig & vermindert',
  'Dreiklangstrainer|bilden_umk_key|basis':'DT 7a — Umkehrungen bilden · Dur & Moll (einfach)',
  'Dreiklangstrainer|bilden_umk_key|vorzeichen':'DT 7b — Umkehrungen bilden · Mehr Vorzeichen',
  'Dreiklangstrainer|bilden_umk_key|augdim':'DT 7c — Umkehrungen bilden · Übermäßig & vermindert',
  'Dreiklangstrainer|bilden_umk_staff|basis':'DT 8a — Umkehrungen notieren · Dur & Moll (einfach)',
  'Dreiklangstrainer|bilden_umk_staff|vorzeichen':'DT 8b — Umkehrungen notieren · Mehr Vorzeichen',
  'Dreiklangstrainer|bilden_umk_staff|augdim':'DT 8c — Umkehrungen notieren · Übermäßig & vermindert',
  'Tonleitertrainer|einsteiger|basis':'TT 1a — Ganzton / Halbton · Stammtöne (C, D, E, F, G, A, H)',
  'Tonleitertrainer|einsteiger|vorzeichen':'TT 1b — Ganzton / Halbton · Mit Vorzeichen',
  'Tonleitertrainer|einsteiger|noaudio':'TT 1c — Ganzton / Halbton · Ohne Hörbeispiel',
  'Tonleitertrainer|aufsteiger|basis':'TT 2a — Halbtonschritte finden · HS-Stufen wählen (Dur & Moll)',
  'Tonleitertrainer|aufsteiger|stufenpaare':'TT 2b — Halbtonschritte finden · HS-Paare auswählen',
  'Tonleitertrainer|aufsteiger|mehr_tonarten':'TT 2c — Halbtonschritte finden · Erweiterte Tonarten',
  'Tonleitertrainer|aufsteiger|noaudio':'TT 2d — Halbtonschritte finden · Ohne Hörbeispiel',
  'Tonleitertrainer|profi|muster_lernen':'TT 3a — Tonleiter benennen · Tongeschlecht bestimmen (Dur / Moll / Andere)',
  'Tonleitertrainer|profi|muster_erkennen':'TT 3b — Tonleiter benennen · HS-Stufen finden + Tonleiter benennen',
  'Tonleitertrainer|profi|alles':'TT 3c — Tonleiter benennen · Alle Tonleitern benennen',
  'Tonleitertrainer|profi|ohne_hilfe':'TT 3d — Tonleiter benennen · Ohne Klaviatur-Hilfe',
  'Tonleitertrainer|profi|noaudio':'TT 3e — Tonleiter benennen · Ohne Hörbeispiel',
  'Tonleitertrainer|bilden|tastatur_einfach':'TT 4a — Tonleiter bilden · Tastatur (einfach)',
  'Tonleitertrainer|bilden|schreiben_einfach':'TT 4b — Tonleiter bilden · Schreiben (einfach)',
  'Tonleitertrainer|bilden|tastatur_schwer':'TT 4c — Tonleiter bilden · Tastatur (viele Vorzeichen)',
  'Tonleitertrainer|bilden|schreiben_schwer':'TT 4d — Tonleiter bilden · Schreiben (viele Vorzeichen)',
  'Tonleitertrainer|bilden|noaudio':'TT 4e — Tonleiter bilden · Ohne Hörbeispiel',
  'Tonleitertrainer|meister|aussenkr':'TT 5a — Quintenzirkel · Außenkreis + Merksätze',
  'Tonleitertrainer|meister|innenkr':'TT 5b — Quintenzirkel · Innenkreis + Mollparallelen',
  'Tonleitertrainer|meister|vorz_ableitung':'TT 5c — Quintenzirkel · Vorzeichen-Ableitung',
  'Tonleitertrainer|meister|enharmonisch':'TT 5d — Quintenzirkel · Enharmonische Verwechslung',
  'Tonleitertrainer|meister|verwandte':'TT 5e — Quintenzirkel · Verwandte Tonarten',
  'Tonleitertrainer|meister|symmetrien':'TT 5f — Quintenzirkel · Symmetrien (Tritonus, Dreiecke, Raute)',
  'Rhythmustrainer|einsteiger|basis':'RT 1a — Notenwerte · Basis (Ganze, Halbe, Viertel)',
  'Rhythmustrainer|einsteiger|pausen':'RT 1b — Notenwerte · Mit Pausen',
  'Rhythmustrainer|einsteiger|8tel':'RT 1c — Notenwerte · Mit Achtelnoten',
  'Rhythmustrainer|einsteiger|16tel':'RT 1d — Notenwerte · Mit Sechzehntelnoten',
  'Rhythmustrainer|einsteiger|punktierte':'RT 1e — Notenwerte · Mit punktierten Noten',
  'Rhythmustrainer|einsteiger|triolen':'RT 1f — Notenwerte · Mit Triolen',
  'Rhythmustrainer|einsteiger|hilfen_aus':'RT 1g — Notenwerte · Ohne Legende',
  'Rhythmustrainer|taktarten|regelmaessig':'RT 2a — Taktarten · Regelmäßige Taktarten (2/4, 3/4, 4/4)',
  'Rhythmustrainer|taktarten|unregelmaessig1':'RT 2b — Taktarten · Unregelmäßig 1 (+ 5/4, 7/4)',
  'Rhythmustrainer|taktarten|unregelmaessig2':'RT 2c — Taktarten · Unregelmäßig 2 (+ 7/8, 9/8)',
  'Rhythmustrainer|fortgeschrittener|basis':'RT 3a — Zählzeiten · Basis (Ganze, Halbe, Viertel)',
  'Rhythmustrainer|fortgeschrittener|pausen':'RT 3b — Zählzeiten · Mit Pausen',
  'Rhythmustrainer|fortgeschrittener|8tel':'RT 3c — Zählzeiten · Mit Achtelnoten',
  'Rhythmustrainer|fortgeschrittener|16tel':'RT 3d — Zählzeiten · Mit Sechzehntelnoten',
  'Rhythmustrainer|fortgeschrittener|punktierte':'RT 3e — Zählzeiten · Mit punktierten Noten',
  'Rhythmustrainer|fortgeschrittener|noaudio':'RT 3f — Zählzeiten · Ohne Hörbeispiel',
  'Rhythmustrainer|profi|basis':'RT 4a — Rhythmussprache · Basis (Mit Achtelnoten)',
  'Rhythmustrainer|profi|16tel':'RT 4b — Rhythmussprache · Mit Sechzehntelnoten',
  'Rhythmustrainer|profi|punktierte':'RT 4c — Rhythmussprache · Mit punktierten Noten',
  'Rhythmustrainer|profi|triolen':'RT 4d — Rhythmussprache · Mit Triolen',
  'Rhythmustrainer|profi|noaudio':'RT 4e — Rhythmussprache · Ohne Hörbeispiel',
  'Rhythmustrainer|notenwert_bilden|8tel':'RT 5a — Fehlenden Wert ergänzen · Basis (bis Achtel)',
  'Rhythmustrainer|notenwert_bilden|punktierte':'RT 5b — Fehlenden Wert ergänzen · Mit punktierten Noten',
  'Rhythmustrainer|notenwert_bilden|16tel':'RT 5c — Fehlenden Wert ergänzen · Mit Sechzehntelnoten',
  'Rhythmustrainer|rhythmusdiktat|8tel':'RT 6a — Rhythmusdiktat · Basis (bis Achtel)',
  'Rhythmustrainer|rhythmusdiktat|punktierte':'RT 6b — Rhythmusdiktat · Mit punktierten Noten',
  'Rhythmustrainer|rhythmusdiktat|16tel':'RT 6c — Rhythmusdiktat · Mit Sechzehntelnoten'
};
function _sk(tr, lv, su) {
  return SKILL[(tr || '') + '|' + (lv || '') + '|' + (su || '')]
    || ((tr || '?') + ' · ' + (lv || '?') + ' · ' + (su || '?'));
}

function _toMs(v) {
  if (v instanceof Date) return v.getTime();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.getTime();
}
// ISO-8601-Kalenderwoche (Donnerstag-Regel) → "YYYY-Www".
// Wochengrenze in der Script-Zeitzone (Date-Getter = Runtime-TZ), konsistent
// mit der Stunden-Sicht. Korrekt statt der groben Alt-Dashboard-Formel.
function _isoWeek(ms) {
  const d = new Date(ms);
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;            // Mo=1 … So=7
  dt.setUTCDate(dt.getUTCDate() + 4 - day);   // auf Donnerstag der Woche
  const yStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((dt - yStart) / 86400000 + 1) / 7);
  return dt.getUTCFullYear() + '-W' + ('0' + wk).slice(-2);
}

// YYYY-MM-DD in Script-Zeitzone (für Daily_Aggregates-Schlüssel).
function _ymd(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const dd = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + dd;
}

// Referrer/UTM normalisieren: 'direct', bare utm-Token, Domain oder URL →
// Host ohne www. Kein WHATWG-URL (in Apps-Script V8 nicht zuverlässig).
function _refNorm(r) {
  r = String(r || '').trim();
  if (!r || r === 'direct') return 'direct';
  const m = r.match(/^(?:https?:\/\/)?([^\/?#]+)/i);
  return (m ? m[1].replace(/^www\./i, '') : r) || 'direct';
}

function _json(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
function _pct(n, d) { return d > 0 ? Math.round(n / d * 1000) / 10 : null; }
// Gebundenes Script: Sheet ohne Drive-Scope über getActiveSpreadsheet();
// openById nur als Fallback (Standalone). Vermeidet "missing / no read access".
function _ss() { return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID); }

/** Sessionisierung + Filter */
function _loadSessions() {
  const sh = _ss().getSheetByName('Events');
  if (!sh) throw new Error("Tab 'Events' fehlt");
  const rows = sh.getDataRange().getValues();
  const cutoff = _toMs(CFG.CUTOFF);
  const byId = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ts = _toMs(r[0]);
    const schema = parseInt(r[1], 10) || 0;
    const env = String(r[2] || '');
    const eventType = String(r[3] || '');
    const trainer = String(r[4] || '');
    const device = String(r[5] || '');
    const referrer = String(r[6] || '');
    const sid = String(r[7] || '');
    if (!sid || !ts) continue;
    if (env === 'dev') continue;            // Dev/Test raus
    if (schema < 3) continue;               // nur neues Modell
    if (ts < cutoff) continue;              // ab Cutoff
    (byId[sid] = byId[sid] || []).push({
      ts, eventType, trainer, device, referrer, payload: _json(r[8])
    });
  }
  const sessions = [];
  for (const sid in byId) {
    const ev = byId[sid].sort((a, b) => a.ts - b.ts);
    sessions.push(_features(sid, ev));
  }
  return sessions;
}

/** Merkmale + Klassifikation einer Session */
function _features(sid, ev) {
  const types = {};
  ev.forEach(e => types[e.eventType] = (types[e.eventType] || 0) + 1);
  const t0 = ev[0].ts, tEnd = ev[ev.length - 1].ts;
  const act = ev.filter(e => e.eventType === 'page_view' ||
    e.eventType === 'quiz_start' || e.eventType === 'quiz_complete');
  const tLastAct = act.length ? act[act.length - 1].ts : t0;
  const qsList = ev.filter(e => e.eventType === 'quiz_start');
  const qc = ev.filter(e => e.eventType === 'quiz_complete');
  const qa = ev.filter(e => e.eventType === 'quiz_abandon');
  const cd = ev.filter(e => e.eventType === 'card_dismiss');
  const hasExplore = !!(types['node_select'] || types['card_view']); // Zukunft
  const s = {
    sid, trainer: ev[0].trainer, device: ev[0].device, referrer: ev[0].referrer,
    t0, tEnd, durRaw: tEnd - t0, durEng: tLastAct - t0,
    nHb: types['heartbeat'] || 0, nEvents: ev.length,
    hasQS: qsList.length > 0, hasQC: qc.length > 0,
    lastQS: qsList.length ? qsList[qsList.length - 1] : null,
    qc: qc.length ? qc[qc.length - 1].payload : null,   // letztes (Session-Klassifikation)
    qcAll: qc.map(e => e.payload),                       // ALLE Quizze (für GF_Analyse)
    qaAll: qa.map(e => e.payload),                       // ALLE Abbrüche (für B3-Detail)
    cdAll: cd.map(e => e.payload),                       // ALLE Lernkarten-Dismisses (Verweildauer)
    evAll: ev,                                           // ROHE Events mit ts (für Korrelations-Auswertungen)
    hasExplore, segment: 'organik'
  };
  // ---- Klassifikation (geordnet, erste Übereinstimmung, §2a) ----
  if (s.hasQC) { s.cat = 'abgeschlossen'; s.conf = 'sicher'; }
  else if (s.hasQS) {
    const after = tEnd - s.lastQS.ts;
    if (after <= CFG.INTERRUPT_MS) { s.cat = 'abgebrochen_unterbrochen'; s.conf = 'mittel'; }
    else { s.cat = 'abgebrochen_aktiv'; s.conf = 'mittel'; }
  } else if (hasExplore) {
    s.cat = 'erkundet_ohne_quiz'; s.conf = 'hoch';      // belegt durch node_select/card_view
  } else if (s.nEvents === 1 && types['page_view'] && s.nHb === 0) {
    s.cat = 'phantom_preview'; s.conf = 'hoch';
  } else if (s.durRaw < CFG.SHORT_MS && s.nHb <= 1) {
    s.cat = 'sofort_absprung'; s.conf = 'hoch';
  } else if (s.durRaw > CFG.IDLE_MS && s.nHb >= 3) {
    s.cat = 'idle_offen'; s.conf = 'hoch';
  } else if (s.durRaw >= CFG.SHORT_MS && s.durRaw <= CFG.IDLE_MS) {
    s.cat = 'erkundet_ohne_quiz'; s.conf = 'niedrig';   // schwaches Signal
  } else {
    s.cat = 'sofort_absprung'; s.conf = 'niedrig';
  }
  return s;
}

/** Burst-Heuristik → Klassenraum-Segment */
function _segment(sessions) {
  // 1) Ground Truth: explizite Schulsession-Marker überstimmen die Burst-Heuristik.
  //    Alle prod-Sessions in einem [start, end]-Fenster sind klassenraum.
  //    Test-Marker (Klassen-Präfix „test") werden ausgeschlossen.
  const windows = _loadSchoolSessions().filter(w =>
    !String(w.klass || '').toLowerCase().startsWith('test') && w.end);
  if (windows.length) {
    sessions.forEach(s => {
      for (const w of windows) {
        if (s.t0 >= w.start && s.t0 <= w.end) {
          s.segment = 'klassenraum';
          break;
        }
      }
    });
  }

  // 2) Burst-Heuristik für Tage ohne Marker (Größe + Tablet + Aktivität).
  //    Aktivitäts-Kriterium BURST_ACTIVE_SHARE filtert Bot-Schwärme/
  //    Empfehlungs-Bursts/Trainer↔Landing-Loops aus.
  const byTrainer = {};
  sessions.forEach(s => (byTrainer[s.trainer] = byTrainer[s.trainer] || []).push(s));
  for (const t in byTrainer) {
    const list = byTrainer[t].sort((a, b) => a.t0 - b.t0);
    list.forEach(s => {
      if (s.segment === 'klassenraum') return; // schon durch Marker gesetzt
      const cluster = list.filter(o => Math.abs(o.t0 - s.t0) <= CFG.BURST_WINDOW_MS);
      if (cluster.length >= CFG.BURST_MIN) {
        const tab = cluster.filter(o => o.device === 'tablet').length / cluster.length;
        const active = cluster.filter(o => o.hasQS).length / cluster.length;
        if (tab >= CFG.BURST_TABLET_SHARE && active >= CFG.BURST_ACTIVE_SHARE) {
          s.segment = 'klassenraum';
        }
      }
    });
  }
}

/** Lädt Schulsession-Marker aus 'School_Sessions' und paart Start/End-Marker
 *  pro Klasse zu Sessions. auto_end_90min wird wie end behandelt. Mehrere
 *  Starts derselben Klasse: chronologisch matched (FIFO). Unmatched starts
 *  ohne end (z. B. läuft gerade) werden zurückgegeben mit end=null. */
function _loadSchoolSessions() {
  const sh = _ss().getSheetByName('School_Sessions');
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const byKlass = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ts = _toMs(r[0]);
    const klass = String(r[1] || '').trim();
    const marker = String(r[2] || '').trim();
    const note = String(r[3] || '').trim();
    if (!ts || !klass || !marker) continue;
    (byKlass[klass] = byKlass[klass] || []).push({ ts, marker, note });
  }
  const out = [];
  Object.keys(byKlass).forEach(function (klass) {
    const evs = byKlass[klass].sort(function (a, b) { return a.ts - b.ts; });
    const starts = [];
    evs.forEach(function (e) {
      if (e.marker === 'start') starts.push({ start: e.ts, end: null, klass: klass, autoEnd: false, note: e.note });
      else if (e.marker === 'end' || e.marker === 'auto_end_90min') {
        const open = starts.filter(function (s) { return s.end === null; });
        if (open.length) {
          open[0].end = e.ts;
          open[0].autoEnd = (e.marker === 'auto_end_90min');
        }
      }
    });
    starts.forEach(function (s) { out.push(s); });
  });
  return out.sort(function (a, b) { return a.start - b.start; });
}

/** Hauptlauf */
function runAnalyse() {
  const sessions = _loadSessions();
  _segment(sessions);

  const out = [];
  const push = (a, b) => out.push([a, b === undefined ? '' : b]);
  const now = new Date();

  const org = sessions.filter(s => s.segment === 'organik');
  const kla = sessions.filter(s => s.segment === 'klassenraum');
  const catCount = (arr, c) => arr.filter(s => s.cat === c).length;
  const CATS = ['abgeschlossen', 'abgebrochen_aktiv', 'abgebrochen_unterbrochen',
    'phantom_preview', 'sofort_absprung', 'idle_offen', 'erkundet_ohne_quiz'];

  push('MUSIKTRAINER — EVENTS-AUSWERTUNG');
  push('Generiert', now.toISOString());
  push('Sessions gesamt (gefiltert)', sessions.length);
  push('  davon organik', org.length);
  push('  davon klassenraum', kla.length);
  push('');

  push('— SESSION-KLASSIFIKATION (organik) —');
  CATS.forEach(c => push('  ' + c, catCount(org, c) + ' (' + _pct(catCount(org, c), org.length) + '%)'));
  push('');

  // Pro Trainer (organik) — verhindert Vermischung mehrerer Trainer (Schritt 5)
  push('— PRO TRAINER (organik) —');
  const trnSet = {};
  org.forEach(s => { trnSet[s.trainer || '?'] = true; });
  Object.keys(trnSet).sort().forEach(tn => {
    const t = org.filter(s => (s.trainer || '?') === tn);
    const tNonPh = t.filter(s => s.cat !== 'phantom_preview').length;
    const tBounce = t.filter(s => ['sofort_absprung', 'idle_offen', 'erkundet_ohne_quiz'].indexOf(s.cat) >= 0).length;
    const tDone = t.filter(s => s.cat === 'abgeschlossen').length;
    const tAb = t.filter(s => s.cat.indexOf('abgebrochen') === 0).length;
    push('  ' + tn, 'n=' + t.length + ' | abgeschl. ' + tDone + ' | abgebr. ' + tAb +
      ' | Bounce ' + _pct(tBounce, tNonPh) + '% | Abschluss ' + _pct(tDone, tDone + tAb) + '%');
  });
  push('');

  // A1 — echter Bounce organik, mit Konfidenzband
  const nonPhantom = org.filter(s => s.cat !== 'phantom_preview');
  const bounceHigh = org.filter(s => s.cat === 'sofort_absprung' || s.cat === 'idle_offen');
  const bounceAll = org.filter(s => ['sofort_absprung', 'idle_offen', 'erkundet_ohne_quiz'].indexOf(s.cat) >= 0);
  const bLo = _pct(bounceHigh.length, nonPhantom.length);
  const bHi = _pct(bounceAll.length, nonPhantom.length);
  push('— A1 ECHTER BOUNCE (organik, ohne phantom_preview) —');
  push('  Konfidenzband', bLo + '% – ' + bHi + '%');
  push('  Gegenprobe alte Raw-Data', CFG.OLD_BOUNCE_REF + '%');
  push('  Verdikt', bHi !== null && bHi < CFG.OLD_BOUNCE_REF
    ? 'deutlich niedriger → Artefakt-These gestützt'
    : 'NICHT niedriger → Ursache prüfen (alte These / neues Artefakt)');
  push('');

  // A2 — Artefakt-Anteil
  push('— A2 ALT-ARTEFAKT-ANTEIL (organik) —');
  push('  phantom_preview', _pct(catCount(org, 'phantom_preview'), org.length) + '%');
  push('  idle_offen', _pct(catCount(org, 'idle_offen'), org.length) + '%');
  push('');

  // B1 — Abschlussrate
  const aDone = catCount(org, 'abgeschlossen');
  const aAbort = catCount(org, 'abgebrochen_aktiv') + catCount(org, 'abgebrochen_unterbrochen');
  push('— B1 ABSCHLUSS (organik, unter Quiz-Startern) —');
  push('  abgeschlossen', aDone);
  push('  abgebrochen', aAbort);
  push('  Abschlussrate', _pct(aDone, aDone + aAbort) + '%');
  push('');

  // B3 — Abbruch-Heatmap je level/subskill/mode
  push('— B3 ABBRUCH-HEATMAP (organik, trainer·level·subskill·mode) —');
  const hm = {};
  org.filter(s => s.cat.indexOf('abgebrochen') === 0 && s.lastQS).forEach(s => {
    const p = s.lastQS.payload || {};
    const k = _sk(s.trainer, p.level, p.subskill) + ' · ' + (p.mode || '?');
    hm[k] = (hm[k] || 0) + 1;
  });
  Object.keys(hm).sort((a, b) => hm[b] - hm[a]).forEach(k => push('  ' + k, hm[k]));
  if (!Object.keys(hm).length) push('  (keine Abbrüche)');
  push('');

  // B3-Detail — Abbruch-Position (questionIndex + msInQuiz aus quiz_abandon)
  // Hypothesen-Trennung Klassenraum-Hopping (Q0, <10s) vs. Eingabe-Hürde
  // (Q0-1, 10-30s, konzentriert auf DT/NT) vs. Bug-Frust (Q2+, >30s).
  push('— B3-DETAIL ABBRUCH-POSITION (aus quiz_abandon, alle Segmente) —');
  const abPos = {};        // key → {q0, q1_3, q4_7, q8_plus, ms[]}
  sessions.forEach(s => {
    (s.qaAll || []).forEach(p => {
      if (!p) return;
      const k = _sk(s.trainer, p.level, p.subskill) + ' · ' + (p.mode || '?');
      const b = abPos[k] = abPos[k] || { q0: 0, q1_3: 0, q4_7: 0, q8_plus: 0, ms: [], seg: {} };
      const qi = Number(p.questionIndex) || 0;
      if (qi === 0) b.q0++;
      else if (qi <= 3) b.q1_3++;
      else if (qi <= 7) b.q4_7++;
      else b.q8_plus++;
      const m = Number(p.msInQuiz) || 0;
      if (m > 0) b.ms.push(m);
      const sg = s.segment || 'organik';
      b.seg[sg] = (b.seg[sg] || 0) + 1;
    });
  });
  const median = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const totalAbPos = (b) => b.q0 + b.q1_3 + b.q4_7 + b.q8_plus;
  const keys = Object.keys(abPos).sort((a, b) => totalAbPos(abPos[b]) - totalAbPos(abPos[a]));
  keys.forEach(k => {
    const b = abPos[k];
    const t = totalAbPos(b);
    const medMs = median(b.ms);
    const medSec = medMs !== null ? Math.round(medMs / 100) / 10 : '?';
    const segStr = Object.keys(b.seg).map(sg => sg + '=' + b.seg[sg]).join(', ');
    push('  ' + k, 'n=' + t + ' | Q0:' + b.q0 + ' Q1-3:' + b.q1_3 +
      ' Q4-7:' + b.q4_7 + ' Q8+:' + b.q8_plus + ' | med ' + medSec + 's | ' + segStr);
  });
  if (!keys.length) push('  (keine quiz_abandon-Events — Feature noch frisch oder Schüler bleiben dran)');
  push('');
  push('  Lesehilfe Q0 = Quiz gestartet, vor erster Antwort weg');
  push('  Lesehilfe Hypothesen', 'Q0 <10s: Klassenraum-Hopping | Q0-1 10-30s konz. DT/NT: Eingabe-Hürde | Q2+ >30s: Bug-Frust/Schwierigkeit');
  push('');

  // LERNKARTEN-VERWEILDAUER (aus card_dismiss) — mit Bucket-Aufschlüsselung
  // Pro Karte: Median + Bucket-Counts (weggeklickt <2s | kurz 2-5s | gelesen ≥5s).
  // Schwellen entsprechen PLAN_GF-Lernkartendauer §3 (Phase 1, ohne Kalibrierung).
  // Phase 2 (kartenspezifische Schwellen) wäre Erweiterung nach 2-4 Wochen Daten.
  const CD_SKIP_MS = 2000;    // < skip = "weggeklickt"
  const CD_SHORT_MS = 5000;   // skip ≤ x < short = "kurz gesehen"; ≥ short = "gelesen"
  push('— LERNKARTEN-VERWEILDAUER (aus card_dismiss, alle Segmente) —');
  const cdBuckets = {};   // nodeId → {pflicht: {ms[], skip, short, read}, freiwillig: {…}}
  sessions.forEach(s => {
    (s.cdAll || []).forEach(p => {
      if (!p) return;
      const k = (s.trainer || '?') + ' · ' + (p.nodeId || '?');
      const b = cdBuckets[k] = cdBuckets[k] || {
        pflicht: { ms: [], skip: 0, short: 0, read: 0 },
        freiwillig: { ms: [], skip: 0, short: 0, read: 0 }
      };
      const ms = Number(p.ms_visible) || 0;
      if (ms <= 0) return;
      const dest = p.fromStart ? b.pflicht : b.freiwillig;
      dest.ms.push(ms);
      if (ms < CD_SKIP_MS) dest.skip++;
      else if (ms < CD_SHORT_MS) dest.short++;
      else dest.read++;
    });
  });
  const cdKeys = Object.keys(cdBuckets).sort((a, b) => {
    const ta = cdBuckets[a].pflicht.ms.length + cdBuckets[a].freiwillig.ms.length;
    const tb = cdBuckets[b].pflicht.ms.length + cdBuckets[b].freiwillig.ms.length;
    return tb - ta;
  });
  cdKeys.forEach(k => {
    const b = cdBuckets[k];
    const fmt = (d) => {
      if (!d.ms.length) return '–';
      const m = median(d.ms);
      return Math.round(m / 100) / 10 + 's | weggekl. ' + d.skip + ' / kurz ' + d.short + ' / gelesen ' + d.read + ' (n=' + d.ms.length + ')';
    };
    push('  ' + k + ' · Pflicht', fmt(b.pflicht));
    if (b.freiwillig.ms.length) push('  ' + k + ' · freiwillig', fmt(b.freiwillig));
  });
  if (!cdKeys.length) push('  (keine card_dismiss-Events — Feature noch frisch)');
  push('');
  push('  Lesehilfe Schwellen', 'weggeklickt <2s | kurz 2-5s | gelesen ≥5s (vgl. PLAN_GF-Lernkartendauer §3)');
  push('  Lesehilfe Modus', 'Pflicht = Modal vor Quiz-Start; freiwillig = manuell im Skilltree');
  push('');

  // LERNKARTEN-DIAGNOSE — „kurz gesehen" × Quiz-Erfolg (Hypothesen-Trennung)
  // 2-5s auf Karte + danach Quiz: Mastery → „kannte es schon"; <80% → „überfordert/abgesprungen".
  // Korreliert pro Session: card_dismiss(fromStart=true) → folgendes quiz_complete für denselben subskill.
  // (PLAN_GF-Lernkartendauer §3a: Trennung der zwei Sub-Ursachen.)
  push('— LERNKARTEN-DIAGNOSE „kurz gesehen" × Quiz-Erfolg (organik+klassenraum) —');
  const diag = {};   // key → {n, mastery, ueberfordert}
  sessions.forEach(s => {
    const ev = s.evAll || [];
    // Pro card_dismiss(fromStart=true, 2-5s): finde nächsten quiz_complete im selben subskill
    ev.forEach((e, i) => {
      if (e.eventType !== 'card_dismiss') return;
      const p = e.payload || {};
      if (!p.fromStart) return;
      const ms = Number(p.ms_visible) || 0;
      if (ms < CD_SKIP_MS || ms >= CD_SHORT_MS) return;  // nur Bucket „kurz gesehen"
      const sub = p.nodeId;
      // Finde nächstes quiz_complete in dieser Session mit subskill == sub
      let next = null;
      for (let j = i + 1; j < ev.length; j++) {
        if (ev[j].eventType === 'quiz_complete' && (ev[j].payload || {}).subskill === sub) {
          next = ev[j].payload;
          break;
        }
      }
      if (!next) return;
      const k = (s.trainer || '?') + ' · ' + sub;
      const d = diag[k] = diag[k] || { n: 0, mastery: 0, ueberfordert: 0 };
      d.n++;
      const pct = Number(next.pct) || 0;
      if (pct >= 80) d.mastery++;
      else d.ueberfordert++;
    });
  });
  const dKeys = Object.keys(diag).sort((a, b) => diag[b].n - diag[a].n);
  dKeys.forEach(k => {
    const d = diag[k];
    push('  ' + k, 'n=' + d.n + ' | kannte es schon (≥80%): ' + d.mastery + ' | überfordert (<80%): ' + d.ueberfordert);
  });
  if (!dKeys.length) push('  (keine „kurz gesehen"-Korrelationen verfügbar — Bucket leer oder kein anschließendes Quiz)');
  push('');
  push('  Lesehilfe', 'Hoher Mastery-Anteil = Karte vermutlich zu lang/redundant. Hoher Überfordert-Anteil = Karte muss verständlicher.');
  push('');

  // Engagement-Tiefe (Abschließer organik)
  const comp = org.filter(s => s.cat === 'abgeschlossen' && s.qc);
  const avg = (f) => comp.length ? Math.round(comp.reduce((a, s) => a + (Number(f(s)) || 0), 0) / comp.length * 10) / 10 : null;
  push('— ENGAGEMENT-TIEFE (Abschließer organik) —');
  push('  n', comp.length);
  push('  Ø Dauer engaged (min)', comp.length ? Math.round(comp.reduce((a, s) => a + s.durEng, 0) / comp.length / 6000) / 10 : '');
  push('  Ø Fragen', avg(s => s.qc.answered));
  push('  Ø Erfolg %', avg(s => s.qc.pct));
  push('  Ø Retry', avg(s => s.qc.retryCount));
  push('');

  // ── DESKRIPTIVE NUTZUNGS-SICHTEN (organik) ──────────────────────────
  // Aus Events-Envelope (ts/device/referrer) rekonstruiert — Daten lagen
  // schon vor, nur die Sicht fehlte (ersetzt Alt-Dashboard #1/#2/#4/#8).
  // Rein deskriptiv, KEINE Verhaltens-Schlüsse; gleiches Daten-Gate (unten).

  // #1 — Nutzung pro ISO-Woche je Trainer (organik)
  push('— NUTZUNG PRO ISO-WOCHE (organik, Sessions) —');
  const trAll = {};
  org.forEach(s => { trAll[s.trainer || '?'] = true; });
  const trCols = Object.keys(trAll).sort();
  const wk = {};
  org.forEach(s => {
    const w = _isoWeek(s.t0);
    wk[w] = wk[w] || { _n: 0 };
    wk[w]._n++;
    wk[w][s.trainer || '?'] = (wk[w][s.trainer || '?'] || 0) + 1;
  });
  Object.keys(wk).sort().forEach(w => {
    const bd = trCols.map(t => t + ' ' + (wk[w][t] || 0)).join('  ');
    push('  ' + w, 'gesamt ' + wk[w]._n + '  ·  ' + bd);
  });
  if (!Object.keys(wk).length) push('  (keine Sessions)');
  push('');

  // #2 — Geräteverteilung (organik)
  push('— GERÄTEVERTEILUNG (organik, Sessions) —');
  const dev = {};
  org.forEach(s => { const d = s.device || '?'; dev[d] = (dev[d] || 0) + 1; });
  ['desktop', 'tablet', 'mobile'].concat(
    Object.keys(dev).filter(d => ['desktop', 'tablet', 'mobile'].indexOf(d) < 0)
  ).forEach(d => {
    if (dev[d]) push('  ' + d, dev[d] + ' (' + _pct(dev[d], org.length) + '%)');
  });
  push('');

  // #4 — Peak-Nutzungszeiten (organik, Tagesstunde, Script-Zeitzone)
  const _tz = Session.getScriptTimeZone();
  push('— PEAK-NUTZUNGSZEITEN (organik, Stunde, TZ ' + _tz + ') —');
  const hrC = {};
  org.forEach(s => {
    const h = Number(Utilities.formatDate(new Date(s.t0), _tz, 'H'));
    hrC[h] = (hrC[h] || 0) + 1;
  });
  const hrMax = Object.keys(hrC).reduce((m, h) => Math.max(m, hrC[h]), 0);
  let peakH = null;
  for (let h = 0; h < 24; h++) {
    if (!hrC[h]) continue;
    if (peakH === null || hrC[h] > hrC[peakH]) peakH = h;
    const bar = hrMax ? '█'.repeat(Math.max(1, Math.round(hrC[h] / hrMax * 24))) : '';
    push('  ' + ('0' + h).slice(-2) + ' Uhr', hrC[h] + '  ' + bar);
  }
  if (peakH === null) push('  (keine Sessions)');
  else push('  → Peak', ('0' + peakH).slice(-2) + ' Uhr (' + hrC[peakH] + ')');
  push('');

  // #8 — Traffic-Quellen (organik, Referrer/UTM normalisiert)
  push('— TRAFFIC-QUELLEN (organik, Sessions) —');
  const ref = {};
  org.forEach(s => { const k = _refNorm(s.referrer); ref[k] = (ref[k] || 0) + 1; });
  Object.keys(ref).sort((a, b) => ref[b] - ref[a]).slice(0, 12).forEach(k => {
    push('  ' + k, ref[k] + ' (' + _pct(ref[k], org.length) + '%)');
  });
  if (!Object.keys(ref).length) push('  (keine Sessions)');
  push('');

  // Validitäts-Checks (§5)
  push('— VALIDITÄT —');
  const nPV = sessions.length;
  const nQS = sessions.filter(s => s.hasQS).length;
  const nQC = sessions.filter(s => s.hasQC).length;
  push('  Funnel-Monotonie (QC≤QS≤PV)', (nQC <= nQS && nQS <= nPV) ? 'OK (' + nQC + '≤' + nQS + '≤' + nPV + ')' : 'VERLETZT!');
  const dEng = comp.length ? comp.reduce((a, s) => a + s.durEng, 0) / comp.length / 60000 : null;
  push('  Ø Dauer-Plausibilität 3–10min', dEng === null ? 'k.A.' : (dEng >= 3 && dEng <= 10 ? 'OK (' + (Math.round(dEng * 10) / 10) + ')' : 'AUSSERHALB (' + (Math.round(dEng * 10) / 10) + ')'));
  const spanDays = sessions.length ? (Math.max.apply(null, sessions.map(s => s.t0)) - Math.min.apply(null, sessions.map(s => s.t0))) / 86400000 : 0;
  const gate = org.length >= CFG.MIN_ORGANIK_SESSIONS && spanDays >= CFG.MIN_SPAN_DAYS;
  push('  Mindest-Datenmenge', gate ? 'ERREICHT' : 'NOCH NICHT AUSSAGEKRÄFTIG (' + org.length + ' organik / ' + (Math.round(spanDays * 10) / 10) + ' Tage)');
  push('  Hinweis', gate ? 'Zahlen interpretierbar' : 'nur Pipeline-Sanity, KEINE Verhaltens-Schlüsse');

  // Schreiben
  const ss = _ss();
  let tab = ss.getSheetByName('Events_Analyse');
  if (!tab) tab = ss.insertSheet('Events_Analyse');
  tab.clearContents();
  tab.getRange(1, 1, out.length, 2).setValues(out);

  // GF_Analyse (Pfad B: Lernforschung aus dims/patterns abgeschlossener Quizze)
  const gfOut = _buildGF(sessions);
  let gtab = ss.getSheetByName('GF_Analyse');
  if (!gtab) gtab = ss.insertSheet('GF_Analyse');
  gtab.clearContents();
  gtab.getRange(1, 1, gfOut.length, 2).setValues(gfOut);

  // Schulsession_Analyse (Schulstunden-Marker → kontextualisierte Mini-Auswertung)
  const schOut = _buildSchoolSession(sessions);
  let stab = ss.getSheetByName('Schulsession_Analyse');
  if (!stab) stab = ss.insertSheet('Schulsession_Analyse');
  stab.clearContents();
  if (schOut.length) stab.getRange(1, 1, schOut.length, 2).setValues(schOut);

  // Daily_Aggregates: pro Tag ein eingefrorener Aggregat-Snapshot.
  // Heute + gestern bleiben fluide (werden bei jedem Lauf überschrieben),
  // alles davor wird einmalig geschrieben und nie wieder angefasst.
  // Voraussetzung für den Heartbeat-Cleanup-Trigger (nach >30 Tagen).
  _runDailyAggregates(sessions);
}

/** GF_Analyse: Schwäche-Matrix, Schwierigkeitsprofil, Muster, Korrelation,
 *  Synthese dims↔Abbruch. Nur abgeschlossene Quizze MIT dims (kein
 *  Tastatur/Profi, kein dev). Survivorship-Bias bewusst → B3-Quervergleich. */
function _buildGF(sessions) {
  const o = [];
  const p = (a, b) => o.push([a, b === undefined ? '' : b]);
  // Dims dynamisch je Trainer aus den qc.dims-Keys (keine hartkodierte Liste)
  const dimsOf = q => (q && q.dims && typeof q.dims === 'object') ? Object.keys(q.dims) : [];
  const has = (q, d) => { const x = q.dims && q.dims[d]; return x && x.total > 0; };
  const weak = (q, d) => { const x = q.dims && q.dims[d]; return x && x.total > 0 && (x.correct / x.total) < 0.5; };

  // ALLE quiz_complete je abgeschlossener Session (nicht nur das letzte) —
  // jedes Quiz ist ein eigener Lern-Datenpunkt. comp-Elemente {trainer, qc}.
  const comp = [];
  sessions.forEach(s => {
    if (s.cat !== 'abgeschlossen') return;
    const list = (s.qcAll && s.qcAll.length) ? s.qcAll : (s.qc ? [s.qc] : []);
    list.forEach(q => {
      if (q && q.dims && typeof q.dims === 'object') comp.push({ trainer: s.trainer, qc: q });
    });
  });
  const aborts = sessions.filter(s => String(s.cat).indexOf('abgebrochen') === 0 && s.lastQS);

  p('MUSIKTRAINER — GF_ANALYSE (Pfad B: Lernforschung)');
  p('Generiert', new Date().toISOString());
  p('Abgeschlossene Quizze mit dims', comp.length);
  p('Hinweis', 'Survivorship-Bias: nur Abschließer. Schwächste brachen ab → Synthese (5) + B3 mitlesen.');
  p('Hinweis lagen', 'in Prod best-effort (qsOctaveCorrect) → niedrigere Konfidenz');
  p('');

  // 1. Schwäche-Matrix: trainer·level·subskill·mode × dim, gepoolt Σc/Σt
  p('— 1. SCHWÄCHE-MATRIX (trainer·level·subskill·mode, gepoolt Σc/Σt, N) —');
  const cell = {};
  const ovr = {};                       // Gesamt-Erfolg je Subskill (x/10), dim-unabhängig
  comp.forEach(s => {
    const q = s.qc;
    const key = _sk(s.trainer, q.level, q.subskill) + ' · ' + (q.mode || '?');
    const o = ovr[key] = ovr[key] || { c: 0, t: 0, n: 0 };
    const ans = Number(q.answered) || 0, cor = Number(q.correct) || 0;
    if (ans > 0) { o.c += cor; o.t += ans; o.n++; }
    cell[key] = cell[key] || {};
    dimsOf(q).forEach(d => {
      const dd = q.dims[d];
      if (dd && dd.total > 0) {
        const c = cell[key][d] = cell[key][d] || { c: 0, t: 0, n: 0 };
        c.c += dd.correct; c.t += dd.total; c.n++;
      }
    });
  });
  // Union aller Keys → auch Subskills ohne Dims (null/allzero) erscheinen mit GESAMT
  Object.keys(ovr).sort().forEach(k => {
    const o = ovr[k];
    const of = o.n < 20 ? ' ⚠ N<20' : '';
    p('  ' + k + ' | GESAMT (x/10)', o.c + '/' + o.t + ' (' + _pct(o.c, o.t) + '%) N=' + o.n + of);
    Object.keys(cell[k] || {}).sort().forEach(d => {
      const c = cell[k][d];
      const flag = c.n < 20 ? ' ⚠ N<20' : '';
      const lg = d === 'lagen' ? ' (~)' : '';
      p('    ↳ ' + d + lg, c.c + '/' + c.t + ' (' + _pct(c.c, c.t) + '%) N=' + c.n + flag);
    });
  });
  if (!Object.keys(ovr).length) p('  (keine Daten)');
  p('');

  // 2. Schwierigkeits-Profil je Trainer × Dimension (Quiz-%-Verteilung)
  p('— 2. SCHWIERIGKEITS-PROFIL je Trainer × Dimension —');
  const prof = {};
  comp.forEach(s => {
    dimsOf(s.qc).forEach(d => {
      const dd = s.qc.dims[d];
      if (dd && dd.total > 0) {
        const k = (s.trainer || '?') + ' | ' + d;
        const b = prof[k] = prof[k] || { lo: 0, mid: 0, hi: 0, n: 0 };
        const pc = dd.correct / dd.total * 100;
        if (pc < 50) b.lo++; else if (pc < 80) b.mid++; else b.hi++;
        b.n++;
      }
    });
  });
  Object.keys(prof).sort().forEach(k => {
    const b = prof[k];
    const lg = k.indexOf('| lagen') >= 0 ? ' (~)' : '';
    p('  ' + k + lg, '<50%: ' + _pct(b.lo, b.n) + '% | 50–80%: ' + _pct(b.mid, b.n) +
      '% | ≥80%: ' + _pct(b.hi, b.n) + '% (N=' + b.n + ')');
  });
  if (!Object.keys(prof).length) p('  (keine Daten)');
  p('');

  // 3. Muster-Häufigkeit + Kontext (Nenner: alle comp; exakte Eignung
  //    bräuchte Per-Antwort-Daten = bewusst nicht erhoben)
  p('— 3. MUSTER-HÄUFIGKEIT (von ' + comp.length + ' Quizzen) —');
  const pat = {}, patCtx = {};
  comp.forEach(s => {
    (s.qc.patterns || []).forEach(t => {
      pat[t] = (pat[t] || 0) + 1;
      const ck = _sk(s.trainer, s.qc.level, s.qc.subskill);
      patCtx[t] = patCtx[t] || {};
      patCtx[t][ck] = (patCtx[t][ck] || 0) + 1;
    });
  });
  if (!Object.keys(pat).length) p('  (keine Muster erkannt)');
  Object.keys(pat).sort((a, b) => pat[b] - pat[a]).forEach(t => {
    p('  ' + t, pat[t] + 'x (' + _pct(pat[t], comp.length) + '% der Quizze)');
    const ctx = Object.keys(patCtx[t]).sort((a, b) => patCtx[t][b] - patCtx[t][a])
      .slice(0, 4).map(k => k + ':' + patCtx[t][k]).join('  ');
    p('    Kontext', ctx);
  });
  p('');

  // 4. Schwäche-Korrelation je Trainer (schwach = Dim-% < 50, beide total>0).
  //    Dim-Paare dynamisch aus den real beobachteten Dims des Trainers.
  p('— 4. SCHWÄCHE-KORRELATION je Trainer P(Y schwach | X schwach) —');
  const trDims = {};
  comp.forEach(s => {
    const tn = s.trainer || '?';
    trDims[tn] = trDims[tn] || {};
    dimsOf(s.qc).forEach(d => { trDims[tn][d] = true; });
  });
  let corrAny = false;
  Object.keys(trDims).sort().forEach(tn => {
    const ds = Object.keys(trDims[tn]).sort();
    const tc = comp.filter(s => (s.trainer || '?') === tn);
    ds.forEach(x => ds.forEach(y => {
      if (x === y) return;
      let xw = 0, both = 0;
      tc.forEach(s => {
        if (has(s.qc, x) && has(s.qc, y) && weak(s.qc, x)) {
          xw++; if (weak(s.qc, y)) both++;
        }
      });
      if (xw > 0) { p('  ' + tn + ': ' + x + ' → ' + y, _pct(both, xw) + '% (N=' + xw + ')'); corrAny = true; }
    }));
  });
  if (!corrAny) p('  (keine Daten)');
  p('');

  // 5. Synthese dims↔Abbruch (gleiche trainer·level·subskill-Achse)
  p('— 5. SYNTHESE: Schwäche (Abschließer) ↔ Abbruch (Strugglerde) —');
  const synth = {};
  comp.forEach(s => {
    const k = _sk(s.trainer, s.qc.level, s.qc.subskill);
    synth[k] = synth[k] || { compW: 0, compN: 0, abort: 0 };
    synth[k].compN++;
    if (dimsOf(s.qc).some(d => weak(s.qc, d))) synth[k].compW++;
  });
  aborts.forEach(s => {
    const q = s.lastQS.payload || {};
    const k = _sk(s.trainer, q.level, q.subskill);
    synth[k] = synth[k] || { compW: 0, compN: 0, abort: 0 };
    synth[k].abort++;
  });
  Object.keys(synth).sort().forEach(k => {
    const v = synth[k];
    const wk = v.compN ? _pct(v.compW, v.compN) + '%' : 'n/a';
    p('  ' + k, 'schwach ' + wk + ' (N=' + v.compN + ') | Abbrüche: ' + v.abort);
  });
  p('');

  p('— VALIDITÄT —');
  const gate = comp.length >= 50;
  p('  Mindest-Datenmenge (≥50 Quizze m. dims)', gate
    ? 'ERREICHT' : 'NOCH NICHT (' + comp.length + ') → nur Sanity, keine GF-Rekalibrierung');
  p('  Zellen N<20', 'als ⚠ markiert — nicht interpretieren');
  p('  Lesart', 'dims = nur Abschließer; Schwächste über Abbruch (5) + B3 in Events_Analyse');
  return o;
}

/** Schulsession_Analyse: pro Marker-Fenster (Klasse · Start · End)
 *  kontextualisierte Mini-Auswertung — Klassifikation, Trainer-Split,
 *  Abbruch-Heatmap, GF-Schwächen (nur N≥3). Drittverkehr im Fenster wird
 *  transparent mitgezählt; Klassenraum-Burst-Heuristik (segment) wird als
 *  Indiz reportet. */
function _buildSchoolSession(sessions) {
  const o = [];
  const p = (a, b) => o.push([a, b === undefined ? '' : b]);
  const fmt = ms => Utilities.formatDate(new Date(ms),
    Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  // Test-Marker mit Klasse beginnend mit "test"/"TEST" werden bewusst
  // ausgeschlossen (Pipeline-Tests, Sanity-Checks). Sie bleiben im Sheet
  // sichtbar, fließen aber nicht in die Auswertung ein.
  const raw = _loadSchoolSessions();
  const windows = raw.filter(function (w) { return !/^test/i.test(w.klass); });
  const excluded = raw.length - windows.length;
  p('MUSIKTRAINER — SCHULSESSION-AUSWERTUNG');
  p('Generiert', new Date().toISOString());
  p('Marker-Fenster gesamt', windows.length);
  if (excluded) p('  davon Test-Marker ausgeschlossen (Klasse mit „test"-Präfix)', excluded);
  p('');

  if (!windows.length) {
    p('(noch keine Schulsession-Marker im Sheet "School_Sessions")');
    p('Wie nutzen', 'admin.html → Klasse eingeben → 🟢 Start.');
    return o;
  }

  const CATS = ['abgeschlossen', 'abgebrochen_aktiv', 'abgebrochen_unterbrochen',
    'phantom_preview', 'sofort_absprung', 'idle_offen', 'erkundet_ohne_quiz'];

  windows.forEach(function (w, idx) {
    const endLabel = w.end ? fmt(w.end) : 'läuft noch';
    const tag = w.autoEnd ? ' (auto_end_90min)' : '';
    p('— SESSION ' + (idx + 1) + ': ' + w.klass + ' (' + fmt(w.start) + ' – ' + endLabel + ')' + tag + ' —');

    // Sessions im Fenster: t0 fällt in [start, end] (end=null → bis jetzt)
    const inWin = sessions.filter(function (s) {
      if (s.t0 < w.start) return false;
      if (w.end && s.t0 > w.end) return false;
      return true;
    });
    const klassenraum = inWin.filter(function (s) { return s.segment === 'klassenraum'; });
    const organik = inWin.filter(function (s) { return s.segment === 'organik'; });

    p('  Sessions im Fenster', inWin.length);
    p('    davon Klassenraum-Burst-detektiert', klassenraum.length + ' (' + _pct(klassenraum.length, inWin.length) + '%)');
    p('    davon übrige (mögl. Drittverkehr)', organik.length + ' (' + _pct(organik.length, inWin.length) + '%)');

    if (!inWin.length) {
      p('  Hinweis', 'Keine Sessions in diesem Fenster geloggt.');
      p('');
      return;
    }

    // Klassifikation (über alle inWin-Sessions, nicht nur klassenraum)
    p('  — Klassifikation —');
    CATS.forEach(function (c) {
      const n = inWin.filter(function (s) { return s.cat === c; }).length;
      if (n) p('    ' + c, n + ' (' + _pct(n, inWin.length) + '%)');
    });

    // Pro Trainer
    p('  — Pro Trainer —');
    const trn = {};
    inWin.forEach(function (s) { trn[s.trainer || '?'] = (trn[s.trainer || '?'] || 0) + 1; });
    Object.keys(trn).sort(function (a, b) { return trn[b] - trn[a]; }).forEach(function (t) {
      const tList = inWin.filter(function (s) { return (s.trainer || '?') === t; });
      const tDone = tList.filter(function (s) { return s.cat === 'abgeschlossen'; }).length;
      const tAb = tList.filter(function (s) { return s.cat.indexOf('abgebrochen') === 0; }).length;
      p('    ' + t, 'n=' + tList.length + ' | abgeschl. ' + tDone +
        ' | abgebr. ' + tAb + ' | Abschluss ' + _pct(tDone, tDone + tAb) + '%');
    });

    // Abbruch-Heatmap (Top 8)
    const hm = {};
    inWin.filter(function (s) { return s.cat.indexOf('abgebrochen') === 0 && s.lastQS; })
      .forEach(function (s) {
        const pl = s.lastQS.payload || {};
        const k = _sk(s.trainer, pl.level, pl.subskill) + ' · ' + (pl.mode || '?');
        hm[k] = (hm[k] || 0) + 1;
      });
    const hmKeys = Object.keys(hm).sort(function (a, b) { return hm[b] - hm[a]; });
    if (hmKeys.length) {
      p('  — Abbruch-Heatmap (Top 8) —');
      hmKeys.slice(0, 8).forEach(function (k) { p('    ' + k, hm[k]); });
    }

    // GF-Schwächen aus dims (nur N≥3, gepoolt über alle qc_complete im Fenster)
    const qcInWin = [];
    inWin.forEach(function (s) {
      if (s.cat !== 'abgeschlossen' || !s.qcAll) return;
      s.qcAll.forEach(function (q) { qcInWin.push({ trainer: s.trainer, q: q }); });
    });
    const dimAgg = {}; // key: trainer|dim → { c, t, n }
    qcInWin.forEach(function (x) {
      const q = x.q;
      if (!q || !q.dims) return;
      Object.keys(q.dims).forEach(function (d) {
        const dd = q.dims[d];
        if (!dd || !dd.total) return;
        const k = x.trainer + ' | ' + d;
        if (!dimAgg[k]) dimAgg[k] = { c: 0, t: 0, n: 0 };
        dimAgg[k].c += dd.correct; dimAgg[k].t += dd.total; dimAgg[k].n++;
      });
    });
    const dimKeys = Object.keys(dimAgg).filter(function (k) { return dimAgg[k].n >= 3; })
      .sort(function (a, b) { return (dimAgg[a].c / dimAgg[a].t) - (dimAgg[b].c / dimAgg[b].t); });
    if (dimKeys.length) {
      p('  — GF-Schwächen im Fenster (Σc/Σt, nur N≥3 Quizze) —');
      dimKeys.slice(0, 8).forEach(function (k) {
        const a = dimAgg[k];
        p('    ' + k, a.c + '/' + a.t + ' (' + _pct(a.c, a.t) + '%) N=' + a.n);
      });
    }

    // Engagement (Abschließer im Fenster)
    const comp = inWin.filter(function (s) { return s.cat === 'abgeschlossen' && s.qc; });
    if (comp.length) {
      const avg = function (f) {
        return Math.round(comp.reduce(function (a, s) { return a + (Number(f(s)) || 0); }, 0) / comp.length * 10) / 10;
      };
      p('  — Engagement (Abschließer im Fenster) —');
      p('    n', comp.length);
      p('    Ø Dauer engaged (min)', Math.round(comp.reduce(function (a, s) { return a + s.durEng; }, 0) / comp.length / 6000) / 10);
      p('    Ø Fragen', avg(function (s) { return s.qc.answered; }));
      p('    Ø Erfolg %', avg(function (s) { return s.qc.pct; }));
    }
    p('');
  });

  // Vergleichs-Header über alle Schulsessions
  p('— VERGLEICH ÜBER ALLE SCHULSESSIONS —');
  const totals = { sessions: 0, done: 0, abbruch: 0 };
  windows.forEach(function (w) {
    const inWin = sessions.filter(function (s) {
      if (s.t0 < w.start) return false;
      if (w.end && s.t0 > w.end) return false;
      return true;
    });
    totals.sessions += inWin.length;
    totals.done += inWin.filter(function (s) { return s.cat === 'abgeschlossen'; }).length;
    totals.abbruch += inWin.filter(function (s) { return s.cat.indexOf('abgebrochen') === 0; }).length;
  });
  p('  Sessions in Marker-Fenstern (Summe)', totals.sessions);
  p('  Abschluss-Rate (über alle Schulsessions)', _pct(totals.done, totals.done + totals.abbruch) + '%');
  p('');
  p('  Hinweis', 'Drittverkehr im Fenster wird mitgezählt; siehe Klassenraum-Burst-Anteil je Fenster für Plausibilität.');

  return o;
}

/** Einmalig: täglichen Trigger 03:00 installieren */
function installAnalyseTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runAnalyse') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runAnalyse').timeBased().everyDays(1).atHour(3).create();
}

// =====================================================================
// DAILY_AGGREGATES — pro Tag ein eingefrorener Aggregat-Snapshot
// =====================================================================
// Design:
//  - "heute" + "gestern" (Script-Zeitzone) sind fluide → werden bei jedem
//    runAnalyse-Lauf überschrieben (Events können verspätet eintrudeln).
//  - "vorgestern" und älter sind immutable → frozen=yes, werden nie wieder
//    geschrieben. Ermöglicht Heartbeat-Cleanup nach 30 Tagen ohne Verlust
//    der historischen Klassifikation (PLAN_Auswertung §2a).
//  - Generator-Lauf-Performance: nur 2 fluide Tage werden je Lauf neu
//    geschrieben + neue Tage zwischen letztem Run und gestern.
//
// Spalten in Daily_Aggregates:
//  date | frozen | sessions_total | sessions_organik | sessions_klassenraum
//  cat_abgeschlossen | cat_abgebrochen_aktiv | cat_abgebrochen_unterbrochen
//  cat_phantom_preview | cat_sofort_absprung | cat_idle_offen
//  cat_erkundet_ohne_quiz
//  n_quiz_start | n_quiz_complete | n_quiz_abandon | n_landing_click
//  devices_desktop | devices_tablet | devices_mobile | devices_other
//  top_trainer | top_trainer_n
//  median_dur_engaged_s | median_quizzes_per_active

const DAILY_HEADERS = ['date', 'frozen', 'sessions_total', 'sessions_organik',
  'sessions_klassenraum', 'cat_abgeschlossen', 'cat_abgebrochen_aktiv',
  'cat_abgebrochen_unterbrochen', 'cat_phantom_preview', 'cat_sofort_absprung',
  'cat_idle_offen', 'cat_erkundet_ohne_quiz', 'n_quiz_start', 'n_quiz_complete',
  'n_quiz_abandon', 'n_landing_click', 'devices_desktop', 'devices_tablet',
  'devices_mobile', 'devices_other', 'top_trainer', 'top_trainer_n',
  'median_dur_engaged_s', 'median_quizzes_per_active'];

function _runDailyAggregates(sessions) {
  const ss = _ss();
  let tab = ss.getSheetByName('Daily_Aggregates');
  const isNew = !tab;
  if (isNew) {
    tab = ss.insertSheet('Daily_Aggregates');
    tab.getRange(1, 1, 1, DAILY_HEADERS.length).setValues([DAILY_HEADERS]);
    tab.setFrozenRows(1);
  }

  // Bestehende Zeilen einlesen — ALLE Tage (auch fluide), nicht nur frozen.
  // Sonst werden fluide Zeilen beim nächsten Lauf nicht gefunden und appended
  // statt überschrieben (Duplikate). date → {row, frozen}.
  // Google Sheets konvertiert YYYY-MM-DD-Strings beim Schreiben automatisch
  // zu Date-Objekten → beim Lesen ggf. zurück-konvertieren.
  const existing = {};
  if (!isNew) {
    const vals = tab.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      const raw = vals[i][0];
      const date = (raw instanceof Date) ? _ymd(raw.getTime()) : String(raw || '');
      const isFrozen = String(vals[i][1] || '') === 'yes';
      if (date) existing[date] = { row: i + 1, frozen: isFrozen };
    }
  }

  // Heute + gestern (Script-Zeitzone) sind fluide
  const now = Date.now();
  const today = _ymd(now);
  const yesterday = _ymd(now - 86400000);
  const fluidDays = { [today]: true, [yesterday]: true };

  // Sessions auch zur direkten Quiz-Event-Zählung brauchen wir die ROHEN Events.
  // _loadSessions hat sie aggregiert weggeworfen — wir lesen separat noch mal.
  // (Zeitlich vertretbar: 1 zusätzlicher getValues-Call pro Lauf.)
  const evRows = _ss().getSheetByName('Events').getDataRange().getValues();
  const eventsByDate = {};
  for (let i = 1; i < evRows.length; i++) {
    const r = evRows[i];
    const ts = _toMs(r[0]);
    if (!ts) continue;
    if (String(r[2] || '') === 'dev') continue;
    if ((parseInt(r[1], 10) || 0) < 3) continue;
    const d = _ymd(ts);
    eventsByDate[d] = eventsByDate[d] || [];
    eventsByDate[d].push({ eventType: String(r[3] || ''), trainer: String(r[4] || ''), device: String(r[5] || '') });
  }

  // Sessions nach Tag bündeln
  const sessByDate = {};
  sessions.forEach(s => {
    const d = _ymd(s.t0);
    (sessByDate[d] = sessByDate[d] || []).push(s);
  });

  // Alle Tage, für die Daten existieren
  const allDays = {};
  Object.keys(sessByDate).forEach(d => allDays[d] = true);
  Object.keys(eventsByDate).forEach(d => allDays[d] = true);

  let frozenAdded = 0, fluidAdded = 0, fluidUpdated = 0, frozenTransitioned = 0;
  Object.keys(allDays).sort().forEach(d => {
    const isFluid = !!fluidDays[d];
    const ex = existing[d];
    // Bereits eingefroren und nicht mehr fluide → unverändert lassen
    if (ex && ex.frozen && !isFluid) return;

    const row = _dailyAggregateRow(d, sessByDate[d] || [], eventsByDate[d] || [], isFluid);

    if (ex) {
      // Bestehende Zeile überschreiben (war fluide, ist jetzt entweder fluide oder wird frozen)
      tab.getRange(ex.row, 1, 1, row.length).setValues([row]);
      if (isFluid) fluidUpdated++;
      else frozenTransitioned++;
    } else {
      // Neue Zeile anhängen — entweder erstmaliges Einfrieren oder neuer fluider Tag
      tab.appendRow(row);
      if (isFluid) fluidAdded++;
      else frozenAdded++;
    }
  });

  Logger.log('Daily_Aggregates: ' + frozenAdded + ' neue eingefrorene Tage, ' +
    frozenTransitioned + ' Tage von fluid → frozen, ' +
    fluidAdded + ' neue fluide Tage, ' + fluidUpdated + ' fluide Tage überschrieben');
}

// Einmalig manuell ausführen, um bestehende Duplikate im Daily_Aggregates-Tab
// zu bereinigen (Folge des fix vor dem existing-Map-Fix vom 24.05.2026).
// Behält pro Datum die spätere Zeile (= meist die mit aktuelleren Daten oder
// dem korrekten frozen=yes-Marker für vorgestern und älter).
function cleanupDailyAggregateDuplicates() {
  const ss = _ss();
  const tab = ss.getSheetByName('Daily_Aggregates');
  if (!tab) { Logger.log('Daily_Aggregates-Tab fehlt'); return; }
  const vals = tab.getDataRange().getValues();
  if (vals.length < 2) { Logger.log('Tab leer'); return; }
  const header = vals[0];
  // Pro Datum die LETZTE gefundene Zeile behalten (jüngere überschreibt ältere)
  const byDate = {};
  for (let i = 1; i < vals.length; i++) {
    const raw = vals[i][0];
    const date = (raw instanceof Date) ? _ymd(raw.getTime()) : String(raw || '');
    if (date) byDate[date] = vals[i];
  }
  const dedup = Object.keys(byDate).sort().map(d => byDate[d]);
  tab.clearContents();
  tab.getRange(1, 1, 1, header.length).setValues([header]);
  if (dedup.length) tab.getRange(2, 1, dedup.length, header.length).setValues(dedup);
  Logger.log('cleanupDailyAggregateDuplicates: ' + (vals.length - 1) + ' Zeilen → ' + dedup.length + ' (Duplikate entfernt: ' + (vals.length - 1 - dedup.length) + ')');
}

function _dailyAggregateRow(date, daySessions, dayEvents, isFluid) {
  const org = daySessions.filter(s => s.segment === 'organik');
  const kla = daySessions.filter(s => s.segment === 'klassenraum');
  const catN = (c) => daySessions.filter(s => s.cat === c).length;
  const evN = (t) => dayEvents.filter(e => e.eventType === t).length;
  const devN = (d) => dayEvents.filter(e => e.device === d).length;

  // Top-Trainer (über Events, nicht Sessions — robuster bei viele kurze)
  const trainers = {};
  dayEvents.forEach(e => {
    if (!e.trainer || e.trainer === 'Landing') return;
    trainers[e.trainer] = (trainers[e.trainer] || 0) + 1;
  });
  let topTr = '', topN = 0;
  Object.keys(trainers).forEach(t => {
    if (trainers[t] > topN) { topTr = t; topN = trainers[t]; }
  });

  // Median Engagement (Abschließer)
  const comp = daySessions.filter(s => s.cat === 'abgeschlossen');
  const median = (arr) => {
    if (!arr.length) return '';
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const medEng = median(comp.map(s => Math.round(s.durEng / 1000)));

  // Median Quizze pro aktive Session (Sessions mit ≥1 quiz_complete)
  const qcPerSess = daySessions.filter(s => s.hasQC).map(s => (s.qcAll || []).length);
  const medQc = median(qcPerSess);

  return [
    date, isFluid ? 'no' : 'yes',
    daySessions.length, org.length, kla.length,
    catN('abgeschlossen'), catN('abgebrochen_aktiv'),
    catN('abgebrochen_unterbrochen'), catN('phantom_preview'),
    catN('sofort_absprung'), catN('idle_offen'), catN('erkundet_ohne_quiz'),
    evN('quiz_start'), evN('quiz_complete'), evN('quiz_abandon'),
    evN('landing_click'),
    devN('desktop'), devN('tablet'), devN('mobile'),
    dayEvents.filter(e => ['desktop', 'tablet', 'mobile'].indexOf(e.device) < 0).length,
    topTr, topN,
    medEng, medQc
  ];
}
