import type { NextConfig } from 'next';

// Strict security headers + CSP. Tweak `connect-src` if your app talks
// to APIs other than Supabase. The starter ships with the safest
// baseline for a typical Tarrs project.
const isDev = process.env.NODE_ENV !== 'production';
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

const csp = [
  `default-src 'self'`,
  `script-src 'self' ${isDev ? "'unsafe-eval'" : ''} 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${supabaseHost} wss://*.supabase.co`,
  `frame-ancestors 'none'`,
  `form-action 'self'`,
  `base-uri 'self'`,
  `object-src 'none'`,
]
  .filter(Boolean)
  .join('; ');

const nextConfig: NextConfig = {
  // Tarrs sandbox runs the container behind an ALB on port 3000.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
