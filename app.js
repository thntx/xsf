import ESpeakNg from './espeak-ng.js';

// ---- mapeig fonema IPA -> grafia XSF (mapping.txt) ----
let MAP = null;
async function loadMap() {
  if (MAP) return MAP;
  const txt = await (await fetch('mapping.txt')).text();
  MAP = {};
  for (const line of txt.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('->'); if (i < 0) continue;
    const ipa = line.slice(0, i).trim();
    let v = line.slice(i + 2); const h = v.indexOf('#'); if (h >= 0) v = v.slice(0, h);
    if (ipa) MAP[ipa] = v.trim();
  }
  return MAP;
}

// ---- espeak (motor del fork) : català -> IPA ----
async function toIPA(text, voice) {
  const m = await ESpeakNg({ arguments: ['--phonout', '_g', '--ipa', '--sep=_', '-q', '-v', voice, text], print: () => {}, printErr: () => {} });
  try { return m.FS.readFile('_g', { encoding: 'utf8' }).trim(); } catch (e) { return ''; }
}

// ---- IPA -> XSF (només mapeig + tonicitat; la fonologia la fa el motor) ----
function tokenizeWord(w) {
  // separador de fonemes "_"; treu accents (ˈ ˌ) i marques de durada/lligadura,
  // PERÒ conserva el diacrític dental U+032A (n̪) perquè es mapeja a una grafia pròpia.
  return w.split('_').filter(Boolean).map(tok => ({
    ph: tok.replace(/^[ˈˌ]+/, '').replace(/[ːʰ‿͡‍]/g, ''),
    stress: /^[ˈˌ]/.test(tok),
  })).filter(t => t.ph);
}
const VOWELS = new Set(['a', 'ɛ', 'e', 'i', 'ɔ', 'o', 'u', 'ə', 'ɐ', 'ʊ']);
function wordToXSF(toks, map, opts) {
  const keys = toks.map(t => (t.ph in map) ? map[t.ph] : '«' + t.ph + '»');
  const unknown = toks.filter(t => !(t.ph in map)).map(t => t.ph);
  // posició del + : just després de la síl·laba tònica. Si la vocal tònica NO té
  // consonant a davant, el + va després de la consonant següent (si en té una).
  const plusAt = new Set();
  if (opts.tonicitat) {
    toks.forEach((t, s) => {
      if (!t.stress) return;
      const onsetBefore = s > 0 && !VOWELS.has(toks[s - 1].ph);
      const p = (!onsetBefore && s + 1 < toks.length && !VOWELS.has(toks[s + 1].ph)) ? s + 1 : s;
      plusAt.add(p);
    });
  }
  let out = '';
  for (let i = 0; i < keys.length; i++) { out += keys[i]; if (plusAt.has(i)) out += (map['ˈ'] || '+'); }
  return { out, unknown };
}
async function convert(text, opts) {
  const map = await loadMap();
  const ipa = await toIPA(text, opts.dialecte || 'ca');
  const parts = [], unknown = new Set();
  for (const w of ipa.split(/\s+/).filter(Boolean)) {
    const r = wordToXSF(tokenizeWord(w), map, opts);
    parts.push(r.out); r.unknown.forEach(u => unknown.add(u));
  }
  return { xsf: parts.join(opts.espais ? ' ' : ''), ipa, unknown: [...unknown] };
}

// ---- UI ----
const $ = id => document.getElementById(id);
async function run() {
  const text = $('input').value.trim(); if (!text) return;
  $('status').textContent = 'transcrivint…';
  try {
    const r = await convert(text, { dialecte: $('dialecte').value, tonicitat: $('tonicitat').checked, espais: $('espais').checked });
    $('out').textContent = r.xsf;
    $('debug').textContent = 'IPA: ' + r.ipa + (r.unknown.length ? '\nsense mapeig: ' + r.unknown.join(' ') : '');
    $('status').textContent = ''; window._xsf = r.xsf;
  } catch (e) { $('status').textContent = 'error: ' + e.message; }
}
async function downloadImage() {
  const xsf = window._xsf; if (!xsf) return;
  const size = parseInt($('imgsize').value, 10) || 96;
  await document.fonts.load(size + 'px XSF');
  const pad = Math.round(size * 0.4), lines = xsf.split('\n');
  const meas = document.createElement('canvas').getContext('2d'); meas.font = size + 'px XSF';
  const w = Math.max(...lines.map(l => meas.measureText(l).width)) + pad * 2, lh = size * 1.3, h = lh * lines.length + pad * 2;
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const ctx = c.getContext('2d');
  if (!$('transparent').checked) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.fillStyle = $('color').value; ctx.font = size + 'px XSF'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lh));
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'xsf.png'; a.click();
}
$('go').addEventListener('click', run);
$('dl').addEventListener('click', downloadImage);
$('input').addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') run(); });
loadMap().then(() => { $('status').textContent = 'a punt'; });
