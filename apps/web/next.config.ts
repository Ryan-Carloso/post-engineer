import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

//---------------
// Platform version: the repo-root VERSION file is the single source of
// truth (bumped on every PR). Read once at build time and inlined into the
// bundle via env — no external service involved. Falls back to 'dev' when
// the file is unreadable (e.g. a partial checkout).
//---------------
function readPlatformVersion(): string {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "..", "VERSION"), "utf8").trim() || "dev";
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    APP_VERSION: readPlatformVersion(),
  },
  serverExternalPackages: ['googleapis', 'google-auth-library'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'yt3.ggpht.com',
      },
      {
        protocol: 'https',
        hostname: '**.cdninstagram.com',
      },
    ],
  },
  async headers() {
    // Security headers applied to every route. `unsafe-eval` is only needed in
    // dev (React refresh / Next dev overlay); production stays strict.
    const dev = process.env.NODE_ENV !== 'production';
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');

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
          ...(dev
            ? []
            : [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains',
                },
              ]),
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://post-engineer.com' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
