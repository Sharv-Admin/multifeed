import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/sign-in",
        "/overview",
        "/connections",
        "/calendar",
        "/posts",
        "/teams",
        "/settings",
        "/billing",
      ],
    },
    sitemap: "https://themultifeed.com/sitemap.xml",
  };
}
