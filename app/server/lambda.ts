import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequestHandler } from "react-router";

// Import the React Router server build
// @ts-expect-error -- resolved at build time by esbuild
import * as build from "../build/server/index.js";

const requestHandler = createRequestHandler(build, process.env.NODE_ENV);

function createRequest(event: FunctionURLEvent): Request {
  const url = new URL(
    event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : ""),
    `https://${event.requestContext.domainName}`
  );

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value) headers.set(key, value);
  }
  if (event.cookies?.length) {
    headers.set("cookie", event.cookies.join("; "));
  }

  const method = event.requestContext.http.method;
  const hasBody = method !== "GET" && method !== "HEAD" && event.body;
  const body = hasBody
    ? event.isBase64Encoded
      ? Buffer.from(event.body!, "base64")
      : event.body
    : undefined;

  return new Request(url.toString(), { method, headers, body });
}

// @ts-expect-error awslambda is a Lambda runtime global
export const handler = awslambda.streamifyResponse(
  async (
    event: FunctionURLEvent,
    responseStream: NodeJS.WritableStream
  ) => {
    const request = createRequest(event);
    const response = await requestHandler(request);

    const metadata = {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    };

    // @ts-expect-error awslambda is a Lambda runtime global
    responseStream = awslambda.HttpResponseStream.from(
      responseStream,
      metadata
    );

    if (response.body) {
      await pipeline(Readable.fromWeb(response.body as any), responseStream);
    } else {
      responseStream.write("");
      responseStream.end();
    }
  }
);

interface FunctionURLEvent {
  rawPath: string;
  rawQueryString: string;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded: boolean;
  requestContext: {
    domainName: string;
    http: {
      method: string;
    };
  };
}
