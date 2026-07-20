import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Multipart uploads include a small amount of form-data overhead.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
