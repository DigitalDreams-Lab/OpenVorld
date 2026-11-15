// Sprite names of the objects in the vorld. EVERY sprite is a square of the same size (one ground tile); an object
// bigger than a tile is several sprites side by side (`grid: [columns, rows]` in scenery.yaml). The server's manifest,
// the default sprite sheets and the game client all use these names, so they always agree.

/** Sprite-name-safe key for any id (a-z, 0-9, _). */
export const keyOf = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';

/** [columns, rows] of square sprites a prop is made of. */
export const propGrid = (def) => {
  const g = def?.grid;
  return Array.isArray(g) && g.length === 2 && g.every((n) => Number.isInteger(n) && n > 0) ? g : [1, 1];
};

/** The sprites of one prop variant, top-left to bottom-right: { name, col, row }. A 1x1 prop is one sprite named p_<id>[_v<n>]. */
export function propSprites(id, def, variant = 0) {
  const [cols, rows] = propGrid(def), base = `p_${keyOf(id)}${variant ? `_v${variant}` : ''}`;
  if (cols * rows === 1) return [{ name: base, col: 0, row: 0 }];
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => ({ name: `${base}_${col}_${row}`, col, row }))).flat();
}

/** The plaza landmark is one object of several sprites: b_plaza_<col>_<row>. */
export function landmarkSprites(scenery) {
  const [cols, rows] = propGrid(scenery?.landmark);
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => ({ name: `b_plaza_${col}_${row}`, col, row }))).flat();
}

/** Every prop variant of the pack: [{ id, variant, def }]. */
export const propVariants = (scenery) => Object.entries(scenery?.props ?? {}).flatMap(([id, def]) => Array.from({ length: Math.max(1, def.variants ?? 1) }, (_, variant) => ({ id, variant, def })));
