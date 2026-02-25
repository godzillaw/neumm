import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(request: Request) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url },
  });
}
