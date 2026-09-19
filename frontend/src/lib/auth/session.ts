import { cookies } from 'next/headers';
import prisma from '@/lib/db';
import { redis } from '@/lib/redis';
import { SignJWT, jwtVerify } from 'jose';

const SESSION_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-session-secret-change-in-production');
const COOKIE_NAME = 'anexcel_session';
const SESSION_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_IDLE_TIMEOUT_SEC = 60 * 60; // 60 minutes

export type SessionPayload = {
  sessionId: string;
  professorId: string;
};

/**
 * Creates a session in the database and sets the HTTP-only cookie.
 */
export async function createSession(professorId: string) {
  const expiresAt = new Date(Date.now() + SESSION_MAX_LIFETIME_MS);

  // 1. Create DB session (max lifetime)
  const session = await prisma.session.create({
    data: {
      professor_id: professorId,
      expires_at: expiresAt,
    },
  });

  // 1b. Cache active session in Redis (idle timeout)
  await redis.set(`session:${session.id}`, professorId, 'EX', SESSION_IDLE_TIMEOUT_SEC);

  // 2. Sign JWT
  const jwt = await new SignJWT({ sessionId: session.id, professorId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SESSION_SECRET);

  // 3. Set cookie
  (await cookies()).set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

/**
 * Validates the current session. Returns the payload if valid, null otherwise.
 */
export async function verifySession(): Promise<SessionPayload | null> {
  const cookie = (await cookies()).get(COOKIE_NAME)?.value;
  if (!cookie) return null;

  try {
    const { payload } = await jwtVerify(cookie, SESSION_SECRET);
    const sessionId = payload.sessionId as string;

    // Check DB to ensure session hasn't hit its absolute max lifetime (24h)
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.expires_at < new Date()) {
      return null;
    }

    // Check Redis for idle timeout
    const existsInRedis = await redis.exists(`session:${sessionId}`);
    if (!existsInRedis) {
      return null;
    }

    // Extend idle timeout
    await redis.expire(`session:${sessionId}`, SESSION_IDLE_TIMEOUT_SEC);
    return {
      sessionId: session.id,
      professorId: session.professor_id,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Destroys the session in the database and clears the cookie.
 */
export async function destroySession() {
  const cookie = (await cookies()).get(COOKIE_NAME)?.value;
  if (cookie) {
    try {
      const { payload } = await jwtVerify(cookie, SESSION_SECRET);
      const sessionId = payload.sessionId as string;
      
      // Delete from Postgres
      await prisma.session.delete({
        where: { id: sessionId },
      });

      // Delete from Redis
      await redis.del(`session:${sessionId}`);
    } catch (e) {
      // ignore
    }
  }
  (await cookies()).delete(COOKIE_NAME);
}
