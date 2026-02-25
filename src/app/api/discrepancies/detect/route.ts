import { NextResponse } from 'next/server';
import { detectDiscrepancies } from '@/lib/discrepancy-detector';

// POST /api/discrepancies/detect — run the detection engine
export async function POST() {
  try {
    const result = await detectDiscrepancies();
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[/api/discrepancies/detect] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

// GET /api/discrepancies/detect — convenience check (same as POST)
export async function GET() {
  return POST();
}
