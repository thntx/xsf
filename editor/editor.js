// ---- Editor XSF: escriu XSF directament; els botons recasen (integral/minúscula) la selecció ----

// ---- mapeig (mateix que el transcriptor, sense motor espeak) ----
let MAP = null, RMAP = null, GRAPHS = null;
const NUMROW_SHIFT = { 'º': 'ª', '1': '!', '2': '"', '3': '·', '4': '$', '5': '%', '6': '&', '7': '/', '8': '(', '9': ')', '0': '=', "'": '?', '¡': '¿' };
const SHIFT_BACK = Object.fromEntries(Object.entries(NUMROW_SHIFT).map(([k, v]) => [v, k]));
const integralOf = c => NUMROW_SHIFT[c] || c.toUpperCase();
const deIntegral = c => SHIFT_BACK[c] || c.toLowerCase();
const toBase = g => [...g].map(deIntegral).join('');
const toIntegral = g => [...g].map(integralOf).join('');
// vocal segons la LLETRA base (treu accents amb NFD): a e i o u x(=ə). La resta de grafemes són consonants.
const isVowel = g => 'aeioux'.includes((g.normalize('NFD')[0] || '').toLowerCase());

async function loadMap() {
  if (MAP) return;
  const txt = await (await fetch('../mapping.txt')).text();
  MAP = {};
  for (const line of txt.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('->'); if (i < 0) continue;
    const ipa = line.slice(0, i).trim();
    let v = line.slice(i + 2); const h = v.indexOf('#'); if (h >= 0) v = v.slice(0, h);
    if (ipa) MAP[ipa] = v.trim();
  }
  RMAP = {};
  const addR = (g, ipa) => { if (g && !(g in RMAP)) RMAP[g] = ipa; };
  for (const [ipa, g] of Object.entries(MAP)) { addR(g, ipa); addR(g.length === 1 ? integralOf(g) : g.toUpperCase(), ipa); }
  Object.assign(RMAP, { '1': 'ʃ', 'j': 'ʒ', 't1': 'tʃ', '3j': 'dʒ', '6': 'e̯', '2': 'o̯', '&': 'e̯', '"': 'o̯' });
  GRAPHS = [...new Set([...Object.keys(RMAP), '6', '2'])].filter(Boolean).sort((a, b) => b.length - a.length);
}

// ---- tokenitza l'XSF en grafemes (sobre la versió de BASE; de-integral és 1:1 per caràcter,
// així les posicions coincideixen amb la cadena original) ----
function tokenize(str) {
  const base = [...str].map(deIntegral).join('');
  const toks = []; let i = 0, w = 0;
  while (i < str.length) {
    const ch = base[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') { toks.push({ kind: 'sep', s: i, e: i + 1, w }); w++; i++; continue; }
    if (ch === '+') { toks.push({ kind: 'mark', s: i, e: i + 1, w }); i++; continue; }
    let L = 1;                                              // grafema multi-caràcter del mapa (3z, t1…) o un sol caràcter
    for (const cand of GRAPHS) { if (cand && base.startsWith(cand, i)) { L = cand.length; break; } }
    while (i + L < base.length && base.charCodeAt(i + L) >= 0x300 && base.charCodeAt(i + L) <= 0x36f) L++;  // accents combinants
    const bg = base.slice(i, i + L), v = isVowel(bg);
    toks.push({ kind: 'graph', s: i, e: i + L, w, base: bg, vowel: v, cons: !v, out: str.slice(i, i + L) });
    i += L;
  }
  return toks;
}

// ---- composites (CV / VC) sobre els grafemes; la resta PENJA ----
function analyze(toks) {
  const g = toks.filter(t => t.kind === 'graph');
  for (const t of g) t.comp = false;
  const adj = (a, b) => a >= 0 && b < g.length && g[a].w === g[b].w;
  for (let i = 0; i + 1 < g.length; i++)                 // CV: onset + vocal
    if (g[i].cons && g[i + 1].vowel && adj(i, i + 1) && !g[i].comp && !g[i + 1].comp) { g[i].comp = g[i + 1].comp = true; }
  for (let i = 0; i < g.length; i++)                     // VC: vocal sense onset + coda
    if (g[i].vowel && !g[i].comp && i + 1 < g.length && g[i + 1].cons && adj(i, i + 1) && !g[i + 1].comp) { g[i].comp = g[i + 1].comp = true; }
}

// ---- aplica una acció de recasament al rang [selS,selE) (o a tot si són iguals) ----
function applyAction(str, act, selS, selE) {
  const toks = tokenize(str); analyze(toks);
  const all = selS === selE;
  const inSel = t => all || (t.s < selE && t.e > selS);
  for (const t of toks) {
    if (t.kind !== 'graph' || !inSel(t)) continue;
    const I = () => { t.out = toIntegral(t.base); };
    const B = () => { t.out = t.base; };
    switch (act) {
      case 'kib': if (t.comp) B(); break;                          // composites en minúscula
      case 'ktb': if (t.comp) (t.cons ? I : B)(); break;           // consonant del composite integral
      case 'bkk': if (t.comp) (t.vowel ? I : B)(); break;          // vocal del composite integral
      case 'integraVoc': if (!t.comp && t.vowel) I(); break;
      case 'minvaVoc': if (!t.comp && t.vowel) B(); break;
      case 'integraCons': if (!t.comp && t.cons) I(); break;
      case 'minvaCons': if (!t.comp && t.cons) B(); break;
    }
  }
  let out = '';
  for (const t of toks) out += (t.kind === 'graph') ? t.out : str.slice(t.s, t.e);
  return out;
}

// ---- UI ---- (#src és un contenteditable en font XSF: un <textarea> NO aplica el kern que travessa
// el bloquejador; un contenteditable renderitza com el text normal i sí que l'aplica.)
const $ = id => document.getElementById(id);
const src = $('src');

// text i posicions de selecció (en caràcters) dins del contenteditable; <br> compta com a '\n'
function getText() {
  let s = '';
  const walk = n => { if (n.nodeType === 3) s += n.data; else if (n.nodeName === 'BR') s += '\n'; else n.childNodes.forEach(walk); };
  src.childNodes.forEach(walk);
  return s;
}
function setText(v) { src.textContent = v; updatePh(); }
function offsetTo(container, off) {
  let s = '', done = false;
  const walk = n => {
    if (done) return;
    if (n === container) { if (n.nodeType === 3) s += n.data.slice(0, off); else for (let i = 0; i < off && i < n.childNodes.length; i++) walk(n.childNodes[i]); done = true; return; }
    if (n.nodeType === 3) s += n.data;
    else if (n.nodeName === 'BR') s += '\n';
    else n.childNodes.forEach(walk);
  };
  walk(src);
  return s.length;
}
function selOffsets() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !src.contains(sel.anchorNode)) { const n = getText().length; return [n, n]; }
  const r = sel.getRangeAt(0);
  const a = offsetTo(r.startContainer, r.startOffset), b = offsetTo(r.endContainer, r.endOffset);
  return a <= b ? [a, b] : [b, a];
}
function setCaret(start, end) {
  let acc = 0, sN = null, sO = 0, eN = null, eO = 0;
  const walk = n => {
    if (n.nodeType === 3) {
      const L = n.data.length;
      if (sN === null && acc + L >= start) { sN = n; sO = start - acc; }
      if (eN === null && acc + L >= end) { eN = n; eO = end - acc; }
      acc += L;
    } else if (n.nodeName === 'BR') { acc += 1; }
    else n.childNodes.forEach(walk);
  };
  src.childNodes.forEach(walk);
  if (sN === null) { sN = src; sO = src.childNodes.length; }
  if (eN === null) { eN = src; eO = src.childNodes.length; }
  try { const r = document.createRange(); r.setStart(sN, sO); r.setEnd(eN, eO); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
}
function updatePh() { src.classList.toggle('empty', getText() === ''); }

// Blink NO aplica el kern que travessa el bloquejador '  ' quan el text s'ha TECLEJAT dins
// d'un contenteditable: el node de text queda amb marques internes d'espai d'edició que
// trenquen el shaping a l'espai. Reconstruir el node (textContent net) força un reshape i
// llavors SÍ que s'aplica el kern entre les dues lletres. (setText ja ho fa; per això els
// botons i l'undo ja sortien bé i només fallava l'escriptura en directe.)
let composing = false;
function reshapeBlocker() {
  const t = getText();
  if (t.indexOf('  ') < 0) return;          // només quan hi ha el bloquejador (doble espai)
  const [a, b] = selOffsets();
  src.textContent = t;                       // node net -> Blink reshape amb kern
  setCaret(a, b);
}

// historial d'undo/redo (estats de text)
let hist = [''], hidx = 0, typeTimer = null;
function commit(val) { if (val === hist[hidx]) return; hist = hist.slice(0, hidx + 1); hist.push(val); hidx = hist.length - 1; }
function flushTyping() { if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; } commit(getText()); }
function undo() { if (hidx > 0) { hidx--; setText(hist[hidx]); setCaret(hist[hidx].length, hist[hidx].length); } }
function redo() { if (hidx < hist.length - 1) { hidx++; setText(hist[hidx]); setCaret(hist[hidx].length, hist[hidx].length); } }

src.addEventListener('input', () => { if (!composing) reshapeBlocker(); updatePh(); clearTimeout(typeTimer); typeTimer = setTimeout(() => commit(getText()), 350); });
src.addEventListener('compositionstart', () => { composing = true; });
src.addEventListener('compositionend', () => { composing = false; reshapeBlocker(); updatePh(); });
src.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const z = e.key === 'z' || e.key === 'Z', y = e.key === 'y' || e.key === 'Y';
  if (z && !e.shiftKey) { e.preventDefault(); flushTyping(); undo(); }
  else if (y || (z && e.shiftKey)) { e.preventDefault(); flushTyping(); redo(); }
});

document.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', () => {
  if (!GRAPHS) return;
  flushTyping();
  const [selS, selE] = selOffsets();
  const nv = applyAction(getText(), b.dataset.act, selS, selE);
  setText(nv); commit(nv); setCaret(selS, selE); src.focus();
}));
$('undo').addEventListener('click', () => { flushTyping(); undo(); src.focus(); });
$('redo').addEventListener('click', () => { flushTyping(); redo(); src.focus(); });

updatePh();
loadMap();
