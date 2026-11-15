// Sprites come from SHEETS. The server publishes a vorld's art (the default sprite sheets, engine/server/art.mjs) as an
// atlas index: a few sheet images and the frames on them. This module loads that atlas and cuts frames out of it. Nothing in the game paints pixels itself. Every sprite is a SQUARE of one size (a ground
// tile); an object bigger than a tile is composed from several sprites (composeObject).
import { propGrid, propSprites, landmarkSprites } from '../../../../tools/lib/props.mjs';
export type Pal = Record<string, string>;
// Eight directions, clockwise from down. A character has WALK_FRAMES frames in each: 0 and 2 are the contact poses (a leg and the
// opposite arm forward), 1 and 3 the passing poses; frame IDLE_FRAME is the standing-still pose. (The companion's frames are a wing flap.)
export const DIRECTIONS = ['down', 'down_left', 'left', 'up_left', 'up', 'up_right', 'right', 'down_right'] as const;
export type Direction = typeof DIRECTIONS[number];
export const WALK_FRAMES = 4, IDLE_FRAME = 1;
/** The frame to show `t` ms into a walk, one frame every `step` ms. */
export const walkFrame = (t: number, step = 125) => Math.floor(t / step) % WALK_FRAMES;

// angle of each direction in screen space (x right, y down), in degrees
const ANGLE: Record<Direction, number> = { right: 0, down_right: 45, down: 90, down_left: 135, left: 180, up_left: -135, up: -90, up_right: -45 };
/** The direction of a movement; keeps `last` while the movement stays within a little more than its sector, so a path that wobbles does not flicker between two directions. */
export function movementDirection(vx: number, vy: number, last: Direction = 'down'): Direction {
  if (!vx && !vy) return last;
  const a = Math.atan2(vy, vx) * 180 / Math.PI, off = (d: Direction) => Math.abs(((a - ANGLE[d] + 540) % 360) - 180);
  if (off(last) <= 28) return last;
  return DIRECTIONS.reduce((best, d) => (off(d) < off(best) ? d : best), last);
}

type GenFrame = { img: HTMLImageElement; x: number; y: number; w: number; h: number; art: { x: number; y: number; w: number; h: number }; kind: string; anchor: string; flip?: boolean };
let GEN: Map<string, GenFrame> | null = null, genRevision: string | null = null, genLoad = 0;
/** Texture pixels per world pixel: sprites are baked at this multiple of the world tile and drawn scaled down by it, so the
 * camera zoom shows them smoothly instead of as enlarged pixels. */
export const TEX = 4;
/** Characters are baked finer than the world (their sheet cells are bigger): texture pixels per world pixel. */
export const CHAR_TEX = 8;
/** The companion bee is drawn this much smaller than a person. */
export const BEE_SCALE = 0.6;
const canvasCache = new Map<string, HTMLCanvasElement>();
const listeners = new Set<() => void>();
/** Sprite-name key, same rule as the server (engine/server/art.mjs keyOf). */
export const artKey = (id: string) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
export const generatedRevision = () => genRevision;
/** Called whenever a new atlas has been loaded (React views redraw from it). */
export const onAtlas = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Load an atlas index ({ revision, sheets: [{ image, frames }] }); `getImage` fetches a sheet image by name. */
export async function loadGenerated(data: any, getImage: (name: string) => Promise<Blob>) {
  const load = ++genLoad;
  if (!data?.sheets?.length) { GEN = null; genRevision = null; canvasCache.clear(); listeners.forEach((f) => f()); return; }
  if (genRevision === data.revision && GEN) return;
  const map = new Map<string, GenFrame>();
  for (const sheet of data.sheets) {
    try {
      const blob = await getImage(sheet.image), url = URL.createObjectURL(blob), img = new Image();
      try { img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
      for (const [name, f] of Object.entries<any>(sheet.frames)) map.set(name, { img, ...f });
    } catch { /* a missing sheet leaves its frames out */ }
  }
  if (load !== genLoad) return;
  GEN = map.size ? map : null; genRevision = data.revision; canvasCache.clear(); iconCache.clear();
  listeners.forEach((f) => f());
}
export const hasGenerated = (name: string) => !!GEN?.has(name);
/** 'tile' frames fill their whole cell. */
export const frameKind = (name: string) => GEN?.get(name)?.kind;

/** A sprite as a canvas: its whole square cell, scaled smoothly (no enlarged-pixel look). */
export function generatedCanvas(name: string, size?: number): HTMLCanvasElement | null {
  const f = GEN?.get(name);
  if (!f) return null;
  const key = `${name}|${size ?? ''}`;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size ?? f.w;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (f.flip) { g.translate(c.width, 0); g.scale(-1, 1); }      // a mirrored direction: the same cell, flipped
  g.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  canvasCache.set(key, c);
  return c;
}

type Part = { name: string; col: number; row: number };
/** One object made of several sprites (a tree, a fountain, the plaza landmark): its parts joined edge to edge, `size` pixels per sprite. */
export function composeObject(parts: Part[], cols: number, rows: number, size: number): HTMLCanvasElement | null {
  const c = document.createElement('canvas'); c.width = cols * size; c.height = rows * size;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  let drawn = 0;
  for (const p of parts) {
    const img = generatedCanvas(p.name, size) ?? generatedCanvas(p.name.replace(/_v\d+/, ''), size);
    if (img) { g.drawImage(img, p.col * size, p.row * size); drawn++; }
  }
  return drawn ? c : null;
}
/** A prop variant as one canvas (its grid of sprites), `size` pixels per sprite. */
export const propCanvas = (id: string, def: any, variant: number, size: number) => { const [c, r] = propGrid(def); return composeObject(propSprites(id, def, variant), c, r, size); };
/** The plaza landmark as one canvas. */
export const landmarkCanvas = (scenery: any, size: number) => { const [c, r] = propGrid(scenery?.landmark); return composeObject(landmarkSprites(scenery), c, r, size); };

export const generatedUrl = (name: string) => generatedCanvas(name)?.toDataURL();

/** Trim a sprite cell to its drawn pixels (square, a little margin) so a small glyph fills its button instead of floating in empty cell. */
function trimmedUrl(name: string): string | undefined {
  const hit = iconCache.get(name);
  if (hit !== undefined) return hit;
  const src = generatedCanvas(name);
  if (!src) return undefined;
  let url = src.toDataURL();
  try {
    const { width: w, height: h } = src, d = src.getContext('2d')!.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= 0) {
      const side = Math.max(x1 - x0, y1 - y0) + 1, pad = Math.max(1, Math.round(side * 0.06)), full = side + pad * 2;
      const out = document.createElement('canvas'); out.width = out.height = full;
      const g = out.getContext('2d')!; g.imageSmoothingEnabled = false;
      g.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad + Math.floor((side - (x1 - x0 + 1)) / 2), pad + Math.floor((side - (y1 - y0 + 1)) / 2), x1 - x0 + 1, y1 - y0 + 1);
      url = out.toDataURL();
    }
  } catch { /* keep the whole cell */ }
  iconCache.set(name, url);
  return url;
}
const iconCache = new Map<string, string>();

/** Icon image for a name; the trophy stands in for an unknown name. */
export function iconUrl(name: string): string {
  return trimmedUrl(`i_${artKey(name)}`) ?? trimmedUrl('i_trophy') ?? '';
}

export const companionOf = (vorld: any) => vorld?.crew?.find((c: any) => c.role === 'companion') ?? vorld?.crew?.[0];

/** A crew member's 4x3 walk cycle: twelve whole square cells (`size` pixels each, the sheet's own size by default). */
export function generatedCharacter(memberId: string, size?: number) {
  const k = `c_${artKey(memberId)}`;
  const idx = Array.from({ length: WALK_FRAMES }, (_, f) => f);
  const names = DIRECTIONS.flatMap((d) => idx.map((f) => `${k}_${d}_${f}`));
  if (!GEN || !names.every((n) => GEN!.has(n))) return null;
  const frames = Object.fromEntries(DIRECTIONS.map((d) => [d, idx.map((f) => generatedCanvas(`${k}_${d}_${f}`, size)!)])) as Record<Direction, HTMLCanvasElement[]>;
  const w = frames.down[IDLE_FRAME].width;
  return { w, h: w, frames, portrait: generatedCanvas(`${k}_portrait`, size) };
}
