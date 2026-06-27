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
const SANDHI_VOICE = { s: 'z', 'ʃ': 'ʒ', ts: 'dz', 'tʃ': 'dʒ' }; // sibilants/africades sordes -> sonores davant vocal (sandhi)
// ---- prosòdia: mecàniques de contacte de vocals ----
// quina de les dues vocals glida en un diftong ('a'|'b'|null). La neutra (ə) mai glida -> és el nucli.
function glideMember(a, b) {
  if (a.neutral && b.neutral) return null;
  if (a.neutral) return 'b';
  if (b.neutral) return 'a';
  if (a.stress && !b.stress) return 'b';
  if (b.stress && !a.stress) return 'a';
  return (SON[a.ph] || 3) <= (SON[b.ph] || 3) ? 'a' : 'b';   // glida la de menys sonoritat
}
// quina vocal s'elideix ('a'|'b'): es manté la tònica; entre àtones cau la neutra; si no, la primera.
function elideMember(a, b) {
  if (a.stress && !b.stress) return 'b';
  if (b.stress && !a.stress) return 'a';
  if (a.neutral && !b.neutral) return 'a';
  if (b.neutral && !a.neutral) return 'b';
  return 'a';
}
function applyContact(beh, a, b) {
  if (beh === 'elide') { const m = elideMember(a, b); (m === 'a' ? a : b).dead = true; return; }
  if (beh === 'diftong') {
    const m = glideMember(a, b); if (!m) return;
    const g = m === 'a' ? a : b, nuc = m === 'a' ? b : a, gl = GLIDE[g.ph];
    if (!gl) return;                                          // sense forma de semivocal (a) -> hiat
    g.key = gl; g.glide = true; g.vowel = false;
    if (QACC[g.ph]) nuc.key += QACC[g.ph];                   // l'accent de qualitat (é/ò…) passa al nucli
    if (g.stress) { g.stress = false; nuc.stress = true; }   // i la tonicitat també
  }
}
// X/A = la classe vocàlica "neutra o a" (es tracten com una sola vocal). Mai glida (és nucli).
const isXA = t => t.neutral || cls(t.ph) === 'a';
const fuseKey = t => isXA(t) ? 'a' : t.ph;                    // ɛ/e/ɔ/o/u/i distingits per a la fusió
// PROSÒDIA INTERLÈXICA: contacte de vocals de dues paraules diferents -> comportament segons opcions
function interlexContact(a, b, o) {
  // FUSIONAR VOCALS IGUALS (per qualitat; X/A compta com una sola vocal)
  if (fuseKey(a) === fuseKey(b) && o.fuse.has(fuseKey(a))) return 'elide';
  const xaA = isXA(a), xaB = isXA(b);
  if (xaA && !a.stress && b.stress && !xaB) {                // X/A + tònica
    const q = cls(b.ph);
    if (q === 'i') return o.sxI;
    if (q === 'u') return o.sxU;
    if (q === 'o') return o.sxO;
    return o.sxE;                                            // e
  }
  if (!xaA && a.stress && xaB && !b.stress) {                // tònica + X/A
    const q = cls(a.ph);
    if (q === 'i') return o.xsI;
    if (q === 'u') return o.xsU;
    if (q === 'o') return o.xsO;
    return o.xsE;                                            // e
  }
  // arrodonir àtones: glida la vocal PLENA àtona (no la neutra) si la seva qualitat està activada
  const at = (!a.stress && !a.neutral) ? a : ((!b.stress && !b.neutral) ? b : null);
  if (at && o.round.has(cls(at.ph)) && GLIDE[at.ph]) return 'diftong';
  return 'hiat';
}
const STRESS_RE = /^[ˈˌ]/;
const DIAC = /[ːʰ‿͡‍]/g;
const cls = v => ({ 'ɛ': 'e', 'ɔ': 'o', 'ɐ': 'ə', 'ʊ': 'u' }[v] || v);
const NUMROW_SHIFT ={ 'º': 'ª', '1': '!', '2': '"', '3': '·', '4': '$', '5': '%', '6': '&', '7': '/', '8': '(', '9': ')', '0': '=', "'": '?', '¡': '¿' };
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

  // SANDHI: sibilant/africada SORDA final de paraula sonoritza si la paraula següent comença per
  // vocal (falciots alats -> ...ɔdz əlats; peix alat -> peʒ). El motor ho fa amb la 's' simple
  // (els->əlz) però no amb l'africada -ts ni amb 'ʃ' (el truc del '|' la hi bloca); ho cobrim aquí.
  for (let i = 0; i + 1 < toks.length; i++) {
    const t = toks[i], n = toks[i + 1];
    if (t.w !== n.w && n.vowel && SANDHI_VOICE[t.ph]) {
      t.ph = SANDHI_VOICE[t.ph];
      t.key = (t.ph in map) ? map[t.ph] : '«' + t.ph + '»';
    }
  }

  // PROSÒDIA INTERLÈXICA: contacte de vocals entre paraules diferents (els diftongs interns
  // de paraula els deixem tal com els fa el motor).
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i], b = toks[i + 1];
    if (a.dead || b.dead || a.glide || b.glide || !a.vowel || !b.vowel || a.w === b.w) continue;
    applyContact(interlexContact(a, b, opts), a, b);
  }

  const live = toks.filter(t => !t.dead);
  let ipaShow = ''; let lastW = -1;
  live.forEach(t => { if (lastW !== -1 && t.w !== lastW && opts.espais) ipaShow += ' '; lastW = t.w; ipaShow += (t.stress ? 'ˈ' : '') + t.ph + (t.glide ? '̯' : ''); });

  const adj = (i, j) => i >= 0 && j < live.length && (live[i].w === live[j].w || !opts.espais);
  // PENJADES: cada vocal s'aparella amb el seu ONSET (consonant abans -> glif CV) o, si no en té,
  // amb la CODA (consonant després -> glif VC, p.ex. "el"). Tot el que queda sense aparellar PENJA.
  // (Governa la caixa d'integrals i la geminació; la tònica ja es col·loca a part i és correcta.)
  let grpN = 0;
  for (const t of live) { t.comp = false; t.grp = -1; }
  for (let i = 0; i + 1 < live.length; i++)              // passada 1: CV (onset + vocal)
    if (!live[i].vowel && live[i + 1].vowel && adj(i, i + 1) && !live[i].comp && !live[i + 1].comp) { live[i].comp = live[i + 1].comp = true; live[i].grp = live[i + 1].grp = grpN++; }
  for (let i = 0; i < live.length; i++)                  // passada 2: VC (vocal sense onset + coda)
    if (live[i].vowel && !live[i].comp && i + 1 < live.length && !live[i + 1].vowel && adj(i, i + 1) && !live[i + 1].comp) { live[i].comp = live[i + 1].comp = true; live[i].grp = live[i + 1].grp = grpN++; }
  for (const t of live) if (t.grp === -1) t.grp = grpN++;   // penjades: grup propi (oportunitat de tall)
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
    if (integral) t.key = t.vowel ? t.key.toUpperCase() : [...t.key].map(integralOf).join(''); // integral CARÀCTER a caràcter (3j->·J)
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
  // out = net (per a la imatge/dades); outD = amb U+200B als límits de composite -> oportunitats
  // de tall que MAI parteixen una lligatura, per a la visualització en pantalla.
  let out = '', outD = '';
  live.forEach((t, i) => {
    if (i > 0) {
      if (opts.espais && live[i].w !== live[i - 1].w) { out += ' '; outD += ' '; }
      else if (live[i].grp !== live[i - 1].grp) outD += '​';
    }
    out += t.key; outD += t.key;
    if (plus.has(i)) { const p = (map['ˈ'] || '+'); out += p; outD += p; }
  });
  return { xsf: out, xsfD: outD, ipa: ipaShow, unknown: [...unknown] };
}

// ---- modes ----
// converteix UNA línia (sense salts); el contacte de vocals no creua mai un salt de línia
async function convertLine(text, opts) {
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
  return { xsf: r.xsf, xsfD: r.xsfD, afi: r.ipa, unknown: r.unknown };
}
// processa el text sencer mantenint els SALTS DE LÍNIA (cada línia per separat)
async function convert(text, opts) {
  await loadMap();
  const xs = [], xsd = [], af = [], unk = new Set();
  for (const ln of text.split('\n')) {
    if (!ln.trim()) { xs.push(''); xsd.push(''); af.push(''); continue; }
    const r = await convertLine(ln, opts);
    xs.push(r.xsf ?? ''); xsd.push(r.xsfD ?? r.xsf ?? ''); af.push(r.afi ?? '');
    (r.unknown || []).forEach(u => unk.add(u));
  }
  return { xsf: xs.join('\n'), xsfD: xsd.join('\n'), afi: af.join('\n'), unknown: [...unk] };
}

// ---- llista interactiva de substitucions (amb persistència) ----
const SUBS_DEF = [['però', 'prò+']];
let getSubs;
function subsFrom(arr) { const m = new Map(); arr.forEach(([w, x]) => { if (w && x) m.set(w.trim().toLowerCase(), x.trim()); }); return m; }
function buildList(host, key, defaults, fields, onchange) {
  let data;
  try { const s = JSON.parse(localStorage.getItem(key)); data = Array.isArray(s) ? s : null; } catch (e) { data = null; }
  if (!data) data = defaults.map(r => r.slice());
  const save = () => { localStorage.setItem(key, JSON.stringify(data)); onchange(); };
  function render() {
    host.innerHTML = '';
    data.forEach((row, i) => {
      const r = document.createElement('div'); r.className = 'lrow';
      fields.forEach((f, c) => {
        const inp = document.createElement('input'); inp.className = 'lin' + (f.wide ? ' lsub' : ''); inp.placeholder = f.ph || ''; inp.value = row[c] || '';
        inp.addEventListener('input', () => { data[i][c] = inp.value; save(); });
        r.appendChild(inp);
      });
      const x = document.createElement('button'); x.className = 'lx'; x.textContent = '✕'; x.title = 'elimina';
      x.addEventListener('click', () => { data.splice(i, 1); save(); render(); });
      r.appendChild(x); host.appendChild(r);
    });
    const btns = document.createElement('div'); btns.className = 'lbtns';
    const add = document.createElement('button'); add.className = 'sec'; add.textContent = '+ Afegir';
    add.addEventListener('click', () => { data.push(fields.map(() => '')); save(); render(); });
    btns.appendChild(add); host.appendChild(btns);
  }
  render();
  return () => data;
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
    upHangVow: $('uphangv').checked,
    upHangCons: $('uphangc').checked,
    fuse: new Set([['fus_a', 'a'], ['fus_i', 'i'], ['fus_E', 'ɛ'], ['fus_e', 'e'], ['fus_u', 'u'], ['fus_O', 'ɔ'], ['fus_o', 'o']].filter(([id]) => $(id).checked).map(([, k]) => k)),
    sxE: $('sx_e').value, sxI: $('sx_i').value, sxU: $('sx_u').value, sxO: $('sx_o').value,
    xsE: $('xs_e').value, xsI: $('xs_i').value, xsU: $('xs_u').value, xsO: $('xs_o').value,
    round: new Set(['i', 'e', 'u', 'o'].filter(q => $('prnd_' + q).checked)),
    subs: subsFrom(getSubs()),
  };
}
async function run() {
  const text = $('input').value; if (!text.trim()) return;   // value sense trim: conserva els salts interns
  const opts = readOpts();
  $('status').textContent = 'transcrivint…';
  try {
    const r = await convert(text, opts);
    const xsfOut = OUT_XSF(opts.mode);
    $('out').classList.toggle('afi', !xsfOut);
    $('out').textContent = xsfOut ? (r.xsfD || r.xsf) : r.afi;   // display amb oportunitats de tall (U+200B)
    $('debug').textContent = (r.unknown && r.unknown.length) ? ('sense mapeig: ' + r.unknown.join(' ')) : '';
    $('status').textContent = ''; window._out = xsfOut ? r.xsf : r.afi; window._outD = xsfOut ? (r.xsfD || r.xsf) : ''; window._xsf = xsfOut;   // _out net; _outD amb punts de tall per a l'ajust de la imatge
    updatePreview();
  } catch (e) { $('status').textContent = 'error: ' + e.message; }
}
function syncMode() {
  const m = $('mode').value;
  const ph = { 'cat-xsf': 'text en català…', 'cat-afi': 'text en català…', 'afi-xsf': 'text en AFI…', 'xsf-afi': 'text en XSF…' };
  $('input').placeholder = ph[m];
  $('catonly').style.display = (m === 'cat-xsf' || m === 'cat-afi') ? '' : 'none';
  $('ortobox').style.display = OUT_XSF(m) ? '' : 'none';   // les opcions ortogràfiques només per a sortida XSF
  $('imgbox').style.display = OUT_XSF(m) ? '' : 'none';    // la imatge és en font XSF -> només per a sortida XSF
}
// ---- imatge: canvas de dimensions fixes; ajusta el text en línies (per espais, o si no n'hi ha,
// per composites/lligatures) i fa la lletra tan gran com cap, OMPLINT el canvas. ----
function imgOpts() {
  const num = (id, d) => { const v = parseFloat($(id).value); return isNaN(v) ? d : v; };
  return { W: Math.max(1, Math.round(num('imgw', 1920))), H: Math.max(1, Math.round(num('imgh', 1080))),
           padPct: Math.min(45, Math.max(0, num('imgpad', 5))), lh: num('imglh', 1) || 1,
           color: $('color').value, bg: $('bgcolor').value, transparent: $('transparent').checked, align: $('imgalign').value };
}
function drawRow(ctx, row, padX, innerW, by, align) {
  if (!row.items.length) return;
  if (align.startsWith('justify') && row.hasSpace && row.items.length > 1 && !row.last) {  // justifica: reparteix l'espai
    const sum = row.items.reduce((a, it) => a + it.w, 0), gap = (innerW - sum) / (row.items.length - 1);
    let x = padX; ctx.textAlign = 'left';
    for (const it of row.items) { ctx.fillText(it.a, x, by); x += it.w + gap; }
    return;
  }
  const str = row.items.map(it => it.a).join(row.hasSpace ? ' ' : '');
  const mode = align === 'justify' ? 'left' : align === 'justify-center' ? 'center' : align;   // files no estirables
  if (mode === 'center') { ctx.textAlign = 'center'; ctx.fillText(str, padX + innerW / 2, by); }
  else if (mode === 'right') { ctx.textAlign = 'right'; ctx.fillText(str, padX + innerW, by); }
  else { ctx.textAlign = 'left'; ctx.fillText(str, padX, by); }
}
async function renderTo(c) {                               // pinta al canvas c; retorna la mida de lletra (px) o 0
  const src = window._outD || window._out;
  if (!window._xsf || !src || !src.trim()) { c.width = c.height = 0; return 0; }
  const o = imgOpts();
  c.width = o.W; c.height = o.H;
  const ctx = c.getContext('2d');
  if (!o.transparent) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, o.W, o.H); }
  const padX = o.W * o.padPct / 100, padY = o.H * o.padPct / 100;
  const innerW = Math.max(1, o.W - 2 * padX), innerH = Math.max(1, o.H - 2 * padY);
  const REF = 200;
  await document.fonts.load(REF + 'px XSF');
  ctx.font = REF + 'px XSF';
  const ZW = /​/g;
  // línies dures -> àtoms: PARAULES si hi ha espais; si no, COMPOSITES (per no tallar lligatures)
  const hard = src.split('\n').map(raw => {
    const hasSpace = raw.includes(' ');
    const atoms = (hasSpace ? raw.split(' ') : raw.split('​')).map(a => a.replace(ZW, '')).filter(a => a.length);
    return { hasSpace, atoms };
  });
  let maxAsc = 0, maxDesc = 0; const spaceW = ctx.measureText(' ').width;
  const wref = hard.map(hl => hl.atoms.map(a => {           // amplada de cada àtom + ascens/descens reals (per als accents)
    const m = ctx.measureText(a);
    maxAsc = Math.max(maxAsc, m.actualBoundingBoxAscent || REF * 0.8);
    maxDesc = Math.max(maxDesc, m.actualBoundingBoxDescent || REF * 0.25);
    return m.width;
  }));
  const extra = maxAsc + maxDesc, lhExtraRef = Math.max(0, o.lh - 1) * REF;   // ink d'una línia (a REF)
  // avanç entre línies base = ink màxim teòric + 2px mínims (interlínia 1) + extra si interlínia > 1.
  // Així una línia amb cua/+ avall i l'accent de la següent no es toquen mai.
  const advAt = scale => scale * (extra + lhExtraRef) + 2;
  function layout(scale) {                                 // distribueix els àtoms en files a una escala
    const sw = spaceW * scale; let ok = true; const rows = []; let maxW = 0;
    hard.forEach((hl, hi) => {
      if (!hl.atoms.length) { rows.push({ items: [], w: 0, last: true, hasSpace: hl.hasSpace }); return; }
      let cur = [], curW = 0;
      for (let k = 0; k < hl.atoms.length; k++) {
        const w = wref[hi][k] * scale; if (w > innerW + 0.5) ok = false;
        const add = cur.length ? (hl.hasSpace ? sw : 0) + w : w;
        if (cur.length && curW + add > innerW) { rows.push({ items: cur, w: curW, last: false, hasSpace: hl.hasSpace }); maxW = Math.max(maxW, curW); cur = [{ a: hl.atoms[k], w }]; curW = w; }
        else { cur.push({ a: hl.atoms[k], w }); curW += add; }
      }
      rows.push({ items: cur, w: curW, last: true, hasSpace: hl.hasSpace }); maxW = Math.max(maxW, curW);
    });
    return { rows, maxW, height: scale * extra + (rows.length - 1) * advAt(scale), ok };
  }
  let lo = 0, hi = innerH / extra;                          // cerca binària de l'escala més gran que cap
  for (let it = 0; it < 42; it++) {
    const mid = (lo + hi) / 2, L = layout(mid);
    if (L.ok && L.height <= innerH && L.maxW <= innerW) lo = mid; else hi = mid;
  }
  const scale = lo, S = REF * scale, L = layout(scale);
  await document.fonts.load(S + 'px XSF');
  ctx.font = S + 'px XSF'; ctx.fillStyle = o.color; ctx.textBaseline = 'alphabetic';
  const advance = advAt(scale);
  let by = padY + (innerH - L.height) / 2 + maxAsc * scale; // baseline de la primera fila (deixa espai per a l'accent)
  for (const row of L.rows) { drawRow(ctx, row, padX, innerW, by, o.align); by += advance; }
  return Math.round(S);
}
async function updatePreview() {
  const prev = $('imgprev'); if (!prev) return;
  const s = await renderTo(prev);
  $('imgmeta').textContent = s ? (prev.width + ' × ' + prev.height + ' px · lletra ' + s + ' px') : '—';
  $('dl').disabled = $('copyimg').disabled = !s;
}
async function downloadImage() {
  const c = document.createElement('canvas'); if (!(await renderTo(c))) return;
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'xsf.png'; a.click();
}
async function copyImage() {
  const c = document.createElement('canvas'); if (!(await renderTo(c))) return;
  try {
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    $('imgmeta').textContent = 'copiat al porta-retalls ✓';
  } catch (e) { $('imgmeta').textContent = 'el navegador no permet copiar imatges'; }
}
['mode', 'dialecte', 'tonicitat', 'espais', 'geminacio', 'sistema', 'uphangv', 'uphangc', 'fus_a', 'fus_i', 'fus_E', 'fus_e', 'fus_u', 'fus_O', 'fus_o', 'sx_e', 'sx_i', 'sx_u', 'sx_o', 'xs_e', 'xs_i', 'xs_u', 'xs_o', 'prnd_i', 'prnd_e', 'prnd_u', 'prnd_o'].forEach(id => $(id).addEventListener('change', () => { if (id === 'mode') syncMode(); run(); }));
$('dl').addEventListener('click', downloadImage);
$('copyimg').addEventListener('click', copyImage);
['imgw', 'imgh', 'imgpad', 'imglh', 'color', 'bgcolor', 'transparent', 'imgalign'].forEach(id => $(id).addEventListener('input', updatePreview));
let _deb;
const liveRun = () => { clearTimeout(_deb); _deb = setTimeout(run, 180); };  // transcripció en viu (debounce)
$('input').addEventListener('input', liveRun);
function initLists() {
  getSubs = buildList($('subsList'), 'xsf_subs2', SUBS_DEF, [{ ph: 'paraula', wide: true }, { ph: 'XSF', wide: true }], liveRun);
}
initLists(); syncMode();
loadMap().then(() => { $('status').textContent = 'a punt'; run(); });
