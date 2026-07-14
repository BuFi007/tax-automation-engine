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
COPY apps/wsfecred/package.json apps/wsfecred/package.json
RUN bun install --frozen-lockfile

COPY packages/core packages/core
COPY apps/wsfex-signer apps/wsfex-signer
RUN mkdir -p /data && chown -R bun:bun /data

ENV PORT=4200
ENV WSFEX_SIGNER_DB_PATH=/data/wsfex-signer.sqlite
EXPOSE 4200
USER bun
CMD ["bun", "run", "--filter", "@tax-engine/wsfex-signer", "start"]
