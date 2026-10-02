#!/bin/sh
# Remove build-time-only packages that Prisma's peer graph drags into production trees.
# The API/worker only load @prisma/client/runtime/client with the PostgreSQL driver adapter.
set -eu
DIR="$1"
cd "$DIR/node_modules/.pnpm"
for p in 'prisma@*' '@prisma+studio-core@*' '@prisma+dev@*' '@prisma+engines@*' '@prisma+engines-version@*' '@prisma+fetch-engine@*' '@prisma+get-platform@*' \
         '@electric-sql+pglite*' 'typescript@*' 'effect@*' 'react@*' 'react-dom@*' '@types+*' 'hono@*' '@hono+*' 'esbuild@*' '@esbuild+*'; do
  rm -rf $p 2>/dev/null || true
done
# Keep only the PostgreSQL query compiler (all other databases' wasm builds are dead weight).
for rt in @prisma+client@*/node_modules/@prisma/client/runtime; do
  find "$rt" -name 'query_compiler_*' ! -name '*postgresql*' -delete 2>/dev/null || true
  find "$rt" -name '*.map' -delete 2>/dev/null || true
done
find "$DIR/node_modules" -xtype l -delete 2>/dev/null || true
echo "pruned $(du -sh "$DIR/node_modules" | cut -f1) remaining in $DIR"
