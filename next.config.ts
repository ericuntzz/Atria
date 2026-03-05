import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevHosts: ["all"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
