/** What the founder cannot walk through (props, the Party Hall's pillar, the walls of homes), so the crew can walk around it too. */
export type Rect = { x: number; y: number; w: number; h: number };

export class SolidIndex {
  private tiles = new Map<number, Rect[]>();
  /** `tile`: the map's tile size. `margin`: how far a walker's feet stick out around a point, so nobody clips a corner. */
  constructor(private tile: number, private margin = 3) {}
  private key(col: number, row: number) { return row * 4096 + col; }
  /** A rectangle given by its centre, the way the scene makes its collision zones. */
  addCentered(x: number, y: number, w: number, h: number) { this.add({ x: x - w / 2, y: y - h / 2, w, h }); }
  add(r: Rect) {
    const m = this.margin, big = { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
    for (let row = Math.floor(big.y / this.tile); row <= Math.floor((big.y + big.h) / this.tile); row++)
      for (let col = Math.floor(big.x / this.tile); col <= Math.floor((big.x + big.w) / this.tile); col++) {
        const k = this.key(col, row), list = this.tiles.get(k);
        if (list) list.push(big); else this.tiles.set(k, [big]);
      }
  }
  blocked(x: number, y: number): boolean {
    const list = this.tiles.get(this.key(Math.floor(x / this.tile), Math.floor(y / this.tile)));
    return !!list?.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
  }
  clear() { this.tiles.clear(); }
}
