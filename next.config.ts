import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: "." },
  /* config options here */
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
