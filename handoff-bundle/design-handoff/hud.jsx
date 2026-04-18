/* global React */
// HUD components — lane headers, momentum meter, winner banner.

(function(){
  const { useMemo } = React;

  function hexToRgb(hex) {
    const s = hex.replace('#','');
    const v = s.length === 3
      ? s.split('').map(c => parseInt(c+c,16))
      : [0,2,4].map(i => parseInt(s.slice(i,i+2),16));
    return { r: v[0], g: v[1], b: v[2] };
  }
  const rgba = (hex, a) => { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; };

  // Lane header chip — shows model + persona + state
  function LaneHeader({ team, color, align, latest }) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        alignItems: align === 'right' ? 'flex-end' : 'flex-start',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 4,
          border: `1px solid ${rgba(color, 0.45)}`,
          background: rgba(color, 0.08),
          fontFamily: "'Orbitron', monospace",
          fontWeight: 800, fontSize: 12, letterSpacing: 2,
          color, textTransform: 'uppercase',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: color, boxShadow: `0 0 10px ${color}`,
          }}/>
          {team.model}{team.persona ? `:${team.persona}` : ''}
        </div>
        <div style={{ color: rgba(color, 0.55), fontSize: 10, letterSpacing: 1.5, minHeight: 14 }}>
          {latest || '—'}
        </div>
      </div>
    );
  }

  // Momentum meter — horizontal bar leaning toward whichever team has more recent activity
  function MomentumMeter({ momentum, teamA, teamB, colorA, colorB }) {
    // momentum in [-1, 1]: -1 = all A, +1 = all B
    const pct = (momentum + 1) / 2 * 100;
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '10px 14px',
        border: '1px solid #0a2235',
        background: '#040c18',
        borderRadius: 6,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: "'Orbitron', monospace", fontSize: 9, fontWeight: 800,
          letterSpacing: 2, textTransform: 'uppercase',
        }}>
          <span style={{ color: colorA }}>◀ {teamA.model}</span>
          <span style={{ color: '#4a8fa8' }}>MOMENTUM · last 10s</span>
          <span style={{ color: colorB }}>{teamB.model} ▶</span>
        </div>
        <div style={{
          position: 'relative', height: 10,
          background: '#01060c', borderRadius: 2,
          border: '1px solid #0a2235', overflow: 'hidden',
        }}>
          {/* A side */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, right: '50%',
            width: `${50 - pct/2 * (momentum < 0 ? 1 : 0) - (momentum < 0 ? Math.abs(momentum) * 50 : 0)}%`,
            display: momentum < 0 ? 'block' : 'none',
          }}/>
          {/* Correct, single bar from center */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: momentum < 0 ? `${50 + momentum * 50}%` : '50%',
            width: `${Math.abs(momentum) * 50}%`,
            background: momentum < 0
              ? `linear-gradient(90deg, ${colorA}, ${rgba(colorA, 0.5)})`
              : `linear-gradient(90deg, ${rgba(colorB, 0.5)}, ${colorB})`,
            boxShadow: `0 0 12px ${momentum < 0 ? colorA : colorB}`,
            transition: 'left 180ms ease, width 180ms ease',
          }}/>
          {/* Center divider */}
          <div style={{
            position: 'absolute', top: -2, bottom: -2, left: '50%',
            width: 1, background: '#4a8fa8', opacity: 0.6,
          }}/>
        </div>
      </div>
    );
  }

  // Winner banner — full-bleed inside canvas area
  function WinnerBanner({ winner, color, visible }) {
    const opacity = visible ? 1 : 0;
    return (
      <div style={{
        position: 'absolute',
        left: '50%', top: '55%',
        transform: 'translate(-50%, -50%)',
        opacity, transition: 'opacity 600ms ease',
        pointerEvents: 'none',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: "'Orbitron', monospace",
          fontSize: 10, fontWeight: 800, letterSpacing: 6,
          color: rgba(color, 0.7), textTransform: 'uppercase', marginBottom: 8,
        }}>◆ VICTOR ◆</div>
        <div style={{
          fontFamily: "'Orbitron', monospace",
          fontSize: 64, fontWeight: 900, letterSpacing: 4,
          color, textTransform: 'uppercase',
          textShadow: `0 0 30px ${color}, 0 0 60px ${rgba(color, 0.6)}`,
          lineHeight: 1,
        }}>{winner}</div>
        <div style={{
          fontFamily: "'Orbitron', monospace",
          fontSize: 11, fontWeight: 800, letterSpacing: 4,
          color: rgba(color, 0.8), textTransform: 'uppercase', marginTop: 10,
        }}>WINS</div>
      </div>
    );
  }

  // Phase chip (freeze / judging)
  function PhaseChip({ phase }) {
    if (phase === 'active') return null;
    const label = phase === 'freeze' ? "TIME'S UP" : phase === 'judging' ? 'JUDGING...' : '';
    if (!label) return null;
    return (
      <div style={{
        position: 'absolute', left: '50%', top: 18,
        transform: 'translateX(-50%)',
        fontFamily: "'Orbitron', monospace",
        fontSize: 11, fontWeight: 800, letterSpacing: 4,
        padding: '6px 14px',
        border: '1px solid rgba(255,102,0,0.4)',
        background: 'rgba(255,102,0,0.08)',
        color: '#ff6600', textTransform: 'uppercase',
        borderRadius: 4,
      }}>{label}</div>
    );
  }

  window.LaneHeader = LaneHeader;
  window.MomentumMeter = MomentumMeter;
  window.WinnerBanner = WinnerBanner;
  window.PhaseChip = PhaseChip;
})();
