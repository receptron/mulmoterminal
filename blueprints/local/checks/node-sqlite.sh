#!/bin/sh
# Node is new enough to open a database with the built-in node:sqlite, and yarn answers.
set -eu
node -e 'const { DatabaseSync } = require("node:sqlite"); new DatabaseSync(":memory:").exec("create table t (x)")' 2>/dev/null ||
  { echo "this Node cannot open node:sqlite; install Node.js 22.13 or later" >&2; exit 1; }
yarn --version >/dev/null 2>&1 || { echo "yarn is missing (corepack enable)" >&2; exit 1; }
