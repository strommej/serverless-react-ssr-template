#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Building app..."
(cd app && npm run build)

echo "Deploying infrastructure..."
(cd infrastructure && npx cdk bootstrap --quiet && npx cdk deploy "$@")
