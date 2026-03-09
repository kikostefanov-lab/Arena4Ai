/**
 * Returns a copy of process.env with CLAUDECODE unset,
 * allowing nested `claude` CLI processes to spawn without conflict.
 */
export function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['CLAUDECODE'];
  return env;
}
