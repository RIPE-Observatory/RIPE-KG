import releases from "./src/lib/releases.json";
import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: appRoot,
    // Monaco embeds an older sanitizer; use the patched, locked npm dependency.
    resolveAlias: { "./dompurify/dompurify.js": "dompurify" },
  },
  async headers() {
    return Object.keys(releases).flatMap((version) =>
      Object.entries({ ttl: "text/turtle", jsonld: "application/ld+json", rdf: "application/rdf+xml", nt: "application/n-triples" }).map(([ext, type]) => ({
        source: `/data/${version}/ripe-data.${ext}`,
        headers: [
          { key: "Content-Type", value: type + "; charset=utf-8" },
          { key: "X-RIPE-KG-Version", value: version },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Expose-Headers", value: "X-RIPE-KG-Version" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      }))
    );
  },
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
