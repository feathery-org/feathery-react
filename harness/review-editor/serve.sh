#!/bin/zsh
# Build the harness bundle, then serve the repo root so /harness/... resolves.
# file:// breaks fetch of the sample PDF and CORS, so a server is not optional.
set -e
cd "$(dirname "$0")/../.."
echo "building the harness bundle…"
npx webpack --config harness/review-editor/webpack.config.js >/dev/null
echo
echo "Review editor harness → http://localhost:8771/harness/review-editor.html   (ctrl-C to stop)"
echo
python3 -m http.server 8771
