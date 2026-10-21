// Measure complete shaped rows: kerning can change the width at every boundary.
export function wrapLine(atoms, separator, maxWidth, measure) {
  const rows = [];
  let items = [], text = '', width = 0;
  for (const a of atoms) {
    const atomWidth = measure(a);
    const nextText = items.length ? text + separator + a : a;
    const nextWidth = measure(nextText);
    if (items.length && nextWidth > maxWidth) {
      rows.push({ items, w: width, last: false });
      items = [{ a, w: atomWidth }]; text = a; width = atomWidth;
    } else {
      items.push({ a, w: atomWidth }); text = nextText; width = nextWidth;
    }
  }
  rows.push({ items, w: width, last: true });
  return rows;
}
