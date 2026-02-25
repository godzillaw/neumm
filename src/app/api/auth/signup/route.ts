import { NextResponse } from 'next/server';
import { getUserByEmail, createEmailUser, hashPassword, signToken, buildSetCookieHeader } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string; name?: string };
    const { email, password, name } = body;

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = createEmailUser(email, name, passwordHash);

    const token = signToken({ sub: user.id, email: user.email, name: user.name });

    const res = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
    });
    res.headers.set('Set-Cookie', buildSetCookieHeader(token));
    return res;

  } catch (err) {
    console.error('[POST /api/auth/signup]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
