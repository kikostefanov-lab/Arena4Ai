import { describe, it, expect } from 'vitest';
import { sandboxEnv, resolveSandboxProvider, claudeEnv } from '../claude-env.js';

/**
 * The sandbox environment is a security boundary: everything the container
 * receives is readable by model-written code. These tests pin the allowlist
 * shape rather than an exact list, so a CLI adding a new ANTHROPIC_* knob
 * does not break the suite, but re-exposing DATABASE_URL does.
 */

const OPERATOR_ENV: NodeJS.ProcessEnv = {
  // the two the card names explicitly
  DATABASE_URL: 'postgresql://localhost/arena',
  ARENA_API_KEY: 'sk-arena-operator-secret',
  // more of the operator's machine that used to travel wholesale
  ARENA_JUDGE_MODEL: 'claude-opus-5',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  GITHUB_TOKEN: 'ghp_operator',
  SSH_AUTH_SOCK: '/private/tmp/ssh-agent.sock',
  npm_config_registry: 'https://registry.internal/',
  // host paths that mean nothing inside the container
  PATH: '/opt/homebrew/bin:/usr/bin',
  HOME: '/Users/operator',
  // provider credentials
  ANTHROPIC_API_KEY: 'sk-ant-key',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  OPENAI_API_KEY: 'sk-openai-key',
  GEMINI_API_KEY: 'gemini-key',
  GOOGLE_CLOUD_PROJECT: 'proj-123',
  // shared, innocuous
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  HTTPS_PROXY: 'http://proxy.internal:3128',
  NODE_EXTRA_CA_CERTS: '/etc/ssl/corp.pem',
};

describe('resolveSandboxProvider', () => {
  it('maps each supported binary, bare or absolute', () => {
    expect(resolveSandboxProvider('claude')).toBe('claude');
    expect(resolveSandboxProvider('/usr/local/bin/codex')).toBe('codex');
    expect(resolveSandboxProvider('C:\\bin\\gemini.exe')).toBe('gemini');
  });

  it('still resolves a wrapper name, so a custom *_BIN does not fail closed', () => {
    expect(resolveSandboxProvider('/usr/local/bin/claude-wrapper')).toBe('claude');
    expect(resolveSandboxProvider('gemini-cli')).toBe('gemini');
  });

  it('returns null for anything it does not recognise', () => {
    expect(resolveSandboxProvider('bash')).toBeNull();
    expect(resolveSandboxProvider('')).toBeNull();
  });
});

describe('sandboxEnv — what must never cross', () => {
  for (const provider of ['claude', 'codex', 'gemini'] as const) {
    it(`withholds the operator's own secrets from ${provider}`, () => {
      const env = sandboxEnv(provider, OPERATOR_ENV);
      expect(env['DATABASE_URL']).toBeUndefined();
      expect(env['ARENA_API_KEY']).toBeUndefined();
      expect(env['ARENA_JUDGE_MODEL']).toBeUndefined();
      expect(env['GITHUB_TOKEN']).toBeUndefined();
      expect(env['SSH_AUTH_SOCK']).toBeUndefined();
      expect(env['npm_config_registry']).toBeUndefined();
    });

    it(`does not forward host-only paths to ${provider}`, () => {
      // A host PATH inside the container is a bug as well as a leak: Docker
      // resolves the command against the PATH it is handed.
      const env = sandboxEnv(provider, OPERATOR_ENV);
      expect(env['PATH']).toBeUndefined();
      expect(env['HOME']).toBeUndefined();
    });

    it(`forwards the shared innocuous set to ${provider}`, () => {
      const env = sandboxEnv(provider, OPERATOR_ENV);
      expect(env['LANG']).toBe('en_US.UTF-8');
      expect(env['TERM']).toBe('xterm-256color');
      expect(env['HTTPS_PROXY']).toBe('http://proxy.internal:3128');
      expect(env['NODE_EXTRA_CA_CERTS']).toBe('/etc/ssl/corp.pem');
    });
  }
});

describe('sandboxEnv — each provider gets its own credentials and no one else\'s', () => {
  it('claude', () => {
    const env = sandboxEnv('claude', OPERATOR_ENV);
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-key');
    expect(env['ANTHROPIC_BASE_URL']).toBe('https://api.anthropic.com');
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['GEMINI_API_KEY']).toBeUndefined();
  });

  it('codex', () => {
    const env = sandboxEnv('codex', OPERATOR_ENV);
    expect(env['OPENAI_API_KEY']).toBe('sk-openai-key');
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['GEMINI_API_KEY']).toBeUndefined();
  });

  it('gemini', () => {
    const env = sandboxEnv('gemini', OPERATOR_ENV);
    expect(env['GEMINI_API_KEY']).toBe('gemini-key');
    expect(env['GOOGLE_CLOUD_PROJECT']).toBe('proj-123');
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
  });

  it('an unrecognised binary gets the base set only — fail closed', () => {
    const env = sandboxEnv(null, OPERATOR_ENV);
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['GEMINI_API_KEY']).toBeUndefined();
    expect(env['LANG']).toBe('en_US.UTF-8');
  });
});

describe('sandboxEnv — vendor namespaces travel whole', () => {
  it('forwards vendor knobs the allowlist has never heard of', () => {
    // The point of prefix matching: a CLI release adding a new setting must
    // not need a code change here.
    const env = sandboxEnv('claude', {
      ANTHROPIC_SOME_FUTURE_KNOB: 'on',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192',
    });
    expect(env['ANTHROPIC_SOME_FUTURE_KNOB']).toBe('on');
    expect(env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe('8192');
  });
});

describe('sandboxEnv — blocked even inside an allowed namespace', () => {
  it('drops nested-session markers that stop the CLI starting', () => {
    const env = sandboxEnv('claude', {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '51234',
      ANTHROPIC_API_KEY: 'sk-ant-key',
    });
    expect(env['CLAUDECODE']).toBeUndefined();
    expect(env['CLAUDE_CODE_ENTRYPOINT']).toBeUndefined();
    expect(env['CLAUDE_CODE_SSE_PORT']).toBeUndefined();
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-key');
  });

  it('drops handles pointing back at the host machine', () => {
    const env = sandboxEnv('claude', {
      CLAUDE_BG_RENDEZVOUS_SOCK: '/private/tmp/claude-bg.sock',
      CLAUDE_BRIDGE_OAUTH_TOKEN: 'bridge-token',
      CLAUDE_CONFIG_DIR: '/Users/operator/.claude',
    });
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('drops the gemini IDE loopback handles', () => {
    const env = sandboxEnv('gemini', {
      GEMINI_CLI_IDE_SERVER_PORT: '4242',
      GEMINI_CLI_IDE_AUTH_TOKEN: 'ide-token',
      GEMINI_API_KEY: 'gemini-key',
    });
    expect(env['GEMINI_CLI_IDE_SERVER_PORT']).toBeUndefined();
    expect(env['GEMINI_CLI_IDE_AUTH_TOKEN']).toBeUndefined();
    expect(env['GEMINI_API_KEY']).toBe('gemini-key');
  });

  it('drops "already sandboxed" flags that would make the CLI nest a sandbox', () => {
    const codex = sandboxEnv('codex', { CODEX_SANDBOX: 'seatbelt', OPENAI_API_KEY: 'k' });
    expect(codex['CODEX_SANDBOX']).toBeUndefined();
    const gemini = sandboxEnv('gemini', { GEMINI_SANDBOX: 'docker', GEMINI_API_KEY: 'k' });
    expect(gemini['GEMINI_SANDBOX']).toBeUndefined();
  });

  it('drops credential file paths so the API key fallback still works', () => {
    const env = sandboxEnv('gemini', {
      GOOGLE_APPLICATION_CREDENTIALS: '/Users/operator/adc.json',
      GEMINI_API_KEY: 'gemini-key',
    });
    expect(env['GOOGLE_APPLICATION_CREDENTIALS']).toBeUndefined();
    expect(env['GEMINI_API_KEY']).toBe('gemini-key');
  });
});

describe('sandboxEnv — Bedrock and Vertex opt-ins', () => {
  it('withholds AWS credentials when Bedrock is off', () => {
    const env = sandboxEnv('claude', { AWS_ACCESS_KEY_ID: 'id', AWS_SECRET_ACCESS_KEY: 'sec' });
    expect(env['AWS_ACCESS_KEY_ID']).toBeUndefined();
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
  });

  it('forwards AWS credentials when the operator has turned Bedrock on', () => {
    const env = sandboxEnv('claude', {
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_ACCESS_KEY_ID: 'id',
      AWS_SECRET_ACCESS_KEY: 'sec',
      AWS_REGION: 'us-east-1',
    });
    expect(env['AWS_ACCESS_KEY_ID']).toBe('id');
    expect(env['AWS_SECRET_ACCESS_KEY']).toBe('sec');
    expect(env['AWS_REGION']).toBe('us-east-1');
  });

  it('treats 0 / false as off', () => {
    const env = sandboxEnv('claude', { CLAUDE_CODE_USE_BEDROCK: 'false', AWS_ACCESS_KEY_ID: 'id' });
    expect(env['AWS_ACCESS_KEY_ID']).toBeUndefined();
  });

  it('does not leak AWS credentials to codex or gemini even with Bedrock on', () => {
    const source = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_SECRET_ACCESS_KEY: 'sec', OPENAI_API_KEY: 'k' };
    expect(sandboxEnv('codex', source)['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(sandboxEnv('gemini', source)['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
  });
});

describe('claudeEnv — the host path is deliberately unchanged', () => {
  it('still returns the full environment minus CLAUDECODE', () => {
    const env = claudeEnv();
    expect(env['CLAUDECODE']).toBeUndefined();
    // host helper spawns run as the operator; nothing is filtered there
    expect(Object.keys(env).length).toBeGreaterThan(5);
  });
});
