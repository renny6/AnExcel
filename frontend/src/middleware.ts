import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-session-secret-change-in-production');
const COOKIE_NAME = 'anexcel_session';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /batches/* and /api/batches/*
  if (pathname.startsWith('/batches') || pathname.startsWith('/api/batches')) {
    const cookie = request.cookies.get(COOKIE_NAME)?.value;

    if (!cookie) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
      // Very basic structural check. Full DB verification happens on page load or API route via session.ts
      await jwtVerify(cookie, SESSION_SECRET);
    } catch (e) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
