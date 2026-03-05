import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  allowedDevOrigins: [`https://${process.env.REPLIT_DEV_DOMAIN}`, "http://127.0.0.1", "http://localhost"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
};
export default nextConfig;
