'use client';
import { useState, useEffect } from 'react';
import type { Agent, Persona } from '@arena/shared';
import { MONOSPACE_FONT } from '../lib/design-tokens';
import { PersonaForm, type PersonaFormData } from './PersonaForm';

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;
type Provider = typeof PROVIDERS[number];

const MODEL_VARIANTS: Record<Provider, string[]> = {
  claude: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  codex:  ['codex-standard'],
  gemini: ['gemini-2-flash'],
};

interface Props {
  /** If set, pre-fills form (edit mode). Pass forkedFromId to indicate fork mode. */
  editAgent?: Agent | null;
  forkedFromId?: string | null;
  onSaved?: (agent: Agent) => void;
  onCancel?: () => void;
}

export function AgentBuilder({ editAgent, forkedFromId, onSaved, onCancel }: Props) {
  const [personas, setPersonas]               = useState<Persona[]>([]);
  const [selectedPersonaId, setPersonaId]     = useState<string>(editAgent?.personaId ?? '');
  const [provider, setProvider]               = useState<Provider>((editAgent?.provider as Provider) ?? 'claude');
  const [modelVariant, setModelVariant]       = useState<string>(editAgent?.modelVariant ?? 'claude-sonnet-4-6');
  const [name, setName]                       = useState<string>(forkedFromId ? `my-${editAgent?.name ?? ''}` : (editAgent?.name ?? ''));
  const [avatar, setAvatar]                   = useState<string>(editAgent?.persona?.avatar ?? '');
  const [showPersonaForm, setShowPersonaForm] = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState('');

  const isEdit = !!editAgent && !forkedFromId;
  const isFork = !!forkedFromId;

  useEffect(() => { loadPersonas(); }, []);

  async function loadPersonas() {
    try {
      const res = await fetch('/api/personas?retired=false');
      const data = await res.json();
      setPersonas(Array.isArray(data) ? data : []);
    } catch {
      setPersonas([]);
    }
  }

  async function handlePersonaCreated(data: PersonaFormData) {
    const res = await fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? 'Failed to create persona');
    }
    const newPersona: Persona = await res.json() as Persona;
    setPersonas(prev => [newPersona, ...prev]);
    setPersonaId(newPersona.id);
    setShowPersonaForm(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !provider || !modelVariant) {
      setError('Name, provider, and model variant are required'); return;
    }
    setSaving(true);
    setError('');
    try {
      let res: Response;
      if (isFork && editAgent) {
        res = await fetch(`/api/agents/${editAgent.id}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
      } else if (isEdit && editAgent) {
        res = await fetch(`/api/agents/${editAgent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), personaId: selectedPersonaId || null, modelVariant }),
        });
      } else {
        res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            personaId: selectedPersonaId || null,
            provider,
            modelVariant,
          }),
        });
      }
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Save failed');
      }
      const agent: Agent = await res.json() as Agent;
      onSaved?.(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const selectedPersona = personas.find(p => p.id === selectedPersonaId);
  const labelStyle: React.CSSProperties = { fontSize: '0.72rem', color: '#7cc6db', display: 'block', marginBottom: '0.3rem' };
  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'rgba(0,240,255,0.05)',
    border: '1px solid rgba(0,240,255,0.2)', borderRadius: 4,
    color: '#e4f8ff', padding: '0.4rem 0.6rem', fontSize: '0.8rem',
    fontFamily: MONOSPACE_FONT,
    boxSizing: 'border-box',
  };

  const modeLabel = isFork ? '🍴 Save Fork' : isEdit ? 'Update Agent' : 'Save Agent';
  const heading   = isFork ? `Fork: ${editAgent?.name}` : isEdit ? `Edit: ${editAgent?.name}` : 'New Agent';

  return (
    <div style={{ maxWidth: 640 }}>
      <h3 style={{ fontFamily: MONOSPACE_FONT, color: '#00f0ff', marginBottom: '1.5rem', fontSize: '1rem' }}>
        {heading}
      </h3>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* 1. Persona (mind) */}
        <div>
          <label style={labelStyle}>Persona (Mind)</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select value={selectedPersonaId} onChange={e => setPersonaId(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}>
              <option value="">— select a persona —</option>
              {personas.map(p => (
                <option key={p.id} value={p.id}>
                  {p.avatar ?? '🤖'} {p.name}
                  {p.createdBy === 'system' ? ' (system)' : ''}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setShowPersonaForm(v => !v)}
              style={{ fontSize: '0.72rem', padding: '0.4rem 0.75rem', background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', borderRadius: 4, color: '#ffd700', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + New persona
            </button>
          </div>

          {selectedPersona && (
            <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(255,215,0,0.04)', border: '1px solid rgba(255,215,0,0.1)', borderRadius: 4 }}>
              <p style={{ fontSize: '0.68rem', color: '#7cc6db', margin: 0 }}>
                <strong style={{ color: '#ffd700' }}>{selectedPersona.avatar} {selectedPersona.name}</strong>
                {' — '}{selectedPersona.systemPrompt.slice(0, 100)}…
              </p>
            </div>
          )}

          {showPersonaForm && (
            <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'rgba(255,215,0,0.03)', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 6 }}>
              <h4 style={{ fontFamily: MONOSPACE_FONT, color: '#ffd700', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                Create Persona
              </h4>
              <PersonaForm
                compact
                onSave={handlePersonaCreated}
                onCancel={() => setShowPersonaForm(false)}
              />
            </div>
          )}
        </div>

        {/* 2. Provider pills */}
        <div>
          <label style={labelStyle}>Provider (Body)</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {PROVIDERS.map(p => (
              <button
                key={p} type="button"
                onClick={() => { setProvider(p); setModelVariant(MODEL_VARIANTS[p][0]); }}
                style={{
                  padding: '0.35rem 0.9rem', borderRadius: 20, fontSize: '0.75rem', cursor: 'pointer',
                  background: provider === p ? 'rgba(0,240,255,0.15)' : 'rgba(0,240,255,0.04)',
                  border: `1px solid ${provider === p ? '#00f0ff' : 'rgba(0,240,255,0.2)'}`,
                  color: provider === p ? '#00f0ff' : '#7cc6db',
                  textTransform: 'uppercase', letterSpacing: 1,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Model variant */}
        <div>
          <label style={labelStyle}>Model Variant</label>
          <select value={modelVariant} onChange={e => setModelVariant(e.target.value)} style={inputStyle}>
            {MODEL_VARIANTS[provider].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* 4. Name */}
        <div>
          <label style={labelStyle}>Agent Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} required />
        </div>

        {/* 5. Avatar (optional override) */}
        <div>
          <label style={labelStyle}>Avatar override <span style={{ color: '#3d7d94', fontSize: '0.65rem', fontWeight: 400 }}>(optional — defaults to persona&apos;s)</span></label>
          <input value={avatar} onChange={e => setAvatar(e.target.value)} style={{ ...inputStyle, maxWidth: 80 }} maxLength={2} />
        </div>

        {error && <p style={{ color: '#ff4444', fontSize: '0.75rem', margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="submit" disabled={saving} className="arena-btn arena-btn-primary">
            {saving ? 'Saving…' : modeLabel}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="arena-btn">Cancel</button>
          )}
        </div>
      </form>
    </div>
  );
}
