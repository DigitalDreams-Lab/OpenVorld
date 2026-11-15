// The vorld: a town laid out from the crew. Each agent lives in a house around the plaza, where the Party Hall
// stands. The founder walks, the companion follows, a party walks to the hall when its chat starts.
// Phaser 4 (WebGL). Talks to React only through the store's event bus.
import { nearestProp, standSpots, facing, clampQueue, type Pt } from './commands';
import Phaser from 'phaser';
import { emit, on } from '../store';
import { play } from '../audio/sfx';
import { TEX, CHAR_TEX, BEE_SCALE } from './pixels';
import { makeBuilding, makeMember, makePillar, makeWorldArt } from './sprites';
import { companionOf, generatedRevision, movementDirection, walkFrame, IDLE_FRAME, type Direction } from './pixels';
import { homeGeometry, propGeometry } from './geometry';
import { clearWalk, walkingPath } from './navigation';
import { BODY_FONT } from '../theme';
const bodyFont = () => BODY_FONT;

const T = 16;                 // tile size in texture pixels
const ZOOM = 3;

type Mode = 'home' | 'summoned' | 'gather' | 'task';
type Npc = { mode: Mode; target: { x: number; y: number } | null; rest: number; slot: number; look: string; id: string; sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; mark?: Phaser.GameObjects.Text; building: Phaser.GameObjects.Container; built: boolean; sign: Phaser.GameObjects.Text; home: { x: number; y: number }; data: any; frame: number; dir: Direction; lastX: number; lastY: number; working: boolean; queue?: any[]; wait?: number; base?: Mode; autoHome?: boolean };

export class VorldScene extends Phaser.Scene {
  vorld: any;
  startPosition: {x:number;y:number} | null = null;
  player!: Phaser.Physics.Arcade.Sprite;
  bee!: Phaser.GameObjects.Sprite;
  companionId = 'companion';
  companionForm = 'creature';
  companionLook = '';
  plan: any;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  npcs = new Map<string, Npc>();
  routes = new Map<string, { target: Pt; points: Pt[] }>();
  solids!: Phaser.Physics.Arcade.StaticGroup;
  prompt!: Phaser.GameObjects.Text;
  near: string | null = null;
  unsub: Array<() => void> = [];
  walkT = 0;
  /** How much bigger than one tile the characters are drawn (scenery.yaml > characters.scale); the sprite art leaves margin inside its cell. */
  get charScale(): number { return Number(this.vorld?.art?.scenery?.characters?.scale) || 1; }
  walkTo: { x: number; y: number } | null = null;
  /** What the companion is doing on a command (it leaves the founder's side for it), and whether it is hurrying back. */
  beeTask: { queue: any[]; target: Pt | null; wait: number } | null = null; beeReturn = false;
  playerDir: Direction = 'down';
  terminal = { x: 0, y: 0 };
  homeRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  companionDir: Direction = 'down';
  beeShadow?: Phaser.GameObjects.Ellipse; beeLastX = 0; beeLean = 0; beeBobT = 0; followersKey = '';
  browsing = new Set<string>();              // members whose browser is in use right now: a globe over their head
  attention = new Set<string>();             // members waiting for the founder (a seal or a writ): a "!" over their head
  atlasRev: string | null = null;

  constructor() { super('vorld'); }
  init(data: { vorld: any; position?: {x:number;y:number} }) { this.vorld = data.vorld; this.startPosition = data.position ?? null; }

  create() {
    this.npcs.clear(); this.routes.clear(); this.unsub = []; this.near = null; this.walkTo = null; this.homeRects = []; this.beeTask = null; this.beeReturn = false;
    this.playerDir = this.companionDir = 'down';
    this.atlasRev = generatedRevision();
    const pal = this.vorld.theme.palette ?? {};
    const plan = this.vorld.scenery;
    this.plan = plan;
    const MAP_W = plan.w, MAP_H = plan.h;
    const { groundScale } = makeWorldArt(this, plan, this.vorld.art);
    const comp = companionOf(this.vorld);
    this.companionId = comp?.id ?? 'companion';
    this.companionForm = comp?.look?.form ?? 'creature';
    this.companionLook = JSON.stringify(comp?.look ?? null);
    makeMember(this, 'companion', this.companionId);
    const pillarSize = makePillar(this, this.vorld.art);
    const fs = makeMember(this, 'founder', 'founder');

    const cx = plan.plaza.x, cy = plan.plaza.y;
    this.add.image(0, 0, 'ground').setOrigin(0).setScale(groundScale).setDepth(0);
    this.solids = this.physics.add.staticGroup();
    this.physics.world.setBounds(T, T, (MAP_W - 2) * T, (MAP_H - 2) * T);
    this.addScenery(plan, pal);

    // the plaza landmark is the Party Hall: parties are formed and opened here
    const pillar = this.add.image(cx * T + 8, cy * T + 12, 'pillar').setOrigin(0.5, 1).setScale(1 / TEX).setDepth(cy * T + 12).setInteractive({ cursor: 'pointer' });
    pillar.on('pointerdown', (p: Phaser.Input.Pointer) => { if (!this.isOnCanvas(p)) return; play('ui.open'); emit('parties'); });
    this.terminal = { x: pillar.x, y: pillar.y + 6 };
    this.solids.add(this.add.zone(pillar.x, pillar.y - 4, Math.min(28, pillarSize.w - 4), 8));
    this.add.text(pillar.x, pillar.y - pillarSize.h - 6, this.vorld.theme.buildings?.party_hall ?? 'Party Hall', this.labelStyle(pal, 7)).setOrigin(0.5).setDepth(9999);

    // homes take the plan's plots in crew order (a crew larger than the map's plots has no house for the rest)
    const homes = this.vorld.crew.filter((c: any) => c.id !== this.companionId);
    homes.slice(0, plan.slots.length).forEach((c: any, i: number) => this.addHome(c, plan.slots[i], pal, i));
    // Street layouts can put a neighbour's roof over a door. Pick standing room
    // after every house is registered, so both spawning and returning home are safe.
    this.placeCrewAtHome();

    // founder + companion
    const start = this.startPosition && this.walkable(this.startPosition.x, this.startPosition.y) ? this.startPosition : { x: plan.spawn.x * T + 8, y: plan.spawn.y * T };
    this.player = this.physics.add.sprite(start.x, start.y, 'founder-down-2').setOrigin(0.5, 1).setScale(this.charScale / CHAR_TEX);
    this.player.setCollideWorldBounds(true);
    (this.player.body as Phaser.Physics.Arcade.Body).setSize(8 * CHAR_TEX / this.charScale, 6 * CHAR_TEX / this.charScale).setOffset((fs.w - 8 * CHAR_TEX / this.charScale) / 2, fs.h - 8 * CHAR_TEX / this.charScale);   // the collision box stays the size of a tile-sized walker
    this.physics.add.collider(this.player, this.solids);
    this.bee = this.add.sprite(this.player.x - 14, this.player.y - 26, 'companion-down-2').setOrigin(0.5, 1).setScale(this.charScale / CHAR_TEX * (this.companionForm === 'creature' ? BEE_SCALE : 1)).setDepth(5000).setInteractive({ cursor: 'pointer' });
    this.beeShadow = this.add.ellipse(this.bee.x, this.bee.y + 20, 8, 3, 0x000000, 0.26).setDepth(1);
    this.beeShadow.setVisible(this.companionForm === 'creature');
    this.beeLastX = this.bee.x;
    this.bee.on('pointerdown', (p: Phaser.Input.Pointer) => { if (!this.isOnCanvas(p)) return; emit('poke'); this.balloon(this.companionId, '♥', 900); play('ui.open'); emit('talk', this.companionId); });

    const cam = this.cameras.main;
    cam.setZoom(ZOOM).setBounds(0, 0, MAP_W * T, MAP_H * T).startFollow(this.player, true, 0.15, 0.15);
    cam.centerOn(this.player.x, this.player.y);   // start on the founder, not panning in from the map corner
    cam.setBackgroundColor(pal.ink ?? '#111');

    this.prompt = this.add.text(0, 0, '', this.labelStyle(pal, 7)).setOrigin(0.5).setDepth(10000).setVisible(false);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE', false) as any;
    kb.on('keydown-E', () => this.talkNear());
    kb.on('keydown-SPACE', () => this.talkNear());

    // click/tap to walk (ignored when the click hit a member, the bee or a building)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length) return;
      // Phaser also hears presses that start outside the canvas (HUD buttons, open dialogs): those must not move the player
      if (!this.isOnCanvas(p)) return;
      this.walkTo = { x: p.worldX, y: p.worldY };
    });

    this.unsub.push(
      on('vorld', (w) => {
        if (!this.sys?.isActive?.() || !this.scene?.manager) return;      // a scene left over from a hot reload
        // Generated art changes props and collision geometry as well as character textures.
        const homes = (x: any) => JSON.stringify(x.crew.map((c: any) => [c.id, c.role]));
        if (JSON.stringify(w.art) !== JSON.stringify(this.vorld.art) || homes(w) !== homes(this.vorld) || generatedRevision() !== this.atlasRev) { this.scene.restart({ vorld: w, position: {x:this.player.x,y:this.player.y} }); return; }
        this.vorld = w; this.refresh();
      }),
      on('attention', (ids: string[]) => { this.attention = new Set(ids); this.refresh(); }),
      on('browsing', (ids: string[]) => { this.browsing = new Set(ids); this.refresh(); }),
      on('balloon', ({ role, text, ms }) => this.balloon(role, text, ms)),
      on('react', ({ role, reaction }) => this.react(role, reaction)),
      on('working', ({ role, working }) => { const n = this.npcs.get(role); if (n) n.working = working; }),
      on('summon', ({ ids }: { ids: string[] }) => this.callOver(ids, 'summoned')),
      on('gather', ({ ids }: { ids: string[] }) => this.callOver(ids, 'gather')),
      on('command', ({ role, commands }: { role: string; commands: any[] }) => this.runCommands(role, commands)),
      on('dismiss', ({ ids }: { ids?: string[] }) => this.sendHome(ids)),
    );
    const cleanup = () => { this.unsub.forEach((u) => u()); this.unsub = []; };
    this.events.once('shutdown', cleanup); this.events.once('destroy', cleanup);
    this.refresh();
    emit('scene-ready');
  }

  isOnCanvas(p?: Phaser.Input.Pointer) {
    const t = (p?.event as Event | undefined)?.target as HTMLElement | undefined;
    return !t || t === this.game.canvas;
  }

  labelStyle(pal: any, size: number): Phaser.Types.GameObjects.Text.TextStyle {
    // names and signs in a bold readable face with a dark outline (the pixel font blurs at this size)
    const L = this.vorld.art?.scenery?.labels ?? {};                         // scenery.yaml > labels: how big map text is
    const k = L.scale ?? 1;
    return { fontFamily: bodyFont(), fontStyle: '700', fontSize: `${Math.max(L.min ?? 4, (size + 1) * k).toFixed(2)}px`, color: pal.parchment ?? '#fff', stroke: pal.ink ?? '#000', strokeThickness: (L.stroke ?? 2.5) * Math.min(1, k + 0.15), resolution: ZOOM * window.devicePixelRatio * 1.5 };
  }

  addHome(c: any, slot: { x: number; y: number }, pal: any, i: number) {
    const look = c.look;
    makeMember(this, `npc-${c.id}`, c.id);
    const house = makeBuilding(this, c.id, this.vorld.art, { seed: this.plan.seed, biome: this.plan.biome, mood: this.plan.mood, order: c.order });
    const size = house?.size;
    const geo = homeGeometry(this.plan.doors[i] ?? { x: slot.x, y: slot.y + 2 }, T, size, house?.block);
    // Keep crew outside the whole illustration, including roof overhangs and side walls.
    // The foot anchor at the door stays in front of the building's depth.
    this.homeRects.push({ x: geo.x - (size?.w ?? 64) / 2 - 4, y: geo.top, w: (size?.w ?? 64) + 8, h: geo.y - geo.top });
    const bx = geo.x, by = geo.y;
    // the home is a container of block sprites (walls, roof rows, door, windows, chimney, extras), not one image
    const building = this.add.container(bx, geo.bottom).setDepth(by - 1);
    for (const b of house?.blocks ?? []) building.add(this.add.image(b.x, -b.y, b.tex).setOrigin(0, 0).setScale(1 / TEX).setFlipX(b.flip).setData('y', -b.y).setData('overlay', b.overlay));
    const hit = this.add.zone(bx, geo.bottom - (size?.h ?? 48) / 2, size?.w ?? 48, size?.h ?? 48).setInteractive({ cursor: 'pointer' });
    this.solids.add(this.add.zone(geo.solid.x, geo.solid.y, geo.solid.w, geo.solid.h));
    for (const w of geo.walls) this.solids.add(this.add.zone(w.x, w.y, w.w, w.h));
    const sign = this.add.text(bx, geo.top - 8, '', this.labelStyle(pal, 7)).setOrigin(0.5).setDepth(9999);
    const sprite = this.add.sprite(bx, by, `npc-${c.id}-down-2`).setOrigin(0.5, 1).setScale(this.charScale / CHAR_TEX).setDepth(by).setInteractive({ cursor: 'pointer' });
    sprite.on('pointerdown', (p: Phaser.Input.Pointer) => { if (!this.isOnCanvas(p)) return; this.tryTalk(c.id); });
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => { if (!this.isOnCanvas(p)) return; this.tryTalk(c.id); });
    const label = this.add.text(bx, by + 2, '', this.labelStyle(pal, 6)).setOrigin(0.5, 0).setDepth(9999);
    this.npcs.set(c.id, { mode: 'home', target: null, rest: 1500 + (i * 977) % 3000, slot: i, id: c.id, look: JSON.stringify(look ?? null), sprite, label, building, built: false, sign, home: { x: bx, y: by }, data: c, frame: 2, dir: 'down', lastX: bx, lastY: by, working: false });
  }

  /** Props, ground decor, water and ambient life from the seeded plan. */
  addScenery(plan: any, pal: any) {
    const defs = this.vorld.art.scenery;
    // water blocks walking: one collider per horizontal run of water cells
    for (let y = 0; y < plan.h; y++) {
      let x = 0;
      while (x < plan.w) {
        if ('wWV'.includes(plan.ground[y][x])) { const x0 = x; while (x < plan.w && 'wWV'.includes(plan.ground[y][x])) x++; this.solids.add(this.add.zone(((x0 + x) / 2) * T, y * T + 8, (x - x0) * T, T)); } else x++;
      }
    }
    for (const g of plan.ground_props) (this.add.image(g.x * T + 3 + ((g.x * 7 + g.y * 3) % 9), g.y * T + 14, `prop-${g.t}-0`).setOrigin(0.5, 1).setScale(1 / TEX).setDepth(1));
    let sway = 0;
    for (const p of plan.props) {
      const def = defs.props[p.t];
      const x = p.x * T + 8, y = p.y * T + 16;
      const img = this.add.image(x, y, `prop-${p.t}-${p.v}`).setOrigin(0.5, 1).setScale(1 / TEX).setDepth(y);
      const geo = propGeometry(def);
      if (geo.solid) this.solids.add(this.add.zone(x, y - geo.footHeight / 2, geo.solid, geo.footHeight));
      if (def.sway && sway++ < 90) this.tweens.add({ targets: img, angle: { from: -1.6, to: 1.6 }, duration: 1800 + (p.x * 37 + p.y * 17) % 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: (p.x * 91) % 1500 });
      if (def.glow) {
        // a soft halo over lamps and crystals
        const col = this.glowColor(defs.biomes[plan.biome], pal);
        this.add.image(x, y - img.displayHeight * 0.75, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(Phaser.Display.Color.HexStringToColor(col).color).setScale(0.5 + 0.35 * def.glow).setAlpha(0.35).setDepth(y + 1);
      }
    }
    this.ambient(plan.particles, pal);
  }
  glowColor(biome: any, pal: any) {
    const t: string = biome.roles?.glow ?? 'pal.gold';
    return t.startsWith('pal.') ? pal[t.slice(4)] ?? '#ffd36b' : /^#/.test(t) ? t : pal.gold ?? '#ffd36b';
  }

  /** Slow ambient life over the whole map: fireflies, petals, snow, embers, rain, dust, sparks. */
  ambient(kind: string | undefined, pal: any) {
    if (!kind || kind === 'none') return;
    const W = this.plan.w * T, H = this.plan.h * T;
    const C = (h: string) => Phaser.Display.Color.HexStringToColor(h).color;
    const cfg: Record<string, { n: number; color: () => number; w: number; h: number; vx: number; vy: number; dur: [number, number]; add?: boolean; alpha: number }> = {
      fireflies: { n: 45, color: () => C(pal.gold ?? '#ffd36b'), w: 2, h: 2, vx: 18, vy: -10, dur: [2600, 5200], add: true, alpha: 0.9 },
      petals: { n: 40, color: () => C([pal.danger, pal.parchment, pal.gold][Math.floor(Math.random() * 3)] ?? '#fff'), w: 2, h: 2, vx: 36, vy: 70, dur: [4200, 7000], alpha: 0.85 },
      snow: { n: 90, color: () => 0xffffff, w: 1.5, h: 1.5, vx: 14, vy: 80, dur: [4500, 8000], alpha: 0.9 },
      embers: { n: 36, color: () => C(pal.gold ?? '#ffb347'), w: 1.5, h: 1.5, vx: 14, vy: -70, dur: [3000, 5200], add: true, alpha: 0.9 },
      rain: { n: 110, color: () => C(pal.parchment ?? '#cfe6ff'), w: 1, h: 5, vx: -14, vy: 150, dur: [650, 1100], alpha: 0.35 },
      dust: { n: 26, color: () => C(pal.parchment ?? '#fff'), w: 1.5, h: 1.5, vx: 30, vy: 6, dur: [6000, 10000], alpha: 0.35 },
      sparks: { n: 34, color: () => C(pal.turquoise ?? '#6fd8ff'), w: 2, h: 2, vx: 0, vy: 0, dur: [900, 2200], add: true, alpha: 0.95 },
    };
    const c = cfg[kind];
    if (!c) return;
    for (let i = 0; i < c.n; i++) {
      const r = this.add.rectangle(Math.random() * W, Math.random() * H, c.w, c.h, c.color()).setDepth(15000).setAlpha(0);
      if (c.add) r.setBlendMode(Phaser.BlendModes.ADD);
      const dur = c.dur[0] + Math.random() * (c.dur[1] - c.dur[0]);
      const wob = kind === 'fireflies' ? { x: `+=${(Math.random() - 0.5) * 2 * c.vx}`, y: `+=${(Math.random() - 0.5) * 2 * 14}` } : { x: `+=${c.vx * (dur / 1000) * (0.6 + Math.random() * 0.8)}`, y: `+=${c.vy * (dur / 1000)}` };
      this.tweens.add({ targets: r, ...wob, alpha: { from: 0, to: c.alpha }, duration: dur, yoyo: kind === 'fireflies' || kind === 'sparks', repeat: -1, delay: Math.random() * 3000, ease: kind === 'fireflies' ? 'Sine.inOut' : 'Linear', onRepeat: () => { if (!['fireflies', 'sparks'].includes(kind)) { r.x = Math.random() * W; r.y = c.vy > 0 ? -4 : H + 4; } else { r.x = Math.random() * W; r.y = Math.random() * H; } } });
    }
  }

  /** Apply the latest vorld state (names, homes, who is waiting for the founder) to the scene. */
  refresh() {
    const byId = new Map(this.vorld.crew.map((c: any) => [c.id, c]));
    const pal = this.vorld.theme.palette ?? {};
    for (const n of this.npcs.values()) {
      const c: any = byId.get(n.id);
      if (!c) continue;
      n.data = c;
      n.label.setText(c.name);
      n.sign.setText(c.home);
      if (!n.built) { n.built = true; this.buildUp(n.building, true); }
      if (n.mark) { n.mark.destroy(); n.mark = undefined; }
      const mark = this.attention.has(n.id) ? '!' : this.browsing.has(n.id) ? '🌐' : null;
      if (mark) {
        n.mark = this.add.text(n.sprite.x, n.sprite.y - 30, mark, { ...this.labelStyle(pal, 12), color: pal.gold ?? '#fc0' }).setOrigin(0.5).setDepth(19000);
        this.tweens.add({ targets: n.mark, y: n.mark.y - 4, duration: 420, yoyo: true, repeat: -1 });
      }
    }
  }

  tryTalk(id: string) {
    play('ui.open');
    emit('talk', id);
  }
  talkNear() {
    if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (this.near) this.tryTalk(this.near);
    else if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.terminal.x, this.terminal.y) < 30) { play('ui.open'); emit('parties'); }
    else if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.bee.x, this.bee.y) < 30) emit('talk', this.companionId);
  }

  balloonAt(x: number, y: number, text: string, ms = 2600) {
    const pal = this.vorld.theme.palette ?? {};
    const t = this.add.text(0, 0, text, { fontFamily: bodyFont(), fontStyle: '600', fontSize: '7px', color: pal.ink ?? '#000', resolution: ZOOM * window.devicePixelRatio * 1.5, wordWrap: { width: 110 }, align: 'center', lineSpacing: 1 }).setOrigin(0.5);
    const w = t.width + 8, h = t.height + 6;
    const g = this.add.graphics();
    g.fillStyle(Phaser.Display.Color.HexStringToColor(pal.parchment ?? '#fff').color).fillRoundedRect(-w / 2, -h / 2, w, h, 3);
    g.lineStyle(1, Phaser.Display.Color.HexStringToColor(pal.ink ?? '#000').color).strokeRoundedRect(-w / 2, -h / 2, w, h, 3);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(pal.parchment ?? '#fff').color).fillTriangle(-3, h / 2 - 1, 3, h / 2 - 1, 0, h / 2 + 4);
    const box = this.add.container(x, y - h / 2 - 6, [g, t]).setDepth(20000).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 140, ease: 'Back.out' });
    this.time.delayedCall(ms, () => this.tweens.add({ targets: box, alpha: 0, y: box.y - 6, duration: 250, onComplete: () => box.destroy() }));
  }
  balloon(role: string, text: string, ms = 2600) {
    if (!text) return;
    if (role === this.companionId) return this.balloonAt(this.bee.x, this.bee.y - 14, text, ms);
    const n = this.npcs.get(role);
    if (n && n.sprite.visible) this.balloonAt(n.sprite.x, n.sprite.y - n.sprite.displayHeight - 2, text, ms);
  }

  particles(x: number, y: number, color: number, count = 8, spread = 14) {
    for (let i = 0; i < count; i++) {
      const p = this.add.rectangle(x, y, 1.5, 1.5, color).setDepth(20000);
      const a = Math.random() * Math.PI * 2, d = spread * (0.4 + Math.random() * 0.6);
      this.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d - 6, alpha: 0, duration: 380 + Math.random() * 220, ease: 'Quad.out', onComplete: () => p.destroy() });
    }
  }

  /** Visual reaction to an agent event (from packs/core/interactions.yaml). */
  react(role: string, r: any) {
    if (!r) return;
    const target = role === this.companionId ? this.bee : this.npcs.get(role)?.sprite;
    if (!target) return;
    const pal = this.vorld.theme.palette ?? {};
    const col = (h: string, d: string) => Phaser.Display.Color.HexStringToColor(h ?? d).color;
    switch (r.anim) {
      case 'hammer':
        this.tweens.add({ targets: target, angle: { from: -12, to: 8 }, duration: 90, yoyo: true });
        this.particles(target.x + 6, target.y, col(pal.gold, '#fc0'), 10);
        this.cameras.main.shake(60, 0.0015);
        break;
      case 'bellows': this.particles(target.x, target.y - 8, 0xbbbbbb, 6, 10); break;
      case 'cheer': this.tweens.add({ targets: target, y: target.y - 6, duration: 120, yoyo: true, repeat: 2 }); this.particles(target.x, target.y - 10, 0xffffff, 12, 18); break;
      case 'wince': case 'faint': this.tweens.add({ targets: target, x: target.x + 2, duration: 40, yoyo: true, repeat: 3 }); target.setTint(0xff7777); this.time.delayedCall(300, () => target.clearTint()); break;
      case 'read_scroll': case 'gaze': this.tweens.add({ targets: target, scaleY: 0.92, duration: 120, yoyo: true }); break;
      case 'think': this.tweens.add({ targets: target, y: target.y - 2, duration: 300, yoyo: true }); break;
      case 'bow': this.tweens.add({ targets: target, scaleY: 0.85, duration: 160, yoyo: true }); break;
      case 'wave': this.tweens.add({ targets: target, angle: { from: -10, to: 10 }, duration: 110, yoyo: true, repeat: 5, onComplete: () => target.setAngle(0) }); break;
      case 'dance': this.tweens.add({ targets: target, y: target.y - 4, angle: { from: -8, to: 8 }, duration: 140, yoyo: true, repeat: 7, onComplete: () => target.setAngle(0) }); this.particles(target.x, target.y - 10, col(pal.gold, '#fc0'), 8, 16); break;
      case 'shrug': this.tweens.add({ targets: target, scaleY: target.scaleY * 0.93, x: target.x + 1, duration: 180, yoyo: true, repeat: 1 }); break;
      case 'sniff': this.tweens.add({ targets: target, y: target.y - 1.5, duration: 160, yoyo: true, repeat: 3 }); break;
      case 'rest': this.tweens.add({ targets: target, scaleY: target.scaleY * 0.88, duration: 260, yoyo: true, hold: Math.max(0, (r.ms ?? 2500) - 520) }); break;
    }
    if (r.particles === 'steam') this.particles(target.x, target.y - 4, 0xffffff, 14, 16);
    if (r.balloon) this.balloon(role, r.balloonText ?? '', 1800);
  }

  /** Is a map point standing room for a member (ground, path, plaza or bridge, outside every home)? */
  walkable(x: number, y: number) {
    const c = this.plan.ground[Math.floor(y / T)]?.[Math.floor(x / T)];
    if (!c || !'0123pPb'.includes(c)) return false;
    return !this.homeRects.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
  }
  placeCrewAtHome() {
    for (const n of this.npcs.values()) {
      if (this.walkable(n.home.x, n.home.y)) continue;
      let best: Pt | null = null, distance = Infinity;
      // Prefer the front or sides of the door, never the back of its roof.
      for (let dy = 0; dy <= T * 8; dy += 4) for (let dx = -T * 8; dx <= T * 8; dx += 4) {
        const d = Math.hypot(dx, dy), x = n.home.x + dx, y = n.home.y + dy;
        if (d < distance && this.walkable(x, y)) { best = { x, y }; distance = d; }
      }
      if (best) { n.home = best; n.sprite.setPosition(best.x, best.y); n.lastX = best.x; n.lastY = best.y; }
    }
  }
  /** Walk each route segment rather than taking a straight line through a house. */
  moveMember(n: Npc, distance: number) {
    if (!n.target) { this.routes.delete(n.id); return; }
    const walkable = (x: number, y: number) => this.walkable(x, y);
    let route = this.routes.get(n.id);
    if (!route || route.target.x !== n.target.x || route.target.y !== n.target.y || (route.points[0] && !clearWalk(n.sprite, route.points[0], walkable))) {
      const points = walkingPath(n.sprite, n.target, walkable, this.plan.w * T, this.plan.h * T);
      if (!points) { n.target = null; this.routes.delete(n.id); return; }
      route = { target: { ...n.target }, points }; this.routes.set(n.id, route);
    }
    while (route.points.length) {
      const at = route.points[0], dx = at.x - n.sprite.x, dy = at.y - n.sprite.y, d = Math.hypot(dx, dy);
      if (d > distance) {
        n.sprite.setPosition(n.sprite.x + dx / d * distance, n.sprite.y + dy / d * distance);
        return;
      }
      n.sprite.setPosition(at.x, at.y); distance -= d; route.points.shift();
    }
    n.target = null; this.routes.delete(n.id);
  }
  /** A random spot in front of the member's home, so they potter about instead of standing still. */
  wanderTarget(n: Npc) {
    for (let k = 0; k < 8; k++) {
      const x = n.home.x + (Math.random() - 0.5) * 72, y = n.home.y + Math.random() * 40 - 4;
      if (this.walkable(x, y)) return { x, y };
    }
    return { x: n.home.x, y: n.home.y };
  }
  /** Members come to the founder ('summoned', they then follow) or to the town terminal ('gather'). */
  callOver(ids: string[], mode: Mode) {
    for (const id of ids) {
      const n = this.npcs.get(id);
      if (!n) continue;
      // the lowest slot nobody else in this mode holds, so members called one by one never share a spot
      const taken = new Set([...this.npcs.values()].filter((o) => o !== n && o.mode === mode).map((o) => o.slot));
      let slot = 0; while (taken.has(slot)) slot++;
      n.mode = mode; n.slot = slot; n.target = this.spotFor(n);
      this.balloon(id, mode === 'gather' ? '…' : '!', 900);
    }
  }
  /** Members go back to their homes (the town terminal's "send home", and the companion's send_home command). */
  sendHome(ids?: string[]) {
    for (const n of this.npcs.values()) if (!ids || ids.includes(n.id)) { n.mode = 'home'; n.queue = []; n.base = undefined; n.target = { x: n.home.x, y: n.home.y }; }
  }

  // ---- game commands: what members DO on the map (checked and spelled out by the server, see packs/core/commands.yaml) ----
  /** A new batch replaces whatever the member was doing; the member goes back to what it was doing before when it is done. */
  runCommands(role: string, commands: any[]) {
    const steps = clampQueue(commands, 12);
    if (!steps.length) return;
    if (role === this.companionId) { this.beeTask = { queue: steps, target: null, wait: 0 }; this.beeReturn = false; return; }
    const n = this.npcs.get(role);
    if (!n) return;
    if (n.mode !== 'task') n.base = n.mode;
    n.mode = 'task'; n.queue = steps; n.wait = 0; n.target = null; n.autoHome = false;
  }
  slotOf(role: string) { return [...this.npcs.keys()].indexOf(role) + 1; }
  /** Room to stand around a point: the first free spot of a ring, a different one for each member. */
  ringSpot(c: Pt, r: number, slot: number): Pt {
    const ring = [0.8, 0.2, 1.2, 1.8, 0.5, 1.5, 1.0, 0.0];
    for (let k = 0; k < ring.length; k++) {
      const a = Math.PI * ring[(slot + k) % ring.length], x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r * 0.65 + 6;
      if (this.walkable(x, y)) return { x, y };
    }
    return { x: c.x, y: c.y + 8 };
  }
  propSpot(kind: string, from: Pt): { stand: Pt; prop: Pt } | null {
    const prop = nearestProp([...(this.plan.props ?? []), ...(this.plan.ground_props ?? [])], kind, from, T);
    if (!prop) return null;
    const stand = standSpots(prop, T).find((p) => this.walkable(p.x, p.y)) ?? { x: prop.x, y: prop.y + T };
    return { stand, prop };
  }
  placeFor(role: string, to: any, from: Pt): (Pt & { look?: Pt }) | null {
    const slot = this.slotOf(role);
    switch (to?.kind) {
      case 'plaza': return this.ringSpot(this.terminal, 30, slot);
      case 'founder': return this.ringSpot({ x: this.player.x, y: this.player.y }, 22, slot);
      case 'home': { if (role === this.companionId) return this.ringSpot({ x: this.player.x, y: this.player.y }, 22, 0); const n = this.npcs.get(role); return n ? this.wanderTarget(n) : null; }
      case 'member': { const o = this.npcs.get(to.id); return o ? this.ringSpot({ x: o.home.x, y: o.home.y }, 16, slot) : null; }
      case 'prop': { const s = this.propSpot(String(to.ref), from); return s ? { ...s.stand, look: s.prop } : null; }
    }
    return null;
  }
  faceToward(role: string, at: Pt) {
    if (role === this.companionId) { this.companionDir = facing({ x: this.bee.x, y: this.bee.y }, at, this.companionDir); return; }
    const n = this.npcs.get(role); if (n) n.dir = facing({ x: n.sprite.x, y: n.sprite.y }, at, n.dir);
  }
  markAt(x: number, y: number) {
    const m = this.add.text(x, y - 18, '▼', { fontFamily: bodyFont(), fontSize: '9px', color: (this.vorld.theme.palette ?? {}).gold ?? '#fc0', resolution: 3 }).setOrigin(0.5).setDepth(20000);
    this.tweens.add({ targets: m, y: y - 12, duration: 380, yoyo: true, repeat: 6 });
    this.time.delayedCall(5000, () => m.destroy());
  }
  /** Begin one step: returns where to walk, how long to wait, and any follow-up step. */
  beginStep(role: string, cmd: any, from: Pt): { target?: Pt; wait?: number; after?: any } {
    switch (cmd?.do) {
      case 'say': { const text = String(cmd.text ?? ''); this.balloon(role, text, Math.min(6000, 1600 + text.length * 60)); return { wait: 1400 }; }
      case 'emote': this.react(role, { anim: String(cmd.kind) }); return { wait: 1100 };
      case 'wait': return { wait: Number(cmd.ms) || 1000 };
      case 'walk_to': { const t = this.placeFor(role, cmd.to, from); return t ? { target: t } : {}; }
      case 'go_home': { const t = this.placeFor(role, { kind: 'home' }, from); return t ? { target: t } : {}; }
      case 'point_to': { const t = this.placeFor(role, cmd.to, from); return t ? { target: t, after: { do: '_point', at: t.look ?? t } } : {}; }
      case 'interact': { const s = this.propSpot(String(cmd.with), from); return s ? { target: s.stand, after: { do: '_act', anim: cmd.anim, ms: cmd.ms, face: s.prop } } : {}; }
      case '_act': this.faceToward(role, cmd.face); this.react(role, { anim: cmd.anim, ms: cmd.ms }); return { wait: Number(cmd.ms) || 2000 };
      case '_point': this.markAt(cmd.at.x, cmd.at.y); this.react(role, { anim: 'cheer' }); return { wait: 1600 };
      case 'summon': this.callOver(cmd.who ?? [], 'summoned'); return { wait: 800 };
      case 'gather': this.callOver(cmd.who ?? [], 'gather'); return { wait: 800 };
      case 'send_home': this.sendHome(cmd.who ?? []); return { wait: 800 };
      default: return {};
    }
  }
  /** Run a member's queue: walk, then the next step when they arrive; when it is empty they go back to what they were doing. */
  tickTask(n: Npc, dt: number) {
    if ((n.wait ?? 0) > 0) { n.wait! -= dt; return; }
    if (n.target) return;
    const step = n.queue?.shift();
    if (!step) {
      if (n.mode !== 'task') return;
      // after a while away from home, a short pause and the walk back, before the usual pottering
      if (n.base === 'home' && !n.autoHome && Phaser.Math.Distance.Between(n.sprite.x, n.sprite.y, n.home.x, n.home.y) > 40) { n.autoHome = true; n.queue = [{ do: 'wait', ms: 2500 }, { do: 'go_home' }]; return; }
      n.mode = n.base ?? 'home'; n.base = undefined; n.autoHome = false;
      return;
    }
    const r = this.beginStep(n.id, step, { x: n.sprite.x, y: n.sprite.y });
    if (r.target) n.target = r.target;
    if (r.after) n.queue!.unshift(r.after);
    n.wait = r.wait ?? 0;
  }
  tickBee(dt: number) {
    const t = this.beeTask!;
    if (t.wait > 0) { t.wait -= dt; return; }
    if (t.target) { if (Math.hypot(t.target.x - this.bee.x, t.target.y - this.bee.y) > 2) return; t.target = null; }
    const step = t.queue.shift();
    if (!step) { this.beeTask = null; this.beeReturn = true; return; }
    const r = this.beginStep(this.companionId, step, { x: this.bee.x, y: this.bee.y });
    if (r.target) t.target = r.target;
    if (r.after) t.queue.unshift(r.after);
    t.wait = r.wait ?? 0;
  }

  /** A free spot around the founder (summoned) or the terminal (gather), one per caller so nobody overlaps. */
  spotFor(n: Npc) {
    const gather = n.mode === 'gather', c = gather ? this.terminal : { x: this.player.x, y: this.player.y };
    const ring = [0.8, 0.2, 1.2, 1.8, 0.5, 1.5, 1.0, 0.0], r = (gather ? 34 : 22) + Math.floor(n.slot / ring.length) * 14;
    for (let k = 0; k < ring.length; k++) {
      const a = Math.PI * ring[(n.slot + k) % ring.length];
      const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r * 0.65 + (gather ? 8 : 0);
      if (this.walkable(x, y)) return { x, y };
    }
    return { x: c.x + (n.slot % 2 ? 1 : -1) * (14 + 10 * Math.floor(n.slot / 2)), y: c.y + 6 };
  }

  /** A home appears block by block: walls from the ground up, then the roof rows, then the details. */
  buildUp(home: Phaser.GameObjects.Container, animate: boolean) {
    if (!animate || !this.tweens) return;
    const kids = home.list as Phaser.GameObjects.Image[];
    const order = [...kids].sort((a, b) => Number(a.getData('overlay')) - Number(b.getData('overlay')) || b.getData('y') - a.getData('y') || a.x - b.x);
    order.forEach((img, k) => {
      const y = img.getData('y');
      img.setAlpha(0).setY(y - 10);
      this.tweens.add({ targets: img, y, alpha: 1, duration: 160, delay: 40 * k, ease: 'Back.Out' });
    });
  }

  /**
   * A flying companion: the wings never stop (a quick flap when it travels, a lazy one when it hovers), it bobs up and
   * down, leans into its movement, and a small shadow on the ground shows how high it floats.
   */
  animateBee(dt: number, travelling: boolean) {
    this.beeBobT += dt;
    const flapMs = travelling ? 55 : 85;
    const frame = walkFrame(this.beeBobT, flapMs);        // the four frames are a wing flap: up, halfway down, down, halfway up
    const bob = Math.sin(this.beeBobT / (travelling ? 170 : 300)) * (travelling ? 0.9 : 1.7);       // world pixels
    const vx = (this.bee.x - this.beeLastX) / Math.max(dt, 1) * 1000;                              // world px per second
    this.beeLastX = this.bee.x;
    const wantLean = Phaser.Math.Clamp(vx / 90, -1, 1) * 9, ease = 1 - Math.exp(-dt / 120);
    this.beeLean += (wantLean - this.beeLean) * ease;
    this.bee.setTexture(`companion-${this.companionDir}-${frame}`).setDepth(this.bee.y);
    this.bee.setOrigin(0.5, 1 + bob / Math.max(1, this.bee.displayHeight)).setAngle(this.beeLean);
    // squash and stretch with the flap, so he feels light
    const base = this.charScale / CHAR_TEX * BEE_SCALE, sq = 1 + [0.01, 0.03, -0.025, 0][frame];
    this.bee.setScale(base / sq, base * sq);
    const sh = this.beeShadow;
    if (sh) { const lift = 1 - Math.min(1, (bob + 2) / 8) * 0.12; sh.setPosition(this.bee.x, this.bee.y + 21).setScale(lift).setAlpha(0.26 - bob * 0.015).setDepth(this.bee.y - 1); }
  }

  /** Soft collision: members never stand inside each other, the founder or a walking companion. */
  separate() {
    const MIN = 13, SQUASH = 1.8;               // feet are wide and flat: y distances count more
    const movers = [...this.npcs.values()].filter((n) => n.sprite.visible !== false);
    const fixed: { x: number; y: number }[] = [{ x: this.player.x, y: this.player.y }];
    if (this.companionForm !== 'creature') fixed.push({ x: this.bee.x, y: this.bee.y });
    const push = (n: Npc, px: number, py: number) => {
      const x = n.sprite.x + px, y = n.sprite.y + py;
      if (clearWalk(n.sprite, { x, y }, (x, y) => this.walkable(x, y))) n.sprite.setPosition(x, y);
    };
    for (let i = 0; i < movers.length; i++) {
      const a = movers[i];
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j];
        let dx = a.sprite.x - b.sprite.x, dy = (a.sprite.y - b.sprite.y) * SQUASH;
        let d = Math.hypot(dx, dy);
        if (d >= MIN) continue;
        if (d < 0.01) { dx = a.id < b.id ? 1 : -1; dy = 0; d = 1; }   // exactly stacked: split sideways
        const k = (MIN - d) / 2 / d;
        push(a, dx * k, (dy * k) / SQUASH); push(b, -dx * k, (-dy * k) / SQUASH);
      }
      for (const f of fixed) {
        let dx = a.sprite.x - f.x, dy = (a.sprite.y - f.y) * SQUASH, d = Math.hypot(dx, dy);
        if (d >= MIN) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; }
        const k = (MIN - d) / d;
        push(a, dx * k, (dy * k) / SQUASH);
      }
    }
  }

  update(_t: number, dt: number) {
    if (!this.player) return;
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const k = this.keys;
    let vx = typing ? 0 : (k.A.isDown || k.LEFT.isDown ? -1 : 0) + (k.D.isDown || k.RIGHT.isDown ? 1 : 0);
    let vy = typing ? 0 : (k.W.isDown || k.UP.isDown ? -1 : 0) + (k.S.isDown || k.DOWN.isDown ? 1 : 0);
    if (vx || vy) this.walkTo = null;
    else if (this.walkTo) {
      const dx = this.walkTo.x - this.player.x, dy = this.walkTo.y - this.player.y;
      const stuck = (this.player.body as Phaser.Physics.Arcade.Body).blocked;
      if (Math.hypot(dx, dy) < 3 || ((stuck.up || stuck.down) && Math.abs(dx) < 3) || ((stuck.left || stuck.right) && Math.abs(dy) < 3)) this.walkTo = null;
      else { vx = Math.abs(dx) > 2 ? Math.sign(dx) : 0; vy = Math.abs(dy) > 2 ? Math.sign(dy) : 0; }
    }
    const len = Math.hypot(vx, vy) || 1;
    this.player.setVelocity((vx / len) * 80, (vy / len) * 80);
    this.playerDir = movementDirection(vx, vy, this.playerDir);
    this.walkT += dt;
    const moving = vx || vy;
    this.player.setTexture(`founder-${this.playerDir}-${moving ? walkFrame(this.walkT, 120) : IDLE_FRAME}`);
    this.player.setDepth(this.player.y);

    // companion floats behind the founder
    const floating = this.companionForm === 'creature';
    if (this.beeTask) this.tickBee(dt);
    const errand = this.beeTask?.target ?? null;                          // somewhere a command sent the companion
    let tx = this.player.x + (this.playerDir === 'left' ? 18 : -18), ty = this.player.y + (floating ? -20 : 10);
    if (errand) { tx = errand.x; ty = errand.y; } else if (this.beeTask) { tx = this.bee.x; ty = this.bee.y; }      // busy where it stands
    const dx = tx - this.bee.x, dy = ty - this.bee.y, dist = Math.hypot(dx, dy), following = dist > 1;
    if (following) {
      this.companionDir = movementDirection(dx, dy, this.companionDir);
      if (errand || (this.beeReturn && dist > 24)) { const step = Math.min(dist, (errand ? 70 : 100) * dt / 1000); this.bee.x += dx / dist * step; this.bee.y += dy / dist * step; }
      else { this.beeReturn = false; const ease = 1 - Math.exp(-dt / 160); this.bee.x += dx * ease; this.bee.y += dy * ease; }
    }
    if (floating) this.animateBee(dt, following);
    else this.bee.setTexture(`companion-${this.companionDir}-${following ? walkFrame(this.walkT, 120) : IDLE_FRAME}`).setDepth(this.bee.y);

    // members potter about their homes, come when called, and face the founder when close
    let best: string | null = null, bestD = 26;
    for (const n of this.npcs.values()) {
      const dp = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.sprite.x, n.sprite.y);
      const busy = n.working || (n.mode === 'home' && dp < 30);
      if (n.queue?.length || n.mode === 'task') this.tickTask(n, dt);
      if (n.mode === 'summoned' && dp > 40) n.target = this.spotFor(n);       // keep up with the founder
      if (!n.target && n.mode === 'home' && !busy) { n.rest -= dt; if (n.rest <= 0) { n.target = this.wanderTarget(n); n.rest = 2500 + Math.random() * 4500; } }
      if (n.target && !(busy && n.mode === 'home')) {
        const speed = (n.mode === 'home' ? 26 : 62) * dt / 1000;
        this.moveMember(n, speed);
      }
      const mx = n.sprite.x - n.lastX, my = n.sprite.y - n.lastY;
      const walking = Math.hypot(mx, my) > 0.01;
      n.dir = walking ? movementDirection(mx, my, n.dir) : dp < 30 ? movementDirection(this.player.x - n.sprite.x, this.player.y - n.sprite.y, n.dir) : n.dir;
      const f = n.working || walking ? walkFrame(this.walkT, 140) : IDLE_FRAME;
      n.frame = f; n.sprite.setTexture(`npc-${n.id}-${n.dir}-${f}`).setDepth(n.sprite.y);
      n.lastX = n.sprite.x; n.lastY = n.sprite.y;
      // followers walk in a tight group: their names would overlap, and the nearest one is named by the prompt;
      // at the terminal they spread out, so first names fit
      n.label.setPosition(n.sprite.x, n.sprite.y + 2).setVisible(n.sprite.visible && n.mode !== 'summoned');
      const want = n.mode === 'gather' ? n.data.name.split(/\s+/)[0] : n.data.name;
      if (n.label.text !== want) n.label.setText(want);
      if (n.mark) n.mark.setX(n.sprite.x);
      if (dp < bestD) { bestD = dp; best = n.id; }
    }
    this.separate();
    const followers = [...this.npcs.values()].filter((n) => n.mode === 'summoned' || (n.mode === 'task' && n.base === 'summoned')).map((n) => n.id).join(',');
    if (followers !== this.followersKey) { this.followersKey = followers; emit('following', followers ? followers.split(',') : []); }
    if (best !== this.near) {
      this.near = best;
      emit('near', best);
    }
    if (best) {
      const n = this.npcs.get(best)!;
      this.prompt.setVisible(true).setPosition(n.sprite.x, n.sprite.y - n.sprite.displayHeight - 4).setText(`E · ${n.data.name}${n.data.job ? ` (${n.data.job})` : ''}`);
    } else this.prompt.setVisible(false);
  }
}
