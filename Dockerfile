# -------------------------
# Deps + build
# -------------------------
FROM node:22.23.2-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# python3/make/g++ are needed to compile bcrypt's native addon on Alpine/musl.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

# -------------------------
# Runtime (Next standalone output)
# -------------------------
FROM node:22.23.2-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/bcrypt ./node_modules/bcrypt

USER nextjs
EXPOSE 3100
CMD ["node", "server.js"]
