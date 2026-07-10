# Multi-stage Docker build optimized for Render / Fly.io free tiers
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy package manifests and install dependencies
COPY package*.json ./
RUN apt-get update && apt-get install -y openssl
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build TypeScript to JavaScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Production runtime stage
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN apt-get update && apt-get install -y openssl
RUN npm ci --only=production

# Copy generated Prisma client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy compiled build output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/index.js"]
