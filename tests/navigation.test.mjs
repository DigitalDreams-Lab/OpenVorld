import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule, clientModuleUrl, stubModule } from './helpers/client.mjs';

const navigation = await clientModuleUrl('engine/client/src/game/navigation.ts');
const geometry = await clientModuleUrl('engine/client/src/game/geometry.ts');
const { clearWalk, walkingPath } = await import(navigation);
const { homeGeometry } = await import(geometry);
const stub = stubModule(`
  export default { Scene: class {} };
  export const emit = () => {}, on = () => {}, play = () => {};
  export const nearestProp = () => {}, standSpots = () => {}, facing = () => {}, clampQueue = () => {};
  export const TEX = 1, BODY_FONT = 'sans-serif';
  let building;
  export const setBuilding = value => { building = value; };
  export const makeBuilding = () => building, makeMember = () => {}, makePillar = () => {}, makeWorldArt = () => {};
  export const companionOf = () => {}, generatedRevision = () => {}, movementDirection = () => {};
`);
const { setBuilding } = await import(stub);
const { VorldScene } = await clientModule('engine/client/src/game/VorldScene.ts', {
  phaser: stub, './commands': stub, '../store': stub, '../audio/sfx': stub,
  './pixels': stub, './sprites': stub, '../theme': stub, './geometry': geometry, './navigation': navigation,
});

function sceneWithHouse() {
  const scene = new VorldScene();
  scene.plan = { w: 20, h: 20, ground: Array(20).fill('0'.repeat(20)) };
  scene.homeRects = [{ x: 96, y: 64, w: 80, h: 96 }];
  return scene;
}
function member(x, y, target) {
  return { id: 'writer', target, sprite: { x, y, setPosition(x, y) { this.x = x; this.y = y; } } };
}

test('returning crew walk around a house and arrive outside its front door', () => {
  const scene = sceneWithHouse(), n = member(136, 40, { x: 136, y: 160 });
  assert.equal(clearWalk(n.sprite, n.target, (x, y) => scene.walkable(x, y)), false);
  const positions = [];
  for (let frame = 0; n.target && frame < 1000; frame++) {
    const before = { x: n.sprite.x, y: n.sprite.y };
    scene.moveMember(n, 1);
    positions.push({ x: n.sprite.x, y: n.sprite.y });
    assert.ok(clearWalk(before, n.sprite, (x, y) => scene.walkable(x, y)), 'each movement stays outside the house');
  }
  assert.equal(n.target, null, 'the member reaches home instead of getting stuck against a wall');
  assert.deepEqual(positions.at(-1), { x: 136, y: 160 });
  assert.ok(positions.some(p => p.x <= 96 || p.x >= 176), 'the route goes around the side');
});

test('slow frames cannot jump through houses, even when crossing multiple waypoints', () => {
  const scene = sceneWithHouse(), n = member(136, 40, { x: 136, y: 160 });
  const visited = [], setPosition = n.sprite.setPosition;
  n.sprite.setPosition = function (x, y) {
    assert.ok(clearWalk(this, { x, y }, (x, y) => scene.walkable(x, y)));
    visited.push({ x, y }); setPosition.call(this, x, y);
  };
  scene.moveMember(n, 1000);
  assert.equal(n.target, null);
  assert.ok(visited.length > 2);
  assert.deepEqual(visited.at(-1), { x: 136, y: 160 });
});

test('blocked destinations and disconnected ground stop safely', () => {
  const scene = sceneWithHouse(), n = member(136, 40, { x: 136, y: 100 });
  scene.moveMember(n, 1000);
  assert.equal(n.target, null);
  assert.equal(n.sprite.y, 40);
  const walkable = (x, y) => x >= 0 && x < 80 && y >= 0 && y < 80 && (x < 32 || x > 48);
  assert.equal(walkingPath({ x: 8, y: 8 }, { x: 72, y: 8 }, walkable, 80, 80), null);
});

test('a changed destination replaces the cached route', () => {
  const scene = sceneWithHouse(), n = member(136, 40, { x: 136, y: 160 });
  scene.moveMember(n, 4);
  n.target = { x: 240, y: 32 };
  scene.moveMember(n, 1000);
  assert.equal(n.target, null);
  assert.equal(n.sprite.x, 240); assert.equal(n.sprite.y, 32);
  assert.equal(scene.routes.size, 0);
});

test('overlapping street roofs do not hide a neighbour at its home anchor', () => {
  const scene = sceneWithHouse();
  // Real street-layout doors: (23, 15) and (20, 10), with the default 5x5 house art.
  scene.homeRects = [{ x: 319.5, y: 146, w: 113, h: 102 }, { x: 271.5, y: 66, w: 113, h: 102 }];
  scene.plan = { w: 64, h: 44, ground: Array(44).fill('0'.repeat(64)) };
  const n = member(328, 168, null); n.home = { x: 328, y: 168 };
  scene.npcs.set(n.id, n);
  assert.equal(scene.walkable(n.home.x, n.home.y), false);
  scene.placeCrewAtHome();
  assert.ok(scene.walkable(n.sprite.x, n.sprite.y));
  assert.ok(n.home.y >= 168, 'the home stand stays in front of its own house');
  const destination = { ...n.home };
  n.sprite.setPosition(512, 376); n.target = destination;
  scene.moveMember(n, 1000);
  assert.equal(n.target, null);
  assert.equal(n.sprite.x, destination.x); assert.equal(n.sprite.y, destination.y);
});

test('door foot anchors remain outside buildings across house sizes', () => {
  for (const size of [undefined, { w: 126, h: 105, bodyW: 84, wallH: 42 }, { w: 63, h: 84, bodyW: 63, wallH: 21 }]) {
    const scene = sceneWithHouse(), geo = homeGeometry({ x: 10, y: 10 }, 16, size);
    setBuilding({ size, block: 16, blocks: [] });
    // Exercise the scene's actual house creation with lightweight rendering stubs.
    scene.vorld = { art: {} }; scene.plan.doors = [{ x: 10, y: 10 }];
    scene.labelStyle = () => ({});
    const object = () => new Proxy({}, { get: (_target, key) => key === 'on' || key === 'add' ? () => {} : () => object() });
    scene.add = { container: object, zone: object, text: object, sprite: object };
    scene.solids = { add() {} }; scene.homeRects = [];
    scene.addHome({ id: 'writer', look: null }, { x: 10, y: 8 }, {}, 0);
    assert.ok(scene.walkable(geo.x, geo.y));
    assert.equal(scene.walkable(geo.x, geo.y - 1), false, 'crew cannot step into the doorway');
    assert.equal(scene.walkable(geo.x + (size?.w ?? 64) / 2 - 1, geo.y - 10), false, 'roof overhangs and side walls are blocked too');
  }
});
