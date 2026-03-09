'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  weight: number;
}

const defaultCriteria: RubricCriterion[] = [
  { id: 'correctness', description: 'Solution correctness and completeness', maxScore: 10, weight: 0.5 },
  { id: 'code-quality', description: 'Code quality and maintainability', maxScore: 10, weight: 0.5 },
];

export default function HomePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<'SPRINT' | 'HACKATHON'>('SPRINT');
  const [problem, setProblem] = useState('');
  const [constraints, setConstraints] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [timeLimitMins, setTimeLimitMins] = useState(5);
  const [criteria, setCriteria] = useState<RubricCriterion[]>(defaultCriteria);
  const [teamAModel, setTeamAModel] = useState<'claude' | 'codex' | 'gemini'>('claude');
  const [teamAPersona, setTeamAPersona] = useState('speedrunner');
  const [teamBModel, setTeamBModel] = useState<'claude' | 'codex' | 'gemini'>('claude');
  const [teamBPersona, setTeamBPersona] = useState('architect');
  const [skipSandbox, setSkipSandbox] = useState(true);

  const addCriterion = () => {
    setCriteria([...criteria, { id: '', description: '', maxScore: 10, weight: 0.5 }]);
  };

  const removeCriterion = (idx: number) => {
    setCriteria(criteria.filter((_, i) => i !== idx));
  };

  const updateCriterion = (idx: number, field: keyof RubricCriterion, value: string | number) => {
    setCriteria(criteria.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body = {
        brief: {
          title,
          format,
          problem,
          constraints: constraints.split('\n').map(s => s.trim()).filter(Boolean),
          deliverables: deliverables.split('\n').map(s => s.trim()).filter(Boolean),
          timeLimitMs: timeLimitMins * 60 * 1000,
          rubric: {
            criteria: criteria.map(c => ({
              ...c,
              maxScore: Number(c.maxScore),
              weight: Number(c.weight),
            })),
          },
        },
        teams: [
          { id: 'team-a', model: teamAModel, persona: teamAPersona },
          { id: 'team-b', model: teamBModel, persona: teamBPersona },
        ],
        options: {
          skipSandbox,
          claudeBin: 'claude',
          logDir: '/tmp/arena-logs',
        },
      };

      const res = await fetch('/api/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create competition: ${res.status} ${text}`);
      }

      const data = await res.json();
      router.push(`/competitions/${data.competitionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold mb-2 text-white">New Competition</h1>
      <p className="text-gray-400 mb-8 text-sm">Configure a head-to-head AI agent challenge</p>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2">Brief</h2>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Competition Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
              placeholder="e.g. Fibonacci API Challenge"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Format</label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value as 'SPRINT' | 'HACKATHON')}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-gray-500"
            >
              <option value="SPRINT">SPRINT</option>
              <option value="HACKATHON">HACKATHON</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Problem Statement</label>
            <textarea
              required
              value={problem}
              onChange={e => setProblem(e.target.value)}
              rows={4}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono text-sm"
              placeholder="Describe the problem agents must solve..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Constraints (one per line)</label>
              <textarea
                value={constraints}
                onChange={e => setConstraints(e.target.value)}
                rows={3}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono text-sm"
                placeholder="No external APIs&#10;TypeScript only"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Deliverables (one per line)</label>
              <textarea
                value={deliverables}
                onChange={e => setDeliverables(e.target.value)}
                rows={3}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono text-sm"
                placeholder="Working implementation&#10;README"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Time Limit (minutes)</label>
            <input
              type="number"
              min={1}
              max={120}
              value={timeLimitMins}
              onChange={e => setTimeLimitMins(Number(e.target.value))}
              className="w-32 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-gray-500"
            />
          </div>
        </section>

        {/* Rubric */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2">Rubric</h2>
          <div className="space-y-3">
            {criteria.map((criterion, idx) => (
              <div key={idx} className="bg-gray-900 border border-gray-800 rounded p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">ID</label>
                    <input
                      type="text"
                      required
                      value={criterion.id}
                      onChange={e => updateCriterion(idx, 'id', e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                      placeholder="criterion-id"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Max Score</label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={criterion.maxScore}
                        onChange={e => updateCriterion(idx, 'maxScore', Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Weight</label>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        required
                        value={criterion.weight}
                        onChange={e => updateCriterion(idx, 'weight', Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 items-start">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Description</label>
                    <input
                      type="text"
                      required
                      value={criterion.description}
                      onChange={e => updateCriterion(idx, 'description', e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                      placeholder="What this criterion evaluates"
                    />
                  </div>
                  {criteria.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCriterion(idx)}
                      className="mt-5 text-red-500 hover:text-red-400 text-sm px-2"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCriterion}
            className="text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded px-3 py-1.5 transition-colors"
          >
            + Add Criterion
          </button>
        </section>

        {/* Teams */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2">Teams</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Team A */}
            <div className="bg-gray-900 border border-gray-800 rounded p-4 space-y-3">
              <h3 className="text-sm font-medium text-blue-400">Team A</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <select
                  value={teamAModel}
                  onChange={e => setTeamAModel(e.target.value as 'claude' | 'codex' | 'gemini')}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Persona</label>
                <input
                  type="text"
                  value={teamAPersona}
                  onChange={e => setTeamAPersona(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>
            {/* Team B */}
            <div className="bg-gray-900 border border-gray-800 rounded p-4 space-y-3">
              <h3 className="text-sm font-medium text-purple-400">Team B</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <select
                  value={teamBModel}
                  onChange={e => setTeamBModel(e.target.value as 'claude' | 'codex' | 'gemini')}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Persona</label>
                <input
                  type="text"
                  value={teamBPersona}
                  onChange={e => setTeamBPersona(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Options */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2">Options</h2>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipSandbox}
              onChange={e => setSkipSandbox(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm text-gray-300">Skip sandbox (run agents directly)</span>
          </label>
        </section>

        {error && (
          <div className="bg-red-950 border border-red-800 rounded p-3 text-red-400 text-sm font-mono">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded transition-colors"
        >
          {submitting ? 'Starting Competition...' : 'Start Competition'}
        </button>
      </form>
    </div>
  );
}
