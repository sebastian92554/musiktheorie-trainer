#!/usr/bin/env node
// Prüft dist/ nach dem Minifizieren; jeder Fehler bricht den Build ab (Netlify behält dann die alte Seite).
// 1) Jeder <script>-Block jeder Seite und jede .js-Datei muss sich fehlerfrei einlesen lassen.
// 2) Feste Anker müssen vorhanden sein (Skilltree, Lernkarten, Stufen, Konto, Register, Tracking).
// 3) Die Zahl der <script>-Blöcke muss der Quelle entsprechen; keine Datei darf gewachsen sein.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..'), dist = path.join(root, 'dist');
const TRAINER = ['notentrainer.html', 'intervalltrainer.html', 'dreiklangstrainer.html', 'tonleitertrainer.html', 'rhythmustrainer.html'];
const ANKER = {
    trainer: ['quickStart', 'lernkartenContent', 'nodeSubSkills', '_stufenHtml', 'stNextCard', 'skilltreeView', 'stufenView', 'Account.onSync', 'woranPanel', 'heartbeat', 'openDeepLinkKnoten', 'src="register.js" defer', 'src="account.js" defer'],
    'index.html': ['const REGISTER', 'renderLernstand', 'renderStufen', 'lpSwitch', 'targetHref', 'src="account.js" defer'],
    'account.js': ['PROGRESS_KEYS', 'Account.onSync', '_mountUI'],
    'register.js': ['const REGISTER', 'prefix:']
};
const errors = [];
// 0) dist muss vollständig sein: jede im Repo liegende Datei (außer Build-Zutaten) muss in dist liegen
const { execSync } = require('child_process');
const SKIP = /^(package\.json|package-lock\.json|netlify\.toml|_build\/|\.gitignore$)/;
execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(f => f && !SKIP.test(f)).forEach(f => { if (!fs.existsSync(path.join(dist, f))) errors.push(`${f}: fehlt in dist`); });
function scripts(html) { return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(m => !/src=/.test(m[0].slice(0, 80))).map(m => m[1]); }
function parse(code, name) { try { new vm.Script(code, { filename: name }); } catch (e) { errors.push(`${name}: ${e.message}`); } }
for (const f of fs.readdirSync(dist).filter(f => /\.(html|js)$/.test(f))) {
    const out = fs.readFileSync(path.join(dist, f), 'utf8'), src = fs.readFileSync(path.join(root, f), 'utf8');
    if (out.length > src.length) errors.push(`${f}: dist ist größer als die Quelle`);
    if (f.endsWith('.js')) parse(out, f);
    else {
        const a = scripts(out), b = scripts(src);
        if (a.length !== b.length) errors.push(`${f}: ${a.length} statt ${b.length} Skriptblöcke`);
        a.forEach((code, i) => parse(code, `${f} [script ${i + 1}]`));
    }
    const anker = TRAINER.includes(f) ? ANKER.trainer : ANKER[f];
    (anker || []).forEach(k => { if (!out.includes(k)) errors.push(`${f}: Anker „${k}“ fehlt` + (src.includes(k) ? '' : ' (auch in der Quelle – Prüfliste anpassen)')); });
}
if (errors.length) { console.error('PRÜFUNG FEHLGESCHLAGEN:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('Prüfung bestanden: alle Skripte lesbar, alle Anker vorhanden.');
