import Docker from 'dockerode';

/** Options for a single isolated sandbox container. */
export interface SandboxOptions {
  /** Human-readable name suffix — used to build the container name. */
  name: string;
  /** Docker image to use. Defaults to 'node:20-alpine'. */
  image?: string;
  /**
   * Host path to mount as /workspace inside the container.
   * If omitted, no volume is mounted (ephemeral scratch space only).
   */
  workdir?: string;
  /** Memory limit in bytes. Defaults to 512 MiB. */
  memoryBytes?: number;
  /** CPU quota in units of 1e9 nanoseconds per second. Defaults to 1 CPU. */
  nanoCpus?: number;
  /** Additional environment variables to inject. */
  env?: Record<string, string>;
}

/** Handle returned by createSandbox(). */
export interface SandboxHandle {
  containerId: string;
  containerName: string;
  internalWorkdir: string;
  destroy(): Promise<void>;
  runInContainer(cmd: string[]): Promise<string>;
}

const DEFAULT_IMAGE = 'node:20-alpine';
const DEFAULT_MEMORY = 512 * 1024 * 1024; // 512 MiB
const DEFAULT_NANO_CPUS = 1_000_000_000;   // 1 CPU
const INTERNAL_WORKDIR = '/workspace';

/**
 * Create an isolated Docker container for one team's competition run.
 *
 * Networking is disabled (NetworkMode: 'none') and all Linux capabilities
 * are dropped to prevent privilege escalation.
 */
export async function createSandbox(
  options: SandboxOptions,
  docker: Docker = new Docker(),
): Promise<SandboxHandle> {
  const image = options.image ?? DEFAULT_IMAGE;
  const containerName = `arena-sandbox-${options.name}-${Date.now()}`;

  const binds: string[] = options.workdir
    ? [`${options.workdir}:${INTERNAL_WORKDIR}:rw`]
    : [];

  const envVars = Object.entries(options.env ?? {}).map(([k, v]) => `${k}=${v}`);

  const container = await docker.createContainer({
    name: containerName,
    Image: image,
    Cmd: ['sh', '-c', 'sleep infinity'],
    WorkingDir: INTERNAL_WORKDIR,
    Env: envVars,
    HostConfig: {
      Binds: binds,
      Memory: options.memoryBytes ?? DEFAULT_MEMORY,
      NanoCpus: options.nanoCpus ?? DEFAULT_NANO_CPUS,
      NetworkMode: 'none',
      ReadonlyRootfs: false,
      AutoRemove: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
    },
  });

  await container.start();

  const handle: SandboxHandle = {
    containerId: container.id,
    containerName,
    internalWorkdir: INTERNAL_WORKDIR,

    /** Run a command array inside the container via dockerode's exec API. */
    async runInContainer(cmd: string[]): Promise<string> {
      const dockerExec = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: INTERNAL_WORKDIR,
      });

      const stream = await dockerExec.start({ hijack: true, stdin: false });

      return new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', async () => {
          const output = Buffer.concat(chunks).toString('utf8');
          const info = await dockerExec.inspect();
          if (info.ExitCode !== 0) {
            reject(new Error(`Container command exited with code ${info.ExitCode}:\n${output}`));
          } else {
            resolve(output);
          }
        });
        stream.on('error', reject);
      });
    },

    async destroy(): Promise<void> {
      try { await container.stop({ t: 2 }); } catch { /* already stopped */ }
      await container.remove({ force: true });
    },
  };

  return handle;
}
