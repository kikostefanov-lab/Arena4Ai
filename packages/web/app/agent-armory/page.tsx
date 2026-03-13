'use client';
import { useState, useEffect } from 'react';
import {
  MONOSPACE_FONT, BODY_FONT, KICKER_STYLE,
  MODEL_BADGE_COLORS, getModelColor,
} from '../../lib/design-tokens';
import type { AgentProfile } from '@arena/shared';
import { AgentCard } from '../../components/AgentCard';
import { EmojiPicker } from '../../components/EmojiPicker';

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;
type Provider = typeof PROVIDERS[number];

const MODEL_VARIANTS: Record<Provider, string[]> = {
  claude: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  codex: ['codex-standard'],
  gemini: ['gemini-2-flash', 'gemini-2-pro'],
};

const LS_KEY = 'arena4ai:personas';

interface LsPersona {
  id: string;
  name: string;
  model: string;
  description?: string;
  systemPrompt?: string;
}

export default function AgentArmoryPage() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [retiredProfiles, setRetiredProfiles] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editProfile, setEditProfile] = useState<AgentProfile | null>(null);
  const [migrationCount, setMigrationCount] = useState(0);
  const [migrating, setMigrating] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formProvider, setFormProvider] = useState<Provider>('claude');
  const [formModelVariant, setFormModelVariant] = useState('claude-sonnet-4-6');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAvatar, setFormAvatar] = useState('🤖');
  const [formTags, setFormTags] = useState('');
  const [formError, setFormError] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    loadProfiles();
    checkMigration();
  }, []);

  async function loadProfiles() {
    setLoading(true);
    try {
      const [activeRes, retiredRes] = await Promise.all([
        fetch('/api/agent-profiles?retired=false'),
        fetch('/api/agent-profiles?retired=true'),
      ]);
      const active: AgentProfile[] = await activeRes.json();
      const retired: AgentProfile[] = await retiredRes.json();
      setProfiles(Array.isArray(active) ? active : []);
      setRetiredProfiles(Array.isArray(retired) ? retired : []);
    } catch {
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }

  function checkMigration() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed: LsPersona[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMigrationCount(parsed.length);
      }
    } catch {}
  }

  async function handleMigrate() {
    setMigrating(true);
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const personas: LsPersona[] = JSON.parse(raw);
      for (const p of personas) {
        const [provider] = p.model.split(':');
        await fetch('/api/agent-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: p.name,
            provider: provider || 'claude',
            modelVariant: p.model || 'claude-sonnet-4-6',
            systemPrompt: p.systemPrompt || '',
            description: p.description,
            createdBy: 'user',
          }),
        });
      }
      localStorage.removeItem(LS_KEY);
      setMigrationCount(0);
      await loadProfiles();
    } catch (e) {
      console.error('Migration failed', e);
    } finally {
      setMigrating(false);
    }
  }

  function resetForm() {
    setFormName('');
    setFormProvider('claude');
    setFormModelVariant('claude-sonnet-4-6');
    setFormSystemPrompt('');
    setFormDescription('');
    setFormAvatar('🤖');
    setFormTags('');
    setFormError('');
    setShowEmojiPicker(false);
    setEditProfile(null);
    setShowForm(false);
  }

  function openEditForm(profile: AgentProfile) {
    setEditProfile(profile);
    setFormName(profile.name);
    setFormProvider(profile.provider as Provider);
    setFormModelVariant(profile.modelVariant);
    setFormSystemPrompt(profile.systemPrompt);
    setFormDescription(profile.description ?? '');
    setFormAvatar(profile.avatar ?? '🤖');
    setFormTags(profile.tags?.join(', ') ?? '');
    setFormError('');
    setShowEmojiPicker(false);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!formName.trim() || !formSystemPrompt.trim()) {
      setFormError('Name and system prompt are required');
      return;
    }
    const tags = formTags.split(',').map(t => t.trim()).filter(Boolean);
    const payload = {
      name: formName.trim(),
      provider: formProvider,
      modelVariant: formModelVariant,
      systemPrompt: formSystemPrompt.trim(),
      description: formDescription.trim() || undefined,
      avatar: formAvatar,
      tags: tags.length ? tags : undefined,
    };
    try {
      if (editProfile) {
        const res = await fetch(`/api/agent-profiles/${editProfile.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Update failed');
      } else {
        const res = await fetch('/api/agent-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Create failed');
      }
      resetForm();
      await loadProfiles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  async function handleFork(profile: AgentProfile) {
    const name = window.prompt(`Fork name (forking "${profile.name}"):`);
    if (!name?.trim()) return;
    try {
      await fetch(`/api/agent-profiles/${profile.id}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      await loadProfiles();
    } catch {}
  }

  async function handleRetire(profile: AgentProfile) {
    if (!confirm(`Retire "${profile.name}"? It will be hidden from the Armory.`)) return;
    try {
      await fetch(`/api/agent-profiles/${profile.id}`, { method: 'DELETE' });
      await loadProfiles();
    } catch {}
  }

  const filtered = profiles.filter(p => {
    if (providerFilter !== 'all' && p.provider !== providerFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const systemProfiles = filtered.filter(p => p.createdBy === 'system');
  const userProfiles = filtered.filter(p => p.createdBy !== 'system');

  return (
    <div style={{ minHeight: '100vh', padding: '6rem 1.5rem 4rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Hero */}
      <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
        <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.6rem' }}>◆ AGENT ARMORY</div>
        <h1 style={{
          fontFamily: MONOSPACE_FONT,
          fontSize: '1.8rem',
          fontWeight: 900,
          background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          margin: '0 0 0.6rem',
          lineHeight: 1.2,
        }}>
          Your Agent Roster
        </h1>
        <p style={{ fontSize: '0.72rem', color: '#4a8fa8', fontFamily: BODY_FONT, margin: 0 }}>
          Build, fork, and manage AI agent personas. Track their battle records.
        </p>
      </div>

      {/* Migration banner */}
      {migrationCount > 0 && (
        <div style={{
          background: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.3)',
          borderRadius: '8px',
          padding: '0.8rem 1.1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}>
          <span style={{ fontSize: '0.72rem', color: '#eab308', fontFamily: BODY_FONT }}>
            📦 You have {migrationCount} saved persona{migrationCount > 1 ? 's' : ''} from the old system. Migrate them to the Armory?
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button
              onClick={handleMigrate}
              disabled={migrating}
              style={{
                fontSize: '0.62rem', fontFamily: MONOSPACE_FONT, fontWeight: 800,
                padding: '0.3rem 0.8rem', borderRadius: '4px',
                background: 'rgba(234,179,8,0.15)', color: '#eab308',
                border: '1px solid rgba(234,179,8,0.4)', cursor: 'pointer',
              }}
            >
              {migrating ? 'Migrating…' : 'Migrate'}
            </button>
            <button
              onClick={() => setMigrationCount(0)}
              style={{
                fontSize: '0.62rem', fontFamily: MONOSPACE_FONT, color: '#4a8fa8',
                background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {/* Provider filter */}
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {(['all', ...PROVIDERS] as string[]).map(p => (
            <button
              key={p}
              onClick={() => setProviderFilter(p)}
              style={{
                fontSize: '0.62rem', fontFamily: MONOSPACE_FONT, fontWeight: 800,
                padding: '0.3rem 0.7rem', borderRadius: '4px', cursor: 'pointer',
                border: `1px solid ${providerFilter === p ? (p === 'all' ? '#00f0ff' : getModelColor(p)) : 'rgba(0,240,255,0.15)'}`,
                background: providerFilter === p ? (p === 'all' ? 'rgba(0,240,255,0.1)' : `${getModelColor(p)}18`) : 'transparent',
                color: providerFilter === p ? (p === 'all' ? '#00f0ff' : getModelColor(p)) : '#3d7d94',
                textTransform: 'capitalize',
              }}
            >
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
        {/* Search */}
        <input
          type="text"
          placeholder="Search agents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: '160px', maxWidth: '280px',
            background: 'rgba(0,4,8,0.6)', border: '1px solid rgba(0,240,255,0.12)',
            borderRadius: '6px', padding: '0.35rem 0.7rem',
            color: '#c8eef8', fontSize: '0.65rem', fontFamily: BODY_FONT, outline: 'none',
          }}
        />
        {/* New Agent CTA */}
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          style={{
            marginLeft: 'auto', fontSize: '0.65rem', fontFamily: MONOSPACE_FONT, fontWeight: 800,
            padding: '0.35rem 1rem', borderRadius: '6px', cursor: 'pointer',
            background: 'rgba(0,240,255,0.1)', color: '#00f0ff',
            border: '1px solid rgba(0,240,255,0.3)', letterSpacing: '0.5px',
          }}
        >
          + New Agent
        </button>
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <div style={{
          background: 'rgba(0,4,8,0.85)', border: '1px solid rgba(0,240,255,0.2)',
          borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h3 style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.85rem', color: '#00f0ff', margin: '0 0 1rem' }}>
            {editProfile ? `Edit: ${editProfile.name}` : 'New Agent'}
          </h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, display: 'block', marginBottom: '0.3rem' }}>NAME *</span>
              <input
                className="arena-input"
                value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="e.g. my-architect"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.65rem' }}
              />
            </label>
            <label>
              <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, display: 'block', marginBottom: '0.3rem' }}>PROVIDER *</span>
              <select
                className="arena-input"
                value={formProvider}
                onChange={e => {
                  const p = e.target.value as Provider;
                  setFormProvider(p);
                  setFormModelVariant(MODEL_VARIANTS[p][0]);
                }}
                style={{ width: '100%', fontSize: '0.65rem' }}
              >
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, display: 'block', marginBottom: '0.3rem' }}>MODEL VARIANT *</span>
              <select
                className="arena-input"
                value={formModelVariant}
                onChange={e => setFormModelVariant(e.target.value)}
                style={{ width: '100%', fontSize: '0.65rem' }}
              >
                {MODEL_VARIANTS[formProvider].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, display: 'block', marginBottom: '0.3rem' }}>SYSTEM PROMPT *</span>
              <textarea
                className="arena-input"
                value={formSystemPrompt} onChange={e => setFormSystemPrompt(e.target.value)}
                placeholder="You are..."
                rows={4}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.65rem', resize: 'vertical' }}
              />
            </label>
            <label>
              <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, display: 'block', marginBottom: '0.3rem' }}>DESCRIPTION</span>
              <input
                className="arena-input"
                value={formDescription} onChange={e => setFormDescription(e.target.value)}
                placeholder="One-line description"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.65rem' }}
              />
            </label>
            <label>
              <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, display: 'block', marginBottom: '0.3rem' }}>TAGS (comma-separated)</span>
              <input
                className="arena-input"
                value={formTags} onChange={e => setFormTags(e.target.value)}
                placeholder="fast, thorough, security"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.65rem' }}
              />
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, display: 'block', marginBottom: '0.3rem' }}>AVATAR</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(v => !v)}
                  style={{
                    fontSize: '1.5rem', width: '3rem', height: '3rem',
                    borderRadius: '50%', background: `${getModelColor(formProvider)}22`,
                    border: `1.5px solid ${getModelColor(formProvider)}66`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {formAvatar}
                </button>
                <span style={{ fontSize: '0.58rem', color: '#3d7d94', fontFamily: BODY_FONT }}>Click to change</span>
              </div>
              {showEmojiPicker && (
                <div style={{ marginTop: '0.5rem' }}>
                  <EmojiPicker value={formAvatar} provider={formProvider} onChange={e => { setFormAvatar(e); setShowEmojiPicker(false); }} />
                </div>
              )}
            </div>
            {formError && (
              <div style={{ gridColumn: '1 / -1', color: '#ef4444', fontSize: '0.62rem', fontFamily: BODY_FONT }}>{formError}</div>
            )}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={resetForm} style={{
                fontSize: '0.62rem', fontFamily: MONOSPACE_FONT, padding: '0.35rem 0.8rem',
                background: 'none', border: '1px solid rgba(0,240,255,0.15)', borderRadius: '4px',
                color: '#3d7d94', cursor: 'pointer',
              }}>Cancel</button>
              <button type="submit" style={{
                fontSize: '0.62rem', fontFamily: MONOSPACE_FONT, fontWeight: 800,
                padding: '0.35rem 0.8rem', background: 'rgba(0,240,255,0.1)', color: '#00f0ff',
                border: '1px solid rgba(0,240,255,0.3)', borderRadius: '4px', cursor: 'pointer',
              }}>{editProfile ? 'Save Changes' : 'Create Agent'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#3d7d94', fontFamily: MONOSPACE_FONT, fontSize: '0.72rem' }}>
          Loading agents…
        </div>
      )}

      {/* System agents section */}
      {!loading && systemProfiles.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.75rem', color: '#3d7d94', margin: '0 0 1rem', letterSpacing: '1px' }}>
            SYSTEM AGENTS
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
            {systemProfiles.map(p => (
              <AgentCard key={p.id} profile={p} onFork={handleFork} />
            ))}
          </div>
        </div>
      )}

      {/* User agents section */}
      {!loading && userProfiles.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.75rem', color: '#3d7d94', margin: '0 0 1rem', letterSpacing: '1px' }}>
            YOUR AGENTS
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
            {userProfiles.map(p => (
              <AgentCard key={p.id} profile={p} onEdit={openEditForm} onFork={handleFork} onRetire={handleRetire} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#3d7d94', fontFamily: MONOSPACE_FONT, fontSize: '0.72rem' }}>
          {search || providerFilter !== 'all' ? 'No agents match your filters.' : 'No agents yet. Create your first agent above.'}
        </div>
      )}

      {/* Retired agents */}
      {retiredProfiles.length > 0 && (
        <details style={{ marginTop: '2rem' }}>
          <summary style={{ fontSize: '0.65rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, cursor: 'pointer', userSelect: 'none' }}>
            {retiredProfiles.length} retired agent{retiredProfiles.length > 1 ? 's' : ''}
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem', marginTop: '1rem', opacity: 0.5 }}>
            {retiredProfiles.map(p => (
              <AgentCard key={p.id} profile={p} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
