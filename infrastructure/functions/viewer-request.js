// CloudFront Function (viewer request) for the SSR behavior.
// CloudFront sends the Function URL's own host to Lambda, so this copies the
// viewer's Host into x-viewer-host. The app uses it to build absolute URLs
// (canonical links, robots.txt, sitemap.xml).
function handler(event) {
  var request = event.request;
  request.headers["x-viewer-host"] = { value: request.headers.host.value };
  return request;
}
