/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Lets a test build run beside the dev server without sharing .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
module.exports = nextConfig;