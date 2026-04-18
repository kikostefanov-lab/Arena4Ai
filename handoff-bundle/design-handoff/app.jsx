/* global React, ReactDOM, GladiatorV2, ArenaRing, Shockwaves, EventStream,
   LaneHeader, MomentumMeter, WinnerBanner, PhaseChip */

const { useRef, useEffect, useState, useMemo, useCallback } = React;

// --- Config ---------------------------------------------------------------
const MODEL_COLORS = {
  claude: '#ff6600',
  codex:  '#0066ff',
  gemini: '#00f0ff',
};
const getModelColor = (m) => MODEL_COLORS[(m||'').split(':')[0]] ?? '#4a8fa8';

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "strokeWeight": 2.6,
  "glowIntensity": 1.0,
  "breathAmplitude": 3.5,
  "figureScale": 1.8,
  "cameraBehavior": "focus",
  "showMomentum": true,
  "ringTicks": true,
  "backgroundDim": 0.6,
  "matchDurationSec": 30
}/*EDITMODE-END*/;

// Canvas is logical size; component scales to container
const CW = 1200, CH = 640;
const MATCH_PHASES = [
  { phase: 'active',  until: 0.80 }, // 0–80% → fighting
  { phase: 'freeze',  until: 0.85 }, // 80–85% → freeze
  { phase: 'judging', until: 0.92 }, // 85–92% → judging
  { phase: 'reveal',  until: 1.0  }, // 92–100% → winner
];

function phaseAt(tNorm) {
  for (const p of MATCH_PHASES) if (tNorm <= p.until) return p.phase;
  return 'reveal';
}

// --- Main App -------------------------------------------------------------
function App() {
  const [tweaks, setTweaks] = useState(DEFAULT_TWEAKS);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Two teams hardcoded for the prototype. Claude vs Gemini.
  const teams = useMemo(() => ([
    { id: 'a', model: 'claude', persona: 'architect' },
    { id: 'b', model: 'gemini', persona: 'synth' },
  ]), []);

  const durationMs = tweaks.matchDurationSec * 1000;
  const stream = useMemo(() => new EventStream(teams.map(t=>t.id), durationMs), [teams, durationMs]);

  // Winner decided by total momentum in active phase — fun but deterministic-ish
  const winnerId = useMemo(() => {
    const counts = { a: 0, b: 0 };
    for (const e of stream.events) counts[e.teamId] = (counts[e.teamId] || 0) + 1;
    return counts.a >= counts.b ? 'a' : 'b';
  }, [stream]);

  // Playback — state drives UI; refs drive RAF loop (no re-subscribe per frame)
  const [playing, setPlaying] = useState(true);
  const [cursorMs, setCursorMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const playingRef = useRef(true);
  const cursorRef = useRef(0);
  const speedRef = useRef(1);
  const tweaksRef = useRef(tweaks);
  const durationRef = useRef(durationMs);
  const streamRef = useRef(stream);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { cursorRef.current = cursorMs; }, [cursorMs]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { tweaksRef.current = tweaks; }, [tweaks]);
  useEffect(() => { durationRef.current = durationMs; }, [durationMs]);
  useEffect(() => { streamRef.current = stream; }, [stream]);

  // Canvas + renderers
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const ringRef = useRef(null);
  const shockRef = useRef(null);
  const gladsRef = useRef(null);
  const lastEventIdxRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1 });
  const latestActionRef = useRef({ a: '', b: '' });

  // Init renderers when teams or tweaks change
  useEffect(() => {
    const scale = tweaks.figureScale;
    const groundY = CH * 0.68;
    gladsRef.current = {
      a: new GladiatorV2({
        teamId: 'a', build: 'claude', color: getModelColor('claude'),
        x: CW * 0.30, y: groundY, scale, facing: 1,
      }),
      b: new GladiatorV2({
        teamId: 'b', build: 'gemini', color: getModelColor('gemini'),
        x: CW * 0.70, y: groundY, scale, facing: -1,
      }),
    };
    ringRef.current = new ArenaRing(CW / 2, CH * 0.76, CW * 0.38, CH * 0.10);
    shockRef.current = new Shockwaves();
    lastEventIdxRef.current = 0;
  }, [tweaks.figureScale]);

  // Reset playback when stream changes
  useEffect(() => {
    setCursorMs(0);
    lastEventIdxRef.current = 0;
    if (shockRef.current) shockRef.current.list = [];
  }, [stream]);

  // Restore cursor
  useEffect(() => {
    const stored = Number(localStorage.getItem('arena_cursor') || 0);
    if (stored && stored < durationMs) setCursorMs(stored);
  }, [durationMs]);
  useEffect(() => { localStorage.setItem('arena_cursor', String(cursorMs)); }, [cursorMs]);

  // Main RAF loop — mounts once, reads mutable state from refs
  useEffect(() => {
    let raf = 0;
    let uiTickCounter = 0;
    const step = (ts) => {
      const last = lastFrameTsRef.current || ts;
      let dt = ts - last;
      lastFrameTsRef.current = ts;
      if (dt > 100) dt = 16;

      let cur = cursorRef.current;
      if (playingRef.current) {
        cur = Math.min(durationRef.current, cur + dt * speedRef.current);
        cursorRef.current = cur;
        // Throttle React state updates to every ~3 frames so the scrubber
        // and momentum HUD reflect reality without thrashing re-renders.
        uiTickCounter++;
        if (uiTickCounter % 3 === 0) setCursorMs(cur);
      }

      drawFrame(dt, cur);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Draw one frame — reads ref snapshots, never closes over state
  const drawFrame = (dt, cur) => {
    const tweaks = tweaksRef.current;
    const stream = streamRef.current;
    const durationMs = durationRef.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const glads = gladsRef.current;
    const ring = ringRef.current;
    const shock = shockRef.current;
    if (!glads || !ring || !shock) return;

    const tNorm = cur / durationMs;
    const phase = phaseAt(tNorm);

    // Fire new events since last frame
    const allEvents = stream.events;
    while (
      lastEventIdxRef.current < allEvents.length &&
      allEvents[lastEventIdxRef.current].t <= cur
    ) {
      const e = allEvents[lastEventIdxRef.current++];
      const g = glads[e.teamId];
      const opp = glads[e.teamId === 'a' ? 'b' : 'a'];
      if (!g) continue;
      if (e.flash === 'thinking') {
        g.setBase('thinking');
        setTimeout(() => g.setBase('idle'), 400 + Math.random()*300);
        latestActionRef.current[e.teamId] = '> reasoning...';
      } else if (e.flash === 'strike' || e.flash === 'power') {
        g.flash(e.flash);
        // Spawn shockwave at opponent center
        const tx = opp.x; const ty = opp.y - 20;
        shock.spawnShockwave(tx, ty, g.color);
        ring.pulse(g.color);
        // Camera nudge toward striker
        if (tweaks.cameraBehavior === 'focus') {
          cameraRef.current.tx = (g.x - CW / 2) * 0.08;
          cameraRef.current.tzoom = 1.05;
          clearTimeout(window.__camTimer);
          window.__camTimer = setTimeout(() => {
            cameraRef.current.tx = 0; cameraRef.current.tzoom = 1;
          }, 350);
        }
        // Opponent hit reaction
        opp.flash('hit');
        latestActionRef.current[e.teamId] = e.flash === 'strike' ? '> write <file>' : '> exec <tool>';
      }
    }

    // Phase transitions
    const winner = teams.find(t => t.id === winnerId);
    const loser = teams.find(t => t.id !== winnerId);
    const winnerColor = getModelColor(winner.model);

    if (phase === 'reveal') {
      glads[winnerId].setTerminal('triumph');
      const lid = loser.id;
      glads[lid].setTerminal('kneel');
      // Winner camera zoom
      if (tweaks.cameraBehavior === 'focus') {
        cameraRef.current.tx = (glads[winnerId].x - CW / 2) * 0.25;
        cameraRef.current.tzoom = 1.18;
      }
      // Confetti once
      if (!ring._confettiFired) {
        shock.spawnConfetti(glads[winnerId].x, glads[winnerId].y - 60, winnerColor);
        ring._confettiFired = true;
      }
    } else {
      if (ring._confettiFired) ring._confettiFired = false;
      glads.a.setTerminal(null);
      glads.b.setTerminal(null);
    }
    ring.setPhase(phase, winnerColor);

    // Energy from recent activity per team
    const win = 3000;
    const recent = stream.eventsInWindow(cur, win);
    const countA = recent.filter(e => e.teamId === 'a').length;
    const countB = recent.filter(e => e.teamId === 'b').length;
    glads.a.setEnergy(Math.min(1, countA / 5));
    glads.b.setEnergy(Math.min(1, countB / 5));

    // Updates
    glads.a.update(dt, cur);
    glads.b.update(dt, cur);
    ring.update(dt);
    shock.update(dt);

    // Ease camera
    const cam = cameraRef.current;
    cam.x += (cam.tx - cam.x) * 0.08;
    cam.zoom += (cam.tzoom - cam.zoom) * 0.08;

    // --- Render ---
    ctx.clearRect(0, 0, CW, CH);
    // Background
    ctx.fillStyle = '#01060c';
    ctx.fillRect(0, 0, CW, CH);

    // Subtle scanlines
    ctx.fillStyle = 'rgba(0,240,255,0.02)';
    for (let y = 0; y < CH; y += 3) ctx.fillRect(0, y, CW, 1);

    // Camera transform
    ctx.save();
    ctx.translate(CW/2, CH/2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-CW/2 - cam.x, -CH/2);

    // Floor grid (dims during reveal)
    const dim = phase === 'reveal' ? 0.3 : tweaks.backgroundDim;
    ring.drawGrid(ctx, dim);

    // Ring
    if (tweaks.ringTicks) ring.drawRing(ctx);

    // Gladiators — draw loser first so winner is on top during reveal
    if (phase === 'reveal') {
      glads[loser.id].draw(ctx);
      glads[winnerId].draw(ctx);
    } else {
      glads.a.draw(ctx);
      glads.b.draw(ctx);
    }

    // Shockwaves on top
    shock.draw(ctx);

    ctx.restore();
  };

  // Momentum for HUD
  const momentum = useMemo(() => {
    const recent = stream.eventsInWindow(cursorMs, 10000);
    const a = recent.filter(e => e.teamId === 'a').length;
    const b = recent.filter(e => e.teamId === 'b').length;
    const total = a + b;
    if (!total) return 0;
    return (b - a) / total; // -1..1
  }, [cursorMs, stream]);

  const phase = phaseAt(cursorMs / durationMs);
  const winner = teams.find(t => t.id === winnerId);
  const winnerColor = getModelColor(winner.model);

  // --- Edit mode wiring ---
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode') setTweaksOpen(true);
      else if (e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const updateTweak = (key, val) => {
    const next = { ...tweaks, [key]: val };
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
  };

  // --- Render ---
  return (
    <div style={{ minHeight: '100vh', background: '#000408', color: '#c8eef8',
      fontFamily: "'JetBrains Mono', monospace", padding: '20px 24px',
    }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 10, fontWeight: 800, letterSpacing: 5, color: '#00f0ff', textTransform: 'uppercase', marginBottom: 4 }}>
            ◆ Arena4Ai · Prototype
          </div>
          <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 22, fontWeight: 800, color: '#c8eef8', letterSpacing: 1 }}>
            Battle Arena · <span style={{ color: '#00f0ff' }}>TRON Broadcast</span>
          </div>
        </div>
        <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 11, fontWeight: 800, letterSpacing: 3, color: '#4a8fa8', textTransform: 'uppercase' }}>
          {phase === 'active' ? 'LIVE' : phase.toUpperCase()}
        </div>
      </div>

      {/* Lane headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16,
        marginBottom: 12, alignItems: 'center',
      }}>
        <LaneHeader team={teams[0]} color={getModelColor(teams[0].model)} align="left"
          latest={latestActionRef.current.a}/>
        <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 18, fontWeight: 900,
          color: '#1e4a5a', letterSpacing: 4 }}>VS</div>
        <LaneHeader team={teams[1]} color={getModelColor(teams[1].model)} align="right"
          latest={latestActionRef.current.b}/>
      </div>

      {/* Canvas stage */}
      <div ref={containerRef} style={{
        position: 'relative',
        border: '1px solid #0a2235',
        background: '#01060c',
        borderRadius: 8,
        overflow: 'hidden',
        aspectRatio: `${CW}/${CH}`,
        maxWidth: 1400, margin: '0 auto',
      }}>
        <canvas ref={canvasRef} width={CW} height={CH}
          style={{ width: '100%', height: '100%', display: 'block' }}/>
        <PhaseChip phase={phase}/>
        <WinnerBanner winner={winner.model.toUpperCase()} color={winnerColor}
          visible={phase === 'reveal'}/>

        {/* Corner accents */}
        <div style={{ position: 'absolute', top: 8, left: 8, width: 12, height: 12,
          borderTop: '1px solid #00f0ff', borderLeft: '1px solid #00f0ff', opacity: 0.5 }}/>
        <div style={{ position: 'absolute', top: 8, right: 8, width: 12, height: 12,
          borderTop: '1px solid #00f0ff', borderRight: '1px solid #00f0ff', opacity: 0.5 }}/>
        <div style={{ position: 'absolute', bottom: 8, left: 8, width: 12, height: 12,
          borderBottom: '1px solid #00f0ff', borderLeft: '1px solid #00f0ff', opacity: 0.5 }}/>
        <div style={{ position: 'absolute', bottom: 8, right: 8, width: 12, height: 12,
          borderBottom: '1px solid #00f0ff', borderRight: '1px solid #00f0ff', opacity: 0.5 }}/>
      </div>

      {/* HUD — momentum meter */}
      {tweaks.showMomentum && (
        <div style={{ maxWidth: 1400, margin: '14px auto 0' }}>
          <MomentumMeter momentum={momentum}
            teamA={teams[0]} teamB={teams[1]}
            colorA={getModelColor(teams[0].model)}
            colorB={getModelColor(teams[1].model)}/>
        </div>
      )}

      {/* Scrubber */}
      <div style={{ maxWidth: 1400, margin: '12px auto 0',
        display: 'flex', gap: 12, alignItems: 'center',
        padding: '10px 14px',
        border: '1px solid #0a2235', background: '#040c18', borderRadius: 6,
      }}>
        <button onClick={() => setPlaying(!playing)} style={btnStyle(playing)}>
          {playing ? '❚❚ PAUSE' : '▶ PLAY'}
        </button>
        <button onClick={() => { cursorRef.current = 0; setCursorMs(0); lastEventIdxRef.current = 0; shockRef.current.list = []; if (ringRef.current) ringRef.current._confettiFired = false; }}
          style={btnStyle(false)}>⟲ RESTART</button>
        <input type="range" min={0} max={durationMs} value={cursorMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            cursorRef.current = v;
            setCursorMs(v);
            // Re-process events up to new cursor
            lastEventIdxRef.current = stream.eventsUpTo(v).length;
            // Reset confetti so rewinding before reveal re-fires it
            if (ringRef.current) ringRef.current._confettiFired = false;
          }}
          style={{ flex: 1, accentColor: '#00f0ff' }}/>
        <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#00f0ff', minWidth: 80, textAlign: 'right' }}>
          {(cursorMs/1000).toFixed(1)}s
        </div>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
          style={{ ...btnStyle(false), padding: '6px 10px' }}>
          <option value={0.25}>0.25×</option>
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
      </div>

      {/* Tweaks panel */}
      {tweaksOpen && (
        <TweaksPanel tweaks={tweaks} onChange={updateTweak} onClose={() => setTweaksOpen(false)}/>
      )}

      <div style={{ maxWidth: 1400, margin: '20px auto 0', fontSize: 11, color: '#4a8fa8', lineHeight: 1.7 }}>
        ▸ Prototype runs on a synthetic event stream. All motion, particles, and rendering is canvas-based —
        the real arena will use the same renderer shape with live <code>events[]</code> from your backend.
        ▸ Open the <b>Tweaks</b> toggle in the toolbar to adjust stroke/glow/scale/breath live.
      </div>
    </div>
  );
}

function btnStyle(active) {
  return {
    fontFamily: "'Orbitron', monospace",
    fontSize: 10, fontWeight: 800, letterSpacing: 2,
    padding: '6px 12px',
    border: `1px solid ${active ? '#00f0ff' : '#0a2235'}`,
    background: active ? 'rgba(0,240,255,0.1)' : '#01060c',
    color: active ? '#00f0ff' : '#a9d4e3',
    borderRadius: 4, cursor: 'pointer',
    textTransform: 'uppercase',
  };
}

function TweaksPanel({ tweaks, onChange, onClose }) {
  const fields = [
    { key: 'figureScale', label: 'Figure Scale', min: 1.4, max: 3.6, step: 0.1 },
    { key: 'strokeWeight', label: 'Stroke Weight', min: 1.5, max: 4, step: 0.1 },
    { key: 'glowIntensity', label: 'Glow Intensity', min: 0, max: 2, step: 0.1 },
    { key: 'breathAmplitude', label: 'Breath Amplitude', min: 0, max: 8, step: 0.5 },
    { key: 'backgroundDim', label: 'Floor Grid Brightness', min: 0, max: 1, step: 0.05 },
    { key: 'matchDurationSec', label: 'Match Duration (s)', min: 10, max: 60, step: 5 },
  ];
  const bools = [
    { key: 'showMomentum', label: 'Show Momentum Meter' },
    { key: 'ringTicks',    label: 'Ring + Tick Marks' },
  ];
  const cameraOpts = ['focus', 'static'];

  return (
    <div style={{
      position: 'fixed', right: 18, bottom: 18, width: 320,
      padding: '14px 16px',
      border: '1px solid #0a2235', background: '#040c18', borderRadius: 8,
      boxShadow: '0 8px 40px rgba(0,240,255,0.06)',
      fontFamily: "'JetBrains Mono', monospace",
      zIndex: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 11, fontWeight: 800, letterSpacing: 3, color: '#00f0ff', textTransform: 'uppercase' }}>
          ◆ Tweaks
        </div>
        <button onClick={onClose} style={btnStyle(false)}>✕</button>
      </div>

      {fields.map(f => (
        <div key={f.key} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#a9d4e3', letterSpacing: 1, marginBottom: 4 }}>
            <span>{f.label}</span>
            <span style={{ color: '#00f0ff' }}>{tweaks[f.key]}</span>
          </div>
          <input type="range" min={f.min} max={f.max} step={f.step}
            value={tweaks[f.key]}
            onChange={(e) => onChange(f.key, Number(e.target.value))}
            style={{ width: '100%', accentColor: '#00f0ff' }}/>
        </div>
      ))}

      {bools.map(b => (
        <label key={b.key} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#a9d4e3', marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!tweaks[b.key]}
            onChange={(e) => onChange(b.key, e.target.checked)}/>
          {b.label}
        </label>
      ))}

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: '#a9d4e3', letterSpacing: 1, marginBottom: 4 }}>Camera Behavior</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {cameraOpts.map(o => (
            <button key={o}
              onClick={() => onChange('cameraBehavior', o)}
              style={btnStyle(tweaks.cameraBehavior === o)}>{o}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
