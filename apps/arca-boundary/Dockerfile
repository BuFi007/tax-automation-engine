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
COPY apps/wsfex-signer/src/contracts.ts apps/wsfex-signer/src/contracts.ts
COPY apps/arca-boundary apps/arca-boundary
RUN mkdir -p /data && chown -R bun:bun /data

ENV PORT=4300
ENV ARCA_BOUNDARY_DB_PATH=/data/arca-boundary.sqlite
EXPOSE 4300
USER bun
CMD ["bun", "run", "--filter", "@tax-engine/arca-boundary", "start"]
