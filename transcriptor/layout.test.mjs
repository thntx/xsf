import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapLine } from './layout.mjs';

const widths = new Map([['A', 10], ['B', 10], ['C', 10], ['AA', 22],
  ['AB', 17], ['ABC', 29], ['A B', 25], ['AAAA', 44]]);
const measure = text => {
  assert.ok(widths.has(text), `Unexpected measurement: ${text}`);
  return widths.get(text);
};

test('positive kerning wraps a pair whose separate widths would fit', () => {
  const rows = wrapLine(['A', 'A'], '', 20, measure);
  assert.deepEqual(rows.map(row => row.w), [10, 10]);
  assert.deepEqual(rows.map(row => row.last), [false, true]);
});

test('negative kerning keeps a pair whose separate widths would overflow', () => {
  const rows = wrapLine(['A', 'B'], '', 17, measure);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].w, 17);
});

test('the whole candidate row is measured with its actual separator', () => {
  assert.equal(wrapLine(['A', 'B', 'C'], '', 29, measure)[0].w, 29);
  const rows = wrapLine(['A', 'B'], ' ', 25, measure);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].w, 25);
});

test('an oversized atom is retained so the caller can reduce the font size', () => {
  const rows = wrapLine(['AAAA'], '', 10, measure);
  assert.equal(rows[0].items[0].a, 'AAAA');
  assert.equal(rows[0].w, 44);
});

test('an empty hard line is preserved', () => {
  assert.deepEqual(wrapLine([], '', 20, measure), [{ items: [], w: 0, last: true }]);
});
