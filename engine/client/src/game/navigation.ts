/** Ground navigation for crew sprites, which do not have Arcade physics bodies. */
type Point = { x: number; y: number };
type Walkable = (x: number, y: number) => boolean;
export type RouteSearch = Generator<void, Point[] | null, void>;

/** Check the whole step, including long steps after a slow frame. */
export function clearWalk(from: Point, to: Point, walkable: Walkable): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!walkable(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false;
  }
  return true;
}

type Entry = { id: number; cost: number; priority: number; remaining: number };
class Frontier {
  items: Entry[] = [];
  before(a: Entry, b: Entry) { return a.priority < b.priority || (a.priority === b.priority && a.remaining < b.remaining); }
  push(entry: Entry) {
    let at = this.items.length; this.items.push(entry);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.before(entry, this.items[parent])) break;
      this.items[at] = this.items[parent]; at = parent;
    }
    this.items[at] = entry;
  }
  pop(): Entry {
    const first = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let at = 0;
      while (at * 2 + 1 < this.items.length) {
        let child = at * 2 + 1;
        if (child + 1 < this.items.length && this.before(this.items[child + 1], this.items[child])) child++;
        if (!this.before(this.items[child], last)) break;
        this.items[at] = this.items[child]; at = child;
      }
      this.items[at] = last;
    }
    return first;
  }
}

/** One static map shared by the crew. Cache tested edges; search work can be advanced a little each frame. */
export class NavigationGrid {
  cols: number;
  rows: number;
  edges = new Map<number, number[]>();
  constructor(public walkable: Walkable, width: number, height: number, public step = 8) {
    this.cols = Math.ceil(width / step); this.rows = Math.ceil(height / step);
  }
  point(id: number): Point { return { x: (id % this.cols + 0.5) * this.step, y: (Math.floor(id / this.cols) + 0.5) * this.step }; }
  anchor(p: Point): number | null {
    const col = Math.floor(p.x / this.step), row = Math.floor(p.y / this.step);
    let best: number | null = null, distance = Infinity;
    for (let y = row - 2; y <= row + 2; y++) for (let x = col - 2; x <= col + 2; x++) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
      const id = y * this.cols + x, at = this.point(id), d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d < distance && clearWalk(p, at, this.walkable)) { best = id; distance = d; }
    }
    return best;
  }
  neighbors(id: number): number[] {
    const cached = this.edges.get(id); if (cached) return cached;
    const col = id % this.cols, row = Math.floor(id / this.cols), at = this.point(id), neighbors: number[] = [];
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const x = col + dx, y = row + dy, next = y * this.cols + x;
      if (x >= 0 && y >= 0 && x < this.cols && y < this.rows && clearWalk(at, this.point(next), this.walkable)) neighbors.push(next);
    }
    this.edges.set(id, neighbors); return neighbors;
  }
  /** A* explores toward the destination; yielding after each node lets the scene bound total work per frame. */
  *search(from: Point, to: Point): RouteSearch {
    if (clearWalk(from, to, this.walkable)) return [{ ...to }];
    if (!this.walkable(from.x, from.y) || !this.walkable(to.x, to.y)) return null;
    const start = this.anchor(from), end = this.anchor(to);
    if (start === null || end === null) return null;
    const heuristic = (id: number) => Math.abs(id % this.cols - end % this.cols) + Math.abs(Math.floor(id / this.cols) - Math.floor(end / this.cols));
    const parents = new Map<number, number | null>([[start, null]]), costs = new Map([[start, 0]]), closed = new Set<number>();
    const frontier = new Frontier(); frontier.push({ id: start, cost: 0, priority: heuristic(start), remaining: heuristic(start) });
    while (frontier.items.length) {
      const { id, cost } = frontier.pop();
      if (closed.has(id)) { yield; continue; }
      if (id === end) {
        const path = [{ ...to }];
        for (let at: number | null = end; at !== null; at = parents.get(at) ?? null) path.push(this.point(at));
        path.reverse();
        // Keep turns, rather than making a moving follower steer back through every grid-cell centre.
        const turns = path.filter((p, i) => {
          if (!i || i === path.length - 1) return true;
          const a = path[i - 1], b = path[i + 1];
          return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 0.001;
        });
        while (turns.length > 1 && clearWalk(from, turns[1], this.walkable)) turns.shift();
        return turns;
      }
      closed.add(id);
      for (const next of this.neighbors(id)) {
        const nextCost = cost + 1;
        if (closed.has(next) || nextCost >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, nextCost); parents.set(next, id);
        const remaining = heuristic(next);
        frontier.push({ id: next, cost: nextCost, priority: nextCost + remaining, remaining });
      }
      yield;
    }
    return null;
  }
}

/** Synchronous helper for callers outside the animation loop. The scene advances searches with a shared frame budget. */
export function walkingPath(from: Point, to: Point, walkable: Walkable, width: number, height: number, step = 8): Point[] | null {
  const search = new NavigationGrid(walkable, width, height, step).search(from, to);
  for (;;) { const result = search.next(); if (result.done) return result.value; }
}
