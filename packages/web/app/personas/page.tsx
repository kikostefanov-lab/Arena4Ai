'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getModelColor, MONOSPACE_FONT, KICKER_STYLE } from '../../lib/design-tokens';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SavedPersona {
  id: string;
  name: string;
  model: 'claude' | 'codex' | 'gemini';
  description: string;
  systemPrompt: string;
}

const FONT = MONOSPACE_FONT;
const STORAGE_KEY = 'arena4ai:personas';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadPersonas(): SavedPersona[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePersonas(personas: SavedPersona[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(personas));
}

// ─── Empty Form ───────────────────────────────────────────────────────────────

const emptyForm = (): Omit<SavedPersona, 'id'> => ({
  name: '',
  model: 'claude',
  description: '',
  systemPrompt: '',
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function PersonasPage() {
  const router = useRouter();
  const [personas, setPersonas] = useState<SavedPersona[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    setPersonas(loadPersonas());
  }, []);

  const handleSave = () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return;

    let updated: SavedPersona[];
    if (editingId) {
      updated = personas.map((p) =>
        p.id === editingId ? { ...form, id: editingId } : p
      );
    } else {
      const newPersona: SavedPersona = {
        ...form,
        id: `persona-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
      updated = [...personas, newPersona];
    }

    savePersonas(updated);
    setPersonas(updated);
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const handleEdit = (persona: SavedPersona) => {
    setEditingId(persona.id);
    setForm({
      name: persona.name,
      model: persona.model,
      description: persona.description,
      systemPrompt: persona.systemPrompt,
    });
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    const updated = personas.filter((p) => p.id !== id);
    savePersonas(updated);
    setPersonas(updated);
    setDeleteConfirm(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const groupedByModel = {
    claude: personas.filter((p) => p.model === 'claude'),
    codex: personas.filter((p) => p.model === 'codex'),
    gemini: personas.filter((p) => p.model === 'gemini'),
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#000408',
    border: '1px solid #0a2235',
    borderRadius: '6px',
    padding: '0.55rem 0.75rem',
    color: '#c8eef8',
    fontSize: '0.78rem',
    fontFamily: FONT,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.55rem',
    color: '#4a8fa8',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    fontWeight: 700,
    marginBottom: '0.4rem',
  };

  return (
    <div style={{
      minHeight: '100vh',
      fontFamily: FONT,
      color: '#c8eef8',
    }}>
      <style>{`
        input:focus, textarea:focus, select:focus { border-color: #00f0ff !important; outline: none; }
        .persona-card { transition: border-color 0.15s ease, background 0.15s ease; }
        .persona-card:hover { border-color: #0e3050 !important; }
        .action-btn { transition: color 0.15s ease, background 0.15s ease; }
        .model-pill { cursor: pointer; transition: all 0.15s; }
      `}</style>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid #0a2235', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.4rem' }}>
              ◆ Personas
            </div>
            <h1 style={{
              fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.05, margin: 0,
              background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              fontFamily: MONOSPACE_FONT,
            }}>
              Persona Library
            </h1>
            <p style={{ fontSize: '0.72rem', color: '#4a8fa8', marginTop: '0.4rem', lineHeight: 1.5 }}>
              Define custom agent personas with system prompts. Pick them when creating a competition.
            </p>
          </div>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm()); }}
            className="arena-btn arena-btn-primary"
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            + New Persona
          </button>
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div style={{
            marginBottom: '2rem',
            background: '#050f1e',
            border: '1px solid #0e3050',
            borderRadius: '12px',
            padding: '1.5rem',
            animation: 'fadeIn 0.2s ease-out',
          }}>
            <div style={{
              fontSize: '0.6rem', color: '#00f0ff', letterSpacing: '3px',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: '1.25rem',
            }}>
              {editingId ? 'Edit Persona' : 'New Persona'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              {/* Name */}
              <div>
                <label style={labelStyle}>Persona Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. debugger, optimist, tester"
                  style={inputStyle}
                />
              </div>

              {/* Model */}
              <div>
                <label style={labelStyle}>Model</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['claude', 'codex', 'gemini'] as const).map((m) => {
                    const color = getModelColor(m);
                    const active = form.model === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        className="model-pill"
                        onClick={() => setForm((f) => ({ ...f, model: m }))}
                        style={{
                          flex: 1,
                          padding: '0.45rem 0.5rem',
                          border: `1.5px solid ${active ? color : '#0a2235'}`,
                          background: active ? `${color}14` : '#000408',
                          color: active ? color : '#4a8fa8',
                          borderRadius: '6px',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          fontFamily: FONT,
                        }}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Description */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Short summary of this persona's style"
                style={inputStyle}
              />
            </div>

            {/* System Prompt */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>System Prompt *</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                rows={6}
                placeholder={'Describe how this agent should behave.\nE.g. "You are a meticulous debugger. Always check edge cases first. Prefer correctness over speed. Add tests for every function you write."'}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  fontSize: '0.65rem', fontWeight: 600, padding: '0.45rem 0.9rem',
                  background: 'none', color: '#4a8fa8', border: '1px solid #0a2235',
                  borderRadius: '6px', cursor: 'pointer', fontFamily: FONT,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!form.name.trim() || !form.systemPrompt.trim()}
                style={{
                  fontSize: '0.65rem', fontWeight: 700, padding: '0.45rem 1rem',
                  background: form.name.trim() && form.systemPrompt.trim() ? '#00f0ff' : '#0a2235',
                  color: form.name.trim() && form.systemPrompt.trim() ? '#000408' : '#1e4a5a',
                  border: 'none', borderRadius: '6px',
                  cursor: form.name.trim() && form.systemPrompt.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: FONT, letterSpacing: '1px',
                }}
              >
                {editingId ? 'Save Changes' : 'Create Persona'}
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {personas.length === 0 && !showForm && (
          <div style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            background: '#050f1e',
            border: '1px dashed #0a2235',
            borderRadius: '12px',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎭</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#c8eef8', marginBottom: '0.5rem' }}>
              No custom personas yet
            </div>
            <p style={{ fontSize: '0.7rem', color: '#4a8fa8', marginBottom: '1.25rem', maxWidth: '380px', margin: '0 auto 1.25rem' }}>
              Create personas with custom system prompts to control how each AI agent approaches problems.
            </p>
            <button
              onClick={() => setShowForm(true)}
              style={{
                fontSize: '0.65rem', fontWeight: 700, padding: '0.5rem 1.25rem',
                background: '#00f0ff', color: '#000408', border: 'none',
                borderRadius: '6px', cursor: 'pointer', fontFamily: FONT,
                letterSpacing: '1px',
              }}
            >
              + Create your first persona
            </button>
          </div>
        )}

        {/* Personas grouped by model */}
        {(['claude', 'codex', 'gemini'] as const).map((model) => {
          const group = groupedByModel[model];
          if (group.length === 0) return null;
          const color = getModelColor(model);

          return (
            <div key={model} style={{ marginBottom: '2rem' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                marginBottom: '0.85rem',
                paddingBottom: '0.5rem',
                borderBottom: `1px solid ${color}22`,
              }}>
                <span style={{
                  fontSize: '0.55rem', fontWeight: 800, letterSpacing: '2px',
                  textTransform: 'uppercase', color,
                  background: `${color}14`,
                  border: `1px solid ${color}44`,
                  borderRadius: '4px',
                  padding: '0.15rem 0.5rem',
                }}>
                  {model}
                </span>
                <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>
                  {group.length} persona{group.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {group.map((persona) => (
                  <div
                    key={persona.id}
                    className="persona-card"
                    style={{
                      background: '#050f1e',
                      border: '1px solid #0a2235',
                      borderRadius: '10px',
                      padding: '1rem 1.25rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#c8eef8' }}>
                            {persona.name}
                          </span>
                          <span style={{
                            fontSize: '0.5rem', fontWeight: 700, color: '#1e4a5a',
                            fontFamily: 'monospace',
                          }}>
                            {model}:{persona.name}
                          </span>
                        </div>
                        {persona.description && (
                          <p style={{ fontSize: '0.68rem', color: '#4a8fa8', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                            {persona.description}
                          </p>
                        )}
                        <div style={{
                                              border: '1px solid #081520',
                          borderRadius: '6px',
                          padding: '0.5rem 0.75rem',
                          fontSize: '0.65rem',
                          color: '#3d7d94',
                          lineHeight: 1.5,
                          maxHeight: '4.5rem',
                          overflow: 'hidden',
                          position: 'relative',
                        }}>
                          <pre style={{ margin: 0, fontFamily: FONT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {persona.systemPrompt.length > 200
                              ? persona.systemPrompt.slice(0, 200) + '…'
                              : persona.systemPrompt}
                          </pre>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flexShrink: 0 }}>
                        <Link
                          href={`/competitions/new?personaId=${persona.id}`}
                          style={{
                            fontSize: '0.58rem', fontWeight: 700, padding: '0.35rem 0.65rem',
                            background: `${color}14`, color,
                            border: `1px solid ${color}44`,
                            borderRadius: '5px', textDecoration: 'none',
                            letterSpacing: '0.5px', textAlign: 'center',
                            display: 'block', whiteSpace: 'nowrap',
                          }}
                        >
                          Use in Battle
                        </Link>
                        <button
                          className="action-btn"
                          onClick={() => handleEdit(persona)}
                          style={{
                            fontSize: '0.58rem', fontWeight: 600, padding: '0.35rem 0.65rem',
                            background: 'none', color: '#4a8fa8',
                            border: '1px solid #0a2235',
                            borderRadius: '5px', cursor: 'pointer', fontFamily: FONT,
                          }}
                        >
                          Edit
                        </button>
                        {deleteConfirm === persona.id ? (
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              onClick={() => handleDelete(persona.id)}
                              style={{
                                fontSize: '0.55rem', fontWeight: 700, padding: '0.3rem 0.5rem',
                                background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                                border: '1px solid rgba(239,68,68,0.3)',
                                borderRadius: '4px', cursor: 'pointer', fontFamily: FONT,
                              }}
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              style={{
                                fontSize: '0.55rem', padding: '0.3rem 0.5rem',
                                background: 'none', color: '#1e4a5a',
                                border: '1px solid #0a2235',
                                borderRadius: '4px', cursor: 'pointer', fontFamily: FONT,
                              }}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            className="action-btn"
                            onClick={() => setDeleteConfirm(persona.id)}
                            style={{
                              fontSize: '0.58rem', fontWeight: 600, padding: '0.35rem 0.65rem',
                              background: 'none', color: '#1e4a5a',
                              border: '1px solid #0a2235',
                              borderRadius: '5px', cursor: 'pointer', fontFamily: FONT,
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = '#ef4444';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.3)';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = '#1e4a5a';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = '#0a2235';
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Quick tip */}
        {personas.length > 0 && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            background: 'rgba(0,240,255,0.04)',
            border: '1px solid rgba(0,240,255,0.12)',
            borderRadius: '8px',
            fontSize: '0.65rem',
            color: '#3d7d94',
            lineHeight: 1.6,
          }}>
            <strong style={{ color: '#00f0ff' }}>Tip:</strong> Custom personas appear in the Agents step when creating a new competition.
            The persona name is passed as the identifier (e.g. <code style={{ color: '#4a8fa8' }}>claude:debugger</code>).
          </div>
        )}
      </div>
    </div>
  );
}
