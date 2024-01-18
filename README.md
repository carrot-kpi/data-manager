<br />

<p align="center">
    <img src="./.github/static/logo.svg" alt="Carrot logo" width="60%" />
</p>

<br />

<p align="center">
    Carrot is a web3 protocol trying to make incentivization easier and more capital
    efficient.
</p>

<br />

<p align="center">
    <img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3">
</p>

# Carrot data uploader

This project implements a simple server that acts as a proxy to various storage
services. Its API can be accessed with a valid JWT.

## Tech used

The server is developed in standard JS (ESM) using `hapi`. The plugins used are:

- `boom`: used to easily handle error responses.
- `inert`, `vision` and `swagger`: used to serve a static OpenAPI documentation
  of the service.
- `pino`: used to handle logging.

Additionally, request validation is performed using `joi`.

## Testing the server

Start by installing the dependencies using `pnpm`:

```
pnpm install
```

Once the dependencies are installed, create a `.env` file at the root of the
repo. For convenience, you can copy and paste the provided `.env.example` file
and rename it to `.env`.

The required env variables are:

- `HOST`: the server's host.
- `PORT`: the server's port.
- `DB_CONNECTION_STRING`: a connection string to a Postgres database.
- `JWT_SECRET`: the secret used to sign the issued JWTs. It's of utmost
  importance to keep this value secret.
- `W3UP_PRINCIPAL_KEY`: a key identifying a principal that was previously
  delegated by a w3up space owner to access the space itself.
- `W3UP_DELEGATION_PROOF`: a proof that proves the delegation of `store` and
  `upload` capabilities from a space owner to the previously given principal key
  (the proof also contains the space the delegation was given on).

In order to get the correct values for `W3UP_PRINCIPAL_KEY` and
`W3UP_DELEGATION_PROOF` follow
[this procedure](https://github.com/web3-storage/w3up/tree/main/packages/w3up-client#bringing-your-own-agent-and-delegation).

Once the `.env` file has been created, it's necessary to have all the correlated
infrastructure up and running in order to properly test the server. In
particular we need a `Postgres` database in which the server can store nonces to
avoid signature replay attacks.

For convenience all the needed infrastructure can easily be spun up using the
provided `docker-compose.yaml` file at the root of the package. Run the
following command to bootstrap everything:

```
docker compose up
```

Once the `.env` file has been created you can go ahead and start the server
using the following command launched from the package's root:

```
pnpm start
```

Keep in mind that no automatic restart of the server's code on changes has been
implemented, so as of now if you want to change something you'll have to kill
and restart the server manually.

If you at any time need a test JWT to call the APIs locally, take a look at the
script under `./scripts/generate-jwt.js`.

## OpenAPI

The OpenAPI specification is exposed under `/swagger.json`, while the Swagger UI
is exposed under `/documentation`, so you can easily test the API that way.

## Docker build

To build a Docker image of the service, run the following command from the root
of the monorepo.

```
docker build .
```
