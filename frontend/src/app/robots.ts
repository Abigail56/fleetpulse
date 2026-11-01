import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/status", "/design-system", "/account", "/dashboard", "/onboarding", "/organisation", "/vehicles", "/drivers", "/tracking", "/map", "/trips", "/alerts", "/geofences", "/maintenance", "/costs", "/compliance", "/notifications", "/automation", "/reports", "/billing", "/admin"] },
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3210"}/sitemap.xml`,
  };
}
