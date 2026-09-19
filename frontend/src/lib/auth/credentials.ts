import prisma from '@/lib/db';
import { redis } from '@/lib/redis';
import bcrypt from 'bcrypt';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes

export async function verifyCredentials(externalId: string, passwordAttempt: string): Promise<{ professorId: string } | null> {
  const attemptKey = `login_attempts:${externalId}`;

  // 1. Check brute force lockout
  const attemptsCount = parseInt((await redis.get(attemptKey)) || '0', 10);
  if (attemptsCount >= MAX_FAILED_ATTEMPTS) {
    throw new Error('Account locked due to too many failed attempts. Try again later.');
  }

  // 2. Fetch professor
  const professor = await prisma.professor.findFirst({
    where: {
      external_id: externalId,
      identity_source: 'test'
    }
  });

  if (!professor || !professor.password_hash) {
    await recordFailedAttempt(attemptKey, attemptsCount);
    return null;
  }

  // 3. Verify password
  const isValid = await bcrypt.compare(passwordAttempt, professor.password_hash);
  
  if (!isValid) {
    await recordFailedAttempt(attemptKey, attemptsCount);
    return null;
  }

  // 4. Success: reset attempts
  await redis.del(attemptKey);
  
  return { professorId: professor.id };
}

async function recordFailedAttempt(key: string, currentAttempts: number) {
  if (currentAttempts === 0) {
    await redis.set(key, 1, 'EX', LOCKOUT_DURATION_SECONDS);
  } else {
    const ttl = await redis.ttl(key);
    await redis.set(key, currentAttempts + 1, 'EX', ttl > 0 ? ttl : LOCKOUT_DURATION_SECONDS);
  }
}
