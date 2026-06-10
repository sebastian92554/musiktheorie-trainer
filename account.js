/**
 * account.js — zentrale Account-Logik für die Musiktrainer
 * =========================================================
 * Server-Account zum geräteübergreifenden Speichern des Fortschritts.
 * Einbinden via <script src="account.js"></script> in allen Trainern + Landing.
 *
 * Backend: separates Apps-Script-Projekt (siehe _apps_script/account_backend.gs).
 * Transport: POST mit Content-Type text/plain → KEIN CORS-Preflight (Phase-0-Regel).
 *
 * Modell:
 *  - Anonym: Fortschritt nur lokal (localStorage, 24-h-Ablauf pro Trainer).
 *  - Account: Server = Quelle der Wahrheit. login überschreibt lokal (Server gewinnt),
 *    register seedet den Account aus dem aktuellen lokalen Stand.
 *  - Kein Token-System: Passwort wird in sessionStorage gehalten und bei jedem
 *    Schreib-/Lesezugriff mitgesendet (über HTTPS unbedenklich, Schulgeräte gewollt).
 */
(function (global) {
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbwOFSpkevlolg75xiy6d4wSYfZroD4yNn22NKI84aQBC8oBaf0K02UWDYmVz6lakjqd/exec';

  // Alle Fortschritts-Keys der 5 Trainer (Tracking-Flags sind NICHT dabei).
  var PROGRESS_KEYS = [
    'notentrainer_quickstart_v1',
    'intervalltrainer_quickstart_progress',
    'dreiklangstrainer_quickstart_v2',
    'tonleitertrainer_quickstart_v1',
    'rhythmustrainer_skilltree_v2'
  ];

  var SESSION_KEY = 'account_session'; // sessionStorage: {username, password}

  // ---------- intern: Session ----------

  function _session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function _setSession(username, password) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username: username, password: password })); }
    catch (e) {}
  }
  function _clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // ---------- intern: Bundle (alle 5 Keys) ----------

  // Sammelt vorhandene Fortschritts-Keys als {key: rohwert-string}.
  function _gatherBundle() {
    var bundle = {};
    for (var i = 0; i < PROGRESS_KEYS.length; i++) {
      var v = null;
      try { v = localStorage.getItem(PROGRESS_KEYS[i]); } catch (e) {}
      if (v != null) bundle[PROGRESS_KEYS[i]] = v;
    }
    return bundle;
  }

  // Schreibt ein Bundle (JSON-String oder Objekt) zurück in localStorage.
  function _restoreBundle(data) {
    var bundle;
    try { bundle = (typeof data === 'string') ? JSON.parse(data) : data; }
    catch (e) { bundle = null; }
    if (!bundle || typeof bundle !== 'object') return;
    for (var i = 0; i < PROGRESS_KEYS.length; i++) {
      var key = PROGRESS_KEYS[i];
      if (bundle[key] != null) {
        try { localStorage.setItem(key, bundle[key]); } catch (e) {}
      }
    }
  }

  // Leert alle Fortschritts-Keys (Logout → sauberes Gerät für den Nächsten).
  function _clearProgress() {
    for (var i = 0; i < PROGRESS_KEYS.length; i++) {
      try { localStorage.removeItem(PROGRESS_KEYS[i]); } catch (e) {}
    }
  }

  // ---------- intern: Transport ----------

  // POST text/plain → JSON. Promise<obj> oder reject bei Netz-/Transportfehler.
  function _post(body) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // vermeidet Preflight
      body: JSON.stringify(body),
      redirect: 'follow'
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error('Ungültige Server-Antwort'); }
    });
  }

  // ---------- öffentliche API ----------

  var Account = {
    isLoggedIn: function () { return !!_session(); },
    currentUser: function () { var s = _session(); return s ? s.username : null; },

    // Registrieren: aktuellen lokalen Stand als Startdaten hochladen.
    // Erfolg → { ok:true, recovery_code:'XXXX-XXXX-XXXX' } (Code dem Nutzer EINMAL zeigen!).
    register: function (username, password) {
      return _post({ action: 'register', username: username, password: password, data: _gatherBundle() })
        .then(function (r) {
          if (r && r.ok) _setSession(username, password);
          return r;
        });
    },

    // Login: Server gewinnt → lokalen Stand mit Server-Stand überschreiben.
    login: function (username, password) {
      return _post({ action: 'login', username: username, password: password })
        .then(function (r) {
          if (r && r.ok) {
            _restoreBundle(r.data);
            _setSession(username, password);
          }
          return r;
        });
    },

    // Aktuellen lokalen Stand (alle 5 Keys) auf den Server speichern.
    // Schutz: ein LEERES Bundle wird NIE geschrieben (sonst Gefahr, einen guten
    // Server-Stand mit leer zu überschreiben, z.B. nach geleertem localStorage).
    save: function () {
      var s = _session();
      if (!s) return Promise.resolve({ ok: false, error: 'not_logged_in' });
      var bundle = _gatherBundle();
      if (Object.keys(bundle).length === 0) return Promise.resolve({ ok: true, skipped: 'empty' });
      if (_saveState !== null) { _saveState = 'saving'; _renderBar(); }
      return _post({ action: 'save', username: s.username, password: s.password, data: bundle })
        .then(function (r) {
          if (_saveState !== null) { _saveState = (r && r.ok) ? 'saved' : 'unsaved'; _renderBar(); }
          return r;
        })
        .catch(function (e) {
          if (_saveState !== null) { _saveState = 'unsaved'; _renderBar(); }
          throw e;
        });
    },

    // Server-Stand neu in localStorage laden.
    load: function () {
      var s = _session();
      if (!s) return Promise.resolve({ ok: false, error: 'not_logged_in' });
      return _post({ action: 'load', username: s.username, password: s.password })
        .then(function (r) { if (r && r.ok) _restoreBundle(r.data); return r; });
    },

    resetPassword: function (username, recoveryCode, newPassword) {
      return _post({ action: 'reset_password', username: username, recovery_code: recoveryCode, new_password: newPassword });
    },

    deleteAccount: function () {
      var s = _session();
      if (!s) return Promise.resolve({ ok: false, error: 'not_logged_in' });
      return _post({ action: 'delete', username: s.username, password: s.password })
        .then(function (r) { if (r && r.ok) _clearSession(); return r; });
    },

    // Abmelden: letzter Sync (best effort) → Fortschritt + Session leeren.
    logout: function () {
      var s = _session();
      if (!s) { _clearProgress(); return Promise.resolve({ ok: true }); }
      return Account.save().catch(function () { return null; }).then(function () {
        _clearSession();
        _clearProgress();
        return { ok: true };
      });
    },

    // Best-effort-Save beim Verlassen der Seite (sendBeacon, keine Antwort nötig).
    flushBeacon: function () {
      var s = _session();
      if (!s || !global.navigator || !navigator.sendBeacon) return;
      var bundle = _gatherBundle();
      if (Object.keys(bundle).length === 0) return; // leeres Bundle nie schreiben
      try {
        var body = JSON.stringify({ action: 'save', username: s.username, password: s.password, data: bundle });
        navigator.sendBeacon(API_URL, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      } catch (e) {}
    }
  };

  // Auto-Flush beim Verlassen/Verstecken der Seite (fängt Tab-Wechsel + Schließen).
  if (global.addEventListener) {
    global.addEventListener('pagehide', Account.flushBeacon);
    global.addEventListener('visibilitychange', function () {
      if (global.document && document.visibilityState === 'hidden') Account.flushBeacon();
    });
  }

  // ====================================================================
  // Geteilte UI-Komponente: Modals (Anmelden/Registrieren/Reset) + Toast
  // + Statusleiste. Wird beim Laden selbst injiziert → alle Seiten zeigen
  // EXAKT dieselbe Account-UI. Alle Klassen/IDs sind "acc-"-namespaced,
  // damit nichts mit Trainer-/Landing-CSS kollidiert. Slate-Neutral-Look.
  // Status-Mount: ein Element mit class="account-bar" auf der Seite.
  // Optionaler Hook: Account.onSync = function(reason){...} (z.B. reload).
  // ====================================================================

  var CSS = `
.acc-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:1rem;z-index:1000}
.acc-overlay.active{display:flex}
.acc-modal{background:#fff;border-radius:16px;padding:1.5rem;width:100%;max-width:380px;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:-apple-system,system-ui,sans-serif;color:#1e293b;line-height:1.5}
.acc-modal h3{margin:0 0 .25rem;font-size:1.1rem}
.acc-modal p.sub{margin:0 0 1rem;color:#64748b;font-size:.88rem}
.acc-modal label{display:block;font-size:.82rem;font-weight:600;margin:.75rem 0 .25rem}
.acc-modal input{width:100%;padding:.6rem .7rem;border:1px solid #cbd5e1;border-radius:9px;font:inherit;box-sizing:border-box}
.acc-actions{display:flex;gap:.6rem;margin-top:1.25rem}
.acc-actions button{flex:1}
.acc-btn{font:inherit;font-weight:600;border:none;border-radius:9px;padding:.6rem 1.1rem;cursor:pointer;background:#334155;color:#fff}
.acc-btn:hover{background:#1e293b}
.acc-btn.ghost{background:#f1f5f9;color:#334155}
.acc-btn.ghost:hover{background:#e2e8f0}
.acc-btn.link{background:none;color:#334155;padding:.2rem;text-decoration:underline;font-weight:500;flex:none}
.acc-warn-red{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:9px;padding:.6rem .75rem;font-size:.83rem;margin-top:.85rem}
.acc-hint-green{background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:9px;padding:1.1rem .7rem;font-size:1.05rem;font-weight:700;text-align:center}
.acc-reccode{font-family:monospace;font-size:1.35rem;letter-spacing:1px;text-align:center;background:#f1f5f9;color:#1e293b;border:2px dashed #334155;border-radius:10px;padding:.85rem;margin:.5rem 0 .75rem}
.acc-msg{font-size:.85rem;margin-top:.85rem;min-height:1.2em}
.acc-msg.ok{color:#10b981}.acc-msg.bad{color:#ef4444}
.acc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:#0f172a;color:#fff;padding:.7rem 1.1rem;border-radius:10px;font-size:.9rem;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;z-index:1001;box-shadow:0 8px 24px rgba(0,0,0,.25);font-family:-apple-system,system-ui,sans-serif}
.acc-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.acc-toast.bad{background:#b91c1c}
.account-bar{display:inline-flex;align-items:center;gap:.6rem;flex-wrap:wrap;font-family:-apple-system,system-ui,sans-serif}
.account-bar .acc-who{font-weight:600;font-size:.9rem;color:#334155}
.account-bar .acc-who small{color:#64748b;font-weight:400}
.acc-status{display:inline-flex;align-items:center}
.acc-status-saved{color:#16a34a}
.acc-status-saving{color:#64748b}
.acc-status-unsaved{color:#dc2626}
@keyframes acc-rot{to{transform:rotate(360deg)}}
.acc-spin{animation:acc-rot .8s linear infinite}
.acc-btn.danger{background:#dc2626;color:#fff}
.acc-btn.danger:hover{background:#b91c1c}
.acc-icon{background:none;color:#64748b;padding:.35rem;display:inline-flex;align-items:center}
.acc-icon:hover{background:#f1f5f9;color:#334155}
.acc-settings-list{display:flex;flex-direction:column;gap:.4rem;margin-top:.5rem}
.acc-settings-item{display:block;width:100%;text-align:left;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:.6rem .75rem;cursor:pointer;font:inherit;font-weight:600;color:#334155}
.acc-settings-item:hover{background:#f1f5f9}
.acc-settings-item.danger{color:#dc2626}
`;

  var HTML = `
<div class="acc-overlay" id="acc-m-register"><div class="acc-modal">
  <div id="acc-reg-form">
    <h3>Registrieren</h3>
    <p class="sub">Erstelle einen Account, um deinen Fortschritt geräteübergreifend zu speichern.</p>
    <div class="acc-warn-red">Wähle <b>NICHT deinen echten Namen</b> — denk dir einen Fantasienamen aus.</div>
    <label>Nutzername</label>
    <input id="acc-reg-user" autocomplete="off" placeholder="z. B. NotenNinja">
    <label>Passwort</label>
    <input id="acc-reg-pw" type="password" autocomplete="new-password">
    <div class="acc-msg" id="acc-reg-msg"></div>
    <div class="acc-actions">
      <button class="acc-btn ghost" data-acc="close">Abbrechen</button>
      <button class="acc-btn" data-acc="reg-submit">Registrieren</button>
    </div>
  </div>
  <div id="acc-reg-success" style="display:none">
    <div class="acc-hint-green">Account erstellt!</div>
    <p style="margin:.85rem 0 0;font-size:.9rem">Schreib dir diesen <b>Wiederherstellungs-Code</b> auf für den Fall, dass du dein Passwort vergessen solltest.</p>
    <div class="acc-reccode" id="acc-reg-code"></div>
    <button class="acc-btn ghost" id="acc-reg-copy" style="width:100%">Code kopieren</button>
    <div class="acc-warn-red" style="margin-top:.9rem">⚠️ <b>Wichtig:</b> Bewahre deinen <b>Nutzernamen</b> und diesen <b>Code</b> gut auf. Vergisst du den Nutzernamen — oder Passwort <b>und</b> Code — ist dein Account nicht wiederherstellbar und dein gesamter Fortschritt <b>unwiderruflich verloren</b>.</div>
    <div class="acc-actions"><button class="acc-btn" data-acc="close">Fertig</button></div>
  </div>
</div></div>

<div class="acc-overlay" id="acc-m-login"><div class="acc-modal">
  <h3>Anmelden</h3>
  <p class="sub">Melde dich an, um deinen gespeicherten Fortschritt zu laden.</p>
  <label>Nutzername</label>
  <input id="acc-log-user" autocomplete="off">
  <label>Passwort</label>
  <input id="acc-log-pw" type="password" autocomplete="current-password">
  <div style="margin-top:.6rem"><button class="acc-btn link" data-acc="open-reset">Passwort vergessen?</button></div>
  <div class="acc-msg" id="acc-log-msg"></div>
  <div class="acc-actions">
    <button class="acc-btn ghost" data-acc="close">Abbrechen</button>
    <button class="acc-btn" data-acc="login-submit">Anmelden</button>
  </div>
</div></div>

<div class="acc-overlay" id="acc-m-reset"><div class="acc-modal">
  <div id="acc-res-form">
    <h3>Passwort zurücksetzen</h3>
    <p class="sub">Mit deinem Wiederherstellungs-Code kannst du ein neues Passwort setzen.</p>
    <label>Nutzername</label>
    <input id="acc-res-user" autocomplete="off">
    <label>Wiederherstellungs-Code</label>
    <input id="acc-res-code" placeholder="XXXX-XXXX-XXXX" autocomplete="off">
    <label>Neues Passwort</label>
    <input id="acc-res-pw" type="password" autocomplete="new-password">
    <div class="acc-msg" id="acc-res-msg"></div>
    <div class="acc-actions">
      <button class="acc-btn ghost" data-acc="close">Abbrechen</button>
      <button class="acc-btn" data-acc="reset-submit">Zurücksetzen</button>
    </div>
  </div>
  <div id="acc-res-success" style="display:none">
    <div class="acc-hint-green">Passwort geändert!</div>
    <p style="margin:.85rem 0 0;font-size:.9rem">Dein alter Code ist jetzt ungültig. Schreib dir den <b>neuen Wiederherstellungs-Code</b> auf:</p>
    <div class="acc-reccode" id="acc-res-newcode"></div>
    <button class="acc-btn ghost" id="acc-res-copy" style="width:100%">Code kopieren</button>
    <div class="acc-warn-red" style="margin-top:.9rem">⚠️ <b>Wichtig:</b> Bewahre deinen <b>Nutzernamen</b> und diesen <b>Code</b> gut auf. Vergisst du den Nutzernamen — oder Passwort <b>und</b> Code — ist dein Account nicht wiederherstellbar und dein Fortschritt <b>unwiderruflich verloren</b>.</div>
    <div class="acc-actions"><button class="acc-btn" data-acc="close">Fertig</button></div>
  </div>
</div></div>

<div class="acc-overlay" id="acc-m-settings"><div class="acc-modal">
  <h3>Einstellungen</h3>
  <div class="acc-settings-list">
    <button class="acc-settings-item danger" data-acc="open-delete">Account löschen</button>
    <!-- künftige Einträge hier (z.B. Auswertung) -->
  </div>
  <div class="acc-actions"><button class="acc-btn ghost" data-acc="close">Schließen</button></div>
</div></div>

<div class="acc-overlay" id="acc-m-delete"><div class="acc-modal">
  <h3>Account löschen</h3>
  <p class="sub">Möchtest du deinen Account wirklich löschen?</p>
  <div class="acc-warn-red">⚠️ Dein Account und dein gesamter gespeicherter Fortschritt werden <b>unwiderruflich gelöscht</b>. Lokales Üben bleibt weiter möglich.</div>
  <div class="acc-msg" id="acc-del-msg"></div>
  <div class="acc-actions">
    <button class="acc-btn ghost" data-acc="close">Abbrechen</button>
    <button class="acc-btn danger" data-acc="delete-confirm">Endgültig löschen</button>
  </div>
</div></div>

<div class="acc-toast" id="acc-toast"></div>
`;

  function _el(id) { return document.getElementById(id); }
  function _show(id, on) { var e = _el(id); if (e) e.style.display = on ? '' : 'none'; }
  function _esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  var ERR = {
    bad_username: 'Nutzername: 3–30 Zeichen.',
    bad_password: 'Passwort: mindestens 4 Zeichen.',
    bad_data: 'Fortschritts-Daten ungültig.',
    username_taken: 'Name schon vergeben — bitte einen anderen wählen.',
    invalid_credentials: 'Name oder Passwort falsch.',
    invalid_recovery: 'Wiederherstellungs-Code stimmt nicht.',
    unknown_action: 'Unbekannte Aktion.',
    server_error: 'Serverfehler — bitte später erneut.'
  };
  function _errText(r) { return (r && r.error && ERR[r.error]) ? ERR[r.error] : 'Unerwarteter Fehler.'; }
  function _setMsg(id, text, ok) { var el = _el(id); if (!el) return; el.textContent = text; el.className = 'acc-msg ' + (ok ? 'ok' : 'bad'); }

  var _toastT;
  function _toast(msg, bad) {
    var t = _el('acc-toast'); if (!t) return;
    t.textContent = msg; t.className = 'acc-toast show' + (bad ? ' bad' : '');
    clearTimeout(_toastT);
    _toastT = setTimeout(function () { t.className = 'acc-toast' + (bad ? ' bad' : ''); }, 2200);
  }

  function _openModal(id) { _closeModals(); var m = _el(id); if (m) m.classList.add('active'); }
  function _closeModals() {
    var ov = document.querySelectorAll('.acc-overlay');
    for (var i = 0; i < ov.length; i++) ov[i].classList.remove('active');
    ['acc-reg-msg', 'acc-log-msg', 'acc-res-msg', 'acc-del-msg'].forEach(function (i) { var e = _el(i); if (e) e.textContent = ''; });
    _show('acc-reg-form', true); _show('acc-reg-success', false);
    _show('acc-res-form', true); _show('acc-res-success', false);
    ['acc-reg-user', 'acc-reg-pw', 'acc-log-user', 'acc-log-pw', 'acc-res-user', 'acc-res-code', 'acc-res-pw']
      .forEach(function (i) { var e = _el(i); if (e) e.value = ''; });
  }

  function _wireCopy(btnId, code) {
    var b = _el(btnId); if (!b) return;
    b.textContent = 'Code kopieren';
    b.onclick = function () { if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { b.textContent = 'kopiert'; }); };
  }

  function _doRegister() {
    var u = _el('acc-reg-user').value.trim(), p = _el('acc-reg-pw').value;
    _setMsg('acc-reg-msg', '…', true);
    Account.register(u, p).then(function (r) {
      if (r && r.ok) {
        _el('acc-reg-code').textContent = r.recovery_code;
        _wireCopy('acc-reg-copy', r.recovery_code);
        _show('acc-reg-form', false); _show('acc-reg-success', true);
        _renderBar();
      } else { _setMsg('acc-reg-msg', _errText(r), false); }
    }).catch(function () { _setMsg('acc-reg-msg', 'Keine Verbindung zum Server.', false); });
  }

  function _doLogin() {
    var u = _el('acc-log-user').value.trim(), p = _el('acc-log-pw').value;
    _setMsg('acc-log-msg', '…', true);
    Account.login(u, p).then(function (r) {
      if (r && r.ok) { _closeModals(); _renderBar(); if (typeof Account.onSync === 'function') Account.onSync('login'); }
      else { _setMsg('acc-log-msg', _errText(r), false); }
    }).catch(function () { _setMsg('acc-log-msg', 'Keine Verbindung zum Server.', false); });
  }

  function _doReset() {
    var u = _el('acc-res-user').value.trim(), c = _el('acc-res-code').value.trim(), p = _el('acc-res-pw').value;
    _setMsg('acc-res-msg', '…', true);
    Account.resetPassword(u, c, p).then(function (r) {
      if (r && r.ok) {
        _el('acc-res-newcode').textContent = r.recovery_code;
        _wireCopy('acc-res-copy', r.recovery_code);
        _show('acc-res-form', false); _show('acc-res-success', true);
      } else { _setMsg('acc-res-msg', _errText(r), false); }
    }).catch(function () { _setMsg('acc-res-msg', 'Keine Verbindung zum Server.', false); });
  }

  function _doLogout() {
    Account.logout().then(function () { _renderBar(); _toast('Abgemeldet.'); if (typeof Account.onSync === 'function') Account.onSync('logout'); });
  }

  function _doDelete() {
    _setMsg('acc-del-msg', '…', true);
    Account.deleteAccount().then(function (r) {
      if (r && r.ok) { _closeModals(); _renderBar(); _toast('Account gelöscht.'); }
      else { _setMsg('acc-del-msg', _errText(r), false); }
    }).catch(function () { _setMsg('acc-del-msg', 'Keine Verbindung zum Server.', false); });
  }

  var _saveState = null; // null = aus | 'saved' | 'saving' | 'unsaved' (Office-365-artig)

  function _statusIcon() {
    if (!_saveState) return '';
    var icons = {
      saved: '<span class="acc-status acc-status-saved" title="Fortschritt gespeichert"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></span>',
      saving: '<span class="acc-status acc-status-saving" title="Wird gespeichert…"><svg class="acc-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>',
      unsaved: '<span class="acc-status acc-status-unsaved" title="Nicht gespeichert"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>'
    };
    return ' ' + (icons[_saveState] || '');
  }

  function _renderBar() {
    var mounts = document.querySelectorAll('.account-bar');
    if (!mounts.length) return;
    var html = Account.isLoggedIn()
      ? '<span class="acc-who">' + _esc(Account.currentUser()) + ' <small>· angemeldet</small></span>' +
        _statusIcon() +
        '<button class="acc-btn ghost" data-acc="logout">Abmelden</button>' +
        '<button class="acc-btn acc-icon" data-acc="open-settings" title="Einstellungen" aria-label="Einstellungen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>'
      : '<button class="acc-btn ghost" data-acc="open-login">Anmelden</button>' +
        '<button class="acc-btn" data-acc="open-register">Registrieren</button>';
    for (var i = 0; i < mounts.length; i++) mounts[i].innerHTML = html;
  }

  function _onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-acc]') : null;
    if (!t) return;
    switch (t.getAttribute('data-acc')) {
      case 'close': _closeModals(); break;
      case 'reg-submit': _doRegister(); break;
      case 'login-submit': _doLogin(); break;
      case 'reset-submit': _doReset(); break;
      case 'open-login': _openModal('acc-m-login'); break;
      case 'open-register': _openModal('acc-m-register'); break;
      case 'open-reset': _openModal('acc-m-reset'); break;
      case 'logout': _doLogout(); break;
      case 'open-settings': _openModal('acc-m-settings'); break;
      case 'open-delete': _openModal('acc-m-delete'); break;
      case 'delete-confirm': _doDelete(); break;
    }
  }

  // ---- Idle-Auto-Logout (Schulgeräte-Schutz) ----
  var IDLE_MS = 30 * 60 * 1000; // 30 Minuten Inaktivität
  var _lastActivity = Date.now();
  function _markActivity() { _lastActivity = Date.now(); }
  function _idleCheck() {
    if (Account.isLoggedIn() && (Date.now() - _lastActivity) > IDLE_MS) {
      Account.logout().then(function () {
        _renderBar();
        _toast('Wegen Inaktivität abgemeldet.');
        if (typeof Account.onSync === 'function') Account.onSync('idle');
      });
    }
  }

  function _mountUI() {
    if (_el('acc-toast')) return; // schon montiert
    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    var wrap = document.createElement('div'); wrap.innerHTML = HTML;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    document.addEventListener('click', _onClick);
    _renderBar();
    // Aktivität verfolgen + jede Minute auf 60-Min-Inaktivität prüfen
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(function (ev) {
      document.addEventListener(ev, _markActivity, { passive: true });
    });
    setInterval(_idleCheck, 60000);
  }

  // UI-Hooks nach außen (z.B. für einen eigenen „Anmelden"-Button im Header)
  Account.openLogin = function () { _openModal('acc-m-login'); };
  Account.openRegister = function () { _openModal('acc-m-register'); };
  Account.renderBar = _renderBar;
  Account.toast = _toast;
  // Status-Anzeige aktivieren (Trainer rufen das beim Laden auf; Landing nicht).
  Account.enableSaveStatus = function () { _saveState = 'saved'; _renderBar(); };
  Account.saveStatus = function (s) { _saveState = s; _renderBar(); };

  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _mountUI);
    else _mountUI();
  }

  global.Account = Account;
})(window);
