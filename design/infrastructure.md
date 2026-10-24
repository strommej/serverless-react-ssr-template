# Infrastructure Design: Serverless React SSR Template

React Router 7 SSR application deployed to AWS with CDK. No auth, no custom domain — a minimal starting point.

## Architecture Overview

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
              |  (static)  |          |   (Node.js 24) |
              +------------+          | React Router 7 |
                                      |  Function URL  |
                                      +----------------+
```

## Components

### CloudFront Distribution

Single entry point for all traffic. Routes requests based on path patterns:

| Path Pattern | Origin | Cache Policy |
|---|---|---|
| `/assets/*` | S3 bucket | Long-lived (immutable, hashed filenames) |
| `/favicon.ico` | S3 bucket | Long-lived |
| `/*` (default) | Lambda Function URL | Cached only when the route sends `Cache-Control` |

A viewer-request CloudFront Function on the default behavior copies the viewer's `Host` header into `x-viewer-host`. CloudFront sends the Function URL's own domain as `Host`, so without it `request.url` in loaders would point at the Lambda URL instead of the public site.

CloudFront handles TLS termination and serves as the CDN. No API Gateway needed — Lambda Function URLs provide an HTTPS endpoint directly, which keeps costs down and reduces latency.

The template uses the CloudFront-issued `*.cloudfront.net` domain. Custom domains can be added later (see [Custom Domain](#custom-domain)).

### Lambda Function (SSR)

- **Runtime:** Node.js 24.x
- **Handler:** Converts Lambda Function URL events to Web Request API, passes them through React Router's `createRequestHandler`, and streams the response back
- **Trigger:** Lambda Function URL (streaming mode)
- **Memory:** 512 MB (start here, tune based on metrics)
- **Timeout:** 15 seconds

The handler:

```typescript
// server/lambda.ts
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequestHandler } from "react-router";

const requestHandler = createRequestHandler(
  // @ts-expect-error - virtual module resolved at build time
  await import("virtual:react-router/server-build"),
  process.env.NODE_ENV
);

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const request = createRequest(event); // Convert FunctionURL event → Web Request
    const response = await requestHandler(request);

    const metadata = {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    };

    responseStream = awslambda.HttpResponseStream.from(responseStream, metadata);

    if (response.body) {
      await pipeline(Readable.fromWeb(response.body as any), responseStream);
    } else {
      responseStream.write("");
      responseStream.end();
    }
  }
);
```

Streaming via Function URLs gives the best UX — the browser starts rendering HTML before the full response is complete.

### S3 Bucket (Static Assets)

Stores the client build output from React Router 7:

```
client/
  assets/       # JS/CSS bundles (content-hashed filenames)
  favicon.ico
```

- No public access — CloudFront uses Origin Access Control (OAC) to read from S3
- Deployed via `BucketDeployment` in CDK

### React Router 7 Build Output

React Router 7 (with Vite) produces two build artifacts:

```
build/
  server/       # Server bundle (deployed to Lambda)
  client/       # Static assets (deployed to S3)
```

Configure in `react-router.config.ts`:

```typescript
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
} satisfies Config;
```

### Lambda Bundling

A separate esbuild step bundles the Lambda handler into a single CJS file targeting Node.js 24. This runs after the React Router build:

```javascript
// build-lambda.mjs
import { build } from "esbuild";

await build({
  entryPoints: ["server/lambda.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: "build/server/lambda.js",
  external: [],
});
```

The build command chains both steps:

```json
"build": "react-router build && node build-lambda.mjs"
```

## CDK Stack

Single stack, minimal resources:

```typescript
// lib/serverless-react-ssr-stack.ts

// 1. S3 bucket for static assets
const assetsBucket = new s3.Bucket(this, "Assets", {
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

// 2. Lambda function for SSR
const ssrFunction = new lambda.Function(this, "SSR", {
  runtime: lambda.Runtime.NODEJS_24_X,
  handler: "lambda.handler",
  code: lambda.Code.fromAsset("../app/build/server"),
  memorySize: 512,
  timeout: Duration.seconds(15),
  environment: {
    NODE_ENV: "production",
  },
});

// 3. Lambda Function URL (streaming)
const functionUrl = ssrFunction.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
});

// 4. CloudFront distribution
const distribution = new cloudfront.Distribution(this, "CDN", {
  defaultBehavior: {
    origin: new origins.FunctionUrlOrigin(functionUrl),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  },
  additionalBehaviors: {
    "assets/*": {
      origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
    },
  },
});

// 5. Deploy static assets to S3
new s3deploy.BucketDeployment(this, "DeployAssets", {
  sources: [s3deploy.Source.asset("../app/build/client")],
  destinationBucket: assetsBucket,
  distribution,
  distributionPaths: ["/*"],
});

// 6. Output the CloudFront URL
new CfnOutput(this, "SiteUrl", {
  value: `https://${distribution.distributionDomainName}`,
});

new CfnOutput(this, "FunctionUrl", {
  value: functionUrl.url,
});
```

Use `lambda.Function` (not `NodejsFunction`) since Vite + esbuild already bundle the server code.

## Project Structure

```
serverless-react-ssr-template/
  app/                        # React Router 7 app
    app/
      routes/
        home.tsx              # Hello world route
      root.tsx                # Root layout
      app.css                 # Tailwind styles
      routes.ts               # Route definitions
    server/
      lambda.ts               # Lambda handler entry point
    build-lambda.mjs          # esbuild script for Lambda bundling
    react-router.config.ts
    vite.config.ts
    package.json
    tsconfig.json
  infrastructure/             # CDK app
    bin/
      app.ts
    lib/
      serverless-react-ssr-stack.ts
    cdk.json
    package.json
    tsconfig.json
  deploy.sh                   # One-command build + deploy
  build/                      # Build output (gitignored)
    server/
    client/
```

## Build & Deploy

```bash
# 1. Install dependencies
(cd app && npm install)
(cd infrastructure && npm install)

# 2. Build and deploy (one command)
./deploy.sh

# Or manually:
(cd app && npm run build)
(cd infrastructure && npx cdk bootstrap && npx cdk deploy)
```

The `deploy.sh` script:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Building app..."
(cd app && npm run build)

echo "Deploying infrastructure..."
(cd infrastructure && npx cdk bootstrap --quiet && npx cdk deploy "$@")
```

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SSR trigger | Lambda Function URL (streaming) | No API Gateway cost, supports response streaming for faster TTFB |
| Static assets | S3 + CloudFront | Standard pattern, immutable hashed assets get long cache TTLs |
| IaC | CDK (TypeScript) | Type-safe, TypeScript throughout the stack |
| No API Gateway | Lambda Function URL instead | Simpler, cheaper, supports streaming (APIGW v2 does not stream) |
| No custom domain | CloudFront `*.cloudfront.net` | Template stays simple; custom domain is an opt-in addition |
| No auth | None | Template is a blank canvas; add auth as needed |

## What's Not Included (Add as Needed)

### Custom Domain

Add a Route 53 hosted zone + ACM certificate when you have a domain:

```typescript
const hostedZone = route53.HostedZone.fromLookup(this, "Zone", {
  domainName: "example.com",
});

const certificate = new acm.Certificate(this, "Cert", {
  domainName: "example.com",
  subjectAlternativeNames: ["*.example.com"],
  validation: acm.CertificateValidation.fromDns(hostedZone),
});

// Add to CloudFront distribution:
//   domainNames: ["example.com", "www.example.com"],
//   certificate,

new route53.ARecord(this, "SiteAlias", {
  zone: hostedZone,
  target: route53.RecordTarget.fromAlias(
    new targets.CloudFrontTarget(distribution)
  ),
});
```

Note: ACM certificate must be in `us-east-1` (CloudFront requirement). Use `crossRegionReferences: true` in the stack if deploying to another region.

If both `example.com` and `www.example.com` point at the distribution, redirect one to the other so search engines index a single site. Add this to `infrastructure/functions/viewer-request.js` before the `x-viewer-host` line:

```javascript
var host = request.headers.host.value;
if (host.indexOf("www.") === 0) {
  return {
    statusCode: 301,
    statusDescription: "Moved Permanently",
    headers: { location: { value: "https://" + host.slice(4) + request.uri } },
  };
}
```

### WAF

AWS WAF for rate limiting and bot protection (~$7/month):

```typescript
const webAcl = new wafv2.CfnWebACL(this, "WAF", {
  scope: "CLOUDFRONT",
  defaultAction: { allow: {} },
  rules: [
    {
      name: "RateLimit",
      priority: 1,
      action: { block: {} },
      statement: {
        rateBasedStatement: { limit: 2000, aggregateKeyType: "IP" },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "RateLimit",
      },
    },
  ],
  visibilityConfig: {
    sampledRequestsEnabled: true,
    cloudWatchMetricsEnabled: true,
    metricName: "WAF",
  },
});

// Add to CloudFront distribution:
//   webAclId: webAcl.attrArn,
```

### Monitoring

CloudWatch alarms on Lambda metrics:

```typescript
const alarmTopic = new sns.Topic(this, "AlarmTopic");

new cloudwatch.Alarm(this, "SSRErrors", {
  metric: ssrFunction.metricErrors({ period: Duration.minutes(5) }),
  threshold: 5,
  evaluationPeriods: 2,
}).addAlarmAction(new cw_actions.SnsAction(alarmTopic));

new cloudwatch.Alarm(this, "SSRDuration", {
  metric: ssrFunction.metricDuration({
    period: Duration.minutes(5),
    statistic: "p99",
  }),
  threshold: 5000,
  evaluationPeriods: 2,
}).addAlarmAction(new cw_actions.SnsAction(alarmTopic));
```

### Edge Caching for SSR

The default behavior uses a cache policy with a default TTL of 0, so nothing is cached unless a route opts in by sending `Cache-Control`:

```typescript
const ssrCachePolicy = new cloudfront.CachePolicy(this, "SSRCachePolicy", {
  minTtl: Duration.seconds(0),
  defaultTtl: Duration.seconds(0),
  maxTtl: Duration.days(1),
  headerBehavior: cloudfront.CacheHeaderBehavior.none(),
  queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
  cookieBehavior: cloudfront.CacheCookieBehavior.none(),
  enableAcceptEncodingGzip: true,
  enableAcceptEncodingBrotli: true,
});
```

To cache a public page, export `headers` from its route:

```typescript
export function headers() {
  return { "Cache-Control": "public, max-age=60, s-maxage=300" };
}
```

Cookies are not part of the cache key, so never send a public `Cache-Control` from a page that depends on the session.

## Cost Estimate (Low Traffic)

| Resource | Cost | Notes |
|---|---|---|
| Lambda | Free tier | 1M requests/month, 400K GB-seconds |
| CloudFront | Free tier | 1TB data transfer |
| S3 | Free tier | 5GB storage |
| **Total** | **$0** | Stays free under AWS free tier limits |

## Future Considerations

- **Provisioned concurrency:** If cold starts become a problem
- **Authentication:** AWS Cognito, Auth0, or custom sessions
- **Database:** DynamoDB, RDS, or external
- **CI/CD:** GitHub Actions pipeline for automated deploys
