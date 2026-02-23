#!/usr/bin/env sh
set -eu

if [ -f package.json ]; then
  npm install --no-audit --no-fund
  exec npm start
fi

echo "package.json not found in working directory: $(pwd)"
ls -la
exit 1
