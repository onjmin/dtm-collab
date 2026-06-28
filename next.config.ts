import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/dtm-collab" : "",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@onjmin/dtm"],
};

export default nextConfig;
