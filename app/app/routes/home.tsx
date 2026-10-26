import { Suspense } from "react";
import { Await } from "react-router";
import type { Route } from "./+types/home";

// Simulate slow data fetches of varying speeds.
// In a real app these would be database queries, API calls, etc.
function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(resolve, ms, value));
}

const TITLE = "Serverless React SSR";
const DESCRIPTION = "React Router 7 streaming SSR on AWS Lambda.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
  ];
}

export async function loader() {
  // Return a mix of resolved data and pending promises.
  // The shell renders immediately with the fast data,
  // and each Suspense boundary streams in as its promise resolves.
  return {
    greeting: "Hello from the edge!",
    fast: delay(200, {
      label: "Fast query",
      detail: "User profile loaded in ~200ms",
    }),
    medium: delay(1000, {
      label: "Medium query",
      detail: "Recent activity loaded in ~1s",
    }),
    slow: delay(3000, {
      label: "Slow query",
      detail: "Analytics dashboard loaded in ~3s",
    }),
  };
}

function Card({
  label,
  detail,
  color,
}: {
  label: string;
  detail: string;
  color: string;
}) {
  return (
    <div
      className={`rounded-lg border p-6 ${color} transition-all duration-300`}
    >
      <h3 className="text-lg font-semibold">{label}</h3>
      <p className="mt-1 text-sm opacity-80">{detail}</p>
    </div>
  );
}

function Skeleton({ color }: { color: string }) {
  return (
    <div
      className={`rounded-lg border p-6 ${color} animate-pulse transition-all duration-300`}
    >
      <div className="h-5 w-32 rounded bg-current opacity-20" />
      <div className="mt-3 h-4 w-48 rounded bg-current opacity-10" />
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { greeting, fast, medium, slow } = loaderData;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-950 px-4 text-white">
      <h1 className="mb-2 text-5xl font-bold tracking-tight sm:text-6xl">
        {greeting}
      </h1>
      <p className="mb-12 text-lg text-gray-400">
        Watch each section stream in as its data resolves.
      </p>

      <div className="grid w-full max-w-2xl gap-4">
        <Suspense
          fallback={
            <Skeleton color="border-green-800 bg-green-950 text-green-400" />
          }
        >
          <Await resolve={fast}>
            {(data) => (
              <Card
                {...data}
                color="border-green-700 bg-green-950 text-green-300"
              />
            )}
          </Await>
        </Suspense>

        <Suspense
          fallback={
            <Skeleton color="border-yellow-800 bg-yellow-950 text-yellow-400" />
          }
        >
          <Await resolve={medium}>
            {(data) => (
              <Card
                {...data}
                color="border-yellow-700 bg-yellow-950 text-yellow-300"
              />
            )}
          </Await>
        </Suspense>

        <Suspense
          fallback={
            <Skeleton color="border-red-800 bg-red-950 text-red-400" />
          }
        >
          <Await resolve={slow}>
            {(data) => (
              <Card
                {...data}
                color="border-red-700 bg-red-950 text-red-300"
              />
            )}
          </Await>
        </Suspense>
      </div>

      <p className="mt-12 text-sm text-gray-500">
        Without streaming, you'd wait 3s for a blank screen. With streaming, the
        shell and fast data arrive instantly.
      </p>
    </main>
  );
}
