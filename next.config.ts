import type { NextConfig } from "next";

const devPort = (process.env.PORT ?? "3000").replace(/[^0-9A-Za-z_-]/g, "") || "3000";

const nextConfig: NextConfig = {
  distDir:
    process.env.NODE_ENV === "production" ? ".next" : `.next-dev-${devPort}`,
  experimental: {
    // Allow large multipart payloads (photo/video training uploads) through
    // middleware proxying and action parsing paths in dev/server runtimes.
    middlewareClientMaxBodySize: "64mb",
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Dev-server file cache has been unstable in this repo and can leave
      // Next unable to read routes-manifest/chunk artifacts after a few requests.
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
