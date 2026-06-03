import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    cachedNavigations: true,
    instantInsights: {
      validationLevel: "warning"
    }
  },
  cacheComponents: true,
  turbopack: {
    root,
  },
};

export default nextConfig;