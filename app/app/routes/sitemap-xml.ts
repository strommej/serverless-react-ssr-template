import type { Route } from "./+types/sitemap-xml";

// Public pages to list for search engines. Add new routes here.
const PATHS = ["/"];

export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const urls = PATHS.map((path) => `  <url><loc>${origin}${path}</loc></url>`);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
