# Serverless React SSR Template

A production-ready starting point for deploying a React Router 7 application with streaming server-side rendering on AWS Lambda. Zero servers to manage, scales to zero cost under free tier, and streams HTML to the browser as data becomes available.

## Why This Exists

Most React SSR setups either require a long-running server (EC2, ECS, etc.) or sacrifice streaming for a simpler serverless deployment. This template gives you both: fully serverless infrastructure with true streaming SSR via Lambda Function URLs.

The included demo page makes the streaming benefit visible — three simulated data fetches at different speeds (200ms, 1s, 3s) each stream into the page as they resolve, instead of making the user wait for the slowest one.

## Architecture

```
                         +----------------+
                         |   CloudFront   |
                         |  Distribution  |
                         +-------+--------+
                                 |
                    +------------+------------+
                    |                         |
             /assets/*                   /* (default)
                    |                         |
              +-----v-----+          +-------v--------+
              |  S3 Bucket |          |     Lambda     |
              |  (static)  |          |   (Node.js 22) |
              +------------+          | React Router 7 |
                                      |  Function URL  |
                                      +----------------+
```

- **CloudFront** terminates TLS and routes traffic. Static assets (`/assets/*`) go to S3 with long cache headers. Everything else goes to Lambda for SSR.
- **Lambda Function URL** with `RESPONSE_STREAM` invoke mode streams HTML chunks to the browser as React renders them. No API Gateway needed.
- **S3** hosts the Vite-built client assets (JS, CSS) with content-hashed filenames for cache busting.

## Quick Start

### Prerequisites

- Node.js 22+
- AWS CLI configured with credentials
- AWS CDK (`npm install -g aws-cdk` or use `npx`)

### Install

```bash
(cd app && npm install)
(cd infrastructure && npm install)
```

### Local Development

```bash
cd app
npm run dev
```

Opens at `http://localhost:5173` with hot module replacement.

### Deploy

```bash
./deploy.sh
```

This builds the app, bootstraps CDK (if needed), and deploys everything. The CloudFront URL is printed as a stack output.

## Project Structure

```
app/                        # React Router 7 application
  app/
    routes/
      home.tsx              # Streaming demo (Suspense + Await)
      splat.tsx              # Catch-all 404 handler
    root.tsx                # HTML shell and error boundary
    routes.ts               # Route definitions
    app.css                 # Tailwind CSS
  server/
    lambda.ts               # Lambda handler — converts Function URL
                            # events to Web Requests and streams
                            # the response back
  build-lambda.mjs          # esbuild script to bundle the handler
  react-router.config.ts    # SSR enabled
  vite.config.ts            # Vite + React Router + Tailwind plugins

infrastructure/             # AWS CDK (TypeScript)
  bin/app.ts                # Stack instantiation
  lib/
    serverless-react-ssr-stack.ts  # S3 + Lambda + CloudFront

deploy.sh                   # One-command build + deploy
design/
  infrastructure.md         # Detailed architecture documentation
```

## How Streaming Works

React Router 7 loaders can return promises alongside resolved data. The server renders what it can immediately (the HTML shell, layout, any synchronous content) and streams it to the browser. As each promise resolves, React sends the rendered chunk down the same HTTP response.

In the Lambda handler, `awslambda.streamifyResponse()` pipes this directly to the client — no buffering the full response first.

```
Browser receives:
  [0ms]    HTML shell, layout, loading skeletons
  [200ms]  Fast data card streams in
  [1000ms] Medium data card streams in
  [3000ms] Slow data card streams in
```

Without streaming, the browser would see nothing until the slowest data source finishes at 3 seconds.

## Extending This Template

This is intentionally minimal. Here are pointers for common additions:

| Need | Approach | Reference |
|---|---|---|
| Custom domain | Route 53 + ACM certificate on CloudFront | [design/infrastructure.md](design/infrastructure.md#custom-domain) |
| Authentication | AWS Cognito, Auth0, or session cookies | [local-hero-bbq](https://github.com) example |
| WAF / rate limiting | AWS WAF attached to CloudFront (~$7/mo) | [design/infrastructure.md](design/infrastructure.md#waf) |
| Monitoring | CloudWatch alarms on Lambda errors/latency | [design/infrastructure.md](design/infrastructure.md#monitoring) |
| Database | DynamoDB, RDS, or any external API | Call from route loaders |
| CI/CD | GitHub Actions: `npm run build` then `cdk deploy` | Standard CDK pipeline |

## Cost

| Resource | Cost |
|---|---|
| Lambda | Free tier (1M requests/mo) |
| CloudFront | Free tier (1TB transfer/mo) |
| S3 | Free tier (5GB storage) |
| **Total** | **$0** under free tier |

## Tech Stack

- **React Router 7** — full-stack routing with SSR, data loading, and streaming
- **React 19** — Suspense for streaming boundaries
- **Vite** — build tooling with HMR
- **Tailwind CSS 4** — utility-first styling
- **esbuild** — bundles the Lambda handler
- **AWS CDK** — infrastructure as code (TypeScript)
- **Node.js 22** — Lambda runtime
