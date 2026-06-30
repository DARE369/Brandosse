import { NextResponse } from 'next/server';
import { checkWorkerHealth } from '../../../../lib/video-engine/worker-client';

export async function GET() {
  const result = await checkWorkerHealth();
  return NextResponse.json(result, { status: result.healthy ? 200 : 503 });
}
