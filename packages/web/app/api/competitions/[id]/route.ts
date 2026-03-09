export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await fetch(`http://localhost:3000/competitions/${params.id}`);
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
