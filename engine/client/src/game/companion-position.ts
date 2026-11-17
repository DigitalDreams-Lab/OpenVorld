type Point = { x: number; y: number };
export type VisibleCharacter = Point & { width: number; height: number };

// Ignore the transparent margin in the character cells; leave a little space around the drawn character.
function bounds(at: Point, size: { width: number; height: number }) {
  return { left: at.x - size.width * 0.35, right: at.x + size.width * 0.35, top: at.y - size.height * 0.93, bottom: at.y - size.height * 0.06 };
}
export function companionOverlap(at: Point, size: { width: number; height: number }, others: VisibleCharacter[], margin = 2): number {
  const a = bounds(at, size);
  return others.reduce((sum, other) => {
    const b = bounds(other, other);
    const w = Math.min(a.right + margin, b.right) - Math.max(a.left - margin, b.left);
    const h = Math.min(a.bottom + margin, b.bottom) - Math.max(a.top - margin, b.top);
    return sum + Math.max(0, w) * Math.max(0, h);
  }, 0);
}

/** Move only the companion when its normal following spot is covered. Every alternative stays within talking range. */
export function companionPosition(preferred: Point, founder: Point, size: { width: number; height: number }, others: VisibleCharacter[], canStand: (x: number, y: number) => boolean, previousOffset?: Point): Point {
  const free = (at: Point, margin = 2) => canStand(at.x, at.y) && companionOverlap(at, size, others, margin) === 0;
  // A wider release margin keeps a moving agent at the edge from making the companion swap sides every frame.
  if (free(preferred, previousOffset ? 4 : 2)) return preferred;
  if (previousOffset && previousOffset.y <= 0) {
    const previous = { x: founder.x + previousOffset.x, y: founder.y + previousOffset.y };
    if (free(previous)) return previous;
  }
  const dx = preferred.x - founder.x, dy = -Math.abs(preferred.y - founder.y);
  // Try the entire upper side before the sides or any lower fallback.
  const offsets = [[-dx, dy], [0, -29], [-14, -26], [14, -26], [-24, -16], [24, -16], [-26, -12], [26, -12], [-28, 0], [28, 0], [-24, 16], [24, 16], [0, 29]];
  let best = preferred, leastOverlap = companionOverlap(preferred, size, others);
  for (const [x, y] of offsets) {
    const at = { x: founder.x + x, y: founder.y + y };
    if (!canStand(at.x, at.y)) continue;
    const overlap = companionOverlap(at, size, others);
    if (!overlap) return at;
    if (overlap < leastOverlap) { leastOverlap = overlap; best = at; }
  }
  return best;
}
