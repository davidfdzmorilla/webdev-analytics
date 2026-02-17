FROM node:22-slim AS base
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY . .
RUN pnpm build

FROM node:22-slim AS production
RUN corepack enable pnpm
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
EXPOSE 3026
ENV PORT=3026
CMD ["pnpm", "start"]
