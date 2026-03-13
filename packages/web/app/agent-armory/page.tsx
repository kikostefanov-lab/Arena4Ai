'use client';
import { useState, useEffect } from 'react';
import {
  MONOSPACE_FONT, BODY_FONT, KICKER_STYLE,
  getModelColor,
} from '../../lib/design-tokens';
import type { Agent, Persona } from '@arena/shared';
import { AgentCard } from '../../components/AgentCard';
import { PersonaCard } from '../../components/PersonaCard';
import { AgentBuilder } from '../../components/AgentBuilder';
import { PersonaForm } from '../../components/PersonaForm';
import type { PersonaFormData } from '../../components/PersonaForm';

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;
type Tab = 'roster' | 'personas' | 'builder';

const TABS = [
  { id: 'roster',   label: '⚙ Agent Roster' },
  { id: 'personas', label: '🧠 Personas' },
  { id: 'builder',  label: '🔨 Agent Builder' },
] as const;

export default function AgentArmoryPage() {
  const [activeTab, setActiveTab]               = useState<Tab>('roster');
  const [agents, setAgents]                     = useState<Agent[]>([]);
  const [retiredAgents, setRetiredAgents]       = useState<Agent[]>([]);
  const [personas, setPersonas]                 = useState<Persona[]>([]);
  const [retiredPersonas, setRetiredPersonas]   = useState<Persona[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [providerFilter, setProviderFilter]     = useState('all');
  const [search, setSearch]                     = useState('');
  const [builderAgent, setBuilderAgent]         = useState<Agent | null>(null);
  const [builderForkId, setBuilderForkId]       = useState<string | null>(null);
  const [editPersona, setEditPersona]           = useState<Persona | null>(null);
  const [showNewPersonaForm, setShowNewPersonaForm] = useState(false);
  const [personaError, setPersonaError]         = useState('');

  useEffect(() => {
    void Promise.all([loadAgents(), loadPersonas()]).finally(() => setLoading(false));
  }, []);

  async function loadAgents() {
    try {
      const [activeRes, retiredRes] = await Promise.all([
        fetch('/api/agents?retired=false'),
        fetch('/api/agents?retired=true'),
      ]);
      const active = await activeRes.json() as { agents?: Agent[] };
      const retired = await retiredRes.json() as { agents?: Agent[] };
      setAgents(active.agents ?? []);
      setRetiredAgents(retired.agents ?? []);
    } catch {
      setAgents([]);
      setRetiredAgents([]);
    }
  }

  async function loadPersonas() {
    try {
      const [activeRes, retiredRes] = await Promise.all([
        fetch('/api/personas?retired=false'),
        fetch('/api/personas?retired=true'),
      ]);
      const active = await activeRes.json() as Persona[];
      const retired = await retiredRes.json() as Persona[];
      setPersonas(Array.isArray(active) ? active : []);
      setRetiredPersonas(Array.isArray(retired) ? retired : []);
    } catch {
      setPersonas([]);
      setRetiredPersonas([]);
    }
  }

  async function handleRetireAgent(id: string) {
    try {
      await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      await loadAgents();
    } catch {}
  }

  async function handleRetirePersona(id: string) {
    setPersonaError('');
    try {
      const res = await fetch(`/api/personas/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setPersonaError(data.error ?? 'Failed to retire persona');
        return;
      }
      await loadPersonas();
    } catch {
      setPersonaError('Failed to retire persona');
    }
  }

  async function handleSavePersona(data: PersonaFormData) {
    if (editPersona) {
      const res = await fetch(`/api/personas/${editPersona.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Update failed');
      }
    } else {
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Create failed');
      }
    }
    setEditPersona(null);
    setShowNewPersonaForm(false);
    await loadPersonas();
  }

  function openEdit(agent: Agent) {
    setBuilderAgent(agent);
    setBuilderForkId(null);
    setActiveTab('builder');
  }

  function openFork(agent: Agent) {
    setBuilderAgent(agent);
    setBuilderForkId(agent.id);
    setActiveTab('builder');
  }

  function openNew() {
    setBuilderAgent(null);
    setBuilderForkId(null);
    setActiveTab('builder');
  }

  const filteredAgents = agents.filter(a => {
    if (providerFilter !== 'all' && a.provider !== providerFilter) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const systemAgents = filteredAgents.filter(a => a.createdBy === 'system');
  const userAgents   = filteredAgents.filter(a => a.createdBy !== 'system');

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
          Manage personas (minds) and agents (provider+persona combos). Track battle records.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,240,255,0.15)', marginBottom: '1.5rem' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              // Clicking Builder tab manually always resets to "New Agent" mode
              if (tab.id === 'builder') {
                setBuilderAgent(null);
                setBuilderForkId(null);
              }
              setActiveTab(tab.id as Tab);
            }}
            style={{
              padding: '0.6rem 1.4rem',
              background: 'none',
              cursor: 'pointer',
              fontSize: '0.75rem',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab.id ? '#00f0ff' : 'transparent',
              color: activeTab === tab.id ? '#00f0ff' : '#3d7d94',
              fontFamily: MONOSPACE_FONT,
              letterSpacing: 1,
            }}
          >
            {tab.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── ROSTER TAB ── */}
      {activeTab === 'roster' && (
        <>
          {/* Controls */}
          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
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
            <button
              onClick={openNew}
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

          {loading && (
            <div style={{ textAlign: 'center', padding: '4rem 0', color: '#3d7d94', fontFamily: MONOSPACE_FONT, fontSize: '0.72rem' }}>
              Loading agents…
            </div>
          )}

          {!loading && systemAgents.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.75rem', color: '#3d7d94', margin: '0 0 1rem', letterSpacing: '1px' }}>
                SYSTEM AGENTS
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
                {systemAgents.map(a => (
                  <AgentCard key={a.id} agent={a} onEdit={openEdit} onFork={openFork} onRetire={handleRetireAgent} />
                ))}
              </div>
            </div>
          )}

          {!loading && userAgents.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.75rem', color: '#3d7d94', margin: '0 0 1rem', letterSpacing: '1px' }}>
                YOUR AGENTS
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
                {userAgents.map(a => (
                  <AgentCard key={a.id} agent={a} onEdit={openEdit} onFork={openFork} onRetire={handleRetireAgent} />
                ))}
              </div>
            </div>
          )}

          {!loading && filteredAgents.length === 0 && (
            <div style={{ textAlign: 'center', padding: '4rem 0', color: '#3d7d94', fontFamily: MONOSPACE_FONT, fontSize: '0.72rem' }}>
              {search || providerFilter !== 'all' ? 'No agents match your filters.' : 'No agents yet. Create your first agent in the Builder tab.'}
            </div>
          )}

          {retiredAgents.length > 0 && (
            <details style={{ marginTop: '2rem' }}>
              <summary style={{ fontSize: '0.65rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, cursor: 'pointer', userSelect: 'none' }}>
                {retiredAgents.length} retired agent{retiredAgents.length > 1 ? 's' : ''}
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem', marginTop: '1rem', opacity: 0.5 }}>
                {retiredAgents.map(a => (
                  <AgentCard key={a.id} agent={a} onEdit={openEdit} onFork={openFork} onRetire={handleRetireAgent} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {/* ── PERSONAS TAB ── */}
      {activeTab === 'personas' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
            <button
              onClick={() => { setEditPersona(null); setShowNewPersonaForm(true); }}
              style={{
                fontSize: '0.65rem', fontFamily: MONOSPACE_FONT, fontWeight: 800,
                padding: '0.35rem 1rem', borderRadius: '6px', cursor: 'pointer',
                background: 'rgba(255,215,0,0.1)', color: '#ffd700',
                border: '1px solid rgba(255,215,0,0.3)', letterSpacing: '0.5px',
              }}
            >
              + New Persona
            </button>
          </div>

          {personaError && (
            <div style={{ color: '#ef4444', fontSize: '0.65rem', fontFamily: BODY_FONT, marginBottom: '1rem',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', padding: '0.5rem 0.75rem' }}>
              {personaError}
            </div>
          )}

          {/* New persona form */}
          {(showNewPersonaForm || editPersona) && (
            <div style={{
              background: 'rgba(0,4,8,0.85)', border: '1px solid rgba(255,215,0,0.2)',
              borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem',
            }}>
              <h3 style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.85rem', color: '#ffd700', margin: '0 0 1rem' }}>
                {editPersona ? `Edit: ${editPersona.name}` : 'New Persona'}
              </h3>
              <PersonaForm
                initial={editPersona ?? undefined}
                onSave={handleSavePersona}
                onCancel={() => { setEditPersona(null); setShowNewPersonaForm(false); setPersonaError(''); }}
                saveLabel={editPersona ? 'Update Persona' : 'Create Persona'}
              />
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem 0', color: '#3d7d94', fontFamily: MONOSPACE_FONT, fontSize: '0.72rem' }}>
              Loading personas…
            </div>
          ) : (
            <>
              {personas.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
                    {personas.map(p => (
                      <PersonaCard
                        key={p.id}
                        persona={p}
                        onEdit={persona => { setEditPersona(persona); setShowNewPersonaForm(false); }}
                        onRetire={handleRetirePersona}
                      />
                    ))}
                  </div>
                </div>
              )}

              {personas.length === 0 && !showNewPersonaForm && (
                <div style={{ textAlign: 'center', padding: '4rem 0', color: '#3d7d94', fontFamily: MONOSPACE_FONT, fontSize: '0.72rem' }}>
                  No personas yet. Create your first persona above.
                </div>
              )}

              {retiredPersonas.length > 0 && (
                <details style={{ marginTop: '2rem' }}>
                  <summary style={{ fontSize: '0.65rem', color: '#3d7d94', fontFamily: MONOSPACE_FONT, cursor: 'pointer', userSelect: 'none' }}>
                    {retiredPersonas.length} retired persona{retiredPersonas.length > 1 ? 's' : ''}
                  </summary>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem', marginTop: '1rem', opacity: 0.5 }}>
                    {retiredPersonas.map(p => (
                      <PersonaCard key={p.id} persona={p} onEdit={() => {}} onRetire={() => {}} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}

      {/* ── BUILDER TAB ── */}
      {activeTab === 'builder' && (
        <div style={{
          background: 'rgba(0,4,8,0.85)', border: '1px solid rgba(0,240,255,0.15)',
          borderRadius: '10px', padding: '1.5rem',
        }}>
          <AgentBuilder
            personas={personas}
            onPersonaCreated={newPersona => {
              setPersonas(prev => [newPersona, ...prev]);
            }}
            editAgent={builderAgent}
            forkedFromId={builderForkId}
            onSaved={async () => {
              await loadAgents();
              setBuilderAgent(null);
              setBuilderForkId(null);
              setActiveTab('roster');
            }}
            onCancel={() => {
              setBuilderAgent(null);
              setBuilderForkId(null);
              setActiveTab('roster');
            }}
          />
        </div>
      )}
    </div>
  );
}
