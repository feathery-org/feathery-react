#!/bin/zsh
# Build the harness bundle, then serve the repo root so /harness/... and
# /node_modules/... both resolve. file:// breaks ES modules and CORS, so a server
# is not optional.
set -e
cd "$(dirname "$0")/../.."
echo "building the harness bundle…"
npx webpack --config harness/bindings/webpack.config.js >/dev/null
echo
echo "Bindings harness → http://localhost:8770/harness/bindings.html   (ctrl-C to stop)"
echo
python3 -m http.server 8770
