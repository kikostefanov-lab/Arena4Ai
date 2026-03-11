import { orchestratorUrl, orchestratorHeaders } from '../../../lib/orchestrator';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const modelA = searchParams.get('modelA') ?? '';
  const modelB = searchParams.get('modelB') ?? '';

  const url = orchestratorUrl(`/compare?modelA=${encodeURIComponent(modelA)}&modelB=${encodeURIComponent(modelB)}`);
  try {
    const res = await fetch(url, { headers: orchestratorHeaders(), cache: 'no-store' });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: 'Could not reach orchestrator' }, { status: 502 });
  }
}
