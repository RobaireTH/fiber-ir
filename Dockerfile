FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY classifier/package.json classifier/package.json
COPY collector/package.json collector/package.json
COPY dashboard/package.json dashboard/package.json
COPY examples/package.json examples/package.json
COPY sdk/ts/package.json sdk/ts/package.json
COPY shared/package.json shared/package.json

RUN npm ci

FROM deps AS build

COPY tsconfig.json tsconfig.base.json ./
COPY api api
COPY classifier classifier
COPY collector collector
COPY dashboard dashboard
COPY examples examples
COPY sdk sdk
COPY shared shared

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8787
ENV FIR_DASHBOARD_DIST=/app/dashboard/dist

WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY classifier/package.json classifier/package.json
COPY collector/package.json collector/package.json
COPY sdk/ts/package.json sdk/ts/package.json
COPY shared/package.json shared/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/classifier/dist classifier/dist
COPY --from=build /app/collector/dist collector/dist
COPY --from=build /app/sdk/ts/dist sdk/ts/dist
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/dashboard/dist dashboard/dist

EXPOSE 8787

CMD ["node", "api/dist/server.js"]
