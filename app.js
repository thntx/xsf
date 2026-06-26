import ESpeakNg from './espeak-ng.js';

// ---- mapeig fonema IPA -> grafia XSF (mapping.txt) ----
let MAP = null, RMAP = null, GRAPHS = null, IPAKEYS = null;
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
  // mapa INVERS grafia XSF -> IPA (mínima i integral; canònic per a les ambigües) + glides
  RMAP = {};
  const addR = (g, ipa) => { if (g && !(g in RMAP)) RMAP[g] = ipa; };
  for (const [ipa, g] of Object.entries(MAP)) { addR(g, ipa); addR(g.length === 1 ? integralOf(g) : g.toUpperCase(), ipa); }
  Object.assign(RMAP, { '1': 'ʃ', 'j': 'ʒ', 't1': 'tʃ', '3j': 'dʒ', '6': 'e̯', '2': 'o̯', '&': 'e̯', '"': 'o̯' });
  GRAPHS = [...new Set([...Object.keys(RMAP), '6', '2'])].filter(Boolean).sort((a, b) => b.length - a.length);
  IPAKEYS = Object.keys(MAP).sort((a, b) => b.length - a.length);
  return MAP;
}

// ---- espeak (motor del fork) : català -> IPA ----
async function toIPA(text, voice) {
  const m = await ESpeakNg({ arguments: ['--phonout', '_g', '--ipa', '--sep=_', '-q', '-v', voice, text], print: () => {}, printErr: () => {} });
  try { return m.FS.readFile('_g', { encoding: 'utf8' }).trim(); } catch (e) { return ''; }
}

// ---- fonètica ----
const VOWELS = new Set(['a', 'ɛ', 'e', 'i', 'ɔ', 'o', 'u', 'ə', 'ɐ', 'ʊ']);
const NEUTRAL = new Set(['ə', 'ɐ']);
const GLIDE = { i: 'y', u: 'w', e: '6', 'ɛ': '6', o: '2', 'ɔ': '2', 'ʊ': 'w' };
const SON = { a: 5, 'ɛ': 4, e: 4, 'ɔ': 4, o: 4, 'ə': 3, 'ɐ': 3, i: 2, u: 2, 'ʊ': 2 };
const QACC = { e: '́', o: '́', 'ɛ': '̀', 'ɔ': '̀' }; // accent de qualitat (agut/greu) a transferir al nucli quan e/o glida
const STRESS_RE = /^[ˈˌ]/;
const DIAC = /[ːʰ‿͡‍]/g;
const cls = v => ({ 'ɛ': 'e', 'ɔ': 'o', 'ɐ': 'ə', 'ʊ': 'u' }[v] || v);
// classe vocàlica acceptant tant AFI com grafia XSF (per a la llista de parells)
const VCLASS = { a: 'a', 'à': 'a', e: 'e', 'è': 'e', 'é': 'e', 'ɛ': 'e', i: 'i', 'í': 'i', o: 'o', 'ò': 'o', 'ó': 'o', 'ɔ': 'o', u: 'u', 'ú': 'u', x: 'ə', 'ə': 'ə', 'ɐ': 'ə' };
const vclass = t => VCLASS[t] || cls(t);
const NUMROW_SHIFT = { 'º': 'ª', '1': '!', '2': '"', '3': '·', '4': '$', '5': '%', '6': '&', '7': '/', '8': '(', '9': ')', '0': '=', "'": '?', '¡': '¿' };
const integralOf = c => NUMROW_SHIFT[c] || c.toUpperCase();

// ---- segmentadors ----
// IPA (sense _) -> paraules de fonemes [{ph,stress}] (greedy longest-match)
function ipaToWords(ipaText) {
  return ipaText.trim().split(/\s+/).filter(Boolean).map(word => {
    const toks = []; let i = 0;
    while (i < word.length) {
      let stress = false;
      while (word[i] === 'ˈ' || word[i] === 'ˌ') { stress = true; i++; }
      let m = null;
      for (const k of IPAKEYS) { if (k && word.startsWith(k, i)) { m = k; break; } }
      if (m) { toks.push({ ph: m, stress }); i += m.length; }
      else if (i < word.length) i++;
    }
    return toks;
  });
}
// XSF -> IPA (segmenta grafemes, mapa invers; '+' marca tònica a l'última vocal; espai = paraula).
// Retorna format espeak: fonemes units per '_', paraules per espai.
function xsfToIpa(xsf) {
  const words = []; let cur = []; let lastVowel = -1; let i = 0;
  const flush = () => { if (cur.length) words.push(cur.join('_')); cur = []; lastVowel = -1; };
  while (i < xsf.length) {
    if (xsf[i] === ' ') { flush(); i++; continue; }
    if (xsf[i] === '+') { if (lastVowel >= 0) cur[lastVowel] = 'ˈ' + cur[lastVowel]; i++; continue; }
    let g = null;
    for (const cand of GRAPHS) { if (cand && xsf.startsWith(cand, i)) { g = cand; break; } }
    if (g) { const ipa = RMAP[g] ?? g; if (VOWELS.has(ipa)) lastVowel = cur.length; cur.push(ipa); i += g.length; }
    else { cur.push(xsf[i]); i++; }
  }
  flush();
  return words.join(' ');
}

// ---- nucli: processa paraules de fonemes -> {xsf, ipa} ----
function processWords(words, srcWords, opts) {
  const toks = []; const unknown = new Set(); const map = MAP;
  words.forEach((wt, wi) => wt.forEach(({ ph, stress }) => {
    if (!ph) return;
    const p = ph.replace(DIAC, '');
    if (!(p in map)) unknown.add(p);
    toks.push({ ph: p, key: (p in map) ? map[p] : '«' + p + '»', vowel: VOWELS.has(p), neutral: NEUTRAL.has(p), stress, w: wi, word: srcWords ? (srcWords[wi] || '') : '', glide: false, dead: false });
  }));

  if (opts.diftongs && opts.pairs.size) {
    for (let i = 0; i + 1 < toks.length; i++) {
      const a = toks[i], b = toks[i + 1];
      if (a.dead || b.dead || !a.vowel || !b.vowel || a.glide || b.glide) continue;
      if (!opts.pairs.has(cls(a.ph) + cls(b.ph))) continue;
      let gi;
      if (a.neutral && !b.neutral) gi = i + 1;
      else if (b.neutral && !a.neutral) gi = i;
      else if ((SON[a.ph] || 3) <= (SON[b.ph] || 3)) gi = i;
      else gi = i + 1;
      const g = toks[gi], nuc = toks[gi === i ? i + 1 : i], gl = GLIDE[g.ph];
      if (!gl) continue;
      if (g.stress && 'iuʊ'.includes(g.ph)) continue;
      g.key = gl; g.glide = true; g.vowel = false;
      if (QACC[g.ph]) nuc.key += QACC[g.ph];               // transfereix l'accent de qualitat (é→6: la x agafa l'agut → x́)
      if (g.stress) { g.stress = false; nuc.stress = true; }
    }
  }
  if (opts.elisio) {
    for (let i = 0; i + 1 < toks.length; i++) {
      const a = toks[i], b = toks[i + 1];
      if (a.dead || b.dead || a.w === b.w || !a.vowel || !b.vowel) continue;
      if (opts.except.has(a.word) || opts.except.has(b.word)) continue;
      if (a.neutral && b.neutral) { if (b.stress) a.dead = true; else b.dead = true; }
      else if (a.neutral) a.dead = true;
      else if (b.neutral) b.dead = true;
    }
  }

  const live = toks.filter(t => !t.dead);
  let ipaShow = ''; let lastW = -1;
  live.forEach(t => { if (lastW !== -1 && t.w !== lastW) ipaShow += ' '; lastW = t.w; ipaShow += (t.stress ? 'ˈ' : '') + t.ph + (t.glide ? '̯' : ''); });

  const adj = (i, j) => i >= 0 && j < live.length && (live[i].w === live[j].w || !opts.espais);
  // PENJADES: cada vocal s'aparella amb el seu ONSET (consonant abans -> glif CV) o, si no en té,
  // amb la CODA (consonant després -> glif VC, p.ex. "el"). Tot el que queda sense aparellar PENJA.
  // (Governa la caixa d'integrals i la geminació; la tònica ja es col·loca a part i és correcta.)
  for (const t of live) t.comp = false;
  for (let i = 0; i + 1 < live.length; i++)              // passada 1: CV (onset + vocal)
    if (!live[i].vowel && live[i + 1].vowel && adj(i, i + 1) && !live[i].comp && !live[i + 1].comp) { live[i].comp = true; live[i + 1].comp = true; }
  for (let i = 0; i < live.length; i++)                  // passada 2: VC (vocal sense onset + coda)
    if (live[i].vowel && !live[i].comp && i + 1 < live.length && !live[i + 1].vowel && adj(i, i + 1) && !live[i + 1].comp) { live[i].comp = true; live[i + 1].comp = true; }
  // GEMINACIÓ: dues consonants iguals adjacents amb almenys UNA penjant -> es marca la PENJADA:
  // ';' si és la primera (i sempre que totes dues pengin), ':' si només penja la segona.
  if (opts.geminacio) {
    for (let i = 0; i + 1 < live.length; i++) {
      const a = live[i], b = live[i + 1];
      if (a.vowel || b.vowel || a.key !== b.key || !adj(i, i + 1) || ':;'.includes(a.key) || ':;'.includes(b.key)) continue;
      if (!a.comp) a.key = ';';
      else if (!b.comp) b.key = ':';
    }
  }
  // INTEGRALS: la COMPOSTA puja segons el sistema (ktb=consonant, bkk=vocal); les PENJADES només
  // pugen si s'activa l'opció corresponent.
  for (const t of live) {
    if (':;'.includes(t.key)) continue;
    const integral = t.vowel
      ? ((t.comp && opts.sistema === 'bkk') || (!t.comp && opts.upHangVow))
      : ((t.comp && opts.sistema === 'ktb') || (!t.comp && opts.upHangCons));
    if (integral) t.key = t.vowel ? t.key.toUpperCase() : (t.key.length === 1 ? integralOf(t.key) : t.key.toUpperCase());
  }
  const plus = new Set();
  if (opts.tonicitat) {
    live.forEach((t, s) => {
      if (!t.stress) return;
      let p = s;
      const prevC = adj(s - 1, s) && !live[s - 1].vowel;
      if (!prevC && adj(s, s + 1) && !live[s + 1].vowel) {
        const ligForward = adj(s + 1, s + 2) && live[s + 2].vowel;
        if (!ligForward) p = s + 1;
      }
      plus.add(p);
    });
  }
  let out = '';
  live.forEach((t, i) => {
    if (i > 0 && opts.espais && live[i].w !== live[i - 1].w) out += ' ';
    out += t.key;
    if (plus.has(i)) out += (map['ˈ'] || '+');
  });
  return { xsf: out, ipa: ipaShow, unknown: [...unknown] };
}

// ---- modes ----
async function convert(text, opts) {
  await loadMap();
  if (opts.mode === 'xsf-afi') return { afi: xsfToIpa(text).replace(/_/g, ''), unknown: [] };

  let words, srcWords = null;
  if (opts.mode === 'afi-xsf') {
    words = ipaToWords(text);
  } else { // cat-xsf / cat-afi : espeak
    // SUBSTITUCIONS (en grafia XSF) -> IPA, injectades a l'AFI per posició
    const subsIpa = new Map();
    for (const [w, x] of opts.subs) subsIpa.set(w, xsfToIpa(x).split(' ')[0]);
    const piped = text.trim().split(/\s+/).join('|');
    let ipa = await toIPA(piped, opts.dialecte || 'ca');
    const ipaW = ipa.split(/\s+/).filter(Boolean);
    srcWords = text.toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}·]/gu, '')).filter(Boolean);
    if (ipaW.length === srcWords.length) {
      for (let i = 0; i < srcWords.length; i++) if (subsIpa.has(srcWords[i])) ipaW[i] = subsIpa.get(srcWords[i]);
    } else srcWords = null;
    words = ipaW.map(w => w.split('_').filter(Boolean).map(tok => ({ ph: tok.replace(/^[ˈˌ]+/, ''), stress: STRESS_RE.test(tok) })));
  }
  const r = processWords(words, srcWords, opts);
  return { xsf: r.xsf, afi: r.ipa, unknown: r.unknown };
}

// ---- opcions editables (textareas) amb persistència ----
const DEFAULTS = {
  pairs: 'e x\no x\ni o\nx i\nx u',
  except: '',
  subs: 'però  prò+',
};
function parsePairs(s) {
  const set = new Set();
  s.split('\n').forEach(l => { const p = l.trim().split(/\s+/); if (p.length >= 2) set.add(vclass(p[0]) + vclass(p[1])); });
  return set;
}
function parseWords(s) { return new Set(s.split(/[\s,]+/).map(w => w.trim().toLowerCase()).filter(Boolean)); }
function parseSubs(s) {
  const m = new Map();
  s.split('\n').forEach(l => { const p = l.trim().split(/\s+/); if (p.length >= 2) m.set(p[0].toLowerCase(), p.slice(1).join(' ')); });
  return m;
}

// ---- UI ----
const $ = id => document.getElementById(id);
const OUT_XSF = m => m === 'cat-xsf' || m === 'afi-xsf';   // la sortida és XSF (font XSF); si no, AFI (mono)
function readOpts() {
  return {
    mode: $('mode').value,
    dialecte: $('dialecte').value,
    tonicitat: $('tonicitat').checked,
    espais: $('espais').checked,
    geminacio: $('geminacio').checked,
    sistema: $('sistema').value,
    elisio: $('elisio').checked,
    diftongs: $('diftongs').checked,
    upHangVow: $('uphangv').checked,
    upHangCons: $('uphangc').checked,
    pairs: parsePairs($('pairs').value),
    except: parseWords($('except').value),
    subs: parseSubs($('subs').value),
  };
}
async function run() {
  const text = $('input').value.trim(); if (!text) return;
  const opts = readOpts();
  $('status').textContent = 'transcrivint…';
  try {
    const r = await convert(text, opts);
    const xsfOut = OUT_XSF(opts.mode);
    $('out').classList.toggle('afi', !xsfOut);
    $('out').textContent = xsfOut ? r.xsf : r.afi;
    $('debug').textContent = (xsfOut && opts.mode === 'cat-xsf') ? ('AFI: ' + r.afi) : '';
    if (r.unknown && r.unknown.length) $('debug').textContent += (xsfOut ? '\n' : '') + 'sense mapeig: ' + r.unknown.join(' ');
    $('status').textContent = ''; window._out = $('out').textContent; window._xsf = xsfOut;
  } catch (e) { $('status').textContent = 'error: ' + e.message; }
}
function syncMode() {
  const m = $('mode').value;
  const ph = { 'cat-xsf': 'text en català…', 'cat-afi': 'text en català…', 'afi-xsf': 'text en AFI…', 'xsf-afi': 'text en XSF…' };
  $('input').placeholder = ph[m] + '  (Ctrl+Enter)';
  $('catonly').style.display = (m === 'cat-xsf' || m === 'cat-afi') ? '' : 'none';
}
async function downloadImage() {
  if (!window._xsf) return;                               // només quan la sortida és XSF
  const xsf = window._out; if (!xsf) return;
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
function initOpts() {
  for (const id of ['pairs', 'except', 'subs']) {
    const saved = localStorage.getItem('xsf_' + id);
    $(id).value = (saved !== null) ? saved : DEFAULTS[id];
    $(id).addEventListener('input', () => { localStorage.setItem('xsf_' + id, $(id).value); });
  }
}
$('go').addEventListener('click', run);
['mode', 'dialecte', 'tonicitat', 'espais', 'geminacio', 'sistema', 'elisio', 'diftongs', 'uphangv', 'uphangc'].forEach(id => $(id).addEventListener('change', () => { if (id === 'mode') syncMode(); run(); }));
$('dl').addEventListener('click', downloadImage);
$('input').addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') run(); });
initOpts(); syncMode();
loadMap().then(() => { $('status').textContent = 'a punt'; });
