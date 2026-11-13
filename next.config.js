const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: {},
};

module.exports = withPWA(nextConfig);