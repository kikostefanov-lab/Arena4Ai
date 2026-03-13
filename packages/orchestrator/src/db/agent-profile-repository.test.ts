import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { AgentProfileRepository } from './agent-profile-repository.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('AgentProfileRepository', () => {
  let pool: InstanceType<typeof Pool>;
  let repo: AgentProfileRepository;

  beforeEach(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const db = drizzle(pool);
    repo = new AgentProfileRepository(db);
  });

  afterEach(async () => {
    await pool.query("DELETE FROM agent_profiles WHERE created_by = 'test'");
    await pool.end();
  });

  it('creates and retrieves a profile', async () => {
    await repo.create({
      id: 'test-profile-1',
      name: 'Test Agent',
      provider: 'claude',
      modelVariant: 'claude-sonnet-4-6',
      systemPrompt: 'You are a test agent.',
      createdBy: 'test',
    });
    const profile = await repo.get('test-profile-1');
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe('Test Agent');
    expect(profile!.retired).toBe(false);
    expect(profile!.statsWins).toBe(0);
  });

  it('lists profiles with provider filter', async () => {
    await repo.create({ id: 'test-claude-1', name: 'Claude Agent', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
    await repo.create({ id: 'test-codex-1', name: 'Codex Agent', provider: 'codex', modelVariant: 'codex-standard', systemPrompt: 'test', createdBy: 'test' });
    const claudeProfiles = await repo.list({ provider: 'claude', retired: false });
    const ids = claudeProfiles.map(p => p.id);
    expect(ids).toContain('test-claude-1');
    expect(ids).not.toContain('test-codex-1');
  });

  it('updates profile fields', async () => {
    await repo.create({ id: 'test-profile-2', name: 'Before', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'before', createdBy: 'test' });
    const updated = await repo.update('test-profile-2', { name: 'After', avatar: '🧪' });
    expect(updated!.name).toBe('After');
    expect(updated!.avatar).toBe('🧪');
  });

  it('retires a profile (soft delete)', async () => {
    await repo.create({ id: 'test-profile-3', name: 'To Retire', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
    const ok = await repo.retire('test-profile-3');
    expect(ok).toBe(true);
    const profile = await repo.get('test-profile-3');
    expect(profile!.retired).toBe(true);
  });

  it('forks a profile', async () => {
    await repo.create({ id: 'test-profile-4', name: 'Original', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'original prompt', createdBy: 'test' });
    const fork = await repo.fork('test-profile-4', 'My Fork', 'test');
    expect(fork.name).toBe('My Fork');
    expect(fork.forkedFromId).toBe('test-profile-4');
    expect(fork.systemPrompt).toBe('original prompt');
    expect(fork.createdBy).toBe('test');
    await pool.query("DELETE FROM agent_profiles WHERE id = $1", [fork.id]);
  });

  it('updates stats correctly (win)', async () => {
    await repo.create({ id: 'test-profile-5', name: 'Stats Agent', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
    await repo.updateStats('test-profile-5', true, 0.85);
    const profile = await repo.get('test-profile-5');
    expect(profile!.statsWins).toBe(1);
    expect(profile!.statsLosses).toBe(0);
    expect(profile!.statsTotal).toBe(1);
    expect(Number(profile!.statsAvgScore)).toBeCloseTo(0.85, 2);
  });

  it('updates stats correctly (loss)', async () => {
    await repo.create({ id: 'test-profile-6', name: 'Stats Agent 2', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
    await repo.updateStats('test-profile-6', true, 0.9);
    await repo.updateStats('test-profile-6', false, 0.4);
    const profile = await repo.get('test-profile-6');
    expect(profile!.statsWins).toBe(1);
    expect(profile!.statsLosses).toBe(1);
    expect(profile!.statsTotal).toBe(2);
    expect(Number(profile!.statsAvgScore)).toBeCloseTo(0.65, 2);
  });

  it('getByProviderAndName returns profile', async () => {
    await repo.create({ id: 'test-profile-7', name: 'architect', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
    const found = await repo.getByProviderAndName('claude', 'architect');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('test-profile-7');
  });

  it('returns null for non-existent profile', async () => {
    const profile = await repo.get('does-not-exist');
    expect(profile).toBeNull();
  });

  it('lists profiles by tags filter', async () => {
    await repo.create({ id: 'test-tagged-1', name: 'Tagged Agent', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', tags: ['security', 'testing'], createdBy: 'test' });
    const tagged = await repo.list({ tags: ['security'] });
    const ids = tagged.map(p => p.id);
    expect(ids).toContain('test-tagged-1');
  });
});
