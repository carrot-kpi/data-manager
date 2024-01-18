FROM node:iron-alpine as base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV SKIP_GIT_HOOKS_SETUP=true
RUN corepack enable
WORKDIR /app

FROM base as prod-deps
COPY package.json .
COPY pnpm-lock.yaml .
COPY scripts/ scripts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base as build
COPY package.json .
COPY pnpm-lock.yaml .
COPY scripts/ scripts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY src/ src/
RUN pnpm build

FROM base as runner

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/out/index.mjs /app/index.mjs

RUN addgroup -S data-uploader-runners
RUN adduser -S -G data-uploader-runners data-uploader-runner
USER data-uploader-runner

ARG HOST
ENV HOST=$HOST

ARG PORT
ENV PORT=$PORT

ARG W3UP_PRINCIPAL_KEY
ENV W3UP_PRINCIPAL_KEY=$W3UP_PRINCIPAL_KEY

ARG W3UP_DELEGATION_PROOF
ENV W3UP_DELEGATION_PROOF=$W3UP_DELEGATION_PROOF

EXPOSE $PORT
ENTRYPOINT ["node", "index.mjs"]
