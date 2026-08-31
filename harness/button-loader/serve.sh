#!/bin/zsh
# Build the harness bundle, then serve the harness dir. file:// breaks ES
# modules and CORS, so a server is not optional.
set -e
cd "$(dirname "$0")/../.."
echo "building the harness bundle…"
npx webpack --config harness/button-loader/webpack.config.js >/dev/null
echo
echo "Button loader harness → http://localhost:8771/button-loader.html   (ctrl-C to stop)"
echo
python3 -m http.server 8771 --directory harness
