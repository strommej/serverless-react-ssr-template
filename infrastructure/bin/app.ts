#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ServerlessReactSsrStack } from "../lib/serverless-react-ssr-stack.js";

const app = new cdk.App();

new ServerlessReactSsrStack(app, "ServerlessReactSsrStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
});
