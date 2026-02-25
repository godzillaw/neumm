import { NextResponse } from 'next/server';
import { upsertGoogleUser, signToken, buildSetCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}

export async function GET(request: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error || !code) {
      return NextResponse.redirect(`${baseUrl}/auth/login?error=google_denied`);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${baseUrl}/auth/login?error=oauth_not_configured`);
    }

    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('[Google callback] Token exchange failed:', await tokenRes.text());
      return NextResponse.redirect(`${baseUrl}/auth/login?error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json() as GoogleTokenResponse;

    // Get user info
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoRes.ok) {
      return NextResponse.redirect(`${baseUrl}/auth/login?error=userinfo_failed`);
    }

    const googleUser = await userInfoRes.json() as GoogleUserInfo;

    if (!googleUser.email_verified) {
      return NextResponse.redirect(`${baseUrl}/auth/login?error=email_not_verified`);
    }

    // Upsert user in DB
    const user = upsertGoogleUser(
      googleUser.sub,
      googleUser.email,
      googleUser.name,
      googleUser.picture
    );

    // Issue JWT
    const token = signToken({ sub: user.id, email: user.email, name: user.name });

    const res = NextResponse.redirect(`${baseUrl}/`);
    res.headers.set('Set-Cookie', buildSetCookieHeader(token));
    return res;

  } catch (err) {
    console.error('[Google callback] Error:', err);
    return NextResponse.redirect(`${baseUrl}/auth/login?error=server_error`);
  }
}
