#!/usr/bin/env node
// Build für Netlify (seit 20.11.2026): Root-Dateien sind die lesbare Quelle, dist/ die ausgelieferte Produktion.
// Konservativ: nur Kommentare und Leerraum entfernen (terser mit compress:false, mangle:false), keine Umformung der Logik,
// keine Umbenennung – darum bleibt jedes Verhalten identisch. Danach prüft _build/check.js jede Datei; schlägt das fehl,
// bricht der Netlify-Build ab und die alte Seite bleibt online.
// Aufruf: npm run build (dann npm run check) – lokal vor dem Push, auf Netlify per netlify.toml.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { minify: minifyHtml } = require('html-minifier-terser');
const terser = require('terser');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Alle Dateien, die im Repo liegen (git ls-files), außer Build-Zutaten – so wird genau das veröffentlicht, was bisher auch
// veröffentlicht wurde, nur kleiner.
const SKIP = /^(package\.json|package-lock\.json|netlify\.toml|_build\/|\.gitignore$)/;
const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(f => f && !SKIP.test(f));

const terserOpts = { compress: false, mangle: false, format: { comments: false } };

async function minifyJs(code, name) {
    const out = await terser.minify(code, terserOpts);
    if (out.error) throw new Error(name + ': ' + out.error);
    return out.code;
}

async function minifyPage(html, name) {
    return minifyHtml(html, {
        collapseWhitespace: true,
        conservativeCollapse: true,          // ein Leerzeichen bleibt, wo eins war (Textfluss unverändert)
        removeComments: true,
        minifyCSS: true,                     // nur Leerraum/Kommentare in <style>
        // Skriptblöcke über terser (synchron); Event-Handler in Attributen (onclick="… return false") bleiben unangetastet
        minifyJS: (code, inline) => { if (inline) return code; const r = terser.minify_sync(code, terserOpts); if (r.error) throw r.error; return r.code; },
        // bewusst aus: nichts an Attributen, Anführungszeichen oder Event-Handlern ändern
        removeAttributeQuotes: false, removeRedundantAttributes: false, removeEmptyAttributes: false,
        minifyURLs: false, sortAttributes: false, sortClassName: false, decodeEntities: false,
        keepClosingSlash: true, caseSensitive: true
    });
}

(async () => {
    fs.rmSync(dist, { recursive: true, force: true });
    let before = 0, after = 0;
    for (const f of files) {
        const src = path.join(root, f), dst = path.join(dist, f);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        if (/\.html$/.test(f)) {
            const html = fs.readFileSync(src, 'utf8');
            const out = await minifyPage(html, f);
            fs.writeFileSync(dst, out);
            before += html.length; after += out.length;
            console.log(`${f}: ${Math.round(html.length / 1024)} → ${Math.round(out.length / 1024)} KB`);
        } else if (/\.js$/.test(f) && !f.startsWith('_apps_script/')) {
            const js = fs.readFileSync(src, 'utf8');
            const out = await minifyJs(js, f);
            fs.writeFileSync(dst, out);
            before += js.length; after += out.length;
            console.log(`${f}: ${Math.round(js.length / 1024)} → ${Math.round(out.length / 1024)} KB`);
        } else {
            fs.copyFileSync(src, dst);
        }
    }
    console.log(`gesamt ${Math.round(before / 1024)} → ${Math.round(after / 1024)} KB (${Math.round(100 - after / before * 100)} % kleiner)`);
})().catch(e => { console.error('BUILD FEHLGESCHLAGEN:', e.message); process.exit(1); });
