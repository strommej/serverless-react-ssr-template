import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import type { Construct } from "constructs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_PATH = path.join(__dirname, "../../app/build");

export class ServerlessReactSsrStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- S3: Static assets bucket ---
    const assetsBucket = new s3.Bucket(this, "Assets", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // --- Lambda: SSR function ---
    const ssrFunction = new lambda.Function(this, "SSR", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "lambda.handler",
      code: lambda.Code.fromAsset(path.join(BUILD_PATH, "server")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: {
        NODE_ENV: "production",
      },
    });

    // --- Lambda Function URL (streaming) ---
    const functionUrl = ssrFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // --- CloudFront: viewer host forwarding ---
    const viewerRequestFn = new cloudfront.Function(this, "ViewerRequest", {
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, "../functions/viewer-request.js"),
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // --- CloudFront: SSR cache policy ---
    // Pages are cached only when a route sends Cache-Control (e.g. s-maxage).
    // Responses without it pass straight through to Lambda.
    const ssrCachePolicy = new cloudfront.CachePolicy(this, "SSRCachePolicy", {
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const staticFile: cloudfront.BehaviorOptions = {
      origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    };

    // --- CloudFront: Distribution ---
    const distribution = new cloudfront.Distribution(this, "CDN", {
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(functionUrl),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: ssrCachePolicy,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [
          {
            function: viewerRequestFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "assets/*": staticFile,
        "favicon.ico": staticFile,
      },
    });

    // --- S3 Deployment: Sync client build to S3 ---
    new s3deploy.BucketDeployment(this, "DeployAssets", {
      sources: [s3deploy.Source.asset(path.join(BUILD_PATH, "client"))],
      destinationBucket: assetsBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });

    new cdk.CfnOutput(this, "FunctionUrl", {
      value: functionUrl.url,
    });
  }
}
