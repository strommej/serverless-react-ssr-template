import { build } from "esbuild";

await build({
  entryPoints: ["server/lambda.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "build/server/lambda.js",
  external: [],
});

console.log("Lambda handler bundled → build/server/lambda.js");
