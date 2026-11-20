import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule, clientModuleUrl, stubModule } from './helpers/client.mjs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
const require = createRequire(import.meta.url);
const TweenManager = require(path.resolve('node_modules/phaser/src/tweens/TweenManager.js'));

const navigation = await clientModuleUrl('engine/client/src/game/navigation.ts');
const geometry = await clientModuleUrl('engine/client/src/game/geometry.ts');
const companion = await clientModuleUrl('engine/client/src/game/companion-position.ts');
const solids = await clientModuleUrl('engine/client/src/game/solids.ts');
const { clearWalk, walkingPath, NavigationGrid } = await import(navigation);
const { homeGeometry } = await import(geometry);
const stub = stubModule(`
  export default { Scene: class {}, Display: { Color: { HexStringToColor: () => ({ color: 0 }) } }, Math: { Distance: { Between: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) } } };
  export const emit = () => {}, on = () => {}, play = () => {};
  export const nearestProp = () => {}, standSpots = () => {}, facing = () => {}, clampQueue = () => {};
  export const TEX = 1, CHAR_TEX = 1, BEE_SCALE = 1, IDLE_FRAME = 1, walkFrame = () => 0, BODY_FONT = 'sans-serif';
  let building;
  export const setBuilding = value => { building = value; };
  export const makeBuilding = () => building, makeMember = () => {}, makePillar = () => {}, makeWorldArt = () => {};
  export const companionOf = () => {}, generatedRevision = () => {}, movementDirection = () => {};
`);
const { setBuilding } = await import(stub);
const { VorldScene } = await clientModule('engine/client/src/game/VorldScene.ts', {
  phaser: stub, './commands': stub, '../store': stub, '../audio/sfx': stub,
  './pixels': stub, './sprites': stub, '../theme': stub, './geometry': geometry, './navigation': navigation, './solids': solids, './companion-position': companion,
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

function reactionScene() {
  const scene = sceneWithHouse(), sprite = { x: 100, y: 100, angle: 0, setAngle(angle) { this.angle = angle; return this; } };
  scene.vorld = { theme: { palette: {} } };
  scene.npcs.set('writer', { sprite, working: true });
  scene.sys = { events: new EventEmitter() };
  scene.tweens = new TweenManager(scene); scene.tweens.getDelta = () => 16;
  scene.particles = () => {}; scene.cameras = { main: { shake() {} } };
  const advance = frames => { for (let i = 0; i < frames; i++) scene.tweens.step(true); };
  return { scene, sprite, advance };
}

test('hammering plays a tilt and naturally returns the character to upright', () => {
  const { scene, sprite, advance } = reactionScene();
  scene.react('writer', { anim: 'hammer' }); advance(5);
  assert.ok(sprite.angle < 0, 'the work animation actually plays');
  advance(30); assert.equal(sprite.angle, 0); assert.equal(scene.rotationReactions.size, 0);
});

test('rapid work reactions replace each other without leaving a residual rotation', () => {
  const { scene, sprite, advance } = reactionScene();
  for (let i = 0; i < 12; i++) { scene.react('writer', { anim: 'hammer' }); advance(3); assert.equal(scene.rotationReactions.size, 1); }
  advance(40); assert.equal(sprite.angle, 0); assert.equal(scene.rotationReactions.size, 0);
});

test('finishing a job cancels a tilt immediately and later frames cannot bring it back', () => {
  const { scene, sprite, advance } = reactionScene();
  scene.react('writer', { anim: 'hammer' }); advance(5); assert.ok(sprite.angle < 0);
  scene.setWorking('writer', false);
  assert.equal(sprite.angle, 0); assert.equal(scene.npcs.get('writer').working, false);
  advance(60); assert.equal(sprite.angle, 0); assert.equal(scene.rotationReactions.size, 0);
});

test('waves and dances also finish upright, including when interrupted by another emote', () => {
  const { scene, sprite, advance } = reactionScene();
  scene.react('writer', { anim: 'wave' }); advance(6); assert.ok(sprite.angle > 0);
  scene.react('writer', { anim: 'dance' }); advance(180);
  assert.equal(sprite.angle, 0); assert.equal(scene.rotationReactions.size, 0);
  sprite.angle = -12; scene.setWorking('writer', true); assert.equal(sprite.angle, 0, 'a new job clears a previously stuck pose');
});

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

test('joining the conversation cancels an old home trip and does not resume it when the party goes quiet', () => {
  const scene = sceneWithHouse(); scene.homeRects = []; scene.player = { x: 160, y: 160 };
  const n = { ...member(200, 240), mode: 'task', base: 'home', slot: 0, queue: [{ do: 'go_home' }], wait: 2500, homing: true };
  scene.npcs.set(n.id, n);
  scene.callOver([n.id], 'summoned');
  assert.equal(n.mode, 'summoned'); assert.deepEqual(n.queue, []); assert.equal(n.base, undefined); assert.equal(n.homing, false);
  scene.moveMember(n, 1000);
  for (let i = 0; i < 200; i++) scene.tickTask(n, 100);
  assert.equal(n.mode, 'summoned'); assert.equal(n.target, null);
  assert.ok(Math.hypot(n.sprite.x - scene.player.x, n.sprite.y - scene.player.y) < 80);
});

test('followers stop only slightly farther away and interaction keeps its original nearby range', t => {
  const savedDocument = globalThis.document; globalThis.document = { activeElement: null };
  t.after(() => { if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument; });
  const scene = sceneWithHouse(); scene.homeRects = []; scene.companionForm = 'person';
  const sprite = (x, y) => Object.assign(member(x, y).sprite, { displayHeight: 26, setVelocity() {}, setTexture() { return this; }, setDepth() { return this; } });
  const text = () => ({ text: '', setPosition(x, y) { this.x = x; this.y = y; return this; }, setVisible() { return this; }, setText(value) { this.text = value; return this; } });
  scene.player = sprite(150, 150); scene.bee = sprite(150, 150); scene.prompt = text();
  scene.keys = Object.fromEntries(['A', 'LEFT', 'D', 'RIGHT', 'W', 'UP', 'S', 'DOWN'].map(k => [k, { isDown: false }]));
  for (const id of ['ada']) scene.npcs.set(id, { ...member(220, 240), id, sprite: sprite(220, 240), label: text(), data: { name: id }, home: { x: 240, y: 240 } });
  scene.callOver(['ada'], 'summoned');
  const settle = () => { for (let i = 0; i < 700; i++) scene.update(i * 16, 16); };
  settle(); scene.player.setPosition(180, 180); settle();
  const n = scene.npcs.get('ada');
  assert.ok(Math.hypot(n.sprite.x - scene.player.x, n.sprite.y - scene.player.y) <= 26, 'stopped follower stays within the original interaction range');
  assert.ok(Math.abs(scene.bee.x - scene.player.x) <= 23, 'the companion stays close rather than on a wide ring');
  assert.equal(scene.near, 'ada');
  n.mode = 'home'; n.working = true; n.target = null;
  n.sprite.setPosition(scene.player.x + 50, scene.player.y); scene.update(0, 16);
  assert.equal(scene.near, null, 'the interaction prompt never reaches a distant crew member');
  n.sprite.setPosition(scene.player.x + 24, scene.player.y); scene.update(0, 16);
  assert.equal(scene.near, 'ada', 'walking close still allows talking normally');
  assert.deepEqual({ x: n.label.x, y: n.label.y }, { x: n.sprite.x, y: n.sprite.y + 2 });
});

test('obstacle searches yield fairly under one shared frame budget', () => {
  const scene = sceneWithHouse();
  scene.plan = { w: 128, h: 88, ground: Array(88).fill('0'.repeat(128)) };
  scene.homeRects = [{ x: 800, y: 0, w: 400, h: 1000 }];
  const a = member(600, 100, { x: 1400, y: 100 }); a.id = 'ada';
  const b = member(620, 100, { x: 1420, y: 100 }); b.id = 'bo';
  scene.planningInFrame = true; scene.moveMember(a, 1); scene.moveMember(b, 1);
  const progress = new Map();
  for (const [id, job] of scene.routeJobs) {
    const next = job.search.next.bind(job.search);
    job.search.next = (...args) => { progress.set(id, (progress.get(id) ?? 0) + 1); return next(...args); };
  }
  scene.planRoutes(8, Infinity);
  assert.equal(progress.get('ada'), 4); assert.equal(progress.get('bo'), 4);
  assert.equal(scene.routes.size, 0); assert.equal(scene.routeJobs.size, 2, 'large searches remain resumable instead of blocking the frame');
  scene.planRoutes(Infinity, Infinity);
  assert.equal(scene.routes.size, 2);
  scene.moveMember(a, 3000); scene.moveMember(b, 3000);
  assert.equal(a.target, null); assert.equal(b.target, null);
});

test('a moving target does not stop a follower while its replacement route is being calculated', () => {
  const scene = sceneWithHouse(), n = member(136, 40, { x: 136, y: 160 });
  scene.moveMember(n, 4);
  n.target = { x: 240, y: 32 }; scene.planningInFrame = true;
  const before = { x: n.sprite.x, y: n.sprite.y };
  scene.moveMember(n, 4);
  assert.ok(scene.routeJobs.has(n.id));
  assert.ok(Math.hypot(n.sprite.x - before.x, n.sprite.y - before.y) > 3.9, 'the still-valid route keeps moving');
  scene.planRoutes(Infinity, Infinity); scene.moveMember(n, 1000);
  assert.equal(n.target, null); assert.equal(n.sprite.x, 240); assert.equal(n.sprite.y, 32);
});

test('ordinary routes around a house fit within one shared planning batch for a full party', () => {
  const scene = sceneWithHouse(); scene.planningInFrame = true;
  for (let i = 0; i < 6; i++) {
    const n = member(136 + i, 40, { x: 136 + i, y: 190 }); n.id = `member-${i}`;
    scene.moveMember(n, 1);
  }
  scene.planRoutes(undefined, Infinity);
  assert.equal(scene.routeJobs.size, 0); assert.equal(scene.routes.size, 6);
});

test('crew share cached obstacle edges and unreachable spots are not searched every frame', () => {
  let checks = 0;
  const grid = new NavigationGrid((x, y) => { checks++; return x >= 0 && y >= 0 && x < 1024 && y < 704 && !(x > 400 && x < 600 && y < 520); }, 1024, 704);
  const run = () => { const search = grid.search({ x: 300, y: 80 }, { x: 700, y: 80 }); for (;;) { const result = search.next(); if (result.done) return result.value; } };
  assert.ok(run()); const cold = checks; checks = 0; assert.ok(run());
  assert.ok(checks < cold / 10, `cached obstacle checks: ${checks}, initial: ${cold}`);
  const scene = sceneWithHouse(); scene.homeRects = [{ x: 140, y: 0, w: 20, h: 320 }];
  const n = member(80, 100, { x: 200, y: 100 }); scene.moveMember(n, 1);
  assert.equal(n.target, null);
  let retries = 0; const search = scene.navigation.search.bind(scene.navigation);
  scene.navigation.search = (...args) => { retries++; return search(...args); };
  for (let i = 0; i < 10; i++) { n.target = { x: 200, y: 100 }; scene.moveMember(n, 1); }
  assert.equal(retries, 0, 'a failed destination has a short cooldown');
  n.target = { x: 220, y: 100 }; scene.moveMember(n, 1); assert.equal(retries, 1, 'a changed destination is tried immediately');
});
