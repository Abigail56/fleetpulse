import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No floating development badge over the design. Errors still appear in the overlay.
  devIndicators: false,
  // Browser tests build separately, so they can run beside a developer's `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // A self-contained server for the production image.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // The Content-Security-Policy is set in src/proxy.ts, because it needs a nonce per response.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
    {
      // These pages can have one-time tokens in their URLs.
      source: "/(verify-email|reset-password|accept-invitation|login)",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
  ],
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
