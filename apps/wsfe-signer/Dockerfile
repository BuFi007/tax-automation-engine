FROM oven/bun:1.3.10

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/arca-boundary/package.json apps/arca-boundary/package.json
COPY apps/reclaim-proof-vault/package.json apps/reclaim-proof-vault/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/erp/package.json packages/erp/package.json
COPY apps/wsfex-signer/package.json apps/wsfex-signer/package.json
COPY apps/wsfe-signer/package.json apps/wsfe-signer/package.json
RUN bun install --frozen-lockfile

COPY packages/core packages/core
# The Factura C signer imports the shared isValidCuit validator from the
# Factura E signer's contracts subpath, so its source must be present.
COPY apps/wsfex-signer apps/wsfex-signer
COPY apps/wsfe-signer apps/wsfe-signer
RUN mkdir -p /data && chown -R bun:bun /data

ENV PORT=4300
ENV WSFE_SIGNER_DB_PATH=/data/wsfe-signer.sqlite
EXPOSE 4300
USER bun
CMD ["bun", "run", "--filter", "@tax-engine/wsfe-signer", "start"]
