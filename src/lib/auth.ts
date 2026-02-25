/**
 * Auth helpers — JWT + bcrypt + cookie management
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { randomUUID } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || '49955224586d382073eabe7f5471aac86db597e34c53b6aed3a886ef3d950103';
const COOKIE_NAME = 'cib_token';
const TOKEN_EXPIRY = '30d';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  google_id?: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_id: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface JWTPayload {
  sub: string;   // user id
  email: string;
  name: string;
  iat?: number;
  exp?: number;
}

// ─── Password helpers ─────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export function buildSetCookieHeader(token: string): string {
  const maxAge = 30 * 24 * 60 * 60; // 30 days in seconds
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// ─── User DB operations ───────────────────────────────────────────────────────

export function getUserById(id: string): User | null {
  const row = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  if (!row) return null;
  return toUser(row);
}

export function getUserByEmail(email: string): UserRow | null {
  return db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email]) ?? null;
}

export function getUserByGoogleId(googleId: string): User | null {
  const row = db.get<UserRow>('SELECT * FROM users WHERE google_id = ?', [googleId]);
  if (!row) return null;
  return toUser(row);
}

export function createEmailUser(email: string, name: string, passwordHash: string): User {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, email.toLowerCase().trim(), name.trim(), passwordHash, now]
  );
  return { id, email: email.toLowerCase().trim(), name: name.trim(), created_at: now };
}

export function createGoogleUser(googleId: string, email: string, name: string, avatarUrl?: string): User {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO users (id, email, name, google_id, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, email.toLowerCase().trim(), name.trim(), googleId, avatarUrl ?? null, now]
  );
  return { id, email: email.toLowerCase().trim(), name: name.trim(), google_id: googleId, avatar_url: avatarUrl ?? null, created_at: now };
}

export function upsertGoogleUser(googleId: string, email: string, name: string, avatarUrl?: string): User {
  // Check by google_id first
  const existing = getUserByGoogleId(googleId);
  if (existing) {
    // Update name/avatar in case they changed
    db.run('UPDATE users SET name = ?, avatar_url = ? WHERE google_id = ?', [name, avatarUrl ?? null, googleId]);
    return { ...existing, name, avatar_url: avatarUrl ?? null };
  }
  // Check if email already registered (link account)
  const byEmail = getUserByEmail(email);
  if (byEmail) {
    db.run('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?', [googleId, avatarUrl ?? null, byEmail.id]);
    return toUser({ ...byEmail, google_id: googleId, avatar_url: avatarUrl ?? null });
  }
  return createGoogleUser(googleId, email, name, avatarUrl);
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url,
    google_id: row.google_id,
    created_at: row.created_at,
  };
}

// ─── Request auth helper ──────────────────────────────────────────────────────

export function getUserFromRequest(request: Request): User | null {
  const cookieHeader = request.headers.get('cookie');
  const token = getTokenFromCookieHeader(cookieHeader);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.sub);
}
