FROM node:22-alpine AS builder

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY web/package*.json ./web/
RUN npm ci --prefix web

COPY . ./
RUN npm run web:build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/config.js ./config.js
COPY --from=builder /app/influencerStore.js ./influencerStore.js
COPY --from=builder /app/postgresStore.js ./postgresStore.js
COPY --from=builder /app/README.md ./README.md
COPY --from=builder /app/AGENTS.md ./AGENTS.md
COPY --from=builder /app/web/dist ./web/dist

RUN mkdir -p ./data/uploads

EXPOSE 8787

CMD ["npm", "start"]
