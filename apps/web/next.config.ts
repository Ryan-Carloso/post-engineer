import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

//---------------
// Build metadata: VERSION/BUILD/COMMIT are injected at build time — CI sets
// them from the repo-root VERSION file (manual SemVer), the CI run number,
// and the commit SHA (see apps/web/Dockerfile ARGs). Local builds fall back
// to the VERSION file for the version; build/commit stay empty there.
// Inlined into the bundle via env — no external service involved. Falls
// back to 'dev' when the file is unreadable (e.g. a partial checkout).
//---------------
function readPlatformVersion(): string {
  const injected = process.env.VERSION?.trim();
  if (injected) return injected;
  try {
    return fs.readFileSync(path.join(__dirname, "..", "..", "VERSION"), "utf8").trim() || "dev";
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  /* config options here */
  // Standalone output: the Docker image (apps/web/Dockerfile) copies only
  // the traced server + node_modules, keeping the image small.
  output: "standalone",
  env: {
    VERSION: readPlatformVersion(),
    BUILD: process.env.BUILD?.trim() ?? '',
    COMMIT: process.env.COMMIT?.trim() ?? '',
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
