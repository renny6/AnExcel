import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
      // Fetch the internal verify API to check Redis revocation
      const verifyUrl = new URL('/api/auth/verify', request.url);
      const res = await fetch(verifyUrl.toString(), {
        headers: { cookie: `${COOKIE_NAME}=${cookie}` },
      });

      if (!res.ok) {
        throw new Error('Revoked or invalid session');
      }
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
