import { NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth/credentials';
import { createSession } from '@/lib/auth/session';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    try {
      const authResult = await verifyCredentials(username, password);
      
      if (!authResult) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }

      await createSession(authResult.professorId);
      
      return NextResponse.json({ success: true });
    } catch (authError: any) {
      // Catch lockout errors
      return NextResponse.json({ error: authError.message }, { status: 403 });
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
