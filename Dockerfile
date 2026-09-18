FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle

ENV PORT=8080
ENV LOOPABLE_DISPATCHER_ID=container
EXPOSE 8080

CMD ["node", "--experimental-strip-types", "src/dispatcher/main.ts"]
