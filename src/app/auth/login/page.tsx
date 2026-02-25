'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

const ERROR_MESSAGES: Record<string, string> = {
  google_denied: 'Google sign-in was cancelled.',
  oauth_not_configured: 'Google OAuth is not configured.',
  token_exchange_failed: 'Google sign-in failed. Please try again.',
  userinfo_failed: 'Could not retrieve your Google profile.',
  email_not_verified: 'Your Google account email is not verified.',
  server_error: 'Something went wrong. Please try again.',
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
  const urlError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(urlError ? (ERROR_MESSAGES[urlError] ?? 'An error occurred.') : null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // If already logged in, redirect
  useEffect(() => {
    fetch('/api/auth/me').then((r) => {
      if (r.ok) router.replace(next);
    });
  }, [next, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error || 'Login failed');
      } else {
        router.push(next);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      // Check if Google OAuth is configured before redirecting
      const check = await fetch('/api/auth/google', { method: 'GET', redirect: 'manual' });
      if (check.status === 503 || check.status === 0) {
        setError('Google sign-in is not configured yet. Please use email and password.');
        setGoogleLoading(false);
        return;
      }
      // If configured, the API returns a redirect — follow it
      window.location.href = '/api/auth/google';
    } catch {
      setError('Could not connect to Google. Please use email and password.');
      setGoogleLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F4F6FA',
        padding: 24,
      }}
    >
      {/* Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 4px 24px rgba(27,58,107,0.10)',
          padding: '40px 40px 32px',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          {/* Neumm logo */}
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: 16, borderRadius: 16, boxShadow: '0 4px 16px rgba(43,101,200,0.35)' }}>
            <defs>
              <linearGradient id="ng-login" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#4DD9C0"/>
                <stop offset="100%" stopColor="#3A7BD5"/>
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="16" fill="url(#ng-login)"/>
            <path d="M13 51V13h7.5L45 46.5V13H51v38h-7.5L19 17.5V51H13z" fill="white"/>
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#3A7BD5', margin: 0 }}>
            Neumm
          </h1>
          <p style={{ fontSize: 14, color: '#6B7A99', margin: '4px 0 0' }}>
            AI-powered company intelligence
          </p>
        </div>

        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1D1C1D', margin: '0 0 24px', textAlign: 'center' }}>
          Sign in to your account
        </h2>

        {/* Error banner */}
        {error && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 8,
              backgroundColor: '#FBE9EF',
              border: '1px solid #E05555',
              marginBottom: 20,
              fontSize: 14,
              color: '#B02A37',
            }}
          >
            <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* Google button */}
        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '11px 16px',
            borderRadius: 8,
            border: '1px solid #E0E0E0',
            backgroundColor: '#FFFFFF',
            cursor: googleLoading ? 'not-allowed' : 'pointer',
            fontSize: 15,
            fontWeight: 500,
            color: '#1D1C1D',
            opacity: googleLoading ? 0.7 : 1,
            transition: 'background-color 0.15s, border-color 0.15s',
            marginBottom: 20,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F8F8F8'; e.currentTarget.style.borderColor = '#BDBDBD'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF'; e.currentTarget.style.borderColor = '#E0E0E0'; }}
        >
          {/* Google G logo */}
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z"/>
          </svg>
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, backgroundColor: '#E0E0E0' }} />
          <span style={{ fontSize: 13, color: '#9E9E9E' }}>or</span>
          <div style={{ flex: 1, height: 1, backgroundColor: '#E0E0E0' }} />
        </div>

        {/* Email/password form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#1D1C1D', marginBottom: 6 }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #E0E0E0',
                fontSize: 15,
                color: '#1D1C1D',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
                fontFamily: 'inherit',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#4A90D9'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#E0E0E0'; }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#1D1C1D', marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{
                  width: '100%',
                  padding: '10px 42px 10px 14px',
                  borderRadius: 8,
                  border: '1px solid #E0E0E0',
                  fontSize: 15,
                  color: '#1D1C1D',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#4A90D9'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#E0E0E0'; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9E9E9E',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showPassword
                  ? <EyeOff style={{ width: 16, height: 16 }} />
                  : <Eye style={{ width: 16, height: 16 }} />
                }
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 16px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: loading ? '#7BBFE8' : '#3A7BD5',
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s',
              marginTop: 4,
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#2D6AC4'; }}
            onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#3A7BD5'; }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Footer link */}
        <p style={{ textAlign: 'center', fontSize: 14, color: '#6B7A99', marginTop: 24, marginBottom: 0 }}>
          Don&apos;t have an account?{' '}
          <a
            href="/auth/signup"
            style={{ color: '#4A90D9', fontWeight: 600, textDecoration: 'none' }}
          >
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
