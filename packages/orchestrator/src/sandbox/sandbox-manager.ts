import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolveSandboxProvider, sandboxEnv } from '../utils/claude-env.js';

const AGENT_IMAGE = process.env.ARENA_AGENT_IMAGE ?? 'arena-agent:latest';

/**
 * Docker network mode for agent containers.
 *
 * Default is `bridge`: outbound NAT to the internet — which is all the
 * provider CLIs need — with no route to services listening on the host's
 * loopback. `host` used to be the default, and it is the reason a deliverable
 * could reach the orchestrator on :3000 and Postgres on :5432 as if it were
 * the operator.
 *
 * Set ARENA_SANDBOX_NETWORK to override. `host` is the escape hatch for the
 * one setup bridge genuinely breaks: pointing a provider at a model served on
 * the operator's own loopback (ANTHROPIC_BASE_URL=http://localhost:...).
 * On Docker Desktop, `host.docker.internal` reaches the host from bridge and
 * is the better answer where it is available.
 */
const SANDBOX_NETWORK = process.env.ARENA_SANDBOX_NETWORK ?? 'bridge';

const NO_SANDBOX_HINT = 'run without the sandbox (CLI: --skip-sandbox; server: ARENA_SKIP_SANDBOX=true).';

function daemonMessage(detail: string): string {
  return `Docker is installed but its daemon is not reachable${detail ? ` (${detail})` : ''}. ` +
    `Start Docker (e.g. open Docker Desktop), or ${NO_SANDBOX_HINT}`;
}

export type SandboxUnavailableReason = 'docker-missing' | 'daemon-unavailable' | 'image-missing';

/** The sandbox cannot be used: carries a machine-readable reason and an actionable message. */
export class SandboxUnavailableError extends Error {
  constructor(readonly reason: SandboxUnavailableReason, message: string) {
    super(message);
    this.name = 'SandboxUnavailableError';
  }
}

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
   * Verify docker is installed, its daemon is reachable, and the agent image
   * exists. Rejects with a SandboxUnavailableError (never an unhandled
   * `error` event) that names what is missing and how to fix it.
   */
  async verify(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let stderr = '';
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const settle = (err?: SandboxUnavailableError) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err); else resolve();
      };
      const proc = spawn('docker', ['image', 'inspect', AGENT_IMAGE], { stdio: ['ignore', 'ignore', 'pipe'] });
      timer = setTimeout(() => {
        proc.kill();
        settle(new SandboxUnavailableError('daemon-unavailable', daemonMessage('timed out waiting for docker to respond')));
      }, 15_000);
      timer.unref?.();
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        settle(new SandboxUnavailableError(
          'docker-missing',
          (err.code === 'ENOENT'
            ? 'Docker is not installed or not on PATH (the "docker" binary was not found).'
            : `Could not run docker: ${err.message}.`) + ` Install Docker, or ${NO_SANDBOX_HINT}`,
        ));
      });
      proc.on('close', (code) => {
        if (code === 0) return settle();
        if (/cannot connect|is the docker daemon running|permission denied|error during connect/i.test(stderr)) {
          return settle(new SandboxUnavailableError('daemon-unavailable', daemonMessage(stderr.trim().split('\n')[0] ?? '')));
        }
        settle(new SandboxUnavailableError(
          'image-missing',
          `Sandbox image "${AGENT_IMAGE}" not found. Build it first:\n` +
          `  docker build -f Dockerfile.agent -t ${AGENT_IMAGE} .\n` +
          `Or ${NO_SANDBOX_HINT}`,
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
    options: { stdin?: boolean } = {},
  ): ChildProcess {
    const containerName = `arena-${teamId}-${Date.now()}`;
    this.containerNames.set(teamId, containerName);

    // The process on the other side of this boundary runs model-written code.
    // Forward only what the chosen CLI needs to run and authenticate — never
    // the whole of the orchestrator's environment.
    const safeEnv = sandboxEnv(resolveSandboxProvider(command), env);

    const dockerArgs = [
      'run',
      '--rm',
      // `docker run` closes the container's stdin unless -i is given, so an
      // adapter that feeds its prompt on stdin would deliver it to nothing.
      ...(options.stdin ? ['-i'] : []),
      '--name', containerName,
      '-v', `${workdir}:/workspace`,
      '-w', '/workspace',
      '--network', SANDBOX_NETWORK,
      '--memory', '2g',
      '--cpus', '1',
      ...Object.entries(safeEnv).flatMap(([k, v]) => v !== undefined ? ['-e', `${k}=${v}`] : []),
      AGENT_IMAGE,
      command,
      ...args,
    ];

    const child = spawn('docker', dockerArgs, {
      stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    child.on('close', () => this.containerNames.delete(teamId));
    return child;
  }

  private runDockerCommand(subcommand: string, name: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const proc = spawn('docker', [subcommand, name], { stdio: 'ignore' });
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
  }

  async killContainer(teamId: string): Promise<void> {
    const name = this.containerNames.get(teamId);
    if (name) await this.runDockerCommand('kill', name);
  }

  async pauseContainer(teamId: string): Promise<void> {
    const name = this.containerNames.get(teamId);
    if (name) await this.runDockerCommand('pause', name);
  }

  async resumeContainer(teamId: string): Promise<void> {
    const name = this.containerNames.get(teamId);
    if (name) await this.runDockerCommand('unpause', name);
  }
}
