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

# Carrot w3up uploader

This project implements a simple server that acts as a proxy to
[w3up](https://web3.storage)'s services. The service does not implement any auth
procedure as it's meant to run inside a properly configured Kubernetes cluster
where only other services running on the cluster can contact it.

## Tech used

The server is developed in standard JS (ESM) using `hapi`. The plugins used are:

- `boom`: used to easily handle error responses.
- `inert`, `vision` and `swagger`: used to serve a static OpenAPI documentation
  of the service (in dev environment only).

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
- `W3UP_PRINCIPAL_KEY`: a key identifying a principal that was previously
  delegated by a w3up space owner to access the space itself.
- `W3UP_DELEGATION_PROOF`: a proof that proves the delegation of `store` and
  `upload` capabilities from a space owner to the previously given principal key
  (the proof also contains the space the delegation was given on).

In order to get the correct values for `W3UP_PRINCIPAL_KEY` and
`W3UP_DELEGATION_PROOF` follow
[this procedure](https://github.com/web3-storage/w3up/tree/main/packages/w3up-client#bringing-your-own-agent-and-delegation).

Once the `.env` file has been created you can go ahead and start the server
using the following command launched from the package's root:

```
pnpm start
```

Keep in mind that no automatic restart of the server's code on changes has been
implemented, so as of now if you want to change something you'll have to kill
and restart the server manually.

## OpenAPI

The OpenAPI specification is exposed under `/swagger.json`, while the Swagger UI
is exposed under `/documentation`, so you can easily test the API that way.

## Docker build

To build a Docker image of the service, run the following command from the root
of the monorepo.

```
docker build .
```
