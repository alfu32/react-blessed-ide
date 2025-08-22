#!/bin/bash

export CSS_TRANSFORMER_WASM=

GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "none")
GIT_COMMIT=$(git rev-parse HEAD)
GIT_BRANCH=$(git branch --show-current)
GIT_TIME=$(date +'%Y-%m-%d %H:%M:%S')


name="John"
cat > version.json <<EOF
{
  "tag":"$GIT_TAG",
  "commit":"$GIT_COMMIT",
  "branch":"$GIT_BRANCH",
  "time":"$GIT_TIME"
}
EOF
bun vt:build
echo '#!/home/alfu64/.bun/bin/bun' > ./dist/edy.jsx
cat ./dist/app.js > ./dist/edy.jsx
chmod +x ./dist/edy.jsx
mv ./dist/edy.jsx ./dist/edy
echo '{
  "name": "edy",
  "version": "1.0.0",
  "main": "edy",
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "ignore": "^7.0.5",
    "neo-blessed": "^0.2.0",
    "raf": "^3.4.1",
    "react-blessed": "^0.7.2",
    "react-blessed-contrib-17": "^0.2.3",
    "react-error-boundary": "^6.0.0",
    "rollup-plugin-pegjs": "^2.1.3",
    "vite": "^7.0.3",
    "react": "^17.0.1"
  }
}' > dist/package.json
## bun build --target=bun ./dist/app.js --outfile dist/edy.js
## bun build --compile --target=bun-linux-x64 ./dist/app.js --outfile dist/edy-linux-x64
## bun build --compile --target=bun-macos-x64 ./dist/app.js --outfile dist/edy-macos-x64
## bun build --compile --target=bun-windows-x64 ./dist/app.js --outfile dist/edy-windows-x64.exe