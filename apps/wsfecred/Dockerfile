FROM oven/bun:1.3.10

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/arca-boundary/package.json apps/arca-boundary/package.json
COPY apps/reclaim-proof-vault/package.json apps/reclaim-proof-vault/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/wsfex-signer/package.json apps/wsfex-signer/package.json
COPY apps/wsfe-signer/package.json apps/wsfe-signer/package.json
COPY apps/wsfecred/package.json apps/wsfecred/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/erp/package.json packages/erp/package.json
RUN bun install --frozen-lockfile

# The read-only lifecycle client imports the shared isValidCuit validator from the
# Factura E signer's contracts subpath, which in turn imports @tax-engine/core, so
# both must be present in the build.
COPY packages/core packages/core
COPY apps/wsfex-signer apps/wsfex-signer
COPY apps/wsfecred apps/wsfecred

ENV PORT=4400
EXPOSE 4400
USER bun
CMD ["bun", "run", "--filter", "@tax-engine/wsfecred", "start"]
