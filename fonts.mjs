export const FONTS = Object.freeze([
  { id: 'editorial', label: 'Editorial', family: 'XSF Editorial', file: 'XSF-Editorial-Regular', version: '2.006' },
  { id: 'cursiva', label: 'Cursiva', family: 'XSF Cursiva', file: 'XSF-Cursiva-Regular', version: '2.006' },
  { id: 'clara', label: 'Clara', family: 'XSF Clara', file: 'XSF-Clara-Regular', version: '2.006' },
  { id: 'suau', label: 'Suau', family: 'XSF Suau', file: 'XSF-Suau-Regular', version: '2.006' },
  { id: 'classica', label: 'Cl\u00e0ssica', family: 'XSF Classica', file: 'XSF-Classica-Regular', version: '2.006' },
  { id: 'didona', label: 'Didona', family: 'XSF Didona', file: 'XSF-Didona-Regular', version: '2.006' },
  { id: 'pixel', label: 'Pixel', family: 'XSF Pixel', file: 'XSF-Pixel', version: '20261110' },
].map(Object.freeze));

export const DEFAULT_FONT = FONTS[0];
export const FONT_STORAGE_KEY = 'xsf_font_family';
let current = DEFAULT_FONT;

export const fontFor = id => FONTS.find(font => font.id === id) || DEFAULT_FONT;
export const getSelectedFont = () => current;
export const fontSpec = (size, font = current) => `${size}px "${font.family}"`;
export const fontURL = (font, format) => new URL(`./fonts/${font.file}.${format}?v=${font.version}`, import.meta.url).href;
export const loadFont = (font = current, size = 48) => document.fonts.load(fontSpec(size, font));

export function initFontPicker(onChange = () => {}) {
  const picker = document.getElementById('font-family');
  const download = document.getElementById('font-download');
  picker.replaceChildren(...FONTS.map(font => new Option(font.label, font.id)));

  function apply(id) {
    current = fontFor(id);
    picker.value = current.id;
    document.documentElement.style.setProperty('--xsf-font', `"${current.family}"`);
    download.href = fontURL(current, 'ttf');
    download.download = `${current.file}.ttf`;
    download.title = `Descarrega ${current.family}`;
    download.setAttribute('aria-label', download.title);
    onChange(current);
  }

  let saved;
  try { saved = localStorage.getItem(FONT_STORAGE_KEY); } catch {}
  apply(saved);
  picker.addEventListener('change', () => {
    apply(picker.value);
    try { localStorage.setItem(FONT_STORAGE_KEY, current.id); } catch {}
  });
  window.addEventListener('storage', event => {
    if (event.key === FONT_STORAGE_KEY) apply(event.newValue);
  });
}
