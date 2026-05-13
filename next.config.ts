import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'accelerometer=(), camera=(), microphone=(), geolocation=(), usb=(), magnetometer=(), gyroscope=()',
          },
          {
            key: 'Content-Security-Policy',
            value: `
              default-src 'self';
              script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com;
              style-src 'self' 'unsafe-inline';
              img-src 'self' data: https: blob:;
              font-src 'self' data: https:;
              connect-src 'self' https://accounts.google.com;
              frame-ancestors 'none';
              base-uri 'self';
              form-action 'self';
            `.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
