// The arena core is importable as a self-contained ESM subtree: every specifier
// in its compiled import graph is relative, so `dist/arena/index.js` loads
// natively in a browser with no bundler and pulls in no third-party code.
// The design tokens are re-exported here so a host needs exactly one import.
export {
  MODEL_COLORS, MODEL_COLOR_FALLBACK, getModelColor, OBSERVER,
  FONT_DISPLAY, FONT_MONO, TYPE, TRACKING, SPACE, EASE, MOTION,
  hexToRgbTuple, rgba, mixHex,
} from '../design/tokens.js';

export type { ProviderFileCapability, FileOperation, FileOpSource, SubAgentStatus, SubAgentSpawnPayload, SubAgentDonePayload } from '../types/event.js';
export { PROVIDER_FILE_CAPABILITIES, squadLabel, CLAUDE_TASK_STATUS } from '../types/event.js';

export type { Ctx2D, CanvasLike, CanvasGradientLike, TextMetricsLike } from './canvas2d.js';
export { clamp, lerp, easeOut, poly, rrect } from './canvas2d.js';

export type { Insets, Viewport, Projected, CameraState } from './camera.js';
export { NO_INSETS, DEFAULT_YAW, DEFAULT_PITCH, createCamera, safeBox, worldScale, focus, project, stepCamera, setYaw } from './camera.js';

export type { Cell, GridExtent, BlockBudget, Band } from './layout.js';
export { planGrid, cellOrder, bandFor, bandsFor, bandCells, blockKeyFor, MAX_BLOCKS_PER_TEAM, SQUAD_SLOTS, squadSlotCells } from './layout.js';

export type { KnownProvider, FrameEventKind, FrameEvent, EditDepthMode, TeamTelemetry, TeamManifest, ReconcileResult, SquadSignals } from './event-model.js';
export { UNKNOWN_PROVIDER_CAPABILITY, providerOf, capabilityFor, recoverLegacyPath, toFrameEvent, toFrameEvents, resolveTelemetry, reconcileWithManifest, isVendoredPath, corpusFromEvents, squadNotes } from './event-model.js';

export type { TeamSpec, BlockKind, Structure, TeamState, Phase, World, ApplyEffects, SquadMember, RecentActivity } from './world.js';
export { createWorld, resetWorld, phaseFor, targetHeight, applyEvent, stepStructures, telemetryFromStats, refreshNotes, ensureGridCapacity, foldSquadSignals, momentumShares } from './world.js';

export type { RendererOptions } from './renderer.js';
export { IsoArenaRenderer } from './renderer.js';

export type { SquadEventLine } from './squad-hud.js';
export { describeSquadEvent } from './squad-hud.js';
