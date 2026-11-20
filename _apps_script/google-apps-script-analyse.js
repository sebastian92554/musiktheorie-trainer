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

  // B3-HÄNGER — Woran blieb jemand hängen? (lastErr/lastErrIsLatest/errCount,
  // seit 09.10.2026 im quiz_abandon). Nur Abbrüche, deren zuletzt geloggte
  // Antwort falsch war = an genau dieser Aufgabe gescheitert. Häufen sich
  // dieselben Fehlerzeilen an derselben Fragenposition, ist das eher ein Bug
  // als Schwierigkeit (vgl. 7/8-Bug RT Frage 9/10).
  push('— B3-HÄNGER (quiz_abandon: an falscher Antwort gescheitert, alle Segmente) —');
  const stuck = {};        // key → {n, q[], err{}}
  let qaWithField = 0, qaStuck = 0;
  sessions.forEach(s => {
    (s.qaAll || []).forEach(p => {
      if (!p || !('lastErrIsLatest' in p)) return;   // ältere Events ohne Feld
      qaWithField++;
      if (p.lastErrIsLatest !== true) return;
      qaStuck++;
      const k = _sk(s.trainer, p.level, p.subskill) + ' · ' + (p.mode || '?');
      const b = stuck[k] = stuck[k] || { n: 0, q: [], err: {} };
      b.n++;
      b.q.push(Number(p.questionIndex) || 0);
      const e = p.lastErr || '(ohne Fehlerzeile — Bau-Modus)';
      b.err[e] = (b.err[e] || 0) + 1;
    });
  });
  push('  Abbrüche mit Fehler-Feldern', qaWithField);
  push('  davon an falscher Antwort gescheitert', qaStuck + (qaWithField ? ' (' + _pct(qaStuck, qaWithField) + '%)' : ''));
  const stuckKeys = Object.keys(stuck).sort((a, b) => stuck[b].n - stuck[a].n);
  stuckKeys.forEach(k => {
    const b = stuck[k];
    const qStr = b.q.slice().sort((x, y) => x - y).join(',');
    const topErr = Object.keys(b.err).sort((x, y) => b.err[y] - b.err[x]).slice(0, 3)
      .map(e => e + (b.err[e] > 1 ? ' (' + b.err[e] + 'x)' : '')).join('  ·  ');
    push('  ' + k, 'n=' + b.n + ' | Fragen: ' + qStr + ' | ' + topErr);
  });
  if (!stuckKeys.length) push('  (noch keine Daten — Felder seit 09.10.2026)');
  push('  Lesehilfe', 'Fragen = questionIndex je Abbruch. Gleiche Fehlerzeile mehrfach oder Häufung an einer festen Fragenposition → Code prüfen.');
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

  // SCHRITT 0 (seit 17.11.2026): Pflichtkarte vor der ersten Aufgabe im Fluss statt als Overlay,
  // mit Kontrollfrage. card_dismiss trägt dann step: true und tries (Versuche an der Kontrollfrage;
  // 0 = Schritt ohne Antwort verlassen, über „Zurücksetzen“ oder „Lernpfad“).
  // Liest der Schüler die Karte? Verweildauer-Buckets wie oben, dazu: erste Antwort richtig?
  push('— SCHRITT 0: Karte vor der ersten Aufgabe (card_dismiss mit step, alle Segmente) —');
  const stB = {};   // trainer · nodeId → {ms[], skip, short, read, t1, t2, t3, t0}
  const stTot = { step: { ms: [], skip: 0, short: 0, read: 0, t1: 0, t2: 0, t3: 0, t0: 0 }, overlay: { ms: [], skip: 0, short: 0, read: 0 } };
  sessions.forEach(s => {
    (s.cdAll || []).forEach(p => {
      if (!p || !p.fromStart) return;
      const ms = Number(p.ms_visible) || 0;
      if (ms <= 0) return;
      const bucket = d => { d.ms.push(ms); if (ms < CD_SKIP_MS) d.skip++; else if (ms < CD_SHORT_MS) d.short++; else d.read++; };
      if (!p.step) { bucket(stTot.overlay); return; }   // Pflicht-Overlay (vor dem Umbau) als Vergleich
      const k = (s.trainer || '?') + ' · ' + (p.nodeId || '?');
      const b = stB[k] = stB[k] || { ms: [], skip: 0, short: 0, read: 0, t1: 0, t2: 0, t3: 0, t0: 0 };
      [b, stTot.step].forEach(d => {
        bucket(d);
        const t = Number(p.tries) || 0;
        if (t === 0) d.t0++; else if (t === 1) d.t1++; else if (t === 2) d.t2++; else d.t3++;
      });
    });
  });
  const stFmt = d => {
    if (!d.ms.length) return '–';
    const m = median(d.ms);
    const n = d.ms.length;
    return Math.round(m / 100) / 10 + 's | weggekl. ' + d.skip + ' / kurz ' + d.short + ' / gelesen ' + d.read
      + ' | 1. Antwort richtig ' + _pct(d.t1, n) + '% · 2. ' + _pct(d.t2, n) + '% · 3+ ' + _pct(d.t3, n) + '% · ohne Antwort ' + _pct(d.t0, n) + '% (n=' + n + ')';
  };
  if (stTot.step.ms.length) {
    push('  Alle Trainer · Schritt 0', stFmt(stTot.step));
    if (stTot.overlay.ms.length) {
      const o = stTot.overlay, m = median(o.ms);
      push('  Vergleich · Pflicht-Overlay (vor dem Umbau)', Math.round(m / 100) / 10 + 's | weggekl. ' + o.skip + ' / kurz ' + o.short + ' / gelesen ' + o.read + ' (n=' + o.ms.length + ')');
    }
    Object.keys(stB).sort((a, b) => stB[b].ms.length - stB[a].ms.length).forEach(k => push('  ' + k, stFmt(stB[k])));
  } else push('  (noch keine card_dismiss mit step — Umbau vom 17.11.2026 noch nicht im Einsatz)');
  push('');
  push('  Lesehilfe', 'Schritt 0 gelesen ≥5s UND 1. Antwort richtig = Karte wirkt; weggeklickt <2s mit 1. Antwort richtig = Frage ohne Karte lösbar (zu leicht); viele 3+ = Frage unklar');
  push('');

  // HAUPTAKTION IM SKILLTREE (seit 17.11.2026): node_select trägt where = next (großer Knopf
  // „Hier geht's weiter“) oder row (Übungszeile im Baum); ohne where = Skilltree vor dem Umbau.
  push('— HAUPTAKTION IM SKILLTREE (node_select.where, alle Segmente) —');
  const whereB = {};   // trainer → {next, row, alt}
  sessions.forEach(s => {
    (s.evAll || []).forEach(e => {
      if (e.eventType !== 'node_select') return;
      const tr = e.trainer || s.trainer || '?';
      const w = whereB[tr] = whereB[tr] || { next: 0, row: 0, alt: 0 };
      const p = e.payload || {};
      if (p.where === 'next') w.next++; else if (p.where === 'row') w.row++; else w.alt++;
    });
  });
  const whereKeys = Object.keys(whereB).sort((a, b) => (whereB[b].next + whereB[b].row) - (whereB[a].next + whereB[a].row));
  let anyWhere = false;
  whereKeys.forEach(tr => {
    const w = whereB[tr], n = w.next + w.row;
    if (!n) return;
    anyWhere = true;
    push('  ' + tr, 'Hauptaktion ' + w.next + ' (' + _pct(w.next, n) + '%) · Übungszeile ' + w.row + ' (' + _pct(w.row, n) + '%)' + (w.alt ? ' · alter Baum ' + w.alt : ''));
  });
  if (!anyWhere) push('  (noch keine node_select mit where — neuer Skilltree noch nicht im Einsatz)');
  push('');
  push('  Lesehilfe', 'Hoher Anteil Hauptaktion = der Baum wird als Weg gelesen; hoher Anteil Übungszeile = Schüler wählen gezielt (Lehrer-Vorgabe „5a“) oder ignorieren den Knopf');
  push('');

  // WEGWEISER UND BLASEN (seit 18.11.2026): arrive = Ankunft im Skilltree über ?knoten= aus der Landing
  // (via chip = Themen-Chip, search = Suche/Kurzcode mit Übung); node_select.where = topic = Start über die
  // Karte „Dein Thema“. coach = Blase für Erstbesucher (key thema/hilfe/konto; phase shown bzw. dismiss mit
  // secs bis zum Tipp). Unter 1,5 s gilt als weggetippt, ohne gelesen zu haben (wie beim alten Overlay).
  push('— WEGWEISER UND BLASEN (arrive, coach, alle Segmente) —');
  const arrB = {};     // trainer → {chip:{n,start,topic}, search:{n,start,topic}}
  const coachB = {};   // key → {shown, dismiss, secs[]}
  sessions.forEach(s => {
    const ev = s.evAll || [];
    ev.forEach((e, i) => {
      if (e.eventType === 'arrive') {
        const tr = e.trainer || s.trainer || '?', p = e.payload || {};
        // seit 20.11.2026 auch start_landing (Startzeile der Landing) und start_stufe (Weiterleitung aus einem Trainer): die Übung startet sofort
        const via = p.via === 'search' ? 'search' : (String(p.via || '').indexOf('start_') === 0 ? 'start' : 'chip');
        const a = arrB[tr] = arrB[tr] || { chip: { n: 0, start: 0, topic: 0 }, search: { n: 0, start: 0, topic: 0 }, start: { n: 0, start: 0, topic: 0 } };
        a[via].n++;
        const rest = ev.slice(i + 1);
        if (rest.some(x => x.eventType === 'quiz_start')) a[via].start++;
        if (rest.some(x => x.eventType === 'node_select' && (x.payload || {}).where === 'topic')) a[via].topic++;
      } else if (e.eventType === 'coach') {
        const p = e.payload || {}, k = String(p.key || '?');
        const c = coachB[k] = coachB[k] || { shown: 0, dismiss: 0, secs: [] };
        if (p.phase === 'shown') c.shown++;
        else if (p.phase === 'dismiss') { c.dismiss++; if (p.secs != null && !isNaN(Number(p.secs))) c.secs.push(Number(p.secs)); }
      }
    });
  });
  let anyArr = false;
  Object.keys(arrB).sort().forEach(tr => {
    const a = arrB[tr];
    ['chip', 'search', 'start'].forEach(via => {
      const v = a[via]; if (!v || !v.n) return; anyArr = true;
      push('  ' + tr + ' · ' + (via === 'chip' ? 'Chip' : via === 'search' ? 'Suche/Kurzcode' : 'Start (Landing/Weiterleitung)'), v.n + ' Ankünfte · danach Übung gestartet ' + v.start + ' (' + _pct(v.start, v.n) + '%) · davon über „Dein Thema“ ' + v.topic);
    });
  });
  if (!anyArr) push('  (noch keine arrive — Wegweiser noch nicht im Einsatz)');
  const coachOrder = ['thema', 'hilfe', 'konto'];
  Object.keys(coachB).forEach(k => { if (coachOrder.indexOf(k) < 0) coachOrder.push(k); });
  let anyCoach = false;
  coachOrder.forEach(k => {
    const c = coachB[k]; if (!c || !c.shown) return; anyCoach = true;
    const secs = c.secs.slice().sort((x, y) => x - y);
    const med = secs.length ? (secs.length % 2 ? secs[(secs.length - 1) / 2] : (secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2) : null;
    const quick = secs.filter(x => x < 1.5).length;
    push('  Blase „' + k + '“', 'gezeigt ' + c.shown + ' · geschlossen ' + c.dismiss + (secs.length ? ' · Median ' + (Math.round(med * 10) / 10) + ' s · unter 1,5 s: ' + quick + ' (' + _pct(quick, secs.length) + '%)' : ''));
  });
  if (!anyCoach) push('  (noch keine coach-Events — Blasen noch nicht im Einsatz)');
  push('');
  push('  Lesehilfe', 'Ankünfte ohne Start = Chip war nur Orientierung (erlaubt); „Dein Thema“ hoch = die Karte trägt. Blase: Median unter 1,5 s = weggetippt wie das alte Overlay, dann Text oder Moment ändern');
  push('');

  // ANSICHTEN (seit 19.11.2026): view_switch = Reiter „Trainer | Stufen“ (Landing) bzw. „Themen | Stufen“ (Trainer),
  // payload.to = trainer/stufe. Frage: Schaltet überhaupt jemand auf „Stufen“, und wie oft folgt darauf ein Start?
  push('— ANSICHTEN (view_switch, alle Segmente) —');
  const vsB = {};   // trainer → {stufe:{n,start}, trainer:{n,start}}
  sessions.forEach(s => {
    const ev = s.evAll || [];
    ev.forEach((e, i) => {
      if (e.eventType !== 'view_switch') return;
      const tr = e.trainer || s.trainer || '?', to = (e.payload || {}).to === 'stufe' ? 'stufe' : 'trainer';
      const v = vsB[tr] = vsB[tr] || { stufe: { n: 0, start: 0 }, trainer: { n: 0, start: 0 } };
      v[to].n++;
      if (ev.slice(i + 1).some(x => x.eventType === 'quiz_start' || (x.eventType === 'landing_click' && (x.payload || {}).via === 'stufe'))) v[to].start++;
    });
  });
  let anyVs = false;
  Object.keys(vsB).sort().forEach(tr => {
    const v = vsB[tr]; anyVs = true;
    push('  ' + tr, 'auf „Stufen“ ' + v.stufe.n + ' (danach Start ' + v.stufe.start + ') · zurück auf Themen/Trainer ' + v.trainer.n);
  });
  if (!anyVs) push('  (noch keine view_switch — Reiter noch nicht im Einsatz)');
  push('');
  push('  Lesehilfe', 'Wenige Wechsel = der Reiter wird übersehen (dann Blase am Reiter erwägen); Wechsel ohne Start = Stufen werden nur zur Orientierung gelesen');
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

  // HILFE-NUDGE — ausgelöst vs. befolgt
  // Der Nudge feuert max. 1× pro Durchgang, ein help_nudge_followed ohne
  // vorheriges help_nudge kann es also nicht geben → Quote = followed/nudge.
  // Zwei Fragen: (1) Wie oft hängen Schüler überhaupt fest (Nudge-Quote je
  // quiz_start)? (2) Führt das Signal zur Hilfe (Befolgt-Quote)?
  // Alle Segmente, weil Klassenraum-Sessions hier das dichtere Signal liefern.
  push('— HILFE-NUDGE (help_nudge → help_nudge_followed, alle Segmente) —');
  const nudgeAgg = {};   // key → {n, followed, byTrigger:{retry:0, erstversuch:0}}
  let nudgeTotal = 0, nudgeFollowed = 0;
  const nudgeTrigger = { retry: 0, erstversuch: 0 };
  sessions.forEach(s => {
    (s.evAll || []).forEach(e => {
      if (e.eventType !== 'help_nudge' && e.eventType !== 'help_nudge_followed') return;
      const p = e.payload || {};
      const k = _sk(s.trainer, p.level, p.subskill);
      const a = nudgeAgg[k] = nudgeAgg[k] || { n: 0, followed: 0 };
      if (e.eventType === 'help_nudge') {
        a.n++; nudgeTotal++;
        const t = String(p.trigger || '');
        if (nudgeTrigger[t] !== undefined) nudgeTrigger[t]++;
      } else {
        a.followed++; nudgeFollowed++;
      }
    });
  });
  const nQuizStart = sessions.reduce((acc, s) =>
    acc + (s.evAll || []).filter(e => e.eventType === 'quiz_start').length, 0);
  push('  Nudges ausgelöst', nudgeTotal);
  push('  davon Hilfe geöffnet', nudgeFollowed + ' (' + _pct(nudgeFollowed, nudgeTotal) + '%)');
  push('  Nudge-Quote je Quiz-Start', _pct(nudgeTotal, nQuizStart) + '% (' + nudgeTotal + '/' + nQuizStart + ')');
  push('  Auslöser retry', nudgeTrigger.retry + ' (' + _pct(nudgeTrigger.retry, nudgeTotal) + '%)');
  push('  Auslöser erstversuch', nudgeTrigger.erstversuch + ' (' + _pct(nudgeTrigger.erstversuch, nudgeTotal) + '%)');
  push('');
  const nudgeKeys = Object.keys(nudgeAgg).sort((a, b) => nudgeAgg[b].n - nudgeAgg[a].n);
  nudgeKeys.forEach(k => {
    const a = nudgeAgg[k];
    if (!a.n) return;
    push('  ' + k, 'n=' + a.n + ' | befolgt ' + a.followed + ' (' + _pct(a.followed, a.n) + '%)');
  });
  if (!nudgeTotal) push('  (keine help_nudge-Events — Feature noch frisch oder Code.gs-Whitelist prüfen)');
  push('');
  push('  Lesehilfe Auslöser', 'retry = in derselben Aufgabe festgehangen; erstversuch = zwei Aufgaben nacheinander im Erstversuch falsch');
  push('  Lesehilfe Quote', 'Hohe Nudge-Quote = Subskill zu schwer oder Aufgabe unklar. Niedrige Befolgt-Quote = Signal wird übersehen oder Hilfe gilt als nutzlos.');
  push('  Hinweis', 'Seit 14.11.2026 ersetzt durch „Woran liegt es?“ (unten); hier nur noch Altdaten.');
  push('');

  // „WORAN LIEGT ES?“ — Selbsteinschätzung nach zwei Fehlversuchen (self_assess, seit 14.11.2026)
  // Ersetzt den Hilfe-Nudge (oben, bleibt nur für Altdaten). Phasen im payload:
  //   shown   = Feld erschienen (errors = die beiden beobachteten Fehlerarten)
  //   choice  = Vermutung gewählt (choice, observed, match = Vermutung passt zum Befund)
  //   open    = Hilfe bzw. Vergleich aufgeklappt (opened = Beschriftung)
  //   outcome = nächste Antwort danach (ok)
  //   end     = Endbildschirm unter 80 %: „Woran lag es?“ gewählt (choice, observed = häufigste
  //             Fehlerart, errors = {Fehlerart: Anzahl}, match; seit 14.11.2026, zuerst NT)
  // Ältere Events ohne phase stammen aus der Wahl → zählen als choice.
  // Fragen: Wo hängen Schüler (Fehlerarten)? Erkennen sie ihren Fehler selbst
  // (Trefferquote, Kegan-Brücke)? Wird das Feld genutzt (Antwortquote)? Hilft es (outcome)?
  push('— WORAN LIEGT ES? (self_assess, alle Segmente) —');
  const wq = {};            // key → {shown, choice, matchT, matchF, klick, weiss, outOk, outN}
  const wqErr = {};         // Fehlerart → Anzahl (aus shown)
  const wqOpen = {};        // aufgeklappte Hilfe → Anzahl
  const WQ0 = () => ({ shown: 0, choice: 0, matchT: 0, matchF: 0, klick: 0, weiss: 0, outOk: 0, outN: 0 });
  const wqAll = WQ0();
  const wqEnd = {};         // Trainer → {failed, n, matchT, matchF, weiss, obs: {Fehlerart: Anzahl}}
  sessions.forEach(s => {
    (s.evAll || []).forEach(e => {
      // Nicht bestandene Quizze = Gelegenheiten für die Endbildschirm-Frage
      if (e.eventType === 'quiz_complete' && (e.payload || {}).pct != null && e.payload.pct < 80) {
        const t = wqEnd[s.trainer] = wqEnd[s.trainer] || { failed: 0, n: 0, matchT: 0, matchF: 0, weiss: 0, obs: {} };
        t.failed++;
      }
      if (e.eventType !== 'self_assess') return;
      const p = e.payload || {};
      const ph = p.phase || (p.opened ? 'open' : 'choice');
      if (ph === 'end') {
        const t = wqEnd[s.trainer] = wqEnd[s.trainer] || { failed: 0, n: 0, matchT: 0, matchF: 0, weiss: 0, klick: 0, multi: 0, obs: {} };
        t.n++;
        if (p.match === true) t.matchT++;
        if (p.match === false) t.matchF++;
        // Mehrfachwahl: choice = Vermutungen mit Komma; „weiss“ steht immer allein
        const ch = String(p.choice || '').split(',');
        if (ch[0] === 'weiss') t.weiss++;
        if (ch.includes('klick')) t.klick = (t.klick || 0) + 1;
        if (ch.length > 1) t.multi = (t.multi || 0) + 1;
        Object.keys(p.errors || {}).forEach(k => { t.obs[k] = (t.obs[k] || 0) + (p.errors[k] || 0); });
        return;
      }
      const k = _sk(s.trainer, p.level, p.subskill);
      const a = wq[k] = wq[k] || WQ0();
      [a, wqAll].forEach(x => {
        if (ph === 'shown') x.shown++;
        if (ph === 'choice') {
          x.choice++;
          if (p.match === true) x.matchT++;
          if (p.match === false) x.matchF++;
          if (p.choice === 'klick') x.klick++;
          if (p.choice === 'weiss') x.weiss++;
        }
        if (ph === 'outcome') { x.outN++; if (p.ok) x.outOk++; }
      });
      if (ph === 'shown') (p.errors || []).forEach(t => { const kk = s.trainer + ' · ' + t; wqErr[kk] = (wqErr[kk] || 0) + 1; });
      if (ph === 'open' && p.opened) { const kk = s.trainer + ' · ' + p.opened; wqOpen[kk] = (wqOpen[kk] || 0) + 1; }
    });
  });
  push('  Feld angezeigt', wqAll.shown + (nQuizStart ? ' (' + _pct(wqAll.shown, nQuizStart) + '% der Quiz-Starts)' : ''));
  push('  Vermutung gewählt', wqAll.choice + ' (' + _pct(wqAll.choice, wqAll.shown) + '% der angezeigten)');
  push('  Trefferquote Vermutung', _pct(wqAll.matchT, wqAll.matchT + wqAll.matchF) + '% (' + wqAll.matchT + '/' + (wqAll.matchT + wqAll.matchF) + ', nur trennbare Fehlerarten)');
  push('  „Weiß ich nicht“ / „verklickt“', wqAll.weiss + ' / ' + wqAll.klick);
  push('  Nächste Antwort richtig', _pct(wqAll.outOk, wqAll.outN) + '% (' + wqAll.outOk + '/' + wqAll.outN + ')');
  push('');
  Object.keys(wq).sort((x, y) => wq[y].shown - wq[x].shown).forEach(k => {
    const a = wq[k];
    if (!a.shown && !a.choice) return;
    push('  ' + k, 'angezeigt ' + a.shown + ' | gewählt ' + a.choice + ' | Treffer ' + _pct(a.matchT, a.matchT + a.matchF) + '% | weiß nicht ' + a.weiss + ' | danach richtig ' + _pct(a.outOk, a.outN) + '%');
  });
  if (!wqAll.shown && !wqAll.choice) push('  (keine self_assess-Events — Feature noch frisch oder Code.gs-Whitelist prüfen)');
  push('');
  push('  Häufigste Fehlerarten (beim Anzeigen)', '');
  Object.keys(wqErr).sort((x, y) => wqErr[y] - wqErr[x]).slice(0, 15).forEach(k => push('    ' + k, wqErr[k]));
  push('  Am häufigsten aufgeklappt', '');
  Object.keys(wqOpen).sort((x, y) => wqOpen[y] - wqOpen[x]).slice(0, 15).forEach(k => push('    ' + k, wqOpen[k]));
  push('');
  push('  Lesehilfe Trefferquote', 'Steigt sie über die Wochen, lernen Schüler, ihre Fehler selbst einzuordnen. Niedrig + viel „Weiß ich nicht“ = Fehlerarten im Feld zu abstrakt formuliert.');
  push('  Lesehilfe Antwortquote', 'Niedrig = Feld wird weggeklickt (zu lang, falscher Moment). „Danach richtig“ vergleichen mit der normalen Quote nach zwei Fehlern.');
  push('');
  push('  Endbildschirm „Woran lag es?“ (phase end, nur Trainer mit dem Feature)', '');
  Object.keys(wqEnd).filter(tr => wqEnd[tr].n).forEach(tr => {
    const t = wqEnd[tr];
    const obs = Object.keys(t.obs).sort((x, y) => t.obs[y] - t.obs[x]).map(k => k + ' ' + t.obs[k]).join(', ');
    push('    ' + tr, 'gewählt ' + t.n + ' (' + _pct(t.n, t.failed) + '% von ' + t.failed + ' nicht bestandenen) | Treffer ' + _pct(t.matchT, t.matchT + t.matchF) + '% | weiß nicht ' + t.weiss + ' | verklickt ' + (t.klick || 0) + ' | mehrere ' + (t.multi || 0) + ' | Fehler: ' + obs);
  });
  if (!Object.keys(wqEnd).some(tr => wqEnd[tr].n)) push('    (noch keine end-Events)');
  push('  Lesehilfe Endbildschirm', 'Trefferquote am Ende mit der im Feld vergleichen: Beim Rückblick auf alle Fehler sollte sie höher liegen. „Gewählt“ unter den nicht bestandenen Quizzen = wie oft die Frage beantwortet statt übersprungen wird.');
  push('');

  // GF-PRÜFUNG (seit 17.11.2026) — Daten, um Lücken und Fehler im Feld und im Endbildschirm zu finden.
  // Neu in self_assess: shown.offered (angebotene Antworten), choice.helps/reply/ans (angebotene Hilfen,
  // Erwiderung, beide eigenen Antworten), end.offered/helps/reply, phase 'control' (zwei Fehler in Folge,
  // Feld im Durchgang schon verbraucht → nächste Antwort ohne Feld) und phase 'link' (from: field | end | card;
  // act: help, read, read_ext, back, back_ext, practice, practice_ext, reco). quiz_start.via = Herkunft des Starts.
  const gfSA = [];   // alle self_assess mit Session-Bezug, zeitlich geordnet je Session
  sessions.forEach(s => (s.evAll || []).forEach((e, i) => { if (e.eventType === 'self_assess') gfSA.push({ s, e, i, p: e.payload || {} }); }));
  const inc = (o, k, n) => { o[k] = (o[k] || 0) + (n === undefined ? 1 : n); };
  const pv = (a, b) => { const v = _pct(a, b); return v === null ? '–' : v + '%'; };   // Prozent oder „–“ ohne Basis
  const top = (o, n) => Object.keys(o).sort((x, y) => o[y] - o[x]).slice(0, n);

  // 1) Links und „Erst hier üben“
  push('— LINKS UND „ERST HIER ÜBEN“ (self_assess phase link, quiz_start.via; seit 17.11.2026) —');
  const lk = {};            // from → {act → n}
  const lkKey = {};         // from · act · key → n
  sessions.forEach(s => (s.evAll || []).forEach(e => {
    if (e.eventType !== 'self_assess' || (e.payload || {}).phase !== 'link') return;
    const p = e.payload;
    inc(lk[p.from] = lk[p.from] || {}, p.act);
    if (p.key || p.opened || p.label) inc(lkKey, (p.from || '?') + ' · ' + p.act + ' · ' + (p.key || p.opened || p.label));
  }));
  const ACTS = ['help', 'read', 'read_ext', 'back', 'back_ext', 'practice', 'practice_ext', 'reco'];
  ['field', 'end', 'card'].forEach(fr => {
    const a = lk[fr];
    if (!a) return;
    push('  ' + ({ field: 'Woran-Feld', end: 'Endbildschirm', card: 'aus Lernkarten' })[fr], ACTS.filter(k => a[k]).map(k => k + ' ' + a[k]).join(' | '));
  });
  if (!Object.keys(lk).length) push('  (noch keine link-Events)');
  push('  Basis', 'Feld: Wahlen ' + wqAll.choice + ' | Endbildschirm: Antworten ' + Object.keys(wqEnd).reduce((n, tr) => n + (wqEnd[tr].n || 0), 0)
    + ' | Hilfen im Feld aufgeklappt ' + gfSA.filter(x => x.p.phase === 'open').length);
  push('  Häufigste Ziele', '');
  top(lkKey, 15).forEach(k => push('    ' + k, lkKey[k]));
  // Starts mit Herkunft und was daraus wurde: bestanden (≥ 80 %) im selben Durchgang; bei Sprüngen aus Feld/Endbildschirm
  // zusätzlich, ob die ursprüngliche Übung danach in derselben Sitzung wieder gestartet und bestanden wurde
  const via = {};           // via → {n, done, pass, back, backPass}
  sessions.forEach(s => {
    const ev = s.evAll || [];
    ev.forEach((e, i) => {
      if (e.eventType !== 'quiz_start' || !(e.payload || {}).via) return;
      const p = e.payload, v = via[p.via] = via[p.via] || { n: 0, done: 0, pass: 0, back: 0, backPass: 0 };
      v.n++;
      const qc = ev.slice(i + 1).find(x => x.eventType === 'quiz_complete' || x.eventType === 'quiz_start');
      if (qc && qc.eventType === 'quiz_complete') { v.done++; if ((qc.payload || {}).pct >= 80) v.pass++; }
      // Herkunft: letzter link-Sprung davor (practice/reco) mit Level/Sub-Skill der ursprünglichen Übung
      const ln = ev.slice(0, i).reverse().find(x => x.eventType === 'self_assess' && (x.payload || {}).phase === 'link' && ['practice', 'reco'].includes(x.payload.act));
      if (!ln || !ln.payload.subskill || ln.payload.subskill === p.subskill) return;
      const j = ev.findIndex((x, k) => k > i && x.eventType === 'quiz_start' && (x.payload || {}).subskill === ln.payload.subskill && (x.payload || {}).level === ln.payload.level);
      if (j < 0) return;
      v.back++;
      const qc2 = ev.slice(j + 1).find(x => x.eventType === 'quiz_complete' || x.eventType === 'quiz_start');
      if (qc2 && qc2.eventType === 'quiz_complete' && (qc2.payload || {}).pct >= 80) v.backPass++;
    });
  });
  push('  Starts mit Herkunft (via)', '');
  Object.keys(via).sort((x, y) => via[y].n - via[x].n).forEach(k => {
    const v = via[k];
    push('    ' + k, v.n + ' Starts | beendet ' + v.done + ' | bestanden ' + v.pass + ' (' + pv(v.pass, v.done) + ') | zurück zur Ausgangsübung ' + v.back + ', dort bestanden ' + v.backPass);
  });
  if (!Object.keys(via).length) push('    (noch keine Starts mit via)');
  push('  Lesehilfe', 'field_practice/end_practice = „Erst hier üben“ im Feld bzw. Endbildschirm, end_reco = Übungsknopf, deeplink = „Erst hier üben“ in der Karte eines anderen Trainers (eigene Sitzung im Zieltrainer, daher ohne Rückkehr). read_ext ohne practice_ext = Karte gelesen und zurück zur Aufgabe.');
  push('');

  // 2) Antwortmöglichkeiten: angeboten vs. gewählt, „Weiß ich nicht“ je Fehlerart, Vermutung × Befund
  push('— ANTWORTMÖGLICHKEITEN (Feld und Endbildschirm) —');
  const opt = {};           // trainer · subskill · option → {off, ch}
  const conf = {};          // trainer · beobachtet → {choice → n}
  const kindStat = {};      // trainer · Fehlerart (beide gleich) → {n, weiss, klick, miss}
  gfSA.forEach(({ s, e, i, p }) => {
    const ev = s.evAll;
    if (p.phase === 'shown' && Array.isArray(p.offered)) {
      const ch = ev.slice(i + 1).find(x => x.eventType === 'self_assess' && (x.payload || {}).phase === 'choice');
      p.offered.forEach(k => { const o = opt[s.trainer + ' · ' + p.subskill + ' · ' + k] = opt[s.trainer + ' · ' + p.subskill + ' · ' + k] || { off: 0, ch: 0 }; o.off++; if (ch && ch.payload.choice === k) o.ch++; });
    }
    if (p.phase === 'end' && Array.isArray(p.offered)) {
      const chosen = String(p.choice || '').split(',');
      p.offered.forEach(k => { const o = opt[s.trainer + ' · ' + p.subskill + ' · ' + k + ' (Ende)'] = opt[s.trainer + ' · ' + p.subskill + ' · ' + k + ' (Ende)'] || { off: 0, ch: 0 }; o.off++; if (chosen.includes(k)) o.ch++; });
    }
    if (p.phase === 'choice' && p.observed) {
      inc(conf[s.trainer + ' · ' + p.observed] = conf[s.trainer + ' · ' + p.observed] || {}, p.choice);
      const ks = kindStat[s.trainer + ' · ' + p.observed] = kindStat[s.trainer + ' · ' + p.observed] || { n: 0, weiss: 0, klick: 0, miss: 0 };
      ks.n++;
      if (p.choice === 'weiss') ks.weiss++;
      if (p.choice === 'klick') ks.klick++;
      if (p.match === false) ks.miss++;
    }
  });
  push('  Nie oder kaum gewählt (ab 10× angeboten, unter 5 %)', '');
  const rare = Object.keys(opt).filter(k => opt[k].off >= 10 && opt[k].ch / opt[k].off < 0.05).sort((x, y) => opt[y].off - opt[x].off);
  rare.slice(0, 15).forEach(k => push('    ' + k, 'angeboten ' + opt[k].off + ', gewählt ' + opt[k].ch));
  if (!rare.length) push('    (keine – oder noch zu wenig Daten)');
  push('  Gleicher Fehler zweimal: Antworten je Fehlerart', '');
  top(Object.fromEntries(Object.keys(kindStat).map(k => [k, kindStat[k].n])), 20).forEach(k => {
    const a = kindStat[k], c = conf[k] || {};
    push('    ' + k, a.n + ' | weiß nicht ' + pv(a.weiss, a.n) + ' | verklickt ' + pv(a.klick, a.n) + ' | Vermutung daneben ' + pv(a.miss, a.n) + ' | gewählt: ' + top(c, 5).map(x => x + ' ' + c[x]).join(', '));
  });
  push('  Lesehilfe', 'Viel „weiß nicht“ oder „daneben“ bei einer Fehlerart = passende Antwort fehlt oder ist unverständlich formuliert. „Verklickt“ bei zweimal demselben Fehler ist selten ein echtes Verklicken. Nie gewählte Antworten streichen oder umformulieren.');
  push('');

  // 3) „Verklickt“ nach Übung und Gerät — Hinweis auf schwierige Eingabe
  push('— „VERKLICKT“ NACH ÜBUNG UND GERÄT (Feld und Endbildschirm) —');
  const kl = {};            // trainer · level · subskill · device → {n, k}
  gfSA.forEach(({ s, p }) => {
    if (p.phase !== 'choice' && p.phase !== 'end') return;
    const a = kl[_sk(s.trainer, p.level, p.subskill) + ' · ' + (s.device || '?')] = kl[_sk(s.trainer, p.level, p.subskill) + ' · ' + (s.device || '?')] || { n: 0, k: 0 };
    a.n++;
    if (String(p.choice || '').split(',').includes('klick')) a.k++;
  });
  Object.keys(kl).filter(k => kl[k].k).sort((x, y) => kl[y].k / kl[y].n - kl[x].k / kl[x].n || kl[y].n - kl[x].n).slice(0, 15)
    .forEach(k => push('  ' + k, 'verklickt ' + kl[k].k + ' von ' + kl[k].n + ' (' + pv(kl[k].k, kl[k].n) + ')'));
  if (!Object.keys(kl).some(k => kl[k].k)) push('  (noch keine „verklickt“-Antworten)');
  push('  Lesehilfe', 'Hohe Quote bei einer Übung auf einem Gerätetyp (z. B. Tastatur auf dem Handy) = Eingabe dort prüfen: Tasten zu klein, Ziehen statt Tippen, Doppelklick.');
  push('');

  // 4) Hilfen: angeboten, aufgeklappt, danach richtig; Felder ohne passende Hilfe
  push('— HILFEN (angeboten → aufgeklappt → nächste Antwort richtig) —');
  const hp = {};            // trainer · Frage → {off, open, after, afterOk}
  let noHelp = 0, withChoice = 0;
  gfSA.forEach(({ s, i, p }) => {
    if ((p.phase === 'choice' || p.phase === 'end') && Array.isArray(p.helps)) {
      if (p.phase === 'choice' && !['klick', 'weiss'].includes(p.choice)) { withChoice++; if (!p.helps.length) noHelp++; }
      const ev = s.evAll;
      // aufgeklappt: open (Feld) bzw. link help (Endbildschirm) bis zur nächsten Wahl
      const nxt = ev.findIndex((x, k) => k > i && x.eventType === 'self_assess' && ['choice', 'end', 'shown'].includes((x.payload || {}).phase));
      const win = ev.slice(i + 1, nxt < 0 ? undefined : nxt);
      const opened = win.filter(x => x.eventType === 'self_assess' && ((x.payload || {}).phase === 'open' || ((x.payload || {}).phase === 'link' && x.payload.act === 'help'))).map(x => x.payload.opened);
      const out = p.phase === 'choice' ? win.find(x => x.eventType === 'self_assess' && (x.payload || {}).phase === 'outcome') : null;
      p.helps.forEach(h => {
        const a = hp[s.trainer + ' · ' + h] = hp[s.trainer + ' · ' + h] || { off: 0, open: 0, after: 0, afterOk: 0 };
        a.off++;
        if (opened.includes(h)) { a.open++; if (out) { a.after++; if (out.payload.ok) a.afterOk++; } }
      });
    }
  });
  push('  Feld-Wahlen ohne passende Hilfe', noHelp + ' von ' + withChoice + ' (' + pv(noHelp, withChoice) + ', ohne „verklickt“/„weiß nicht“)');
  top(Object.fromEntries(Object.keys(hp).map(k => [k, hp[k].off])), 25).forEach(k => {
    const a = hp[k];
    push('  ' + k, 'angeboten ' + a.off + ' | aufgeklappt ' + a.open + ' (' + pv(a.open, a.off) + ') | danach richtig ' + (a.after ? pv(a.afterOk, a.after) + ' von ' + a.after : '–'));
  });
  if (!Object.keys(hp).length) push('  (noch keine Hilfen-Daten)');
  push('  Lesehilfe', 'Oft angeboten, kaum aufgeklappt = Frage trifft die Unsicherheit nicht. Oft aufgeklappt, danach selten richtig = Kurzantwort hilft nicht. Viele Wahlen ohne Hilfe = Hilfe fehlt für diese Vermutung.');
  push('');

  // 5) Wirkt das Feld? Nächste Antwort mit Feld (outcome) vs. ohne Feld (control)
  push('— MIT UND OHNE FELD (nächste Antwort nach zwei Fehlern in Folge) —');
  const mf = {};            // trainer → {o, oOk, c, cOk}
  gfSA.forEach(({ s, p }) => {
    if (p.phase !== 'outcome' && p.phase !== 'control') return;
    const a = mf[s.trainer] = mf[s.trainer] || { o: 0, oOk: 0, c: 0, cOk: 0 };
    if (p.phase === 'outcome') { a.o++; if (p.ok) a.oOk++; } else { a.c++; if (p.ok) a.cOk++; }
  });
  Object.keys(mf).forEach(tr => {
    const a = mf[tr];
    push('  ' + tr, 'mit Feld ' + pv(a.oOk, a.o) + ' richtig (' + a.o + ') | ohne Feld ' + (a.c ? pv(a.cOk, a.c) + ' (' + a.c + ')' : '– (noch keine control-Events)'));
  });
  if (!Object.keys(mf).length) push('  (noch keine Daten)');
  push('  Lesehilfe', 'Ohne Feld = zweite Fehlerfolge im selben Durchgang (Feld schon verbraucht). Diese Schüler sind schon länger in der Übung – der Vergleich ist ein Hinweis, kein Beweis.');
  push('');

  // 6) Erwiderungen: Verteilung und Stichproben zum Gegenlesen
  push('— ERWIDERUNGEN IM FELD (zum Gegenlesen) —');
  const rc = {};
  const smp = [];
  gfSA.forEach(({ s, e, p }) => {
    if (p.phase !== 'choice' || p.reply === undefined) return;
    const r = String(p.reply || '');
    inc(rc, /tatsächlich/.test(r) ? 'tatsächlich' : /zum Teil/.test(r) ? 'zum Teil' : /kann es gelegen/.test(r) ? 'kann' : / lag es nicht/.test(r) ? 'nicht' : 'ohne Urteil');
    smp.push([e.ts, s.trainer + ' · ' + p.subskill + ' · ' + p.choice + ' / ' + p.observed + ' · ' + (p.ans || []).join(' | '), r]);
  });
  push('  Urteile', Object.keys(rc).map(k => k + ' ' + rc[k]).join(' | ') || '(noch keine)');
  push('  Letzte 20 (Übung · Vermutung / Befund · Antworten)', 'Erwiderung');
  smp.sort((x, y) => y[0] - x[0]).slice(0, 20).forEach(x => push('    ' + x[1], x[2]));
  push('');

  // FEHLER IM FELD (wq_error) — abgefangene Fehler von „Woran liegt es?“. Das Quiz läuft
  // dabei weiter, nur das Feld fehlt. Jeder Eintrag hier ist ein Bug mit Fundstelle.
  push('— FEHLER IM FELD „WORAN LIEGT ES?“ (wq_error, alle Segmente) —');
  const wqe = {};
  sessions.forEach(s => {
    (s.evAll || []).forEach(e => {
      if (e.eventType !== 'wq_error') return;
      const p = e.payload || {};
      const k = _sk(s.trainer, p.level, p.subskill) + ' · ' + (p.where || '?') + ' · ' + (p.msg || '?');
      wqe[k] = (wqe[k] || 0) + 1;
    });
  });
  const wqeKeys = Object.keys(wqe).sort((x, y) => wqe[y] - wqe[x]);
  wqeKeys.slice(0, 20).forEach(k => push('  ' + k, wqe[k]));
  if (!wqeKeys.length) push('  (keine Fehler gemeldet)');
  push('');

  // HILFE-KNOPF (help_open, seit 14.11.2026) — Hilfe aktiv geöffnet, im Quiz oder im Menü
  push('— HILFE-KNOPF (help_open, alle Segmente) —');
  const ho = {};
  let hoQuiz = 0, hoMenu = 0;
  sessions.forEach(s => {
    (s.evAll || []).forEach(e => {
      if (e.eventType !== 'help_open') return;
      const p = e.payload || {};
      if (p.where === 'menu') { hoMenu++; return; }
      hoQuiz++;
      const k = _sk(s.trainer, p.level, p.subskill);
      ho[k] = (ho[k] || 0) + 1;
    });
  });
  push('  geöffnet im Quiz / im Menü', hoQuiz + ' / ' + hoMenu);
  push('  je Quiz-Start', _pct(hoQuiz, nQuizStart) + '%');
  Object.keys(ho).sort((x, y) => ho[y] - ho[x]).slice(0, 15).forEach(k => push('  ' + k, ho[k]));
  if (!hoQuiz && !hoMenu) push('  (keine help_open-Events — Feature noch frisch oder Code.gs-Whitelist prüfen)');
  push('');

  // RÜCKFRAGEN IN LERNKARTEN (tip_open) — welche benannten Unsicherheiten werden aufgeklappt?
  push('— LERNKARTEN-RÜCKFRAGEN (tip_open, alle Segmente) —');
  const tip = {};
  sessions.forEach(s => {
    (s.evAll || []).forEach(e => {
      if (e.eventType !== 'tip_open') return;
      const p = e.payload || {};
      const k = s.trainer + ' · ' + (p.card || '?') + ' → ' + (p.target || '?');
      tip[k] = (tip[k] || 0) + 1;
    });
  });
  const tipKeys = Object.keys(tip).sort((x, y) => tip[y] - tip[x]);
  tipKeys.slice(0, 20).forEach(k => push('  ' + k, tip[k]));
  if (!tipKeys.length) push('  (keine tip_open-Events — Feature noch frisch oder Code.gs-Whitelist prüfen)');
  push('  Lesehilfe', 'Karte → Ziel der Rückfrage. Häufig aufgeklappt = diese Vorkenntnis fehlt oft; dort Lernkarte/Übung davor stärken. Enthält auch Hilfen aus dem Endbildschirm (dort zusätzlich als link help erfasst).');
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

  // LANDING-SUCHE UND CHIPS (seit 17.11.2026): landing_click mit trainer „Suche“ trägt term (+ key bei
  // Treffer, miss: true ohne Treffer); Chips auf den Trainer-Karten tragen node/chip; Kurzcodes via: 'hash'.
  push('— LANDING-SUCHE (landing_click „Suche“, alle Segmente) —');
  const srchHit = {}, srchMiss = {}, chips = {}, codes = {};
  sessions.forEach(s => {
    (s.evAll || []).forEach(e => {
      if (e.eventType !== 'landing_click') return;
      const p = e.payload || {};
      if (e.trainer === 'Suche') {
        const t = String(p.term || '').trim().toLowerCase();
        if (!t) return;
        if (p.miss) srchMiss[t] = (srchMiss[t] || 0) + 1; else srchHit[t] = (srchHit[t] || 0) + 1;
      } else if (p.via === 'hash') codes[p.code || '?'] = (codes[p.code || '?'] || 0) + 1;
      else if (p.node) { const ck = p.node + (p.chip ? ' „' + p.chip + '“' : ''); chips[ck] = (chips[ck] || 0) + 1; }
    });
  });
  const topN = (o, n) => Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, n);
  const nHit = Object.values(srchHit).reduce((a, b) => a + b, 0), nMiss = Object.values(srchMiss).reduce((a, b) => a + b, 0);
  push('  Suchen mit Treffer / ohne Treffer', nHit + ' / ' + nMiss);
  topN(srchMiss, 15).forEach(t => push('  ohne Treffer: ' + t, srchMiss[t]));
  topN(srchHit, 10).forEach(t => push('  mit Treffer: ' + t, srchHit[t]));
  if (!nHit && !nMiss) push('  (noch keine Suchen)');
  push('  Lesehilfe', 'Begriffe ohne Treffer gehören ins Register der Landing (index.html) oder in _entwicklung/BEGRIFFE.md');
  push('');
  push('— LANDING-CHIPS UND KURZCODES (landing_click mit node bzw. via hash) —');
  topN(chips, 12).forEach(k => push('  Chip ' + k, chips[k]));
  topN(codes, 8).forEach(k => push('  Code #' + k, codes[k]));
  if (!Object.keys(chips).length && !Object.keys(codes).length) push('  (noch keine Chip- oder Code-Klicks)');
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
//  n_help_nudge | n_help_nudge_followed
//  n_wq_shown | n_wq_choice | n_wq_outcome | n_wq_outcome_ok | n_help_open | n_tip_open | n_wq_error  (seit 14.11.2026)
//
// Beim Erweitern der Spalten: Ist der Tab schmaler als DAILY_HEADERS, ergänzt
// _runDailyAggregates die Kopfzeile selbst (seit 14.11.2026). Neue Spalten nur
// hinten anhängen. Eingefrorene Tage werden nie neu geschrieben, historische
// Zeilen bleiben in neuen Spalten also leer.

const DAILY_HEADERS = ['date', 'frozen', 'sessions_total', 'sessions_organik',
  'sessions_klassenraum', 'cat_abgeschlossen', 'cat_abgebrochen_aktiv',
  'cat_abgebrochen_unterbrochen', 'cat_phantom_preview', 'cat_sofort_absprung',
  'cat_idle_offen', 'cat_erkundet_ohne_quiz', 'n_quiz_start', 'n_quiz_complete',
  'n_quiz_abandon', 'n_landing_click', 'devices_desktop', 'devices_tablet',
  'devices_mobile', 'devices_other', 'top_trainer', 'top_trainer_n',
  'median_dur_engaged_s', 'median_quizzes_per_active',
  'n_help_nudge', 'n_help_nudge_followed',
  'n_wq_shown', 'n_wq_choice', 'n_wq_outcome', 'n_wq_outcome_ok', 'n_help_open', 'n_tip_open', 'n_wq_error'];

function _runDailyAggregates(sessions) {
  const ss = _ss();
  let tab = ss.getSheetByName('Daily_Aggregates');
  const isNew = !tab;
  if (isNew) {
    tab = ss.insertSheet('Daily_Aggregates');
    tab.getRange(1, 1, 1, DAILY_HEADERS.length).setValues([DAILY_HEADERS]);
    tab.setFrozenRows(1);
  } else if (tab.getLastColumn() < DAILY_HEADERS.length) {
    // Neue Spalten: Kopfzeile ergänzen (historische Zeilen bleiben in den neuen Spalten leer)
    tab.getRange(1, 1, 1, DAILY_HEADERS.length).setValues([DAILY_HEADERS]);
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

  // Zweite Verteidigungslinie gegen Geräte mit falscher Systemuhr (erste ist
  // _resolveEventTs in Code.gs). Ein Zukunftstag liegt nie in fluidDays und
  // bekommt deshalb sofort frozen=yes — die Zeile wäre nie mehr korrigierbar.
  // Greift auch für die Altdaten, die vor dem Code.gs-Fix schon im Sheet sind.
  Object.keys(allDays).filter(d => d > today).forEach(d => {
    Logger.log('Daily_Aggregates: Zukunftstag ' + d + ' verworfen (' +
      (sessByDate[d] || []).length + ' Sessions, ' +
      (eventsByDate[d] || []).length + ' Events) — Client-Uhr falsch gestellt?');
    delete allDays[d];
  });

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

// Einmalig manuell ausführen: entfernt Zeilen mit einem Datum in der ZUKUNFT
// aus Daily_Aggregates. Hintergrund: Geräte mit falsch gestellter Systemuhr
// (Schul-Tablet am 13.10.2026 → vier Events auf den 18.10.2026) haben vor dem
// Clock-Skew-Fix in Code.gs Zukunftstage erzeugt. Die lagen nie in fluidDays
// und bekamen sofort frozen=yes, waren also nie mehr korrigierbar.
// Die zugehörigen Events im Events-Tab bleiben unangetastet — nur das
// Aggregat wird bereinigt.
function cleanupFutureDailyAggregates() {
  const tab = _ss().getSheetByName('Daily_Aggregates');
  if (!tab) { Logger.log('Daily_Aggregates-Tab fehlt'); return; }

  const today = _ymd(Date.now());
  const vals = tab.getDataRange().getValues();
  let removed = 0;

  // Von unten nach oben löschen, damit die Zeilennummern stabil bleiben.
  for (let i = vals.length - 1; i >= 1; i--) {
    const raw = vals[i][0];
    const date = (raw instanceof Date) ? _ymd(raw.getTime()) : String(raw || '');
    if (date && date > today) {
      Logger.log('cleanupFutureDailyAggregates: Zeile ' + (i + 1) + ' (' + date +
        ', sessions_total=' + vals[i][2] + ') gelöscht');
      tab.deleteRow(i + 1);
      removed++;
    }
  }

  Logger.log('cleanupFutureDailyAggregates: ' + removed +
    ' Zukunftszeile(n) entfernt (heute=' + today + ')');
}

// EINMALIG, danach löschbar: entfernt die drei Testzeilen des Clock-Skew-
// Tests vom 16.10.2026 aus dem Events-Tab.
// Gezielt über die sessionId statt über env='dev' — im Events-Tab liegen
// 85 env=dev-Zeilen, davon 82 echte Dev-Sessions aus Mai 2026, die bleiben.
// Doppelte Absicherung: env MUSS 'dev' sein UND die sessionId MUSS in der
// Liste stehen. Echte Schülerdaten können so nicht getroffen werden.
const SKEW_TEST_SIDS = ['skewtest-future', 'skewtest-normal', 'probe'];

function cleanupSkewTestRows() {
  const sh = _ss().getSheetByName('Events');
  if (!sh) { Logger.log('Events-Tab fehlt'); return; }

  const vals = sh.getDataRange().getValues();
  let removed = 0;

  // Von unten nach oben löschen, damit die Zeilennummern stabil bleiben.
  for (let i = vals.length - 1; i >= 1; i--) {
    const env = String(vals[i][2] || '');
    const sid = String(vals[i][7] || '');
    if (env === 'dev' && SKEW_TEST_SIDS.indexOf(sid) !== -1) {
      Logger.log('cleanupSkewTestRows: Zeile ' + (i + 1) + ' (' + vals[i][0] +
        ', sid=' + sid + ') gelöscht');
      sh.deleteRow(i + 1);
      removed++;
    }
  }

  Logger.log('cleanupSkewTestRows: ' + removed + ' Testzeile(n) entfernt (erwartet: 3)');
}

function _dailyAggregateRow(date, daySessions, dayEvents, isFluid) {
  const org = daySessions.filter(s => s.segment === 'organik');
  const kla = daySessions.filter(s => s.segment === 'klassenraum');
  const catN = (c) => daySessions.filter(s => s.cat === c).length;
  const evN = (t) => dayEvents.filter(e => e.eventType === t).length;
  const devN = (d) => dayEvents.filter(e => e.device === d).length;
  // „Woran liegt es?“ nach Phase; alte self_assess-Events ohne phase = Wahl
  const wqN = (ph) => dayEvents.filter(e => e.eventType === 'self_assess' &&
    ((e.payload || {}).phase || ((e.payload || {}).opened ? 'open' : 'choice')) === ph).length;

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
    medEng, medQc,
    evN('help_nudge'), evN('help_nudge_followed'),
    wqN('shown'), wqN('choice'), wqN('outcome'),
    dayEvents.filter(e => e.eventType === 'self_assess' && (e.payload || {}).phase === 'outcome' && (e.payload || {}).ok).length,
    evN('help_open'), evN('tip_open'), evN('wq_error')
  ];
}
