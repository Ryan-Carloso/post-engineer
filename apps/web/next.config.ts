import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

function readPlatformVersion(): string {
  const injected = process.env.VERSION?.trim();
  if (injected) return injected;
  try {
    return fs.readFileSync(path.join(__dirname, "..", "..", "VERSION"), "utf8").trim() || "dev";
  } catch {
    return "dev";
  }
}

function readBuiltAt(): string {
  const injected = process.env.BUILT_AT?.trim();
  if (injected) return injected;
  try {
    return fs.readFileSync(path.join(__dirname, ".built-at"), "utf8").trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    VERSION: readPlatformVersion(),
    PR_NUMBER: process.env.PR_NUMBER?.trim() ?? '',
    BUILD: process.env.BUILD?.trim() ?? '',
    COMMIT: process.env.COMMIT?.trim() ?? '',
    BUILT_AT: readBuiltAt(),
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
      {
        protocol: 'https',
        hostname: 'yt3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '**.fbcdn.net',
      },
      {
        protocol: 'https',
        hostname: 'cdn.bsky.app',
      },
      {
        protocol: 'https',
        hostname: 'media.licdn.com',
      },
      {
        protocol: 'https',
        hostname: 'i.pinimg.com',
      },
      {
        protocol: 'https',
        hostname: 'media.fanvue.com',
      },
    ],
  },
  async redirects() {
    return [
      { source: '/api-keys', destination: '/recipes', permanent: true },
      { source: '/posts/history', destination: '/posts', permanent: true },
    ];
  },
  async headers() {
    const dev = process.env.NODE_ENV !== 'production';
    const instrumented = process.env.CYPRESS_COVERAGE === '1';
    const evalException = dev || instrumented ? " 'unsafe-eval'" : '';
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${evalException} https://*.posthog.com`,
      "worker-src 'self' blob:",
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
        source: '/s/:token*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'private, max-age=60' },
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
