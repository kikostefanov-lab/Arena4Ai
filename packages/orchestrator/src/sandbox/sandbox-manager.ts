import { EventEmitter } from 'node:events';
import { createSandbox, type SandboxHandle, type SandboxOptions } from './docker-runtime.js';
import Docker from 'dockerode';

export interface ManagedSandbox {
  teamId: string;
  handle: SandboxHandle;
  createdAt: string;
}

/**
 * SandboxManager owns the lifecycle of all sandbox containers for a
 * single competition.  It ensures containers are always cleaned up,
 * even if the competition aborts.
 *
 * Events:
 *   'sandboxCreated'  (sandbox: ManagedSandbox)
 *   'sandboxDestroyed' (teamId: string)
 *   'error'           (err: Error)
 */
export class SandboxManager extends EventEmitter {
  private readonly sandboxes = new Map<string, ManagedSandbox>();
  private readonly docker: Docker;
  private readonly baseOptions: Omit<SandboxOptions, 'name'>;

  constructor(
    baseOptions: Omit<SandboxOptions, 'name'> = {},
    docker: Docker = new Docker(),
  ) {
    super();
    this.docker = docker;
    this.baseOptions = baseOptions;
  }

  /**
   * Create and register a sandbox for a team.
   * Throws if a sandbox for this teamId already exists.
   */
  async create(teamId: string, overrides: Partial<SandboxOptions> = {}): Promise<ManagedSandbox> {
    if (this.sandboxes.has(teamId)) {
      throw new Error(`Sandbox for team "${teamId}" already exists.`);
    }

    const options: SandboxOptions = {
      ...this.baseOptions,
      ...overrides,
      name: teamId,
    };

    const handle = await createSandbox(options, this.docker);
    const sandbox: ManagedSandbox = {
      teamId,
      handle,
      createdAt: new Date().toISOString(),
    };

    this.sandboxes.set(teamId, sandbox);
    this.emit('sandboxCreated', sandbox);
    return sandbox;
  }

  /** Retrieve an active sandbox by teamId. */
  get(teamId: string): ManagedSandbox | undefined {
    return this.sandboxes.get(teamId);
  }

  /** Destroy the sandbox for a single team. */
  async destroy(teamId: string): Promise<void> {
    const sandbox = this.sandboxes.get(teamId);
    if (!sandbox) return;
    await sandbox.handle.destroy();
    this.sandboxes.delete(teamId);
    this.emit('sandboxDestroyed', teamId);
  }

  /** Destroy all managed sandboxes. Safe to call multiple times. */
  async destroyAll(): Promise<void> {
    const ids = [...this.sandboxes.keys()];
    await Promise.allSettled(ids.map((id) => this.destroy(id)));
  }

  /** Number of active sandboxes. */
  get count(): number {
    return this.sandboxes.size;
  }
}
