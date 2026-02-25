import { NextResponse } from 'next/server';
import { getUserByEmail, verifyPassword, signToken, buildSetCookieHeader } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const userRow = getUserByEmail(email);
    if (!userRow) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    if (!userRow.password_hash) {
      return NextResponse.json({ error: 'This account uses Google sign-in. Please sign in with Google.' }, { status: 401 });
    }

    const valid = await verifyPassword(password, userRow.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = signToken({ sub: userRow.id, email: userRow.email, name: userRow.name });

    const res = NextResponse.json({
      success: true,
      user: { id: userRow.id, email: userRow.email, name: userRow.name },
    });
    res.headers.set('Set-Cookie', buildSetCookieHeader(token));
    return res;

  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
