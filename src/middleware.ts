import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/signup',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/auth/google',
  '/api/auth/google/callback',
];

// JWT verification without importing Node.js-only modules
// We do a lightweight check: just verify the cookie exists and is a valid-looking JWT
// Full verification happens in each API route via getUserFromRequest
function hasValidCookie(request: NextRequest): boolean {
  const cookieValue = request.cookies.get('cib_token')?.value;
  if (!cookieValue) return false;
  // A JWT has 3 dot-separated base64url parts
  const parts = cookieValue.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // Allow all /api routes to pass through (they do their own auth via getUserFromRequest)
  // except we redirect browser navigation to login if no cookie
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // For page routes: redirect to login if no valid cookie
  if (!hasValidCookie(request)) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
