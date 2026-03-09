import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const AGENT_IMAGE = process.env.ARENA_AGENT_IMAGE ?? 'arena-agent:latest';

/**
 * SandboxManager provides Docker-based isolation for agent processes.
 *
 * Each team gets one container's worth of isolation — the agent CLI runs
 * inside `arena-agent:latest` with the team workdir bind-mounted at /workspace.
 *
 * Events still flow back via stdout piping (same as no-sandbox mode).
 */
export class SandboxManager {
  private readonly containerNames = new Map<string, string>();

  /**
   * Verify the agent image is available locally.
   * Throws a helpful error if not built yet.
   */
  async verify(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', ['image', 'inspect', AGENT_IMAGE], { stdio: 'ignore' });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(
          `arena-agent image not found. Build it first:\n  docker build -f Dockerfile.agent -t ${AGENT_IMAGE} .`
        ));
      });
    });
  }

  /**
   * Spawn an agent CLI inside a Docker container.
   * Returns the ChildProcess (stdout/stderr still piped — identical to direct spawn).
   */
  spawnInContainer(
    teamId: string,
    workdir: string,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ): ChildProcess {
    const containerName = `arena-${teamId}-${Date.now()}`;
    this.containerNames.set(teamId, containerName);

    const dockerArgs = [
      'run',
      '--rm',
      '--name', containerName,
      '-v', `${workdir}:/workspace`,
      '-w', '/workspace',
      '--network', 'host',
      '--memory', '2g',
      '--cpus', '1',
      ...Object.entries(env).flatMap(([k, v]) => v !== undefined ? ['-e', `${k}=${v}`] : []),
      AGENT_IMAGE,
      command,
      ...args,
    ];

    const child = spawn('docker', dockerArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.on('close', () => this.containerNames.delete(teamId));
    return child;
  }

  async killContainer(teamId: string): Promise<void> {
    const name = this.containerNames.get(teamId);
    if (!name) return;
    await new Promise<void>((resolve) => {
      const proc = spawn('docker', ['kill', name], { stdio: 'ignore' });
      proc.on('close', () => resolve());
      proc.on('error', () => resolve()); // don't throw if docker not running
    });
  }

  async pauseContainer(teamId: string): Promise<void> {
    const name = this.containerNames.get(teamId);
    if (!name) return;
    await new Promise<void>((resolve) => {
      const proc = spawn('docker', ['pause', name], { stdio: 'ignore' });
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
  }

  async resumeContainer(teamId: string): Promise<void> {
    const name = this.containerNames.get(teamId);
    if (!name) return;
    await new Promise<void>((resolve) => {
      const proc = spawn('docker', ['unpause', name], { stdio: 'ignore' });
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
  }
}
