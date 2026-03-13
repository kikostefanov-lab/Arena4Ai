'use client';
import { useState } from 'react';
import {
  MONOSPACE_FONT,
  BODY_FONT,
  TEXT_PRIMARY,
  TEXT_MUTED,
  TEXT_DIM,
  ACCENT_CYAN,
  BG_INPUT,
  BORDER_DIM,
  BORDER_MID,
  FORM_LABEL_STYLE,
} from '../lib/design-tokens';
import type { Persona } from '@arena/shared';

interface PersonaFormProps {
  initial?: Partial<Persona>;
  onSave: (data: {
    name: string;
    description?: string;
    systemPrompt: string;
    avatar?: string;
    tags?: string[];
  }) => Promise<void>;
  onCancel: () => void;
  saveLabel?: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: BG_INPUT,
  border: `1px solid ${BORDER_MID}`,
  borderRadius: '6px',
  padding: '0.55rem 0.75rem',
  color: TEXT_PRIMARY,
  fontFamily: BODY_FONT,
  fontSize: '0.72rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  ...FORM_LABEL_STYLE,
  display: 'block',
  marginBottom: '0.35rem',
};

export function PersonaForm({ initial, onSave, onCancel, saveLabel = 'Save Persona' }: PersonaFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '');
  const [avatar, setAvatar] = useState(initial?.avatar ?? '');
  const [tagsRaw, setTagsRaw] = useState((initial?.tags ?? []).join(', '));

  const [idea, setIdea] = useState('');
  const [generating, setGenerating] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerateFull() {
    if (!idea.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full', idea: idea.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setName(data.name ?? '');
      setDescription(data.description ?? '');
      setSystemPrompt(data.systemPrompt ?? '');
      setAvatar(data.avatar ?? '');
      setTagsRaw((data.tags ?? []).join(', '));
      setIdea('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleExpandPrompt() {
    if (!systemPrompt.trim()) return;
    setExpanding(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'expand', systemPrompt: systemPrompt.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSystemPrompt(data.systemPrompt ?? systemPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Expansion failed');
    } finally {
      setExpanding(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const tags = tagsRaw
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
        avatar: avatar.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

      {/* AI Full Generation */}
      <div style={{
        background: 'rgba(0,240,255,0.04)',
        border: `1px solid ${BORDER_DIM}`,
        borderRadius: '8px',
        padding: '0.85rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
      }}>
        <label style={{ ...FORM_LABEL_STYLE, display: 'block', color: ACCENT_CYAN }}>
          ✨ Generate Full Persona
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={idea}
            onChange={e => setIdea(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleGenerateFull())}
            placeholder="e.g. a ruthless Silicon Valley startup advisor who speaks in metrics"
            style={{ ...inputStyle, flex: 1 }}
            disabled={generating}
          />
          <button
            type="button"
            onClick={handleGenerateFull}
            disabled={generating || !idea.trim()}
            className="arena-btn arena-btn-primary"
            style={{
              fontSize: '0.62rem',
              padding: '0.45rem 0.85rem',
              whiteSpace: 'nowrap',
              opacity: generating || !idea.trim() ? 0.5 : 1,
              cursor: generating || !idea.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {generating ? '⟳ Generating…' : '✨ Generate'}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: '0.60rem', color: TEXT_DIM, fontFamily: BODY_FONT }}>
          Enter an idea and let AI fill all fields below.
        </p>
      </div>

      {/* Divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        color: TEXT_DIM,
        fontSize: '0.58rem',
        fontFamily: MONOSPACE_FONT,
        letterSpacing: '2px',
      }}>
        <div style={{ flex: 1, height: '1px', background: BORDER_DIM }} />
        OR FILL MANUALLY
        <div style={{ flex: 1, height: '1px', background: BORDER_DIM }} />
      </div>

      {/* Name */}
      <div>
        <label style={labelStyle}>Name <span style={{ color: '#ef4444' }}>*</span></label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          placeholder="Persona name"
          style={inputStyle}
        />
      </div>

      {/* Description */}
      <div>
        <label style={labelStyle}>Description</label>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Short description (optional)"
          style={inputStyle}
        />
      </div>

      {/* System Prompt */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            System Prompt <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <button
            type="button"
            onClick={handleExpandPrompt}
            disabled={expanding || !systemPrompt.trim()}
            style={{
              fontSize: '0.58rem',
              color: expanding ? TEXT_DIM : ACCENT_CYAN,
              background: 'none',
              border: 'none',
              cursor: expanding || !systemPrompt.trim() ? 'not-allowed' : 'pointer',
              padding: 0,
              fontFamily: MONOSPACE_FONT,
              opacity: expanding || !systemPrompt.trim() ? 0.5 : 1,
            }}
          >
            {expanding ? '⟳ Expanding…' : '✨ Expand'}
          </button>
        </div>
        <textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          required
          placeholder="You are an expert…"
          rows={6}
          style={{
            ...inputStyle,
            resize: 'vertical',
            lineHeight: 1.6,
          }}
        />
      </div>

      {/* Avatar */}
      <div>
        <label style={labelStyle}>Avatar <span style={{ color: TEXT_DIM, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(emoji)</span></label>
        <input
          type="text"
          value={avatar}
          onChange={e => setAvatar(e.target.value)}
          placeholder="🧠"
          maxLength={4}
          style={{ ...inputStyle, width: '5rem' }}
        />
      </div>

      {/* Tags */}
      <div>
        <label style={labelStyle}>Tags <span style={{ color: TEXT_DIM, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(comma-separated)</span></label>
        <input
          type="text"
          value={tagsRaw}
          onChange={e => setTagsRaw(e.target.value)}
          placeholder="strategy, finance, brutal"
          style={inputStyle}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{
          color: '#ef4444',
          fontSize: '0.62rem',
          fontFamily: BODY_FONT,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: '6px',
          padding: '0.55rem 0.75rem',
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
        <button
          type="button"
          onClick={onCancel}
          className="arena-btn"
          style={{ fontSize: '0.62rem', padding: '0.5rem 1rem' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || !systemPrompt.trim()}
          className="arena-btn arena-btn-orange"
          style={{
            fontSize: '0.62rem',
            padding: '0.5rem 1.2rem',
            opacity: saving || !name.trim() || !systemPrompt.trim() ? 0.5 : 1,
            cursor: saving || !name.trim() || !systemPrompt.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '⟳ Saving…' : saveLabel}
        </button>
      </div>
    </form>
  );
}
