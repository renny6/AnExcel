import { cookies } from 'next/headers';
import prisma from '@/lib/db';
import { SignJWT, jwtVerify } from 'jose';

const SESSION_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-session-secret-change-in-production');
const COOKIE_NAME = 'anexcel_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type SessionPayload = {
  sessionId: string;
  professorId: string;
};

/**
 * Creates a session in the database and sets the HTTP-only cookie.
 */
export async function createSession(professorId: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // 1. Create DB session
  const session = await prisma.session.create({
    data: {
      professor_id: professorId,
      expires_at: expiresAt,
    },
  });

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

    // Check DB to ensure session hasn't been revoked/expired
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.expires_at < new Date()) {
      return null;
    }

    // Optional: Idle timeout logic could go here by extending expires_at on activity
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
      await prisma.session.delete({
        where: { id: payload.sessionId as string },
      });
    } catch (e) {
      // ignore
    }
  }
  (await cookies()).delete(COOKIE_NAME);
}
