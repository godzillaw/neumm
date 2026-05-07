import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  // keep old paths working as redirects (handled below)
  '/auth/login',
  '/auth/signup',
  // API auth routes
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/auth/google',
  '/api/auth/google/callback',
  // Static demo tools (no auth required)
  '/storypark-rostering.html',
];

function hasValidCookie(request: NextRequest): boolean {
  const cookieValue = request.cookies.get('cib_token')?.value;
  if (!cookieValue) return false;
  const parts = cookieValue.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Redirect old /auth/login → /login and /auth/signup → /signup
  if (pathname === '/auth/login' || pathname.startsWith('/auth/login?')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (pathname === '/auth/signup' || pathname.startsWith('/auth/signup?')) {
    const url = request.nextUrl.clone();
    url.pathname = '/signup';
    return NextResponse.redirect(url);
  }

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // Allow API routes (they do their own auth)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // For all page routes: require valid cookie or redirect to /login
  if (!hasValidCookie(request)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

