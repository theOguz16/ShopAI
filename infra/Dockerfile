FROM node:22.14.0-bookworm-slim AS app
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production
ENTRYPOINT ["/app/infra/entrypoint.sh"]
