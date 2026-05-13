# ---------- Etapa 1: build ----------
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# ---------- Etapa 2: runtime ----------
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      tini \
      tzdata \
    && rm -rf /var/lib/apt/lists/*

# Zona horaria del contenedor (Node + Postgres-tools la usan).
# El valor real lo pisa la variable TZ que pasa docker-compose desde .env.production.
ENV TZ=America/Guayaquil
RUN ln -fs /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo "$TZ" > /etc/timezone

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY public ./public

# Carpetas persistentes (montadas como volúmenes)
RUN mkdir -p /app/uploads \
    && chown -R node:node /app

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
