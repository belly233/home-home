import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma + pg must run as real Node modules; bundling them with Turbopack
  // can throw Invalid `__TURBOPACK__imported__module__` on Vercel at runtime.
  serverExternalPackages: ["@prisma/client", "prisma", "pg", "@prisma/adapter-pg"],
};

export default nextConfig;
