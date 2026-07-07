// middleware.ts

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const secret = process.env.NEXTAUTH_SECRET;

// Protected admin routes
const adminRoutes = ['/admin'];

// Routes that require authentication
const protectedRoutes = ['/profile', '/orders'];

// Public routes that redirect authenticated users
const authRoutes = ['/auth/signin', '/auth/signup'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Get the token from the request
  const token = await getToken({
    req: request,
    secret,
    cookieName:
      process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
  });

  // Check if the current route is an admin route
  const isAdminRoute = adminRoutes.some(route => pathname.startsWith(route));

  // Check if the current route requires authentication
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname.startsWith(route)
  );

  // Check if the current route is an auth route
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route));

  // Handle admin routes
  if (isAdminRoute) {
    if (!token) {
      // Redirect to sign-in page with callback URL
      const signInUrl = new URL('/auth/signin', request.url);
      signInUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signInUrl);
    }

    // Check if user has admin role
    if (String(token.role).toLowerCase() !== 'admin') {
      // Redirect to access denied page or home
      return NextResponse.redirect(new URL('/access-denied', request.url));
    }
  }

  // Handle protected routes (require authentication)
  if (isProtectedRoute && !token) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Handle auth routes (redirect if already authenticated)
  if (isAuthRoute && token) {
    // Check if there's a callback URL
    const callbackUrl = request.nextUrl.searchParams.get('callbackUrl');
    if (callbackUrl && callbackUrl !== '/auth/signin') {
      return NextResponse.redirect(new URL(callbackUrl, request.url));
    }
    // Otherwise redirect to profile or home
    return NextResponse.redirect(new URL('/profile', request.url));
  }

  // Handle API routes
  if (pathname.startsWith('/api/admin')) {
    if (!token) {
      return new NextResponse(
        JSON.stringify({ error: 'Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (String(token.role).toLowerCase() !== 'admin') {
      return new NextResponse(
        JSON.stringify({ error: 'Admin access required' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Handle protected API routes
  const protectedApiRoutes = ['/api/profile', '/api/orders'];
  const isProtectedApiRoute = protectedApiRoutes.some(route =>
    pathname.startsWith(route)
  );

  if (isProtectedApiRoute && !token) {
    return new NextResponse(
      JSON.stringify({ error: 'Authentication required' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Add security headers
  const response = NextResponse.next();

  // Content Security Policy
  // 토스페이먼츠: js.tosspayments.com(스크립트) / api.tosspayments.com(connect) / 결제창 iframe
  // 카카오(다음) 우편번호: 스크립트는 kakaocdn/daumcdn, iframe(우편번호 UI)은
  //   postcode.map.daum.net → postcode.map.kakao.com 로 302 리다이렉트되므로 둘 다 허용해야 함.
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.tosspayments.com https://t1.kakaocdn.net https://*.kakaocdn.net https://ssl.daumcdn.net https://t1.daumcdn.net https://*.daumcdn.net;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' blob: data: https:;
    media-src 'self' blob: data:;
    connect-src 'self' https://api.tosspayments.com https://js.tosspayments.com https://*.tosspayments.com https://t1.kakaocdn.net https://*.kakaocdn.net https://ssl.daumcdn.net https://*.daumcdn.net https://postcode.map.kakao.com https://postcode.map.daum.net https://*.kakao.com https://*.daum.net;
    frame-src 'self' https://*.tosspayments.com https://js.tosspayments.com postcode.map.kakao.com postcode.map.daum.net *.kakao.com *.daum.net http://postcode.map.kakao.com http://postcode.map.daum.net;
    worker-src 'self' blob:;
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  response.headers.set('Content-Security-Policy', cspHeader);

  // Other security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('X-Download-Options', 'noopen');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // HTTPS redirect in production — 프록시가 x-forwarded-proto로 http임을 명시할 때만.
  // 로컬 next start·CI E2E 같은 직결 요청은 이 헤더가 없으므로 리다이렉트하지 않는다
  // (기존: 헤더 부재 시에도 301 → localhost가 https로 튕겨 E2E·헬스체크 전멸).
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const hostHeader = request.headers.get('host') ?? '';
  const isLocalHost = hostHeader.startsWith('localhost') || hostHeader.startsWith('127.');
  if (
    process.env.NODE_ENV === 'production' &&
    forwardedProto !== null &&
    forwardedProto !== 'https' &&
    !isLocalHost
  ) {
    return NextResponse.redirect(
      `https://${hostHeader}${request.nextUrl.pathname}`,
      301
    );
  }

  // Rate limiting for sensitive routes
  const sensitiveRoutes = ['/auth/signin', '/auth/signup', '/api/auth'];
  const isSensitiveRoute = sensitiveRoutes.some(route =>
    pathname.startsWith(route)
  );

  if (isSensitiveRoute) {
    // Add rate limiting headers (implementation would depend on your rate limiting solution)
    response.headers.set('X-RateLimit-Limit', '5');
    response.headers.set('X-RateLimit-Remaining', '4');
    response.headers.set('X-RateLimit-Reset', (Date.now() + 900000).toString());
  }

  // Add user info to request headers for API routes
  if (pathname.startsWith('/api/') && token) {
    response.headers.set('X-User-ID', token.sub || '');
    response.headers.set('X-User-Role', token.role || 'user');
    response.headers.set('X-User-Email', token.email || '');
  }

  // Logging middleware (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[Middleware] ${request.method} ${pathname} - User: ${token?.email || 'anonymous'} - Role: ${token?.role || 'none'}`
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, icons, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|images|icons|robots.txt|sitemap.xml).*)',
  ],
};
