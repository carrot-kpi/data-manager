FROM node:iron-alpine as base

FROM base as builder
WORKDIR /app
COPY package.json .
COPY package-lock.json .
RUN npm ci
COPY src/ src/
RUN npm run build

FROM base as runner
WORKDIR /app

COPY --from=builder /app/out .

RUN addgroup -S w3up-uploader-runners
RUN adduser -S -G w3up-uploader-runners w3up-uploader-runner
USER w3up-uploader-runner

ARG HOST
ENV HOST=$HOST

ARG PORT
ENV PORT=$PORT

ARG W3UP_PRINCIPAL_KEY
ENV W3UP_PRINCIPAL_KEY=$W3UP_PRINCIPAL_KEY

ARG W3UP_DELEGATION_PROOF
ENV W3UP_DELEGATION_PROOF=$W3UP_DELEGATION_PROOF

EXPOSE $PORT
ENTRYPOINT ["node", "index.js"]
