#!/usr/bin/env bash
# Vendor this package's runtime (src + manifest/tools.js) into a consumer
# repo, e.g. scripts/sync-to.sh ../alertkick-ui/src/lib/webmcp
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
dest=${1:?usage: sync-to.sh <dest-dir>}
mkdir -p "$dest/manifest"
cp "$here"/src/*.js "$dest/"
cp "$here"/src/manifest/tools.js "$dest/manifest/"
cp "$here"/LICENSE "$dest/LICENSE"
ver=$(node -e "console.log(require('$here/package.json').version)")
printf '# Vendored from https://github.com/alertkick/alertkick-webmcp v%s\n# Do not edit here; run scripts/sync-to.sh in that repo.\n' "$ver" > "$dest/VENDORED.md"
echo "synced @alertkick/webmcp v$ver -> $dest"
