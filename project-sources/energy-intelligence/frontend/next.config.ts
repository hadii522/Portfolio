import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.ETIP_API_ORIGIN || 'http://127.0.0.1:8000'}/api/:path*`,
      },
    ];
  },
};
export default nextConfig;
