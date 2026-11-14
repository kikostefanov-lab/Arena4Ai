/**
 * Arena 3D — the "Neon District" view.
 *
 * This is a second PICTURE of the same truth. It owns no competition state: the
 * host keeps driving `IsoArenaRenderer` (clock, seek, incremental ingest,
 * honesty notes) and hands this scene the resulting `World` every frame. So the
 * block channel keeps its contract — one block per file, height is the edit
 * count, and a block whose depth is `inferred` or `unavailable` is drawn
 * visibly different (dashed edges / hollow ghost) rather than as a short solid
 * block that would read as "did less work".
 *
 * The robots are authored in `tools/blender/build_gladiators.py` and loaded
 * from `/models/gladiators.glb` as a rigid joint hierarchy, posed by name.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { providerOf } from '@arena/shared';
import type { World, Structure } from '@arena/shared';

export interface Arena3DTeam { id: string; model: string; color: string }
export interface Arena3DOptions { teams: Arena3DTeam[]; reducedMotion?: boolean; modelUrl?: string }

type PoseName = 'idle' | 'thinking' | 'strike' | 'power' | 'hit' | 'triumph' | 'kneel' | 'salute';
// [spineX, spineY, headX, shLx, shLz, elL, shRx, shRz, elR, hipLx, knL, hipRx, knR, bodyY, bodyZ]
const POSES: Record<PoseName, number[]> = {
  idle:     [0.04, 0, 0, 0.15, 0.2, -0.4, 0.15, 0.2, -0.4, -0.16, 0.22, 0.14, 0.16, 0, 0],
  thinking: [0.14, 0.15, 0.3, 0.2, 0.15, -0.5, -0.95, 0.1, -2.15, -0.12, 0.2, 0.12, 0.14, 0, 0],
  strike:   [0.32, 0.5, -0.1, 0.8, 0.35, -1.1, -1.55, 0.05, -0.05, -0.8, 0.85, 0.5, 0.35, -0.45, 0.9],
  power:    [-0.18, 0, -0.32, -2.75, 0.5, -0.35, -2.75, 0.5, -0.35, -0.25, 0.3, 0.25, 0.2, 0.15, 0],
  hit:      [-0.5, -0.3, -0.35, 0.5, 0.8, -0.9, 0.3, 0.9, -0.7, 0.35, 0.5, -0.25, 0.45, -0.1, -1.3],
  triumph:  [-0.14, 0, -0.38, 0.1, 0.55, -1.3, -3.0, 0.2, -0.12, -0.2, 0.25, 0.2, 0.18, 0.1, 0],
  kneel:    [0.5, 0, 0.55, 0.35, 0.15, -0.25, -0.35, 0.1, -0.9, 0.2, 1.75, -1.5, 1.6, -2.3, 0],
  salute:   [0, 0, -0.05, 0.1, 0.15, -0.3, -0.5, 0.6, -2.3, -0.08, 0.1, 0.08, 0.1, 0, 0],
};
const JOINTS = ['hips', 'spine', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'] as const;
type JointName = typeof JOINTS[number];

interface Fighter {
  id: string; color: THREE.Color; root: THREE.Object3D; j: Record<JointName, THREE.Object3D>; disc: THREE.Object3D | null;
  glow: THREE.MeshStandardMaterial | null; base: THREE.Color; flareC: THREE.Color; flare: number;
  aura: THREE.Mesh; hipsY: number; cur: number[]; basePose: PoseName; flash: PoseName | null; flashT: number; thinkT: number;
  energy: number; light: THREE.PointLight; beams: THREE.ShaderMaterial[];
}
interface Block { group: THREE.Group; fill: THREE.MeshStandardMaterial; edge: THREE.LineBasicMaterial | THREE.LineDashedMaterial; depth: string; color: THREE.Color }

const P = 44; // city block period
const FOG = new THREE.Color('#0a0518');
const JUDGE = new THREE.Color('#b06bff');
const GOLD = new THREE.Color('#ffd23c');
const ALERT = new THREE.Color('#ff3b3b');
const GRID = new THREE.Color('#00f0ff');
const WHITE = new THREE.Color(1, 1, 1);
const MAX_PULSES = 6;

function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Arena3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
  private composer: EffectComposer;
  private time = { value: 0 };
  private fighters: Fighter[] = [];
  private blocks = new Map<string, Block>();
  private blockRoot = new THREE.Group();
  private arena = new THREE.Group();
  private floorMat!: THREE.ShaderMaterial;
  private groundMat!: THREE.ShaderMaterial;
  private mirror!: Reflector;
  private pulses = Array.from({ length: MAX_PULSES }, () => new THREE.Vector4(0, 0, -99, 0));
  private pulseColors = Array.from({ length: MAX_PULSES }, () => new THREE.Color());
  private pulseI = 0;
  private cars: Array<{ m: THREE.Mesh; axis: 'x' | 'z'; dir: number; lane: number; pos: number; speed: number }> = [];
  private jumbo!: { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; text: string };
  private spot!: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>;
  private phaseCol = new THREE.Color(0, 0, 0);
  private C = 4.5;          // scene units per world cell
  private R = 46.5;         // deck radius (fits the minimum 8x5 grid at full scale)
  private lastT = 0;
  private lastPhase = '';
  private revealAt = -1;
  private seam = 0;
  private disposed = false;
  private tmp = new THREE.Vector3();
  // particles
  private PN = 1600; private pPos!: Float32Array; private pCol!: Float32Array; private pSize!: Float32Array;
  private pVel!: Float32Array; private pLife!: Float32Array; private pMax!: Float32Array; private pGrav!: Float32Array;
  private pGeo = new THREE.BufferGeometry(); private pI = 0;
  // camera
  director = true;
  private shot = 0; private shotT = 0;
  private free = { th: 0.7, ph: 1.2, r: 120 };
  private drag: { x: number; y: number } | null = null;
  private look = new THREE.Vector3(0, 9, 0);
  private camPos = new THREE.Vector3();
  private reduced: boolean;
  private listeners: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private opts: Arena3DOptions) {
    this.reduced = !!opts.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.fog = new THREE.FogExp2(FOG, 0.0019);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.55, 0.9));
    this.composer.addPass(new OutputPass());
    this.buildEnvironment();
    this.buildSky();
    this.buildGround();
    this.buildCity();
    this.buildParticles();
    this.scene.add(this.arena);
    this.arena.add(this.blockRoot);
    this.scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x180822, 0.7));
    const sun = new THREE.DirectionalLight(0xff4f8a, 1.4); sun.position.set(0, 30, -200); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x35d6ff, 1.1); fill.position.set(0, 80, 160); this.scene.add(fill);
    this.bindPointer();
  }

  /** Load the robots and lay the deck out for this world's grid. */
  async load(world: World): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(this.opts.modelUrl ?? '/models/gladiators.glb');
    if (this.disposed) return;
    this.free.r = this.R * 2.3;
    this.buildDeck();
    for (const spec of this.opts.teams) {
      const st = world.teams.get(spec.id);
      const provider = providerOf(spec.model);
      const src = gltf.scene.getObjectByName(provider) ?? gltf.scene.getObjectByName('gemini');
      if (!src || !st) continue;
      const root = src.clone(true);
      const color = new THREE.Color(spec.color);
      const j = {} as Record<JointName, THREE.Object3D>;
      const prefix = src.name;
      for (const n of JOINTS) j[n] = root.getObjectByName(`${prefix}_${n}`) ?? new THREE.Object3D();
      let glow: THREE.MeshStandardMaterial | null = null;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.envMapIntensity = 1.15;
        if (mat.name.endsWith('_glow')) { glow = glow ?? mat; m.material = glow; glow.emissive.copy(color); }
        else {
          if (mat.name.endsWith('_paint')) mat.color.copy(color).multiplyScalar(0.62);
          m.material = mat;
        }
      });
      const aura = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.0, 48), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 0.06; root.add(aura);
      this.arena.add(root);
      const light = new THREE.PointLight(color, 100, 70, 1.8); this.scene.add(light);
      const glowMat = glow as THREE.MeshStandardMaterial | null;
      this.fighters.push({
        id: spec.id, color, root, j, disc: root.getObjectByName(`${prefix}_disc`) ?? null, glow: glowMat,
        base: glowMat ? glowMat.emissive.clone() : color.clone(), flareC: new THREE.Color(1, 1, 1), flare: 0, aura, hipsY: j.hips.position.y,
        cur: POSES.idle.slice(), basePose: 'idle', flash: null, flashT: 0, thinkT: 0, energy: 0, light, beams: [],
      });
    }
    this.layout(world);
    this.buildPylons();
    this.lastT = world.t;
  }

  /**
   * Fit the world's grid onto the deck. The deck is a fixed size; the lattice
   * (and the fighters standing on it) scale to fit, because the grid can grow
   * mid-competition and a replay is rebuilt against a larger one.
   */
  private layout(world: World): void {
    const reach = Math.hypot(world.grid.gx, world.grid.gz);
    const C = Math.min(4.5, (this.R - 4) / reach);
    if (C === this.C && this.laidOut) return;
    this.C = C; this.laidOut = true;
    this.floorMat.uniforms.uCell.value = C;
    for (const f of this.fighters) {
      const st = world.teams.get(f.id); if (!st) continue;
      const x = st.band.baseX * C;
      f.root.position.set(x, 3.84, 0);
      f.root.rotation.y = x <= 0 ? Math.PI / 2 : -Math.PI / 2;
      f.root.scale.setScalar(1.15 * (C / 4.5));
      f.light.position.set(x, 13, 7);
    }
  }
  private laidOut = false;

  // ───────────────────────────────────────────────────────────── world sync

  /** Mirror the truth model into the scene. Called once per frame by the host. */
  sync(world: World, dt: number): void {
    const now = (this.time.value += dt);
    this.layout(world);
    const C = this.C;

    // Blocks: one per structure, removed when a seek drops them.
    for (const [key, b] of this.blocks) {
      if (!world.structures.has(key)) { this.blockRoot.remove(b.group); this.blocks.delete(key); }
    }
    for (const [key, s] of world.structures) {
      let b = this.blocks.get(key);
      if (!b || b.depth !== s.depth) {
        if (b) this.blockRoot.remove(b.group);
        b = this.makeBlock(s, world);
        this.blocks.set(key, b);
      }
      const h = Math.max(0.05, s.h) * C;
      b.group.scale.set(C * 0.78, h, C * 0.78);
      b.group.position.set(s.x * C, 3.86, s.z * C);
      const hot = Math.min(1, s.flash), hit = Math.min(1, s.hit), gold = Math.min(1, s.gold);
      b.edge.color.copy(b.color).multiplyScalar(s.depth === 'unavailable' ? 0.9 : 2.2).lerp(WHITE, hot * 0.8).lerp(ALERT, hit).lerp(GOLD, gold * 0.9);
      b.fill.emissive.copy(b.color).multiplyScalar(0.1 + hot * 1.2).lerp(ALERT, hit * 0.8).lerp(GOLD, gold * 0.5);
    }

    // Per-event choreography, from the world's own recent-activity window.
    if (world.t < this.lastT) this.lastT = world.t;       // scrubbed backwards: no effects
    const fresh = world.recent.filter((r) => r.t > this.lastT && r.t <= world.t);
    if (fresh.length > 0 && fresh.length <= 10) for (const r of fresh) this.react(world, r.teamId, r.kind);
    this.lastT = world.t;

    // Phase.
    const phaseKey = `${world.phase}:${world.winnerId ?? ''}`;
    if (phaseKey !== this.lastPhase) { this.onPhase(world); this.lastPhase = phaseKey; }
    this.phaseCol.lerp(world.phase === 'judging' ? JUDGE : new THREE.Color(0, 0, 0), Math.min(1, dt * 3));
    this.floorMat.uniforms.uPhase.value.copy(this.phaseCol);
    this.groundMat.uniforms.uPhase.value.copy(this.phaseCol);

    // Momentum (10s window) → the seam between two territories.
    let target = 0;
    if (this.fighters.length === 2) {
      let a = 0, b = 0;
      for (const r of world.recent) { if (world.t - r.t >= 10_000) continue; if (r.teamId === this.fighters[0].id) a++; else if (r.teamId === this.fighters[1].id) b++; }
      target = (a - b) / (a + b + 3);
      if (world.phase === 'reveal' && world.winnerId) target = world.winnerId === this.fighters[0].id ? 0.8 : -0.8;
      if (world.phase === 'judging' || world.phase === 'freeze') target = 0;
    }
    this.seam += (target - this.seam) * Math.min(1, dt * 2.5);
    this.floorMat.uniforms.uSeam.value = this.seam * Math.abs(this.fighters[0]?.root.position.x ?? 0) * 0.5;

    for (const f of this.fighters) this.stepFighter(f, dt, now);

    if (world.phase === 'reveal' && world.winnerId && this.revealAt >= 0) {
      const w = this.fighters.find((f) => f.id === world.winnerId);
      this.spot.material.uniforms.uI.value += (1 - this.spot.material.uniforms.uI.value) * Math.min(1, dt * 2);
      if (w && now - this.revealAt < 10 && Math.random() < dt * 5) {
        this.tmp.set((Math.random() - 0.5) * 170, 50 + Math.random() * 50, (Math.random() - 0.5) * 170 - 20);
        this.spark(this.tmp, Math.random() < 0.7 ? w.color : WHITE, 100, 26, 1.8, 9, 0, 1.5);
      }
    }

    for (const c of this.cars) {
      c.pos += c.speed * c.dir * dt; if (c.pos > 520) c.pos = -520; if (c.pos < -520) c.pos = 520;
      if (c.axis === 'x') c.m.position.set(c.pos, 0.6, c.lane); else c.m.position.set(c.lane, 0.6, c.pos);
    }
    this.stepParticles(dt);
    this.jumbo.tex.offset.x = now * 0.03;
    this.mirror.visible = this.blocks.size <= 220;
    this.stepCamera(world, dt);
  }

  render(): void { this.composer.render(); }

  resize(w: number, h: number, dpr: number): void {
    this.renderer.setPixelRatio(Math.min(dpr, 1.75));
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  nextShot(): void { this.director = true; this.cut((this.shot + 1) % this.shotCount()); }

  dispose(): void {
    this.disposed = true;
    for (const off of this.listeners) off();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose?.();
    });
    this.scene.environment?.dispose();
    this.jumbo?.tex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ───────────────────────────────────────────────────────────── reactions

  private react(world: World, teamId: string, kind: string): void {
    const f = this.fighters.find((x) => x.id === teamId);
    if (!f) return;
    f.energy = Math.min(1, f.energy + 0.22);
    const x = f.root.position.x;
    if (kind === 'tool') {
      f.flash = 'power'; f.flashT = 0.75; f.flare = 0.6; f.flareC.set(1, 1, 1);
      this.pulse(x, 0, f.color);
      this.spark(this.headOf(f), f.color, 24, 9, 0.8, 0, 6, 0.45);
    } else if (kind === 'file') {
      f.flash = 'strike'; f.flashT = 0.7; f.flare = 0.9; f.flareC.set(1, 1, 1);
      const hand = this.handOf(f);
      this.spark(hand, f.color, 22, 12, 0.6, 12, 2, 0.5);
      // Trace a spark line from the hand to the block that was just written.
      let best: Structure | null = null;
      for (const s of world.structures.values()) if (s.teamId === teamId && (!best || s.flash > best.flash)) best = s;
      if (best) {
        const to = new THREE.Vector3(best.x * this.C, 3.86 + best.h * this.C, best.z * this.C);
        for (let i = 1; i <= 14; i++) { this.tmp.lerpVectors(hand, to, i / 14); this.tmp.y += Math.sin((i / 14) * Math.PI) * 5; this.spark(this.tmp, f.color, 2, 1.2, 0.5 + i * 0.03, 0, 0, 0.4); }
        this.pulse(to.x, to.z, f.color);
      }
    } else if (kind === 'error') {
      f.flash = 'hit'; f.flashT = 0.9; f.flare = 1.4; f.flareC.copy(ALERT);
      this.pulse(x, 0, ALERT);
      this.spark(this.headOf(f).add(new THREE.Vector3(0, -3, 0)), ALERT, 46, 16, 0.9, 18, 3, 0.55);
    } else if (kind === 'reasoning') {
      f.basePose = 'thinking'; f.thinkT = 1.6;
      this.spark(this.headOf(f), f.color, 6, 2.2, 1.4, -3, 2.5, 0.32);
    }
  }

  private onPhase(world: World): void {
    const names = this.opts.teams.map((t) => t.model.toUpperCase()).join('  vs  ');
    this.spot.visible = false; this.spot.material.uniforms.uI.value = 0; this.revealAt = -1;
    for (const f of this.fighters) { f.basePose = 'idle'; f.flash = null; }
    if (world.phase === 'active') { this.setJumbo(`LIVE  ·  ${names}`, '#00f0ff'); this.cut(0); }
    else if (world.phase === 'freeze') { this.setJumbo('TIME UP  ·  COLLECTING DELIVERABLES', '#ffd23c'); this.cut(3); }
    else if (world.phase === 'judging') { for (const f of this.fighters) f.basePose = 'salute'; this.setJumbo('CROSS-JUDGE READING THE FILES', '#b06bff'); this.cut(0); }
    else {
      const w = this.fighters.find((f) => f.id === world.winnerId);
      if (!w) { this.setJumbo(`SCORED  ·  ${names}`, '#00f0ff'); return; }
      for (const f of this.fighters) { f.basePose = f === w ? 'triumph' : 'kneel'; f.energy = f === w ? 1 : 0; }
      this.spot.visible = true; this.spot.position.x = w.root.position.x; this.spot.material.uniforms.uC.value = w.color;
      this.revealAt = this.time.value;
      const name = this.opts.teams.find((t) => t.id === w.id)?.model.toUpperCase() ?? '';
      this.setJumbo(`VERDICT  ·  ${name} WINS`, `#${w.color.getHexString()}`);
      this.cut(1 + this.fighters.indexOf(w) % 2);
    }
  }

  private stepFighter(f: Fighter, dt: number, now: number): void {
    f.energy = Math.max(0, f.energy - dt * 0.28);
    if (f.thinkT > 0 && (f.thinkT -= dt) <= 0 && f.basePose === 'thinking') f.basePose = 'idle';
    const target = POSES[f.flash ?? f.basePose], c = f.cur, k = 1 - Math.exp(-dt * (f.flash ? 16 : 6));
    for (let i = 0; i < c.length; i++) c[i] += (target[i] - c[i]) * k;
    const j = f.j, br = this.reduced ? 0 : Math.sin(now * 1.7 + f.root.position.x) * 0.03;
    j.spine.rotation.set(c[0] + br, c[1], 0); j.head.rotation.x = c[2];
    j.shL.rotation.set(c[3], 0, c[4]); j.elL.rotation.x = c[5];
    j.shR.rotation.set(c[6], 0, -c[7]); j.elR.rotation.x = c[8];
    j.hipL.rotation.x = c[9]; j.knL.rotation.x = c[10]; j.hipR.rotation.x = c[11]; j.knR.rotation.x = c[12];
    j.hips.position.set(0, f.hipsY + c[13] + br * 2, c[14]);
    if (f.disc) f.disc.rotation.z += dt * (2 + f.energy * 10);
    if (f.flash && (f.flashT -= dt) <= 0) f.flash = null;
    f.flare = Math.max(0, f.flare - dt * 2.4);
    if (f.glow) f.glow.emissive.copy(f.base).lerp(f.flareC, Math.min(1, f.flare));
    const s = 1 + f.energy * 0.55 + Math.sin(now * 4) * 0.03; f.aura.scale.set(s, s, 1);
    (f.aura.material as THREE.MeshBasicMaterial).opacity = 0.35 + f.energy * 0.6;
    f.light.intensity = 90 + f.energy * 260;
    for (const bm of f.beams) bm.uniforms.uI.value += ((0.12 + f.energy * 0.75) - bm.uniforms.uI.value) * Math.min(1, dt * 4);
  }

  private handOf(f: Fighter): THREE.Vector3 { return f.j.elR.localToWorld(new THREE.Vector3(0, -1.9, 0)); }
  private headOf(f: Fighter): THREE.Vector3 { return f.j.head.localToWorld(new THREE.Vector3(0, 1.6, 0)); }

  private makeBlock(s: Structure, world: World): Block {
    const color = new THREE.Color(world.teams.get(s.teamId)?.color ?? '#00f0ff');
    const geo = Arena3D.blockGeo, group = new THREE.Group();
    const ghost = s.depth === 'unavailable';
    // `unavailable` is a hollow ghost and `inferred` has dashed edges, so the
    // confidence of a block's height survives a screenshot.
    const fill = new THREE.MeshStandardMaterial({ color: 0x0a0e16, metalness: 0.7, roughness: 0.35, emissive: color.clone().multiplyScalar(0.1), transparent: ghost, opacity: ghost ? 0.12 : 1, depthWrite: !ghost });
    group.add(new THREE.Mesh(geo, fill));
    let edge: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    const lines = new THREE.LineSegments(Arena3D.blockEdges);
    if (s.depth === 'inferred') { edge = new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.09, toneMapped: false }); lines.computeLineDistances(); }
    else edge = new THREE.LineBasicMaterial({ color, toneMapped: false });
    lines.material = edge; group.add(lines);
    this.blockRoot.add(group);
    return { group, fill, edge, depth: s.depth, color };
  }
  private static blockGeo = (() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; })();
  private static blockEdges = new THREE.EdgesGeometry(Arena3D.blockGeo);

  // ───────────────────────────────────────────────────────────── camera

  private shotCount(): number { return 6; }
  private cut(i: number): void { this.shot = i; this.shotT = 0; }

  private stepCamera(world: World, dt: number): void {
    const R = this.R, fx = Math.abs(this.fighters[0]?.root.position.x ?? 20), hy = 10 * (this.C / 4.5);
    if (this.director) {
      const i = this.reduced ? 0 : this.shot, t = (this.shotT += dt), p = this.camPos, l = this.look;
      let fov = 40, dur = 9;
      if (i === 0) { const a = 0.9 + t * 0.07; p.set(Math.sin(a) * R * 1.9, R * 0.5 + Math.sin(t * 0.2) * 3, Math.cos(a) * R * 1.9); l.set(0, hy, 0); }
      else if (i === 1 || i === 2) { const s = i === 1 ? -1 : 1; fov = 34; dur = 6; p.set(s * (fx + 26 - t * 0.8), 6, 30 - t * 0.6); l.set(s * (fx - 3), hy * 1.1, 0); }
      else if (i === 3) { const a = t * 0.12; fov = 50; dur = 6; p.set(Math.sin(a) * 30, R * 3 - t * 4, Math.cos(a) * 30 + 40); l.set(0, 0, 0); }
      else if (i === 4) { fov = 20; dur = 7; p.set(Math.sin(t * 0.3) * 2, 9, 250 - t * 6); l.set(0, hy * 1.6, 0); }
      else { fov = 36; dur = 6; p.set(-4 + t * 1.2, 12 + t * 0.4, R + 14); l.set(0, hy, -6); }
      if (!this.reduced && t > dur && world.phase === 'active') this.cut((i + 1 + ((Math.random() * 2) | 0)) % this.shotCount());
      if (!this.reduced && world.phase === 'reveal' && i !== 0 && t > 6) this.cut(0);
      this.camera.position.copy(p);
      if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    } else {
      const f = this.free; this.look.set(0, hy * 0.8, 0);
      this.camera.position.set(Math.sin(f.th) * Math.sin(f.ph) * f.r, hy + Math.cos(f.ph) * f.r, Math.cos(f.th) * Math.sin(f.ph) * f.r);
      if (this.camera.fov !== 42) { this.camera.fov = 42; this.camera.updateProjectionMatrix(); }
    }
    this.camera.position.y = Math.max(4.6, this.camera.position.y);
    this.camera.lookAt(this.look);
  }

  private bindPointer(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      c.addEventListener(type, fn as EventListener, o); this.listeners.push(() => c.removeEventListener(type, fn as EventListener, o));
    };
    on('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); this.director = false; this.onFreeCam?.(); });
    on('pointermove', (e) => { if (!this.drag) return; this.free.th -= (e.clientX - this.drag.x) * 0.006; this.free.ph = Math.min(1.52, Math.max(0.25, this.free.ph - (e.clientY - this.drag.y) * 0.004)); this.drag = { x: e.clientX, y: e.clientY }; });
    on('pointerup', () => { this.drag = null; });
    on('pointercancel', () => { this.drag = null; });
    on('wheel', (e) => { e.preventDefault(); this.free.r = Math.min(460, Math.max(26, this.free.r * (1 + e.deltaY * 0.001))); this.director = false; this.onFreeCam?.(); }, { passive: false });
  }
  /** Fired when the viewer grabs the camera, so the host can reflect it. */
  onFreeCam?: () => void;

  // ───────────────────────────────────────────────────────────── builders

  private buildEnvironment(): void {
    // Image-based lighting from a tiny neon "studio", so armor reflects its surroundings.
    const es = new THREE.Scene(); es.background = new THREE.Color(0x04050c);
    const panel = (c: string, k: number, w: number, h: number, x: number, y: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m);
    };
    panel('#ff6a00', 5, 6, 12, -12, 2, 2); panel('#1f7bff', 6, 6, 12, 12, 2, 2);
    panel('#ff2d7a', 5, 16, 5, 0, 1, -12); panel('#00f0ff', 3, 14, 2, 0, 9, 6);
    panel('#ffffff', 2.5, 10, 1.2, 0, 12, 0); panel('#b06bff', 2, 4, 8, -6, 3, 12); panel('#ffd23c', 2, 4, 8, 7, 0, 11);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(es, 0.03).texture; pm.dispose();
  }

  private buildSky(): void {
    const sun = new THREE.Vector3(0, 0.085, -1).normalize();
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uSun: { value: sun }, uTime: this.time },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vD; uniform vec3 uSun; uniform float uTime;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){ vec3 d = normalize(vD); float h = d.y;
          vec3 top = vec3(0.004,0.006,0.03), mid = vec3(0.10,0.015,0.20), hor = vec3(0.85,0.16,0.34);
          vec3 c = mix(mid, top, smoothstep(0.02,0.55,h));
          c = mix(hor, c, smoothstep(-0.03,0.20,h));
          c += vec3(0.9,0.35,0.1) * exp(-abs(h)*26.) * 0.35 * max(0., dot(d, uSun));
          float sd = distance(d, uSun);
          float disc = smoothstep(0.235,0.228,sd);
          float band = step(0.42, fract((d.y - uSun.y)*26. - uTime*0.04));
          float cut = mix(1., band, smoothstep(0.03,-0.10, d.y - uSun.y));
          vec3 sunc = mix(vec3(0.95,0.08,0.36), vec3(1.05,0.62,0.14), smoothstep(-0.12,0.2, d.y - uSun.y));
          c = mix(c, sunc, disc*cut);
          c += sunc*0.12*exp(-sd*5.);
          vec3 g = floor(d*260.); float s = step(0.9975, hash(g)) * smoothstep(0.12,0.5,h);
          c += vec3(0.8,0.9,1.)*s*(0.6+0.4*sin(uTime*2.+hash(g+1.)*40.));
          if (h < 0.) c = mix(c, vec3(0.03,0.012,0.06), smoothstep(0.,-0.05,h));
          gl_FragColor = vec4(c,1.); }`,
    })));
  }

  private buildGround(): void {
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uFog: { value: FOG }, uPhase: { value: new THREE.Color(0, 0, 0) } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec3 vW; uniform float uTime; uniform vec3 uFog,uPhase;
        float line(float v, float w){ float f = abs(fract(v-0.5)-0.5)/fwidth(v); return 1.-min(f/w,1.); }
        void main(){ vec2 p = vW.xz; float r = length(p);
          vec3 c = vec3(0.012,0.014,0.03);
          float g = max(line(p.x/4.,1.2), line(p.y/4.,1.2));
          float G = max(line(p.x/${P}.,1.6), line(p.y/${P}.,1.6));
          vec3 gc = vec3(0.,0.94,1.);
          float pulse = exp(-abs(r - mod(uTime*46., 620.))*0.05);
          c += gc*g*(0.05 + 0.5*pulse)*exp(-r*0.004);
          c += gc*G*(0.5 + 1.4*pulse)*exp(-r*0.0022);
          vec2 rd = abs(mod(p + ${P / 2}., ${P}.) - ${P / 2}.);
          float dash = step(0.5, fract((rd.x < rd.y ? p.y : p.x)/7.));
          float lane = (1.-smoothstep(0.,0.35, abs(min(rd.x,rd.y)-3.2))) * dash * step(120., r);
          c += vec3(1.0,0.72,0.2)*lane*0.55;
          c += uPhase*0.12*exp(-r*0.01);
          float d = length(cameraPosition - vW); c = mix(uFog, c, exp(-d*d*0.0000036));
          gl_FragColor = vec4(c,1.); }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.groundMat);
    ground.rotation.x = -Math.PI / 2; this.scene.add(ground);
  }

  private buildCity(): void {
    const rnd = mulberry(4);
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const tints = ['#00f0ff', '#ff2d7a', '#ff6a00', '#1f7bff', '#ffd23c', '#b06bff'].map((c) => new THREE.Color(c));
    const builds: Array<{ x: number; z: number; w: number; d: number; h: number; seed: number; tint: THREE.Color }> = [];
    for (let i = -11; i <= 11; i++) for (let j = -11; j <= 11; j++) {
      const cx = i * P + P / 2, cz = j * P + P / 2, r = Math.hypot(cx, cz);
      if (r < 150) continue;
      const n = rnd() < 0.45 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.08) continue;
        const w = n === 2 ? 12 + rnd() * 5 : 18 + rnd() * 12, d = n === 2 ? 26 + rnd() * 4 : 18 + rnd() * 12;
        let h = 14 + rnd() * 46 + Math.min(r, 300) * 0.16 * rnd();
        if (rnd() < 0.07) h += 90 + rnd() * 110;
        if (cz < -120 && Math.abs(cx) < 70) h *= 0.45; // keep the sun lane open
        builds.push({ x: cx + (n === 2 ? (k ? 8.5 : -8.5) : 0), z: cz, w, d, h, seed: rnd() * 100, tint: tints[(rnd() * tints.length) | 0] });
      }
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uFog: { value: FOG } },
      vertexShader: `attribute float aSeed; attribute vec3 aTint; varying vec3 vL, vS, vN, vW, vTint; varying float vSeed;
        void main(){ vL = position; vN = normal; vSeed = aSeed; vTint = aTint;
          vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec4 w = modelMatrix*instanceMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec3 vL, vS, vN, vW, vTint; varying float vSeed; uniform float uTime; uniform vec3 uFog;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){ vec3 c = vec3(0.012,0.014,0.028); float H = vS.y;
          if (abs(vN.y) > 0.5) {
            vec2 e = (0.5-abs(vL.xz))*vS.xz; float rim = 1.-smoothstep(0.,0.8,min(e.x,e.y));
            c += vTint*rim*1.5;
          } else {
            bool fx = abs(vN.x) > 0.5; float u = (fx ? vL.z*vS.z : vL.x*vS.x); float wdt = fx ? vS.z : vS.x; float v = vL.y*H;
            vec2 cell = floor(vec2(u/2.6, v/3.6)); vec2 f = fract(vec2(u/2.6, v/3.6));
            float lit = step(0.66, hash(cell + vSeed));
            float tw = step(0.985, hash(cell*1.7 + vSeed + floor(uTime*0.6)));
            float win = step(0.18,f.x)*step(f.x,0.82)*step(0.22,f.y)*step(f.y,0.74);
            vec3 wc = mix(vec3(1.0,0.72,0.38), vTint, step(0.55, hash(cell.yy + vSeed*3.)));
            c += wc*win*max(lit - tw, 0.)*(0.35 + 0.5*hash(cell+9.));
            float top = smoothstep(H-1.1, H-0.5, v);
            float edge = 1.-smoothstep(0.,0.45, wdt*0.5 - abs(u));
            float band = step(0.62, fract(vSeed*7.3))*(1.-smoothstep(0.,0.35, abs(mod(v, 18.)-9.)));
            c += vTint*(top*2.2 + edge*1.3 + band*1.1);
            c *= 0.35 + 0.65*smoothstep(0., 16., v);
          }
          float d = length(cameraPosition - vW); c = mix(uFog, c, exp(-d*d*0.0000030));
          gl_FragColor = vec4(c,1.); }`,
    });
    const city = new THREE.InstancedMesh(geo, mat, builds.length);
    const m = new THREE.Matrix4(), seeds = new Float32Array(builds.length), tn = new Float32Array(builds.length * 3);
    builds.forEach((b, i) => { m.makeScale(b.w, b.h, b.d); m.setPosition(b.x, 0, b.z); city.setMatrixAt(i, m); seeds[i] = b.seed; b.tint.toArray(tn, i * 3); });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tn, 3));
    city.frustumCulled = false; this.scene.add(city);

    // Traffic: light trails on the street grid.
    const trailGeo = new THREE.BoxGeometry(0.7, 0.5, 26); trailGeo.translate(0, 0, -13);
    const mats = ['#00f0ff', '#ff2d7a', '#ffd23c', '#ffffff'].map((c) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uC: { value: new THREE.Color(c) } },
      vertexShader: `varying float vZ; void main(){ vZ = -position.z/26.; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying float vZ; uniform vec3 uC; void main(){ float a = pow(1.-vZ, 2.2); gl_FragColor = vec4(uC*2.4*a + vec3(1.)*step(vZ,0.03), a); }`,
    }));
    for (let i = 0; i < 54; i++) {
      let k = Math.floor(rnd() * 20) - 10; if (Math.abs(k) < 3) k = k < 0 ? k - 3 : k + 3;
      const axis: 'x' | 'z' = rnd() < 0.5 ? 'x' : 'z', dir = rnd() < 0.5 ? 1 : -1;
      const mesh = new THREE.Mesh(trailGeo, mats[i % 4]);
      mesh.position.y = 0.6; mesh.rotation.y = axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.scene.add(mesh); this.cars.push({ m: mesh, axis, dir, lane: k * P + dir * 3.2, pos: (rnd() - 0.5) * 900, speed: 40 + rnd() * 80 });
    }
  }

  private glowMat(c: THREE.Color, k = 2.2): THREE.MeshBasicMaterial { return new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), toneMapped: false }); }

  private buildDeck(): void {
    const R = this.R, C = this.C;
    const metal = new THREE.MeshStandardMaterial({ color: 0x0a0d16, metalness: 0.92, roughness: 0.32 });
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(R + 22, R + 24, 0.8, 96), metal); plaza.position.y = 0.4; this.arena.add(plaza);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 4, 3, 96), metal); deck.position.y = 2.3; this.arena.add(deck);
    for (const r of [R + 10, R + 21]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.14, 6, 128), this.glowMat(GRID, 1.3)); t.rotation.x = Math.PI / 2; t.position.y = 0.86; this.arena.add(t); }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.3, 8, 128), this.glowMat(GRID, 1.8)); rim.rotation.x = Math.PI / 2; rim.position.y = 3.85; this.arena.add(rim);

    this.mirror = new Reflector(new THREE.CircleGeometry(R, 64), { textureWidth: 1024, textureHeight: 1024, color: 0x99aabb, clipBias: 0.003 });
    this.mirror.rotation.x = -Math.PI / 2; this.mirror.position.y = 3.81; this.arena.add(this.mirror);

    const two = this.opts.teams.length === 2;
    const a = new THREE.Color(this.opts.teams[0]?.color ?? '#00f0ff'), b = new THREE.Color(this.opts.teams[1]?.color ?? '#00f0ff');
    this.floorMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: this.time, uSeam: { value: 0 }, uA: { value: two ? a : GRID }, uB: { value: two ? b : GRID }, uPhase: { value: new THREE.Color(0, 0, 0) },
        uPulse: { value: this.pulses }, uPulseC: { value: this.pulseColors }, uCell: { value: C }, uR: { value: R }, uTwo: { value: two ? 1 : 0 },
      },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vP; uniform float uTime,uSeam,uCell,uR,uTwo; uniform vec3 uA,uB,uPhase; uniform vec4 uPulse[${MAX_PULSES}]; uniform vec3 uPulseC[${MAX_PULSES}];
        float line(float v, float w){ float f = abs(fract(v-0.5)-0.5)/fwidth(v); return 1.-min(f/w,1.); }
        void main(){ vec2 p = vec2(vP.x, -vP.y); float r = length(p);
          float side = smoothstep(-0.4,0.4,p.x - uSeam); vec3 team = mix(uA,uB,side);
          // Cell lines sit on the same lattice the blocks occupy.
          float g = max(line(p.x/uCell + 0.5,1.3), line(p.y/uCell + 0.5,1.3));
          float rings = 1.-smoothstep(0.,0.5,abs(r-(uR-0.8)));
          float seam = exp(-abs(p.x - uSeam)*2.2)*uTwo;
          vec3 c = team*(g*0.5 + rings*1.3) + team*0.05*(1.-r/uR);
          c += vec3(2.2)*seam*(0.7+0.3*sin(uTime*9. + p.y*0.9));
          c += team*exp(-abs(p.x - uSeam)*0.28)*0.22*uTwo;
          for (int i=0;i<${MAX_PULSES};i++){ vec4 q = uPulse[i]; float age = uTime - q.z; if (age < 0. || age > 1.6) continue;
            float d = distance(p, q.xy); float ring = exp(-abs(d - age*24.)*0.9)*(1.-age/1.6); c += uPulseC[i]*ring*2.6; }
          c += uPhase*(0.25 + 0.5*line(r/4. - uTime*0.5, 2.));
          float al = clamp(0.52 + g*0.3 + rings*0.4 + seam, 0., 1.);
          gl_FragColor = vec4(c, al); }`,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64), this.floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = 3.84; this.arena.add(floor);

    // Jumbotron ring.
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 128;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 8;
    this.jumbo = { tex, ctx: cv.getContext('2d') as CanvasRenderingContext2D, text: '' };
    const jr = Math.max(15, R * 0.42), jy = 24 + R * 0.3;
    const jm = new THREE.Mesh(new THREE.CylinderGeometry(jr, jr, jr * 0.28, 64, 1, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    jm.position.y = jy; this.arena.add(jm);
    for (const dy of [-jr * 0.16, jr * 0.16]) { const t = new THREE.Mesh(new THREE.TorusGeometry(jr + 0.2, 0.12, 6, 96), this.glowMat(GRID, 2)); t.rotation.x = Math.PI / 2; t.position.y = jy + dy; this.arena.add(t); }

    // Verdict spotlight.
    this.spot = new THREE.Mesh(new THREE.ConeGeometry(9, 70, 32, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uC: { value: new THREE.Color(1, 1, 1) }, uI: { value: 0 } },
      vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying float vY; uniform vec3 uC; uniform float uI; void main(){ float a = (0.15 + 0.85*vY)*uI*0.5; gl_FragColor = vec4(uC*1.6*a, a); }`,
    }));
    this.spot.position.y = 38.8; this.spot.visible = false; this.arena.add(this.spot);
  }

  private buildPylons(): void {
    const R = this.R + 9;
    const metal = new THREE.MeshStandardMaterial({ color: 0x0a0d16, metalness: 0.92, roughness: 0.32 });
    for (let i = 0; i < 10; i++) {
      const ang = (i + 0.5) / 10 * Math.PI * 2, x = Math.cos(ang) * R, z = Math.sin(ang) * R;
      // Each pylon belongs to the nearest fighter and brightens with that team's energy.
      let owner: Fighter | null = null;
      for (const f of this.fighters) if (!owner || Math.abs(f.root.position.x - x) < Math.abs(owner.root.position.x - x)) owner = f;
      const col = owner?.color ?? GRID;
      const py = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), metal); py.position.set(x, 5.3, z); py.rotation.y = -ang; this.arena.add(py);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8.4, 0.5), this.glowMat(col, 1.6)); strip.position.set(x * 0.985, 5.3, z * 0.985); strip.rotation.y = -ang; this.arena.add(strip);
      const bm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uC: { value: col }, uI: { value: 0.2 } },
        vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `varying float vY; uniform vec3 uC; uniform float uI; void main(){ float a = pow(1.-vY,1.6)*uI; gl_FragColor = vec4(uC*2.*a, a); }`,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 320, 10, 1, true), bm); beam.position.set(x, 169.8, z); this.arena.add(beam);
      owner?.beams.push(bm);
    }
  }

  private setJumbo(msg: string, color: string): void {
    if (this.jumbo.text === msg) return;
    this.jumbo.text = msg;
    const g = this.jumbo.ctx, w = 2048, h = 128;
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(2,6,16,0.82)'; g.fillRect(0, 0, w, h);
    g.fillStyle = color; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    g.font = 'italic 700 74px ui-sans-serif, system-ui, sans-serif'; g.textBaseline = 'middle';
    const unit = `${msg}   ◆   `, tw = g.measureText(unit).width, n = Math.max(1, Math.round(w / tw));
    g.save(); g.scale(w / (tw * n), 1); for (let i = 0; i < n; i++) g.fillText(unit, i * tw, h / 2 + 4); g.restore();
    this.jumbo.tex.needsUpdate = true;
  }

  private pulse(x: number, z: number, c: THREE.Color): void {
    const i = (this.pulseI = (this.pulseI + 1) % MAX_PULSES);
    this.pulses[i].set(x, z, this.time.value, 0); this.pulseColors[i].copy(c);
  }

  private buildParticles(): void {
    const N = this.PN;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pSize = new Float32Array(N);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N); this.pGrav = new Float32Array(N);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const pts = new THREE.Points(this.pGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*(420./-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vC*a*2., a); }`,
    }));
    pts.frustumCulled = false; this.scene.add(pts);
  }

  private spark(pos: THREE.Vector3, col: THREE.Color, n: number, speed: number, life: number, grav = 0, up = 0, size = 0.5): void {
    for (let k = 0; k < n; k++) {
      const i = (this.pI = (this.pI + 1) % this.PN), th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1), sp = speed * (0.35 + Math.random() * 0.65);
      this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
      this.pVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp; this.pVel[i * 3 + 1] = Math.cos(ph) * sp + up; this.pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.pCol[i * 3] = col.r; this.pCol[i * 3 + 1] = col.g; this.pCol[i * 3 + 2] = col.b;
      this.pLife[i] = this.pMax[i] = life * (0.6 + Math.random() * 0.4); this.pGrav[i] = grav; this.pSize[i] = size * (0.6 + Math.random() * 0.8);
    }
  }

  private stepParticles(dt: number): void {
    const { pPos, pVel, pLife, pMax, pGrav, pSize } = this;
    for (let i = 0; i < this.PN; i++) {
      if (pLife[i] <= 0) { pSize[i] = 0; continue; }
      pLife[i] -= dt; pVel[i * 3 + 1] -= pGrav[i] * dt; const dr = 1 - dt * 0.9;
      pVel[i * 3] *= dr; pVel[i * 3 + 2] *= dr;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pLife[i] < pMax[i] * 0.3) pSize[i] *= 0.94;
    }
    this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.size.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true;
  }
}
