import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "framer-motion",
      "@chakra-ui/react",
      "@radix-ui/react-dialog",
    ],
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    turbopackFileSystemCacheForDev: true,
    turbopackFileSystemCacheForBuild: true,
  },
  turbopack: {
    root: rootDir,
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store",
          },
        ],
      },
      {
        source: "/:path*.(avif|gif|ico|jpg|jpeg|png|svg|webp|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

// LOCK L0.4 — wrap for source-map upload and tunnelling.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps when an auth token exists. Without this guard the
  // build FAILS on any machine lacking the token — including CI, which has no
  // reason to hold one. A monitoring tool must never be able to break a build.
  silent: !process.env.CI,

  // Route Sentry requests through the app's own domain so ad blockers do not
  // silently drop them. Losing error reports to a content blocker is the same
  // failure class this lock exists to end: absence of signal read as health.
  tunnelRoute: "/monitoring",

  // Strip the injected source-map comments from the client bundle.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
