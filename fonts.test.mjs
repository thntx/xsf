import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { FONTS, DEFAULT_FONT, FONT_STORAGE_KEY, fontFor, fontSpec, fontURL,
  getSelectedFont, initFontPicker } from './fonts.mjs';

test('font order and default match the published picker', () => {
  assert.deepEqual(FONTS.map(f => f.id), ['editorial', 'cursiva', 'clara', 'suau', 'classica', 'didona', 'pixel']);
  assert.equal(DEFAULT_FONT.id, 'editorial');
  assert.equal(fontFor('missing'), DEFAULT_FONT);
  assert.equal(fontFor(null), DEFAULT_FONT);
});

test('every family has matching CSS, complete assets and a manifest entry', () => {
  const css = readFileSync(new URL('./fonts.css', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('./fonts/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.glyphs_per_font, 8337);
  assert.deepEqual(manifest.fonts.map(f => f.id), FONTS.map(f => f.id));
  for (const font of FONTS) {
    assert.ok(css.includes(`font-family:'${font.family}'`));
    assert.ok(css.includes(`${font.file}.woff2?v=${font.version}`));
    for (const format of ['ttf', 'woff2']) {
      const row = manifest.fonts.find(f => f.id === font.id).formats[format];
      assert.equal(manifest.fonts.find(f => f.id === font.id).version, font.version);
      assert.equal(row.file, `${font.file}.${format}`);
      assert.equal(statSync(new URL(`./fonts/${row.file}`, import.meta.url)).size, row.bytes);
      assert.equal(new URL(fontURL(font, format)).search, `?v=${font.version}`);
    }
  }
});

test('both apps use the shared picker and the selected CSS font', () => {
  for (const page of ['editor', 'transcriptor']) {
    const html = readFileSync(new URL(`./${page}/index.html`, import.meta.url), 'utf8');
    assert.ok(html.includes('../fonts.css?v=12'));
    assert.ok(html.includes('id="font-family"'));
    assert.ok(html.includes('id="font-download"'));
    assert.ok(html.includes('font-family:var(--xsf-font)'));
    assert.ok(!html.includes("font-family:'XSF'"));
  }
});

function withDOM(saved, action) {
  const names = ['document', 'window', 'localStorage', 'Option'];
  const old = Object.fromEntries(names.map(n => [n, globalThis[n]]));
  const picker = { events: {}, replaceChildren(...options) { this.options = options; },
    addEventListener(name, callback) { this.events[name] = callback; } };
  const download = { setAttribute(name, value) { this[name] = value; } };
  const style = { setProperty(name, value) { this[name] = value; } };
  const events = {}, storage = new Map([[FONT_STORAGE_KEY, saved]]);
  try {
    globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
    globalThis.document = { getElementById: id => id === 'font-family' ? picker : download,
      documentElement: { style } };
    globalThis.window = { addEventListener: (name, callback) => { events[name] = callback; } };
    globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    action({ picker, download, style, events, storage });
  } finally {
    for (const name of names) {
      if (old[name] === undefined) delete globalThis[name]; else globalThis[name] = old[name];
    }
  }
}

test('default, restored selection, download and cross-tab changes remain in sync', () => {
  withDOM(undefined, ({ picker, download, style, events, storage }) => {
    const changes = [];
    initFontPicker(font => changes.push(font.id));
    assert.equal(picker.value, 'editorial');
    assert.equal(picker.options.length, 7);
    assert.equal(style['--xsf-font'], '"XSF Editorial"');
    picker.value = 'didona'; picker.events.change();
    assert.equal(getSelectedFont().id, 'didona');
    assert.equal(storage.get(FONT_STORAGE_KEY), 'didona');
    assert.equal(download.download, 'XSF-Didona-Regular.ttf');
    assert.ok(download.href.endsWith('/fonts/XSF-Didona-Regular.ttf?v=2.005'));
    assert.equal(fontSpec(200), '200px "XSF Didona"');
    events.storage({ key: FONT_STORAGE_KEY, newValue: 'cursiva' });
    assert.equal(picker.value, 'cursiva');
    assert.equal(style['--xsf-font'], '"XSF Cursiva"');
    assert.deepEqual(changes, ['editorial', 'didona', 'cursiva']);
  });
  withDOM('pixel', ({ picker }) => {
    initFontPicker();
    assert.equal(picker.value, 'pixel');
  });
});

test('invalid or unavailable browser storage falls back to Editorial', () => {
  withDOM('bad-value', ({ picker }) => {
    initFontPicker();
    assert.equal(picker.value, 'editorial');
    globalThis.localStorage.getItem = () => { throw Error('disabled'); };
    globalThis.localStorage.setItem = () => { throw Error('disabled'); };
    initFontPicker();
    assert.equal(picker.value, 'editorial');
    picker.value = 'suau';
    assert.doesNotThrow(() => picker.events.change());
    assert.equal(getSelectedFont().id, 'suau');
  });
});
