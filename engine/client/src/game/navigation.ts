/** Ground navigation for crew sprites, which do not have Arcade physics bodies. */
type Point = { x: number; y: number };
type Walkable = (x: number, y: number) => boolean;

/** Check the whole step, including long steps after a slow frame. */
export function clearWalk(from: Point, to: Point, walkable: Walkable): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!walkable(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false;
  }
  return true;
}

/** Route around homes and water; unreachable destinations never permit walking through them. */
export function walkingPath(from: Point, to: Point, walkable: Walkable, width: number, height: number, step = 8): Point[] | null {
  if (clearWalk(from, to, walkable)) return [{ ...to }];
  if (!walkable(from.x, from.y) || !walkable(to.x, to.y)) return null;
  const cols = Math.ceil(width / step), rows = Math.ceil(height / step);
  const point = (id: number): Point => ({ x: (id % cols + 0.5) * step, y: (Math.floor(id / cols) + 0.5) * step });
  // Connect exact foot positions to the grid without cutting a corner at either end.
  const anchor = (p: Point): number | null => {
    const col = Math.floor(p.x / step), row = Math.floor(p.y / step);
    let best: number | null = null, distance = Infinity;
    for (let y = row - 2; y <= row + 2; y++) for (let x = col - 2; x <= col + 2; x++) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const id = y * cols + x, at = point(id), d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d < distance && clearWalk(p, at, walkable)) { best = id; distance = d; }
    }
    return best;
  };
  const start = anchor(from), end = anchor(to);
  if (start === null || end === null) return null;
  const parents = new Map<number, number | null>([[start, null]]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (id === end) {
      const path = [{ ...to }];
      for (let at: number | null = end; at !== null; at = parents.get(at) ?? null) path.push(point(at));
      return path.reverse();
    }
    const col = id % cols, row = Math.floor(id / cols), at = point(id);
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const x = col + dx, y = row + dy, next = y * cols + x;
      if (x < 0 || y < 0 || x >= cols || y >= rows || parents.has(next)) continue;
      if (!clearWalk(at, point(next), walkable)) continue;
      parents.set(next, id); queue.push(next);
    }
  }
  return null;
}
