import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Next asks for this to be explicit when cacheComponents is on. `true` is the
  // default for new projects (segments prefetch their static shell only).
  partialPrefetching: true,
  // pdfjs loads its worker file at run time; bundling it breaks that path
  // (resume text for tailored questions).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
