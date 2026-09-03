import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // Silences a Turbopack warning caused by an unrelated package-lock.json
  // sitting in the home directory, outside this repo.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
