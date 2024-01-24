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

This service is responsible for managing data in the Carrot protocol, which
primarily falls into two categories at the time of writing:

1. **Templates:** Represent Carrot templates, including Webpack federated React
   components, CSS, and a `base.json` metadata file.
2. **Generic specifications:** Comprise JSON files providing information about
   various entities, such as KPI token campaign specifications and DefiLlama
   oracle specifications.

### Data States

Data in Carrot exists in two main states:

- **Limbo:** data in limbo doesn't yet need to be persisted but is a potential
  candidate for persistence. It includes items like Carrot templates with active
  deployment proposals and specifications for entities that have yet to be
  created.
- **Persistent:** data in the persistent state is data that is referenced by
  on-chain entities within the Carrot protocol. This data needs to be reliably
  available at all times and for an extremely long period of time.

### On-Chain Data Reference

The on-chain reference mechanism previously mentioned and used to determine if
data should be persisted and removed from limbo is based on CIDs following the
`multiformats` CIDv1 specification. A given CID is considered referenced
on-chain when it's stored in the blockchain's state by a Carrot protocol etity.
At that point the data referenced by that CID needs to be persisted.

### Storage Locations

Data in Carrot is mainly stored in two locations:

- **AWS S3 Bucket:** this is a solution for hot/warm storage of both limbo and
  persistent data, served through a CloudFront distributed CDN for quick access.
  The S3 bucket contains all non-expired limbo data (both raw data and IPFS CAR
  data) plus all persisted data, and is indexed using CIDs for the data itself.

- **IPFS/Filecoin:** here we exclusively store persistent data that needs to be
  extremely long lived and available in a decentralized way. Web3.storage is
  utilized for IPFS data uploads and Filecoin persistence operations.

### API endpoints

1. **`/data/s3/json`:** this endpoint can be used to store JSON limbo data. The
   API takes the raw input JSON, encodes it into the IPFS CAR format and
   determines the raw data CID. Both the raw content and the CAR file are
   uploaded to the S3 bucket using the CID as the base key (the raw content uses
   the CID itself as the key, while the CAR is uploaded under `$CID/car`).

2. **`/data/ipfs`:** this endpoint persists limbo data and replicates it to
   IPFS/Filecoin. The API accepts a single parameter `cid` which must refer to
   some limbo data that the caller wants to persist to IPFS/Filecoin. The API
   fetches the CAR associated with the passed CID (stored on the S3 bucket under
   `$CID/car`) and stores the fetched CAR file on IPFS/Filecoin through
   web3.storage's w3up service. The resulting upload CID is checked for
   consistency and if everything is fine the raw data is also persisted on the
   S3 bucket while the CAR is deleted from there.

### Benefits of this approach

This centralized approach where only this service manages Carrot data has a few
extremely important benefits.

#### Deterministic CIDs

IPFS can store data in different formats, and depending on the picked format,
the same starting data can result in different multihashes once uploaded to the
network, which in the end results in different CIDs. This is a problem for
Carrot because the on-chain CID references are immutable and we need some way to
guarantee that the on-chain CIDs reference some real data that is in fact stored
on IPFS.

Let's have the following example:

1. A template author wants to add a template to Carrot to unlock some specific
   functionality. He builds the template and ends up with the final template's
   code, which he uploads to IPFS using a pinning service such as Pinata.
2. The output step from step 1 is the template's code CID, which can be used to
   create a proposal to add the template to Carrot on-chain. The proposal is
   created.
3. After some time, the proposal is approved and the template is added to Carrot
   on-chain. This results in the template code'S CID being referenced on-chain,
   which should make the data persistent in Carrot, as explained above.
4. The IPFS pinner daemon picks up this added reference and makes the template
   code persistent on IPFS. In order to do that it downloads the template's code
   from IPFS and uploads it to web3.storage through a dedicated library. This
   library follows a different data encoding prodedure, resulting in a different
   multihash and CID at the end of the process. **So at this point the same
   starting data has been added to IPFS in different ways, resulting in a CID
   mismatch.**
5. After some time the author unpins from Pinata the template's code.

The end result? The template's code has been put in limbo and then persisted to
IPFS in 2 different ways, resulting in 2 different CIDs, and now the limbo data
is no more. We end up with a dangling CID: **the on-chain reference to the
template's code is referencing data the doesn't exist anywhere**.

The best solution to avoid this scenario is to handle both limbo data addition
and persistent data addition in the same place, and this place is the
`data-uploader` service. Adding data to limbo will cause the `data-uploader`
service to calculate this data's CID by creating an IPFS CAR containing the
data, and returning this CID to the caller. **It's then responsibility of the
caller to use that CID to reference the limbo data**. As long as the caller does
that, we have an extremely strong guarantee that when the data will be persisted
it will be persisted with the same original CID. This is because the peristence
process is performed by storing the CAR file on IPFS/Filecoin, the same CAR file
that was originarily used to determine's the data CID.

#### Performance and decentralization

Through the double S3/IPFS storing mechanism we can guarantee the best
properties of both worlds. If a Carrot user doesn't have strong decentralization
guarantee he will be able to access all Carrot data from the S3 bucket directly
through a distributed CloudFront CDN, as the bucket always contains all limbo
data + persisted data. The addition of the CDN also boosts data delivery
performance, resulting in a snappier and overall better experience.

For users that want the maximum amount of decentralization and trustlessness
it's also possible to access Carrot data directly from IPFS too, as IPFS will
have all Carrot's persistent data at all times. In most cases this won't have
the same performance of a distributed CloudFrontn CDN though.

This setup is especially powerful (in both decentralization and trustlessness)
if coupled with a frontend that allows using a locally hosted IPFS node to
access the data.

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
pnpm dev
```

This command will start the server and automatically restart it on code changes
leveraging `nodemon` and `tsx`.

If you at any time need a test JWT to call the APIs locally, take a look at the
script under `./scripts/generate-jwt.ts`. You can call it using:

```
pnpm generate-jwt
```

## OpenAPI

The OpenAPI specification is exposed under `/swagger.json`, while the Swagger UI
is exposed under `/documentation`, so you can easily test the API that way.

## Docker build

To build a Docker image of the service, run the following command from the root
of the monorepo.

```
docker build .
```
