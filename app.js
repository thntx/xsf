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

// ---- IPA -> XSF ----
const VOWELS = new Set(['a', 'ɛ', 'e', 'i', 'ɔ', 'o', 'u', 'ə', 'ɐ', 'ʊ']);
async function convert(text, opts) {
  const map = await loadMap();
  const ipa = await toIPA(text, opts.dialecte || 'ca');
  // Tokens plans de TOTA la frase (amb índex de paraula). Cal mirar la frase sencera
  // perquè les LLIGATURES (consonant+vocal) poden travessar els límits de paraula quan
  // no es posen espais (p. ex. "claven àncores" -> ...n + à = "na").
  const toks = []; const unknown = new Set();
  ipa.split(/\s+/).filter(Boolean).forEach((w, wi) => {
    w.split('_').filter(Boolean).forEach(tok => {
      const stress = /^[ˈˌ]/.test(tok);
      const ph = tok.replace(/^[ˈˌ]+/, '').replace(/[ːʰ‿͡‍]/g, ''); // conserva el dental n̪ (U+032A)
      if (!ph) return;
      if (!(ph in map)) unknown.add(ph);
      toks.push({ key: (ph in map) ? map[ph] : '«' + ph + '»', vowel: VOWELS.has(ph), stress, w: wi });
    });
  });
  // i, j consecutius s'enganxen (formen lligatura) si són a la mateixa paraula, o sempre si no hi ha espais
  const adj = (i, j) => i >= 0 && j < toks.length && (toks[i].w === toks[j].w || !opts.espais);
  // GEMINACIÓ dins de grup consonàntic: si dues consonants IGUALS van juntes i una de les
  // dues queda ENTRE dues consonants (cluster de 3), la consonant intercalada se substitueix:
  //   ':' si és la SEGONA del parell · ';' si és la PRIMERA.   ttr -> t:r · rtt -> r;t
  if (opts.geminacio !== false) {
    const cons = i => i >= 0 && i < toks.length && !toks[i].vowel;
    const repl = [];
    for (let i = 0; i + 1 < toks.length; i++) {
      if (cons(i) && cons(i + 1) && toks[i].key === toks[i + 1].key && adj(i, i + 1)) {
        if (cons(i + 2) && adj(i + 1, i + 2)) repl.push([i + 1, ':']);   // segona, enmig -> :
        if (cons(i - 1) && adj(i - 1, i)) repl.push([i, ';']);          // primera, enmig -> ;
      }
    }
    repl.forEach(([i, ch]) => { toks[i].key = ch; });
  }
  // El + va DESPRÉS DE LA LLIGATURA de la vocal tònica (cal >=1 vocal i >=1 consonant):
  //  - vocal amb consonant enganxada al davant -> lligatura CV -> + just després de la vocal
  //  - si no, i la consonant de després és CODA (no s'enganxa a la vocal següent) -> + després d'ella
  //  - si no hi ha cap consonant a la lligatura (síl·laba oberta sense onset) -> + després de la vocal
  const plus = new Set();
  if (opts.tonicitat) {
    toks.forEach((t, s) => {
      if (!t.stress) return;
      let p = s;
      const prevC = adj(s - 1, s) && !toks[s - 1].vowel;
      if (!prevC && adj(s, s + 1) && !toks[s + 1].vowel) {
        const ligForward = adj(s + 1, s + 2) && toks[s + 2].vowel; // la consonant s'enganxa a la vocal de després
        if (!ligForward) p = s + 1;
      }
      plus.add(p);
    });
  }
  let out = '';
  toks.forEach((t, i) => {
    if (i > 0 && opts.espais && toks[i].w !== toks[i - 1].w) out += ' ';
    out += t.key;
    if (plus.has(i)) out += (map['ˈ'] || '+');
  });
  return { xsf: out, ipa, unknown: [...unknown] };
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
