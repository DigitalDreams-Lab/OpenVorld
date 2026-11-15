/** Vorld-pixel geometry shared by drawing and collision. Plan doors are tile-centre foot anchors. */
export type HomeSize = { w: number; h: number; bodyW: number; wallH: number };
export const DEFAULT_HOME: HomeSize = { w: 64, h: 64, bodyW: 48, wallH: 28 };

/** A home stands with its base 3px below the door tile centre; the wall collider stops short of the door. */
export function homeGeometry(door: { x: number; y: number }, tile = 16, size: HomeSize = DEFAULT_HOME, block = 16) {
  const x = door.x * tile + tile / 2, y = door.y * tile + tile / 2, bottom = y + 3;
  const h = Math.max(10, size.wallH - 12), solidBottom = y - 9;
  const solid = { x, y: solidBottom - h / 2, w: Math.max(16, size.bodyW - 4), h };
  // beside the door the wall is solid right down to its base (nobody walks over the windows); only the door step in the middle is open
  const top = solid.y - solid.h / 2, base = bottom - 2, gap = Math.max(block, 12), side = (solid.w - gap) / 2;
  const walls = side > 2 ? [-1, 1].map((d) => ({ x: x + d * (gap / 2 + side / 2), y: (top + base) / 2, w: side, h: base - top })) : [];
  return { x, y, top: bottom - size.h, bottom, solid, walls };
}

/** A prop is a grid of square sprites (one tile each): its size is the grid, `solid` is the width that blocks walking. */
export function propGeometry(def: any, tile = 16) {
  const [cols, rows] = Array.isArray(def.grid) && def.grid.length === 2 ? def.grid : [1, 1];
  return { w: cols * tile, h: rows * tile, solid: def.solid ?? 0, footHeight: 6 };
}
