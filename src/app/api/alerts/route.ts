import { NextRequest, NextResponse } from 'next/server';
import { getDiscrepancies, insertDiscrepancy, resolveDiscrepancy, type DbDiscrepancy } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const resolvedParam = searchParams.get('resolved');
    let resolvedFilter: boolean | undefined;
    if (resolvedParam === 'true') resolvedFilter = true;
    else if (resolvedParam === 'false') resolvedFilter = false;

    const discrepancies = getDiscrepancies(resolvedFilter);
    return NextResponse.json({ discrepancies });
  } catch (error) {
    console.error('GET /api/alerts error:', error);
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const discrepancy: DbDiscrepancy = {
      id: body.id || `disc-${Date.now()}`,
      type: body.type,
      severity: body.severity,
      title: body.title,
      documented: body.documented,
      actual: body.actual,
      sources: body.sources || [],
      recommendation: body.recommendation,
      resolved: false,
      detected_at: body.detected_at || new Date().toISOString(),
    };
    insertDiscrepancy(discrepancy);
    return NextResponse.json({ success: true, discrepancy }, { status: 201 });
  } catch (error) {
    console.error('POST /api/alerts error:', error);
    return NextResponse.json({ error: 'Failed to insert alert' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    resolveDiscrepancy(id);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('PATCH /api/alerts error:', error);
    return NextResponse.json({ error: 'Failed to resolve alert' }, { status: 500 });
  }
}
