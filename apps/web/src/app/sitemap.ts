import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "/",
    "/policies/privacy",
    "/policies/terms",
    "/policies/data-deletion",
  ].map((path) => ({
    url: `https://themultifeed.com${path === "/" ? "" : path}`,
  }));
}
