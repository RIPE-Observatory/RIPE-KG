# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
COPY --from=oven/bun:1.3.9-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo/ui
COPY ui/package.json ui/bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /repo
COPY ui ./ui
COPY knowledge/ripe.ttl ./knowledge/ripe.ttl
WORKDIR /repo/ui
ENV NEXT_TELEMETRY_DISABLED=1
RUN test -s public/data/1.0.0/ripe-data.ttl && test -s public/data/1.1.0/ripe-data.ttl
RUN bun run check && bun run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV RIPE_ONTOLOGY_TTL_PATH=/app/knowledge/ripe.ttl

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/ui/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/ui/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/ui/public ./public
COPY --from=builder --chown=nextjs:nodejs /repo/knowledge/ripe.ttl ./knowledge/ripe.ttl

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
