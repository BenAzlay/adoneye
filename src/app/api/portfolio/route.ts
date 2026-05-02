import { NextRequest } from 'next/server';
import { fetchZerionPositions, buildPortfolioData } from '@/lib/zerion';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const address = request.nextUrl.searchParams.get('address');
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: 'Invalid or missing address' }, { status: 400 });
  }

  const key = process.env.ZERION_API;
  if (!key) return Response.json({ error: 'ZERION_API not configured' }, { status: 500 });

  try {
    const positions = await fetchZerionPositions(address, key);
    return Response.json(buildPortfolioData(address, positions));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
