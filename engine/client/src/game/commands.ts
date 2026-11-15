// Pure helpers for game commands (what crew members do on the map). The scene (VorldScene) does the moving and drawing; this
// module only answers "where": the nearest prop of a kind, and where someone can stand to use it.
import { movementDirection, type Direction } from './pixels';

export type Pt = { x: number; y: number };
export type MapProp = { t: string; x: number; y: number };

/** The nearest prop of a kind to a point, as a vorld-pixel centre (props are planned in tiles). */
export function nearestProp(props: MapProp[], kind: string, from: Pt, tile: number): Pt | null {
  let best: Pt | null = null, bestD = Infinity;
  for (const p of props) {
    if (p.t !== kind) continue;
    const c = { x: p.x * tile + tile / 2, y: p.y * tile + tile / 2 }, d = Math.hypot(c.x - from.x, c.y - from.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Places to stand next to a prop, best first: just below it (so the crew member faces it from the front), then the sides, then above. */
export function standSpots(prop: Pt, tile: number): Pt[] {
  return [[0, 0.95], [-0.9, 0.7], [0.9, 0.7], [-1.1, 0], [1.1, 0], [0, -0.95], [-0.9, 1.5], [0.9, 1.5]].map(([dx, dy]) => ({ x: prop.x + dx * tile, y: prop.y + dy * tile }));
}

/** Which way to face when standing at `at` and looking at `target`. */
export const facing = (at: Pt, target: Pt, last: Direction = 'down'): Direction => movementDirection(target.x - at.x, target.y - at.y, last);

/** The most steps a crew member keeps queued; a newer batch replaces an older one. */
export const clampQueue = <T>(steps: T[] | undefined, max = 12): T[] => (Array.isArray(steps) ? steps.slice(0, max) : []);

/** Screens a `show` command may open (packs/core/commands.yaml > panels). */
export const PANELS: Record<string, 'quests' | 'deeds' | 'settings'> = { quests: 'quests', deeds: 'deeds', settings: 'settings' };
