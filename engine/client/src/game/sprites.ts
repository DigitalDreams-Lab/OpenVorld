// Phaser textures cut from the world's sprite sheets: characters, homes (block by block), the plaza landmark,
// props and the ground. The sheets come from the server (an image model's, or the default sprite sheets); this file
// only places sprites. Nothing here paints pixels. EVERY sprite is a square one tile large; an object bigger than a
// tile (a tree, a fountain, a house, the landmark) is composed of several sprites.
import Phaser from 'phaser';
import { DIRECTIONS, WALK_FRAMES, TEX, CHAR_TEX, artKey, generatedCanvas, generatedCharacter, propCanvas, landmarkCanvas, hasGenerated } from './pixels';
import { propGrid } from '../../../../tools/lib/props.mjs';

const TILE_PX = 16;
const MAX_TEXTURE = 4096;
import { DEFAULT_HOME, type HomeSize } from './geometry';
import { planHouse, houseBlocks } from '../../../../tools/lib/houses.mjs';
import { roadConnections, paintRoadTile } from './terrain';

function canvasTexture(scene: Phaser.Scene, key: string, c: HTMLCanvasElement) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
}
const blank = (w = 1, h = 1) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** Textures `${key}-${dir}-${frame}` (8 directions x WALK_FRAMES, see pixels.ts) from the member's walk cycle on the character sheet. */
export function makeMember(scene: Phaser.Scene, key: string, memberId: string) {
  const gen = generatedCharacter(memberId, TILE_PX * CHAR_TEX);
  if (!gen) { DIRECTIONS.forEach((dir) => Array.from({ length: WALK_FRAMES }, (_, f) => f).forEach((f) => canvasTexture(scene, `${key}-${dir}-${f}`, blank(TILE_PX * CHAR_TEX, TILE_PX * CHAR_TEX)))); return { w: TILE_PX * CHAR_TEX, h: TILE_PX * CHAR_TEX }; }
  DIRECTIONS.forEach((dir) => gen.frames[dir].forEach((c, f) => canvasTexture(scene, `${key}-${dir}-${f}`, c)));
  return { w: gen.w, h: gen.h };
}

/** Plan ground symbol -> tile sprite (engine/server/art/manifest.mjs TILE_NAMES). */
const TILE: Record<string, string> = { '0': 't_ground_0', '1': 't_ground_1', '2': 't_ground_2', '3': 't_ground_3', p: 't_path', P: 't_plaza', w: 't_water', W: 't_water', b: 't_bridge', V: 't_void' };

export function makeWorldArt(scene: Phaser.Scene, plan: any, art: any) {
  const defs = art.scenery;
  const world = defs.size?.tile ?? 16, tile = world * TEX;      // sprites are baked at TEX x the world tile (drawn scaled down: smooth, not enlarged pixels)
  // the ground is one big texture: keep it inside what every GPU accepts (4096 px), at the cost of a little sharpness on very large maps
  const gtile = Math.min(tile, Math.floor(MAX_TEXTURE / Math.max(plan.w, plan.h)));
  const ground = document.createElement('canvas');
  ground.width = plan.w * gtile; ground.height = plan.h * gtile;
  const ctx = ground.getContext('2d')!;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (let y = 0; y < plan.h; y++) for (let x = 0; x < plan.w; x++) {
    const ch = plan.ground[y][x], img = generatedCanvas(TILE[ch] ?? TILE.V, gtile);
    if (!img) continue;
    if (ch === 'p') paintRoadTile(ctx, img, x * gtile, y * gtile, gtile, roadConnections(plan, x, y));
    else if (ch === 'b' && (roadConnections(plan, x, y).east || roadConnections(plan, x, y).west)) {
      ctx.save(); ctx.translate((x + 0.5) * gtile, (y + 0.5) * gtile); ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -gtile / 2, -gtile / 2, gtile, gtile); ctx.restore();
    } else ctx.drawImage(img, x * gtile, y * gtile, gtile, gtile);
  }
  canvasTexture(scene, 'ground', ground);
  const groundScale = world / gtile;           // world pixels per texture pixel of the ground
  for (const [id, def] of Object.entries<any>(defs.props)) {
    const [cols, rows] = propGrid(def);
    for (let v = 0; v < (def.variants ?? 1); v++) canvasTexture(scene, `prop-${id}-${v}`, propCanvas(id, def, v, tile) ?? blank(cols * tile, rows * tile));
  }
  // soft light for lamps and crystals: part of the atmosphere (the one coded graphic), not a sprite
  const g = document.createElement('canvas'); g.width = g.height = 64;
  const x = g.getContext('2d')!, grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.28)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
  canvasTexture(scene, 'glow', g);
  return { groundScale };
}

/** One block of a home, placed on the home's grid (x right, y up from the ground line), in pixels. */
export type HouseBlock = { tex: string; x: number; y: number; overlay: boolean; part: string; flip: boolean };
export type HouseBuild = { blocks: HouseBlock[]; size: HomeSize; cols: number; rows: number; block: number };

/**
 * A member's home, BUILT BLOCK BY BLOCK (scenery.yaml > houses): the world seed and the member pick the
 * footprint and the block variants inside the world's style (biome + mood); tools/lib/houses.mjs lays the
 * blocks out on a grid (walls per floor, stepped roof rows, door, windows, chimney, extras). Every block is a
 * sprite cut from the buildings sheet (h_<part>_<variant>[_<piece>]) and its own sprite in the world.
 */
export function makeBuilding(scene: Phaser.Scene, memberId: string, art?: any, world?: { seed?: string; biome?: string; mood?: string; order?: number }): HouseBuild {
  const houses = art?.scenery?.houses ?? {};
  const B = Math.round((houses.block ?? 16) * (Number(houses.scale) || 1));          // world pixels per block: homes grow with the characters (scenery.yaml > houses.scale)
  const illustrations = art?.house_sprites ?? [];
  if (illustrations.length) {
    let hash = 2166136261;
    for (const c of `${world?.seed ?? 'seed'}|${memberId}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    // every home is the same kind of house: given out in crew order, so neighbours differ (the seed picks where to start)
    const illustration = illustrations[((world?.seed ? hash % illustrations.length : 0) + (world?.order ?? 0)) % illustrations.length];
    const [cols, rows] = illustration.grid;
    const cells = Array.from({ length: cols * rows }, (_, i) => ({ col: i % cols, row: Math.floor(i / cols), name: `h_house_${illustration.id}_${i % cols}_${Math.floor(i / cols)}` }));
    if (cells.every(c => hasGenerated(c.name))) {
      const blocks: HouseBlock[] = cells.map(c => {
        const tex = `hb:${c.name}@${B}`;
        if (!scene.textures.exists(tex)) canvasTexture(scene, tex, generatedCanvas(c.name, B * TEX)!);
        return { tex, x: (c.col - cols / 2) * B, y: (rows - c.row) * B, overlay: false, part: 'illustration', flip: false };
      });
      return { blocks, cols, rows, block: B, size: { w: cols * B, h: rows * B, bodyW: (illustration.body_cols ?? cols - 1) * B, wallH: (illustration.wall_rows ?? 2) * B } };
    }
  }
  const plan = planHouse(houses, { seed: world?.seed ?? 'seed', biome: world?.biome ?? 'default', mood: world?.mood ?? 'cozy', id: memberId });
  const grid = houseBlocks(plan), mid = (grid.cols - 1) / 2;
  const blocks: HouseBlock[] = [];
  for (const b of grid.blocks) {
    const tex = blockTexture(scene, b, B);
    if (tex) blocks.push({ tex, x: (b.col - grid.cols / 2) * B, y: (b.row + 1) * B, overlay: !!b.overlay, part: b.part, flip: b.part === 'extra' && b.piece === 'door_side' && b.col > mid });
  }
  return { blocks, cols: grid.cols, rows: grid.rows, block: B, size: { w: grid.cols * B, h: grid.rows * B, bodyW: grid.cols * B, wallH: plan.floors * B } };
}

/** The texture of one block, cut from the sheet and cached per sprite. */
function blockTexture(scene: Phaser.Scene, b: any, B: number) {
  const name = ['wall', 'roof'].includes(b.part) ? `h_${b.part}_${artKey(b.variant)}_${b.piece}` : `h_${b.part}_${artKey(b.variant)}`;
  const key = `hb:${name}@${B}`;
  if (scene.textures.exists(key)) return key;
  const img = generatedCanvas(name, B * TEX);
  if (!img) return null;
  canvasTexture(scene, key, img);          // every block (wall, roof, door, window, chimney, extra) is one whole square sprite
  return key;
}

/** The plaza landmark, composed of the sprites b_plaza_<col>_<row> of the world sheet. */
export function makePillar(scene: Phaser.Scene, art?: any) {
  const [cols, rows] = propGrid(art?.scenery?.landmark);
  const gen = landmarkCanvas(art?.scenery, TILE_PX * TEX) ?? blank(cols * TILE_PX * TEX, rows * TILE_PX * TEX);
  canvasTexture(scene, 'pillar', gen);
  return { w: gen.width / TEX, h: gen.height / TEX };          // world pixels
}
export { DEFAULT_HOME };
