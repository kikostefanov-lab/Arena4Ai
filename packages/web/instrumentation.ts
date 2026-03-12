/**
 * Next.js instrumentation hook — runs once on server startup (Node.js runtime only).
 * Pre-warms the Remotion bundle so the first reel render doesn't take 30–60s.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getBundle } = await import('./lib/remotion-bundle');
    getBundle()
      .then(() => console.log('[arena] Remotion bundle pre-warmed'))
      .catch((err: unknown) => console.warn('[arena] Remotion bundle pre-warm failed:', err));
  }
}
