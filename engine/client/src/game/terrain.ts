const ROAD = new Set(['p', 'P', 'b']);
export function roadConnections(plan: any, x: number, y: number) {
  const road = (dx: number, dy: number) => ROAD.has(plan.ground[y + dy]?.[x + dx]);
  return { north: road(0, -1), east: road(1, 0), south: road(0, 1), west: road(-1, 0) };
}

/** A generated path is a material plus a border, not one repeated fenced square.
 * Stretch its middle material and place its border only on exposed road edges. */
export function paintRoadTile(g: CanvasRenderingContext2D, image: HTMLCanvasElement, x: number, y: number, tile: number, connections: ReturnType<typeof roadConnections>) {
  const sx = Math.max(1, Math.floor(image.width / 4)), sy = Math.max(1, Math.floor(image.height / 4));
  g.drawImage(image, sx, sy, image.width - sx * 2, image.height - sy * 2, x, y, tile, tile);
  const border = Math.max(1, Math.round(tile / 8));
  for (const [edge, angle] of [['west', 0], ['north', Math.PI / 2], ['east', Math.PI], ['south', -Math.PI / 2]] as const) {
    if (connections[edge]) continue;
    g.save(); g.translate(x + tile / 2, y + tile / 2); g.rotate(angle);
    g.drawImage(image, 0, sy, sx, image.height - sy * 2, -tile / 2, -tile / 2, border, tile);
    g.restore();
  }
}
