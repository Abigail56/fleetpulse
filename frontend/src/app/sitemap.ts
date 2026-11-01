import type { MetadataRoute } from "next";

const PATHS = ["", "/features", "/solutions", "/pricing", "/about", "/contact", "/terms", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3210";
  return PATHS.map((path) => ({ url: `${base}${path}` }));
}
