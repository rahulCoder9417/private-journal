import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cross-origin isolation enables SharedArrayBuffer, so on-device Whisper
  // (lib/whisper.worker.ts) can run multithreaded WASM.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
