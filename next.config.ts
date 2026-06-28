import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@onjmin/dtm"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
