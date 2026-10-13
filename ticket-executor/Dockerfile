FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

COPY . .
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

RUN mkdir -p /data/home /workspace && chown -R node:node /data /workspace /app

USER node
ENV HOME=/data/home \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
