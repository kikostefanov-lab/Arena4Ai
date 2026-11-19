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
 * It lives in @arena/video, not the web app, so the live arena and the sizzle
 * reel draw with the same code: the app calls `sync()` every animation frame,
 * the reel calls `drawFrame()`, which is a pure function of its arguments
 * because Remotion renders frames out of order and in parallel.
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
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { providerOf, capabilityFor, momentumShares, squadSlotCells, SQUAD_SLOTS } from '@arena/shared';
import type { World, Structure, SquadMember, RecentActivity, TeamState } from '@arena/shared';

export interface Arena3DTeam { id: string; model: string; color: string }
export interface Arena3DOptions {
  teams: Arena3DTeam[];
  reducedMotion?: boolean;
  modelUrl?: string;
  /** Keep the WebGL buffer readable after a frame — needed when frames are screenshotted. */
  preserveDrawingBuffer?: boolean;
}

/** Everything `drawFrame()` needs that the world does not already say. */
export interface Arena3DFrame {
  /** Scene time in seconds; drives every ambient animation. */
  t: number;
  cam: { pos: [number, number, number]; look: [number, number, number]; fov: number };
  /**
   * World-milliseconds a reaction lasts. A reel compresses minutes into seconds,
   * so "how long ago" has to be measured in the world's time, not the video's.
   */
  windowMs: number;
  /** 0..1 strength of the verdict spotlight on the winner. */
  reveal?: number;
  banner?: { text: string; color: string };
  /** Per-team staging: hold a pose, or lift the figure off the deck for an entrance. */
  overrides?: Record<string, {
    /** A held pose, or a blend between two so a staged move is still a pure function of the frame. */
    pose?: PoseName | { from: PoseName; to: PoseName; mix: number };
    lift?: number;
    /** Facing, in radians about the vertical axis (0 faces the +z camera side). */
    yaw?: number;
  }>;
}

export type PoseName = 'idle' | 'thinking' | 'strike' | 'power' | 'hit' | 'triumph' | 'kneel' | 'salute';
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

interface Posable { j: Record<JointName, THREE.Object3D>; cur: number[]; hipsY: number }
interface Fighter extends Posable {
  id: string; color: THREE.Color; root: THREE.Object3D; disc: THREE.Object3D | null;
  glow: THREE.MeshStandardMaterial | null; base: THREE.Color; flareC: THREE.Color; flare: number;
  aura: THREE.Mesh; basePose: PoseName; flash: PoseName | null; flashT: number; thinkT: number;
  energy: number; light: THREE.PointLight; beams: THREE.ShaderMaterial[];
  /** Model-space height of this robot, for placing things above its head. */
  height: number;
  /** The squad pool: `SQUAD_SLOTS` low-detail robots built in `load()`. */
  squad: SquadBot[];
  /** "+N" above the lead: open members with no slot, counted but not drawn. */
  badge: Tag;
}

/**
 * One sub-agent robot. Each team has a fixed pool, built in `load()` and bound
 * to members by `placeSquad()` every frame; nothing is cloned at runtime.
 */
interface SquadBot extends Posable {
  root: THREE.Object3D;
  label: THREE.Sprite; labelText: string; labelCtx: CanvasRenderingContext2D; labelTex: THREE.CanvasTexture;
  /** A reaction set by `reactActor()` (live only; drawFrame derives its own). */
  flash: PoseName | null; flashT: number;
  /** The member this bot drew last frame. A different member drops the flash. */
  memberId: string | null;
  body: THREE.MeshStandardMaterial; glow: THREE.MeshStandardMaterial;
  aura: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}
interface Tag { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; text: string }
/** One decimated mesh of a robot, in the space of the joint that carries it. */
interface LodPiece { joint: string; cls: string; geo: THREE.BufferGeometry; color: THREE.Color }
interface Block { group: THREE.Group; cap: THREE.MeshBasicMaterial | null; fill: THREE.MeshStandardMaterial; edge: THREE.LineBasicMaterial | THREE.LineDashedMaterial; depth: string; color: THREE.Color }

const P = 44; // city block period
const FOG = new THREE.Color('#0a0518');
const JUDGE = new THREE.Color('#b06bff');
const GOLD = new THREE.Color('#ffd23c');
const ALERT = new THREE.Color('#ff3b3b');
const GRID = new THREE.Color('#00f0ff');
const WHITE = new THREE.Color(1, 1, 1);
const MAX_PULSES = 6;
const UP = new THREE.Vector3(0, 1, 0);

// Squad robots.
/** A squad robot's size relative to its lead. */
const SQUAD_SCALE = 0.55;
/** World-ms a new member takes to travel from the lead to its slot, scaling in. */
const SPAWN_MS = 600;
/** World-ms an ended member stays on its cell, saluting or hit, while it fades. */
const EXIT_MS = 900;
/** Seconds a live reaction (power / strike / hit) lasts on a squad robot. */
const SQUAD_FLASH_S = 0.7;
/** World-ms a new member's label stays up, and how long one stays up after its member acts. */
const LABEL_SPAWN_MS = 2500;
const LABEL_ACTIVE_MS = 3000;
/** Label height as a fraction of the view (labels keep their size at any distance). */
const LABEL_H = 0.03;
/** Model-space height of a robot's chest, where beams attach. */
const CHEST = 6.2;
/** Vertices the decimated squad robot keeps, and the mesh size below which decimating is not worth the tearing. */
const LOD_KEEP = 0.25;
const LOD_MIN_VERTS = 400;
/** Seconds the "DEPLOYS SQUAD" banner holds before the live banner returns. */
const SQUAD_JUMBO_S = 6;
/**
 * Events older than this (world-ms) do not react. A forward seek hands `sync`
 * everything between the old and the new playhead; replaying it would fire a
 * burst of effects for things that happened long ago.
 */
const REACT_STALE_MS = 2000;
/** How far the momentum seam swings for a team holding every file event in the window. */
const SEAM_SWING = 0.6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);
/** A reaction's strength `a` (0..1) of the way through it: a quick rise, a long fall. */
const envelope = (a: number): number => { const e = a < 0.25 ? a / 0.25 : 1 - (a - 0.25) / 0.75; const c = clamp01(e); return smooth(c); };
/** Blend `cur` toward `to` by `w`, in place. */
function blendPose(cur: number[], to: number[], w: number): void { for (let i = 0; i < cur.length; i++) cur[i] += (to[i] - cur[i]) * w; }
/**
 * Give the event loop a turn. A message, not `setTimeout(0)`: browsers throttle
 * timers in a background tab to one a second, which would stretch a load that
 * yields a few dozen times into minutes.
 */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); resolve(); }; ch.port2.postMessage(0); });
}

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
  /** Every squad robot, beam, label and badge: one switch hides them all from the mirror. */
  private squadRoot = new THREE.Group();
  private tagTextures: THREE.CanvasTexture[] = [];
  private jumboUntil = 0;
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
  private tmp2 = new THREE.Vector3();
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
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
    this.arena.add(this.squadRoot);
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
    // One decimation per robot model, shared by every team that uses it.
    const lod = new Map<string, Promise<LodPiece[]>>();
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

      let pieces = lod.get(prefix);
      if (!pieces) lod.set(prefix, (pieces = this.lowDetailPieces(src)));
      const template = this.squadTemplate(src, await pieces, color);
      if (this.disposed) return;
      const squad = Array.from({ length: SQUAD_SLOTS }, () => this.makeBot(template, prefix, color));
      const badge = this.makeTag(192, 96);
      const bb = new THREE.Box3().setFromObject(src);

      this.fighters.push({
        id: spec.id, color, root, j, disc: root.getObjectByName(`${prefix}_disc`) ?? null, glow: glowMat,
        base: glowMat ? glowMat.emissive.clone() : color.clone(), flareC: new THREE.Color(1, 1, 1), flare: 0, aura, hipsY: j.hips.position.y,
        cur: POSES.idle.slice(), basePose: 'idle', flash: null, flashT: 0, thinkT: 0, energy: 0, light, beams: [],
        height: Math.max(1, bb.max.y - bb.min.y), squad, badge,
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

  // ───────────────────────────────────────────────────────────── squad robots

  /**
   * Decimate one robot model for its squad.
   *
   * The shipped robots are ~52 meshes and ~137K triangles each; three squads of
   * six full clones would be ~1,000 draw calls and 2.5M triangles. Each mesh is
   * welded and run through three's SimplifyModifier down to `LOD_KEEP` of its
   * vertices (small meshes are kept whole: they are cheap, and collapsing a
   * 100-vertex trim tears it), which takes the robot to ~37K triangles. The
   * robot is a rigid joint hierarchy, not a skinned mesh, so decimating each
   * part in its own joint's space keeps the jointed look: nothing stretches
   * across a joint. Normals are dropped and the bot is flat-shaded, which reads
   * as deliberate low-poly armour rather than a smoothed-over blob.
   *
   * Runs once per model at load (~0.7 s), yielding every ~24 ms of work so the
   * page stays responsive while it runs.
   */
  private async lowDetailPieces(src: THREE.Object3D): Promise<LodPiece[]> {
    src.updateMatrixWorld(true);
    const joints = new Set(JOINTS.map((n) => `${src.name}_${n}`));
    const meshes: THREE.Mesh[] = [];
    src.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const simplify = new SimplifyModifier();
    const rel = new THREE.Matrix4();
    const pieces: LodPiece[] = [];
    let slice = performance.now();
    for (const m of meshes) {
      if (performance.now() - slice > 24) { await yieldTask(); slice = performance.now(); if (this.disposed) break; }
      let joint: THREE.Object3D = m.parent ?? src;
      while (joint !== src && joint.parent && !joints.has(joint.name)) joint = joint.parent;
      rel.copy(joint.matrixWorld).invert().multiply(m.matrixWorld);
      let geo = new THREE.BufferGeometry().setAttribute('position', m.geometry.getAttribute('position').clone());
      if (m.geometry.index) geo.setIndex(m.geometry.index.clone());
      geo.applyMatrix4(rel);
      geo = mergeVertices(geo);
      const n = geo.getAttribute('position').count;
      if (n > LOD_MIN_VERTS) geo = simplify.modify(geo, Math.floor(n * (1 - LOD_KEEP)));
      const mat = m.material as THREE.MeshStandardMaterial;
      pieces.push({ joint: joint.name, cls: mat.name.slice(mat.name.lastIndexOf('_') + 1), geo, color: mat.color.clone() });
    }
    return pieces;
  }

  /**
   * A team's squad robot, from the decimated pieces: the team robot's joint
   * hierarchy with two meshes per joint, a body whose materials are baked into
   * vertex colours (the paint in the team colour) and the glow strips. Two
   * draw calls per joint instead of five.
   */
  private squadTemplate(src: THREE.Object3D, pieces: LodPiece[], color: THREE.Color): THREE.Object3D {
    const root = src.clone(true);
    const old: THREE.Object3D[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) old.push(o); });
    for (const o of old) o.removeFromParent();
    // The disc of the Claude robot stays, merged into the spine: at this size
    // it is still what tells a Claude squad from a Gemini one, but it does not spin.
    const paint = color.clone().multiplyScalar(0.62);
    const byJoint = new Map<string, { body: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] }>();
    for (const p of pieces) {
      let g = byJoint.get(p.joint);
      if (!g) byJoint.set(p.joint, (g = { body: [], glow: [] }));
      if (p.cls === 'glow') { g.glow.push(p.geo); continue; }
      // Lift the near-black armour a touch: a third of the size, it would otherwise read as a hole.
      const c = p.cls === 'paint' ? paint : p.color.clone().multiplyScalar(1.6);
      const geo = p.geo.clone(), n = geo.getAttribute('position').count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(a, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.body.push(geo);
    }
    for (const [name, g] of byJoint) {
      const joint = name === src.name ? root : root.getObjectByName(name);
      if (!joint) continue;
      for (const [list, part] of [[g.body, 'body'], [g.glow, 'glow']] as const) {
        const merged = list.length ? mergeGeometries(list as THREE.BufferGeometry[]) : null;
        if (!merged) continue;
        merged.computeVertexNormals();
        const mesh = new THREE.Mesh(merged); mesh.name = part; joint.add(mesh);
      }
    }
    return root;
  }

  private makeBot(template: THREE.Object3D, prefix: string, color: THREE.Color): SquadBot {
    const root = template.clone(true);
    const body = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.36, envMapIntensity: 1.3, flatShading: true });
    const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color.clone(), roughness: 0.4, metalness: 0 });
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = m.name === 'glow' ? glow : body; });
    const j = {} as Record<JointName, THREE.Object3D>;
    for (const n of JOINTS) j[n] = root.getObjectByName(`${prefix}_${n}`) ?? new THREE.Object3D();
    // A smaller, fainter aura than the lead's.
    const aura = new THREE.Mesh(Arena3D.squadAuraGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = 0.06; root.add(aura);
    const beam = new THREE.Mesh(Arena3D.beamGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const tag = this.makeTag(512, 96);
    root.visible = false; beam.visible = false;
    this.squadRoot.add(root, beam);
    return {
      root, j, hipsY: j.hips.position.y, cur: POSES.idle.slice(), flash: null, flashT: 0, memberId: null,
      label: tag.sprite, labelText: '', labelCtx: tag.ctx, labelTex: tag.tex, body, glow, aura, beam,
    };
  }
  private static squadAuraGeo = new THREE.RingGeometry(2.2, 2.45, 40);
  private static beamGeo = (() => { const g = new THREE.CylinderGeometry(0.16, 0.16, 1, 6, 1, true); g.translate(0, 0.5, 0); return g; })();

  /** A camera-facing text tag that keeps its on-screen size at any distance. */
  private makeTag(w: number, h: number): Tag {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false }));
    sprite.renderOrder = 10; sprite.visible = false;
    this.tagTextures.push(tex);
    this.squadRoot.add(sprite);
    return { sprite, ctx: cv.getContext('2d') as CanvasRenderingContext2D, tex, text: '' };
  }

  private drawTag(ctx: CanvasRenderingContext2D, tex: THREE.CanvasTexture, text: string, color: THREE.Color): void {
    const w = ctx.canvas.width, h = ctx.canvas.height, pad = h * 0.36;
    ctx.clearRect(0, 0, w, h);
    let size = Math.round(h * 0.46);
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
    let tw = ctx.measureText(text).width;
    if (tw > w - pad * 2) { size = Math.floor(size * (w - pad * 2) / tw); ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`; tw = ctx.measureText(text).width; }
    const bw = Math.min(w - 4, tw + pad * 2), x0 = (w - bw) / 2, y0 = h * 0.14, bh = h * 0.72, r = bh / 2;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + bw - r, y0); ctx.arc(x0 + bw - r, y0 + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0 + r, y0 + bh); ctx.arc(x0 + r, y0 + r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
    ctx.fillStyle = 'rgba(3,7,16,0.84)'; ctx.fill();
    ctx.strokeStyle = `#${color.getHexString()}`; ctx.lineWidth = Math.max(2, h * 0.045); ctx.stroke();
    ctx.fillStyle = '#eaf7ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
    tex.needsUpdate = true;
  }

  /**
   * Bind each team's pool to its squad and pose it: a pure function of `world`,
   * with `now` (scene seconds) only for the ambient breathing and working loop.
   * Called by both `sync()` and `drawFrame()`.
   *
   * A member with a slot is drawn from `spawnedAt` until `endedAt + EXIT_MS`.
   * It scales in over `SPAWN_MS`, travelling from the lead to its slot cell on
   * a beam; works there; then salutes (completed) or takes a hit with a red fade
   * (failed, killed, unknown). Every age is the playhead minus the member's own
   * event times, so a seek lands on the same picture as playing up to it.
   *
   * A provider that cannot attribute events to a member gets a looping working
   * pose, because the picture must not invent which member did what.
   *
   * `flashWin` is drawFrame's reaction window (world-ms): given, a robot's
   * reaction is derived from its own recent events; omitted, it is the live
   * flash `reactActor()` set.
   */
  private placeSquad(world: World, now: number, flashWin?: number): void {
    const C = this.C, k45 = C / 4.5, active = world.phase === 'active';
    for (const f of this.fighters) {
      const st = world.teams.get(f.id);
      const bound: Array<SquadMember | null> = f.squad.map(() => null);
      let overflow = 0;
      const cells = st && active ? squadSlotCells(st.band) : [];
      if (st && active) {
        const fading: SquadMember[] = [];
        for (const m of st.squad.values()) {
          if (m.spawnedAt > world.t) continue;
          const open = m.endedAt === undefined || m.endedAt > world.t;
          const drawn = m.slot !== null && m.slot < Math.min(bound.length, cells.length);
          if (open) { if (drawn) bound[m.slot!] = m; else overflow++; }
          else if (drawn && world.t - m.endedAt! < EXIT_MS) fading.push(m);
        }
        // An ended member keeps its slot number for its exit, but the slot is
        // free for the next spawn at once. When one has taken it, the exit plays
        // on a spare bot on the same cell (the newcomer is still travelling out
        // from the lead), or is cut short when all six are busy.
        for (const m of fading) {
          const i = bound[m.slot!] ? bound.indexOf(null) : m.slot!;
          if (i >= 0) bound[i] = m;
        }
      }
      const attributed = st ? capabilityFor(st.model).subagentAttribution : false;
      const lead = f.root.position, ls = f.root.scale.x;
      // Labels: new arrivals, exits, and only the single most recently active
      // member, so three squads never bury the floor in text.
      let talker: SquadMember | null = null;
      for (const m of bound) {
        if (!m || m.endedAt !== undefined && m.endedAt <= world.t || m.lastActiveAt <= m.spawnedAt || m.lastActiveAt > world.t) continue;
        if (world.t - m.lastActiveAt < LABEL_ACTIVE_MS && (!talker || m.lastActiveAt > talker.lastActiveAt)) talker = m;
      }

      f.squad.forEach((b, i) => {
        const m = bound[i];
        if (!m) { b.root.visible = b.beam.visible = b.label.visible = false; b.memberId = null; b.flash = null; return; }
        if (b.memberId !== m.id) { b.memberId = m.id; b.flash = null; b.flashT = 0; }
        const cell = cells[m.slot!];
        const age = world.t - m.spawnedAt, k = smooth(clamp01(age / SPAWN_MS));
        const ended = m.endedAt !== undefined && m.endedAt <= world.t;
        const x = ended ? clamp01((world.t - m.endedAt!) / EXIT_MS) : 0;
        const ok = m.status === 'completed';
        const s = ls * SQUAD_SCALE * Math.max(0.02, k);

        // Out of the lead's chest, down onto the slot.
        const px = lead.x + (cell.x * C - lead.x) * k, pz = lead.z + (cell.z * C - lead.z) * k;
        const py = 3.84 + (1 - k) * CHEST * ls * 0.8;
        b.root.visible = true;
        b.root.position.set(px, py, pz);
        b.root.scale.setScalar(s);
        b.root.rotation.y = lead.x <= 0 ? Math.PI / 2 : -Math.PI / 2;

        // Pose: idle, or the working loop; a reaction on top; the exit pose last.
        const c = b.cur;
        for (let q = 0; q < c.length; q++) c[q] = POSES.idle[q];
        if (!attributed && !ended && k >= 1) blendPose(c, POSES.strike, this.reduced ? 0.3 : 0.32 + 0.28 * Math.sin(now * 5.2 + m.slot! * 1.7));
        let fl: PoseName | null = null, e = 0;
        if (!ended && flashWin !== undefined) {
          for (let r = world.recent.length - 1; r >= 0; r--) {
            const a = world.recent[r];
            if (world.t - a.t > flashWin) break;
            if (a.t > world.t || a.agentId !== m.id || (a.kind !== 'file' && a.kind !== 'tool' && a.kind !== 'error')) continue;
            fl = a.kind === 'file' ? 'strike' : a.kind === 'error' ? 'hit' : 'power';
            e = envelope((world.t - a.t) / flashWin);
            break;
          }
        } else if (!ended && b.flash) { fl = b.flash; e = envelope(1 - b.flashT / SQUAD_FLASH_S); }
        if (fl) blendPose(c, POSES[fl], e);
        if (ended) blendPose(c, POSES[ok ? 'salute' : 'hit'], smooth(clamp01(x / 0.3)));
        this.applyJoints(b, this.reduced ? 0 : Math.sin(now * 1.9 + m.slot! * 2.1) * 0.03);

        // Look: fade out on exit, red for anything but a clean finish.
        const alpha = 1 - x, red = ended && !ok ? clamp01(x * 3) : 0;
        // Opaque until the fade, and no depth writes during it. A transparent
        // body that writes depth was measured to differ by a few dozen pixels
        // between identical drawFrame calls, which a reel rendered out of order
        // would show as flicker; without depth writes it is stable (and a
        // fading robot reads as a ghost, which is the point).
        const fading = x > 0;
        if (b.body.transparent !== fading) {
          b.body.transparent = b.glow.transparent = fading;
          b.body.depthWrite = b.glow.depthWrite = !fading;
          b.body.needsUpdate = b.glow.needsUpdate = true;
        }
        b.body.opacity = b.glow.opacity = alpha;
        b.body.emissive.copy(ALERT).multiplyScalar(red * 0.5);
        b.glow.emissive.copy(f.color).lerp(fl === 'hit' ? ALERT : WHITE, e * 0.7).lerp(ALERT, red);
        b.aura.material.opacity = (0.22 + e * 0.4) * alpha * k;

        // The beam: lead to robot while it travels out, robot back to lead as a finished member reports in.
        const bi = k < 1 ? Math.sin(k * Math.PI) : ended && ok ? Math.sin(x * Math.PI) * 0.8 : 0;
        if (bi > 0.02) {
          const ay = 3.84 + CHEST * ls, v = this.tmp2.set(px - lead.x, py + CHEST * s - ay, pz - lead.z), len = v.length();
          b.beam.visible = len > 0.2;
          b.beam.position.set(lead.x, ay, lead.z);
          if (len > 0.2) b.beam.quaternion.setFromUnitVectors(UP, v.divideScalar(len));
          b.beam.scale.set(k45, len, k45);
          b.beam.material.opacity = bi;
        } else b.beam.visible = false;

        const talk = m === talker ? clamp01((LABEL_ACTIVE_MS - (world.t - m.lastActiveAt)) / 500) : 0;
        const la = Math.max(clamp01((LABEL_SPAWN_MS - age) / 500), talk, ended ? 1 : 0) * alpha * clamp01(k * 2);
        if (la > 0.01) {
          if (b.labelText !== m.label) { b.labelText = m.label; this.drawTag(b.labelCtx, b.labelTex, m.label, f.color); }
          b.label.visible = true;
          b.label.material.opacity = la;
          b.label.position.set(px, py + f.height * s + 1.1 * k45, pz);
          b.label.scale.set(LABEL_H * 512 / 96, LABEL_H, 1);
        } else b.label.visible = false;
      });

      const badge = f.badge;
      if (overflow > 0) {
        const text = `+${overflow}`;
        if (badge.text !== text) { badge.text = text; this.drawTag(badge.ctx, badge.tex, text, f.color); }
        badge.sprite.visible = true;
        badge.sprite.position.set(lead.x, lead.y + f.height * ls + 2.2 * k45, lead.z);
        badge.sprite.scale.set(LABEL_H * 1.2 * 2, LABEL_H * 1.2, 1);
      } else badge.sprite.visible = false;
    }
  }

  // ───────────────────────────────────────────────────────────── world sync

  /** Mirror the truth model into the scene. Called once per frame by the host. */
  sync(world: World, dt: number): void {
    const now = (this.time.value += dt);
    this.layout(world);

    this.syncBlocks(world);
    // Squad first, so a member spawned this frame has a robot to react with.
    this.placeSquad(world, now);
    for (const f of this.fighters) for (const b of f.squad) if (b.flash && (b.flashT -= dt) <= 0) b.flash = null;

    // Per-event choreography, from the world's own recent-activity window,
    // coalesced per actor: each robot (lead, member, or the unnamed squad)
    // plays only its newest fresh event, so a burst of activity never stacks
    // effects and never has to be dropped wholesale. Lifecycle (spawn / done)
    // is its own channel, so a member's first tool call cannot swallow its
    // arrival; and narration never displaces an action in the same frame.
    if (world.t < this.lastT) this.lastT = world.t;       // scrubbed backwards: no effects
    const since = Math.max(this.lastT, world.t - REACT_STALE_MS);
    const acts = new Map<string, RecentActivity>();
    for (const r of world.recent) {
      if (r.t <= since || r.t > world.t) continue;
      const life = r.kind === 'spawn' || r.kind === 'agentDone';
      const actor = `${r.teamId}|${r.agentId ?? (r.squad ? '#squad' : '#lead')}${life ? '|life' : ''}`;
      const prev = acts.get(actor);
      if (prev && r.kind === 'reasoning' && prev.kind !== 'reasoning') continue;
      acts.set(actor, r);
    }
    for (const r of acts.values()) this.reactActor(world, r.teamId, r.agentId, r.kind, r.key, !!r.squad);
    this.lastT = world.t;
    if (this.jumboUntil > 0 && now >= this.jumboUntil) {
      this.jumboUntil = 0;
      if (world.phase === 'active') this.setJumbo(this.liveBanner(), '#00f0ff');
    }

    // Phase.
    const phaseKey = `${world.phase}:${world.winnerId ?? ''}`;
    if (phaseKey !== this.lastPhase) { this.onPhase(world); this.lastPhase = phaseKey; }
    this.phaseCol.lerp(world.phase === 'judging' ? JUDGE : new THREE.Color(0, 0, 0), Math.min(1, dt * 3));
    this.floorMat.uniforms.uPhase.value.copy(this.phaseCol);
    this.groundMat.uniforms.uPhase.value.copy(this.phaseCol);

    // Momentum (10s window of file events, as the HUD bar) → the seam between two territories.
    let target = 0;
    if (this.fighters.length === 2) {
      target = this.seamFor(world, 10_000);
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

    this.placeCars(now);
    this.stepParticles(dt);
    this.jumbo.tex.offset.x = now * 0.03;
    this.mirror.visible = this.blocks.size <= 220;
    this.stepCamera(world, dt);
  }

  private syncBlocks(world: World): void {
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
      b.fill.emissive.copy(b.color).multiplyScalar(0.03 + hot * 0.9).lerp(ALERT, hit * 0.8).lerp(GOLD, gold * 0.5);
      b.cap?.color.copy(b.color).multiplyScalar(0.75 + hot * 1.6).lerp(ALERT, hit).lerp(GOLD, gold * 0.9);
    }
  }

  /** Where the layout put things, for a host that stages its own camera. */
  get metrics(): { cell: number; deckRadius: number; fighterX: number[] } {
    return { cell: this.C, deckRadius: this.R, fighterX: this.fighters.map((f) => f.root.position.x) };
  }

  /**
   * Draw one frame as a pure function of `(world, spec)`.
   *
   * No easing, no accumulation, no `Math.random()`: reactions are derived from
   * how long ago each event happened in the world's own time, so frame N is
   * identical however many frames were drawn before it and in whatever order.
   * Particles are the one live effect with no pure form, and are left out.
   */
  drawFrame(world: World, o: Arena3DFrame): void {
    this.time.value = o.t;
    this.layout(world);
    this.syncBlocks(world);
    const win = Math.max(1, o.windowMs), recent = world.recent;
    const judging = world.phase === 'judging';
    this.phaseCol.set(0, 0, 0); if (judging) this.phaseCol.copy(JUDGE);
    this.floorMat.uniforms.uPhase.value.copy(this.phaseCol);
    this.groundMat.uniforms.uPhase.value.copy(this.phaseCol);

    let pi = 0;
    for (const p of this.pulses) p.z = -99;
    for (let i = recent.length - 1; i >= 0 && pi < MAX_PULSES; i--) {
      const r = recent[i], age = (world.t - r.t) / win;
      if (age > 2.2) break;
      if (age < 0 || r.kind === 'reasoning') continue;
      const f = this.fighters.find((x) => x.id === r.teamId); if (!f) continue;
      const at = this.pulseAt(world, r, f);
      this.pulses[pi].set(at.x, at.z, o.t - age * 0.7, 0);
      this.pulseColors[pi].copy(r.kind === 'error' || (r.kind === 'agentDone' && !this.endedClean(world, r)) ? ALERT : f.color); pi++;
    }

    const winner = world.phase === 'reveal' ? this.fighters.find((f) => f.id === world.winnerId) : undefined;
    const counts = this.fighters.map(() => 0);
    this.fighters.forEach((f, fi) => {
      const ov = o.overrides?.[f.id];
      let last: { kind: string; t: number } | null = null, newest: string | null = null;
      for (let i = recent.length - 1; i >= 0; i--) {
        const r = recent[i]; if (world.t - r.t > win * 6) break;
        if (r.teamId !== f.id || r.t > world.t) continue;
        counts[fi]++;
        // The squad's own events move the squad, not the lead. Its one part in
        // them is the spawn: the lead deploys the member.
        const own = !r.agentId && !r.squad;
        if (!own && r.kind !== 'spawn') continue;
        if (own) newest = newest ?? r.kind;
        if (!last && r.kind !== 'reasoning' && r.kind !== 'agentDone' && world.t - r.t <= win) last = r;
      }
      f.energy = winner ? (f === winner ? 1 : 0) : Math.min(1, counts[fi] / 8);
      const staged = ov?.pose;
      const base: PoseName = typeof staged === 'string' ? staged : (winner ? (f === winner ? 'triumph' : 'kneel') : judging ? 'salute' : newest === 'reasoning' ? 'thinking' : 'idle');
      let e = 0, flash: PoseName = 'idle';
      if (staged && typeof staged !== 'string') {
        const A0 = POSES[staged.from], B0 = POSES[staged.to], m = Math.min(1, Math.max(0, staged.mix));
        for (let i = 0; i < f.cur.length; i++) f.cur[i] = A0[i] + (B0[i] - A0[i]) * m;
      } else if (last && !staged && !winner) {
        e = envelope((world.t - last.t) / win);
        flash = last.kind === 'file' ? 'strike' : last.kind === 'error' ? 'hit' : 'power';
        f.flareC.copy(last.kind === 'error' ? ALERT : WHITE);
      }
      if (!staged || typeof staged === 'string') {
        const A = POSES[base], B = POSES[flash];
        for (let i = 0; i < f.cur.length; i++) f.cur[i] = A[i] + (B[i] - A[i]) * e;
      }
      if (ov?.yaw !== undefined) f.root.rotation.y = ov.yaw;
      this.applyJoints(f, Math.sin(o.t * 1.7 + f.root.position.x) * 0.03);
      f.root.position.y = 3.84 + (ov?.lift ?? 0);
      if (f.disc) f.disc.rotation.z = o.t * (2 + f.energy * 4);
      if (f.glow) f.glow.emissive.copy(f.base).lerp(f.flareC, e * 0.8);
      const sc = 1 + f.energy * 0.55 + Math.sin(o.t * 4) * 0.03; f.aura.scale.set(sc, sc, 1);
      (f.aura.material as THREE.MeshBasicMaterial).opacity = 0.35 + f.energy * 0.6;
      f.light.intensity = 90 + f.energy * 260;
      for (const bm of f.beams) bm.uniforms.uI.value = 0.12 + f.energy * 0.75;
    });

    this.placeSquad(world, o.t, win);

    let seam = 0;
    if (this.fighters.length === 2) {
      seam = this.seamFor(world, win * 6);
      if (winner) seam = winner === this.fighters[0] ? 0.8 : -0.8; else if (judging || world.phase === 'freeze') seam = 0;
    }
    this.floorMat.uniforms.uSeam.value = seam * Math.abs(this.fighters[0]?.root.position.x ?? 0) * 0.5;

    this.spot.visible = !!winner && (o.reveal ?? 0) > 0;
    if (winner) { this.spot.position.x = winner.root.position.x; this.spot.material.uniforms.uC.value = winner.color; this.spot.material.uniforms.uI.value = o.reveal ?? 0; }
    this.setJumbo(o.banner?.text ?? this.liveBanner(), o.banner?.color ?? '#00f0ff');
    this.jumbo.tex.offset.x = o.t * 0.03;
    this.placeCars(o.t);
    this.pSize.fill(0); this.pGeo.attributes.size.needsUpdate = true;
    this.mirror.visible = true;
    this.camera.position.set(...o.cam.pos); this.look.set(...o.cam.look);
    if (this.camera.fov !== o.cam.fov) { this.camera.fov = o.cam.fov; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(this.look);
    this.composer.render();
  }

  private placeCars(t: number): void {
    for (const c of this.cars) {
      const pos = ((((c.pos + c.speed * c.dir * t) + 520) % 1040) + 1040) % 1040 - 520;
      if (c.axis === 'x') c.m.position.set(pos, 0.6, c.lane); else c.m.position.set(c.lane, 0.6, pos);
    }
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
    for (const t of this.tagTextures) t.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ───────────────────────────────────────────────────────────── reactions

  /**
   * Play one actor's reaction to its newest fresh event (live only).
   *
   * The actor is the squad robot `agentId` names. With no `agentId`, a file an
   * unnamed squad member wrote (`squad`, from the workdir watcher) only pulses
   * its block, because nobody on the floor can honestly be shown writing it;
   * anything else is the lead's. A file spark aims at the block `key` names.
   */
  private reactActor(world: World, teamId: string, agentId: string | undefined, kind: string, key: string | undefined, squad = false): void {
    const f = this.fighters.find((x) => x.id === teamId);
    const st = world.teams.get(teamId);
    if (!f || !st) return;
    if (kind === 'spawn' || kind === 'agentDone') { this.reactLifecycle(world, f, st, agentId, kind); return; }
    const block = key ? world.structures.get(`${teamId}|${key}`) : undefined;
    const top = block ? new THREE.Vector3(block.x * this.C, 3.86 + block.h * this.C, block.z * this.C) : null;
    if (!agentId && !squad) { this.reactLead(f, kind, top); return; }
    if (kind === 'reasoning') return;
    f.energy = Math.min(1, f.energy + 0.1);
    const bot = agentId ? f.squad.find((b) => b.memberId === agentId && b.root.visible) : undefined;
    if (!bot) {
      // An unnamed member, or one past the six drawn: the block lights, no robot acts.
      if (top) this.pulse(top.x, top.z, kind === 'error' ? ALERT : f.color);
      return;
    }
    if (kind === 'tool') {
      bot.flash = 'power';
      this.spark(this.headOf(bot), f.color, 10, 6, 0.6, 0, 4, 0.35);
    } else if (kind === 'file') {
      bot.flash = 'strike';
      const hand = this.handOf(bot);
      this.spark(hand, f.color, 12, 8, 0.5, 10, 2, 0.4);
      if (top) { this.sparkLine(hand, top, f.color, 3); this.pulse(top.x, top.z, f.color); }
    } else if (kind === 'error') {
      bot.flash = 'hit';
      this.spark(this.headOf(bot), ALERT, 22, 10, 0.7, 14, 2, 0.45);
    } else return;
    bot.flashT = SQUAD_FLASH_S;
  }

  /** A member arrives (the lead deploys it, the jumbotron calls it) or reports in. */
  private reactLifecycle(world: World, f: Fighter, st: TeamState, agentId: string | undefined, kind: string): void {
    const m = agentId ? st.squad.get(agentId) : undefined;
    if (!m || world.phase !== 'active') return;
    const chest = this.tmp2.copy(f.root.position); chest.y += CHEST * f.root.scale.x;
    if (kind === 'spawn') {
      f.flash = 'power'; f.flashT = 0.6; f.flare = 0.7; f.flareC.set(1, 1, 1);
      f.energy = Math.min(1, f.energy + 0.22);
      this.pulse(f.root.position.x, f.root.position.z, f.color);
      const cell = m.slot !== null ? squadSlotCells(st.band)[m.slot] : undefined;
      if (cell) {
        const to = new THREE.Vector3(cell.x * this.C, 3.84 + CHEST * f.root.scale.x * SQUAD_SCALE * 0.5, cell.z * this.C);
        this.sparkLine(chest, to, f.color, 2);
        this.spark(to, f.color, 26, 7, 0.8, 6, 3, 0.5);
      }
      let open = 0;
      for (const x of st.squad.values()) if (x.endedAt === undefined) open++;
      this.setJumbo(`${providerOf(st.model).toUpperCase()} DEPLOYS SQUAD · ${open} ACTIVE`, `#${f.color.getHexString()}`);
      this.jumboUntil = this.time.value + SQUAD_JUMBO_S;
      return;
    }
    const bot = f.squad.find((b) => b.memberId === agentId && b.root.visible);
    if (!bot) return;
    const at = this.headOf(bot);
    if (m.status === 'completed') { this.sparkLine(at, chest, f.color, 2); this.spark(at, f.color, 16, 5, 0.6, 0, 4, 0.4); }
    else this.spark(at, ALERT, 30, 10, 0.7, 14, 2, 0.5);
  }

  /** A trail of sparks arcing from `from` to `to`. */
  private sparkLine(from: THREE.Vector3, to: THREE.Vector3, c: THREE.Color, arc = 5): void {
    const a = from.clone(), b = to.clone();
    for (let i = 1; i <= 14; i++) { this.tmp.lerpVectors(a, b, i / 14); this.tmp.y += Math.sin((i / 14) * Math.PI) * arc; this.spark(this.tmp, c, 2, 1.2, 0.5 + i * 0.03, 0, 0, 0.4); }
  }

  /** Where a `recent` entry's floor pulse goes: its block, else the member's slot, else the lead. */
  private pulseAt(world: World, r: RecentActivity, f: Fighter): { x: number; z: number } {
    const s = r.key ? world.structures.get(`${r.teamId}|${r.key}`) : undefined;
    if (s) return { x: s.x * this.C, z: s.z * this.C };
    const st = world.teams.get(r.teamId), m = r.agentId && r.kind !== 'spawn' ? st?.squad.get(r.agentId) : undefined;
    const cell = st && m && m.slot !== null ? squadSlotCells(st.band)[m.slot] : undefined;
    if (cell) return { x: cell.x * this.C, z: cell.z * this.C };
    return { x: f.root.position.x, z: f.root.position.z };
  }

  private endedClean(world: World, r: RecentActivity): boolean {
    return !!r.agentId && world.teams.get(r.teamId)?.squad.get(r.agentId)?.status === 'completed';
  }

  /** Two-team seam offset from the file-event momentum shares (the same measure as the HUD bar). */
  private seamFor(world: World, windowMs: number): number {
    const sh = momentumShares(world, windowMs);
    return ((sh.get(this.fighters[0].id) ?? 0) - (sh.get(this.fighters[1].id) ?? 0)) * SEAM_SWING;
  }

  private liveBanner(): string {
    return `LIVE  ·  ${this.opts.teams.map((t) => t.model.toUpperCase()).join('  vs  ')}`;
  }

  /** The lead's own reaction: unchanged choreography, but a file spark now aims at the block it wrote. */
  private reactLead(f: Fighter, kind: string, top: THREE.Vector3 | null): void {
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
      if (top) { this.sparkLine(hand, top, f.color); this.pulse(top.x, top.z, f.color); }
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
    this.jumboUntil = 0;
    for (const f of this.fighters) { f.basePose = 'idle'; f.flash = null; for (const b of f.squad) b.flash = null; }
    if (world.phase === 'active') { this.setJumbo(this.liveBanner(), '#00f0ff'); this.cut(0); }
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
    this.applyJoints(f, this.reduced ? 0 : Math.sin(now * 1.7 + f.root.position.x) * 0.03);
    if (f.disc) f.disc.rotation.z += dt * (2 + f.energy * 10);
    if (f.flash && (f.flashT -= dt) <= 0) f.flash = null;
    f.flare = Math.max(0, f.flare - dt * 2.4);
    if (f.glow) f.glow.emissive.copy(f.base).lerp(f.flareC, Math.min(1, f.flare));
    const s = 1 + f.energy * 0.55 + Math.sin(now * 4) * 0.03; f.aura.scale.set(s, s, 1);
    (f.aura.material as THREE.MeshBasicMaterial).opacity = 0.35 + f.energy * 0.6;
    f.light.intensity = 90 + f.energy * 260;
    for (const bm of f.beams) bm.uniforms.uI.value += ((0.12 + f.energy * 0.75) - bm.uniforms.uI.value) * Math.min(1, dt * 4);
  }

  private applyJoints(f: Posable, br: number): void {
    const j = f.j, c = f.cur;
    j.spine.rotation.set(c[0] + br, c[1], 0); j.head.rotation.x = c[2];
    j.shL.rotation.set(c[3], 0, c[4]); j.elL.rotation.x = c[5];
    j.shR.rotation.set(c[6], 0, -c[7]); j.elR.rotation.x = c[8];
    j.hipL.rotation.x = c[9]; j.knL.rotation.x = c[10]; j.hipR.rotation.x = c[11]; j.knR.rotation.x = c[12];
    j.hips.position.set(0, f.hipsY + c[13] + br * 2, c[14]);
  }

  private handOf(f: Posable): THREE.Vector3 { return f.j.elR.localToWorld(new THREE.Vector3(0, -1.9, 0)); }
  private headOf(f: Posable): THREE.Vector3 { return f.j.head.localToWorld(new THREE.Vector3(0, 1.6, 0)); }

  private makeBlock(s: Structure, world: World): Block {
    const color = new THREE.Color(world.teams.get(s.teamId)?.color ?? '#00f0ff');
    const geo = Arena3D.blockGeo, group = new THREE.Group();
    const ghost = s.depth === 'unavailable';
    // `unavailable` is a hollow ghost and `inferred` has dashed edges, so the
    // confidence of a block's height survives a screenshot.
    const fill = new THREE.MeshStandardMaterial({ color: 0x06080d, metalness: 0.4, roughness: 0.6, emissive: color.clone().multiplyScalar(0.03), transparent: ghost, opacity: ghost ? 0.12 : 1, depthWrite: !ghost });
    group.add(new THREE.Mesh(geo, fill));
    let edge: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    const lines = new THREE.LineSegments(Arena3D.blockEdges);
    if (s.depth === 'inferred') { edge = new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.09, toneMapped: false }); lines.computeLineDistances(); }
    else edge = new THREE.LineBasicMaterial({ color, toneMapped: false });
    lines.material = edge; group.add(lines);
    // A lit rooftop tile, so a block reads as one file from above and at a distance.
    let cap: THREE.MeshBasicMaterial | null = null;
    if (!ghost) {
      cap = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const tile = new THREE.Mesh(Arena3D.capGeo, cap); tile.position.y = 1.002; group.add(tile);
    }
    this.blockRoot.add(group);
    return { group, cap, fill, edge, depth: s.depth, color };
  }
  private static blockGeo = (() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; })();
  private static blockEdges = new THREE.EdgesGeometry(Arena3D.blockGeo);
  private static capGeo = (() => { const g = new THREE.PlaneGeometry(0.66, 0.66); g.rotateX(-Math.PI / 2); return g; })();

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
      else if (i === 3) { const a = -0.5 + t * 0.03, d = R * 1.5; dur = 7; p.set(Math.sin(a) * d, R, Math.cos(a) * d); l.set(0, 3, 0); } // high three-quarter: both cities at once
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
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.2, 8, 128), this.glowMat(GRID, 1.05)); rim.rotation.x = Math.PI / 2; rim.position.y = 3.85; this.arena.add(rim);

    this.mirror = new Reflector(new THREE.CircleGeometry(R, 64), { textureWidth: 1024, textureHeight: 1024, color: 0x99aabb, clipBias: 0.003 });
    this.mirror.rotation.x = -Math.PI / 2; this.mirror.position.y = 3.81; this.arena.add(this.mirror);
    // The squad is left out of the reflection: eighteen extra robots in a
    // second pass would double their cost for a picture nobody reads, and their
    // fixed-size labels would mirror as stray tags under the deck. The
    // Reflector renders its pass inside its own onBeforeRender, so hiding the
    // squad around that call removes it from the mirror and nothing else.
    const reflect = this.mirror.onBeforeRender.bind(this.mirror);
    this.mirror.onBeforeRender = (...args: Parameters<Reflector['onBeforeRender']>) => {
      const was = this.squadRoot.visible;
      this.squadRoot.visible = false;
      try { reflect(...args); } finally { this.squadRoot.visible = was; }
    };

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
        fragmentShader: `varying float vY; uniform vec3 uC; uniform float uI; void main(){ float a = pow(1.-vY,1.6)*uI*0.55; gl_FragColor = vec4(uC*2.*a, a); }`,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.8, 320, 10, 1, true), bm); beam.position.set(x, 169.8, z); this.arena.add(beam);
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
