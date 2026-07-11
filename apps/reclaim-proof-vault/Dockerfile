FROM oven/bun:1.3.10

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/arca-boundary/package.json apps/arca-boundary/package.json
COPY apps/reclaim-proof-vault/package.json apps/reclaim-proof-vault/package.json
COPY apps/wsfex-signer/package.json apps/wsfex-signer/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/erp/package.json packages/erp/package.json
RUN bun install --frozen-lockfile

COPY packages/core packages/core
COPY apps/arca-boundary/src/crypto.ts apps/arca-boundary/src/crypto.ts
COPY apps/reclaim-proof-vault apps/reclaim-proof-vault
RUN mkdir -p /data && chown -R bun:bun /data

ENV PORT=4400
ENV RECLAIM_PROOF_VAULT_DB_PATH=/data/reclaim-proof-vault.sqlite
EXPOSE 4400
USER bun
CMD ["bun", "run", "--filter", "@tax-engine/reclaim-proof-vault", "start"]
