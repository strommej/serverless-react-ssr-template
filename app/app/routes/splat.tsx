import { data } from "react-router";

export function loader() {
  throw data(null, { status: 404 });
}

// A default export makes this a page route, so unknown URLs get the root
// ErrorBoundary's HTML 404 page instead of a JSON body.
export default function NotFound() {
  return null;
}
