FROM oven/bun:1.3.10

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/arca-boundary/package.json apps/arca-boundary/package.json
COPY apps/arca-setup-executor/package.json apps/arca-setup-executor/package.json
COPY apps/reclaim-proof-vault/package.json apps/reclaim-proof-vault/package.json
COPY apps/wsfex-signer/package.json apps/wsfex-signer/package.json
COPY apps/wsfe-signer/package.json apps/wsfe-signer/package.json
COPY apps/wsfecred/package.json apps/wsfecred/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/sql-store/package.json packages/sql-store/package.json
COPY packages/erp/package.json packages/erp/package.json
COPY packages/browser-contracts/package.json packages/browser-contracts/package.json
COPY packages/arca-setup-contract/package.json packages/arca-setup-contract/package.json
RUN bun install --frozen-lockfile

COPY packages packages
COPY apps/wsfex-signer apps/wsfex-signer
COPY apps/wsfe-signer apps/wsfe-signer
COPY apps/api apps/api
# browser-contracts ships prebuilt dist (bun run --filter @tax-engine/browser-contracts build
# before docker build); building it in the image needs more memory than small builders have.
RUN test -f packages/browser-contracts/dist/index.js && mkdir -p /data && chown -R bun:bun /data

ENV PORT=4100
ENV TAX_ENGINE_HOST=0.0.0.0
ENV TAX_ENGINE_DB_PATH=/data/tax-engine.sqlite
ENV TAX_ARCA_SETUP_DB_PATH=/data/arca-setup.sqlite
EXPOSE 4100
USER bun
CMD ["bun", "run", "--filter", "@tax-engine/api", "start"]
