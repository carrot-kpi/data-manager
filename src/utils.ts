import {
    create as createW3UpClient,
    type Client as W3UpClient,
} from "@web3-storage/w3up-client";
import {
    parse as parsePrincipalKey,
    type Block,
} from "@ucanto/principal/ed25519";
import { importDAG } from "@ucanto/core/delegation";
import { CarReader } from "@ipld/car";
import { S3Client } from "@aws-sdk/client-s3";
import pg, { type Client as PgClient } from "pg";
import { randomBytes } from "crypto";
import { isAddress, type Address } from "viem";
import jsonwebtoken, { type JwtPayload } from "jsonwebtoken";
import { JWT_ISSUER, NONCE_LENGTH_BYTES, SCOPE_S3 } from "./constants";
import { unauthorized } from "@hapi/boom";
import { type ServerAuthScheme } from "@hapi/hapi";
import { type Logger } from "pino";
import * as jsonCodec from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { base32 } from "multiformats/bases/base32";
import { CID } from "multiformats/cid";
import { CAR } from "@web3-storage/upload-client";
import type { CARFile } from "@web3-storage/upload-client/types";

interface RequireEnvParams {
    name: string;
}

export const requireEnv = ({ name }: RequireEnvParams): string => {
    const env = process.env[name];
    if (!env) throw new Error(`Env ${name} is required`);
    return env;
};

interface GetW3UpClientParams {
    principalKey: string;
    delegationProof: string;
}

export const getW3UpClient = async ({
    principalKey,
    delegationProof,
}: GetW3UpClientParams): Promise<W3UpClient> => {
    const w3UpPrincipal = parsePrincipalKey(principalKey);
    const w3UpClient = await createW3UpClient({ principal: w3UpPrincipal });

    const proofBlocks = [];
    const reader = await CarReader.fromBytes(
        Buffer.from(delegationProof, "base64"),
    );
    for await (const block of reader.blocks()) {
        proofBlocks.push(block);
    }
    const proof = importDAG(proofBlocks as unknown as Iterable<Block>);

    const space = await w3UpClient.addSpace(proof);
    await w3UpClient.setCurrentSpace(space.did());

    return w3UpClient;
};

interface GetS3ClientParams {
    accessKeyId: string;
    secretAccessKey: string;
}

export const getS3Client = ({
    accessKeyId,
    secretAccessKey,
}: GetS3ClientParams): S3Client => {
    return new S3Client({
        region: "us-east-1",
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });
};

interface GetDbClientParams {
    connectionString: string;
    logger: Logger;
}

export const getDbClient = async ({
    connectionString,
    logger,
}: GetDbClientParams): Promise<PgClient> => {
    let client = new pg.Client({ connectionString });
    try {
        await client.connect();
        logger.info("Connected to database");
    } catch (error) {
        logger.error("Error connecting to database", error);

        const parsedConnectionString = new URL(connectionString);
        const { pathname, username } = parsedConnectionString;
        const database = pathname.slice(1, pathname.length);

        parsedConnectionString.pathname = "/postgres";
        const postgresDatabaseClient = new pg.Client({
            connectionString: parsedConnectionString.toString(),
        });
        await postgresDatabaseClient.connect();

        logger.info(`Creating database ${database}`);
        await postgresDatabaseClient.query(`CREATE DATABASE "${database}";`);
        await postgresDatabaseClient.query(
            `GRANT ALL PRIVILEGES ON DATABASE "${database}" TO "${username}";`,
        );
        logger.info(`Database ${database} created`);

        logger.info(`Connecting to database ${database}`);
        client = new pg.Client({ connectionString });
        await client.connect();
        logger.info("Connected to database");
    }

    logger.info("Creating table if they don't already exist");
    await client.query(
        `CREATE TABLE IF NOT EXISTS nonces (address VARCHAR(42) PRIMARY KEY, value VARCHAR(${NONCE_LENGTH_BYTES * 2}))`,
    );
    logger.info("Tables created");

    return client;
};

interface GetLoginMessageParams {
    address: Address;
    nonce: string;
}

export const getLoginMessage = ({
    address,
    nonce,
}: GetLoginMessageParams): string => {
    return (
        "Welcome to Carrot!\n\n" +
        "Sign this message to authenticate.\n\n" +
        "This request will not trigger a blockchain transaction or cost you any fees.\n\n" +
        "Your authentication status will reset after 24 hours.\n\n" +
        "Wallet address:\n" +
        `${address}\n\n` +
        "Nonce:\n" +
        nonce
    );
};

interface UpdateOrInsertNonceParams {
    client: PgClient;
    address: Address;
}

export const updateOrInsertNonce = async ({
    client,
    address,
}: UpdateOrInsertNonceParams): Promise<string> => {
    if (!isAddress(address))
        throw new Error(`Invalid address ${address} given`);
    const nonce = randomBytes(NONCE_LENGTH_BYTES).toString("hex");
    await client.query(
        "INSERT INTO nonces (address, value) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET value = EXCLUDED.value",
        [address, nonce],
    );
    return nonce;
};

interface GetNonceParams {
    client: PgClient;
    address: Address;
}

export const getNonce = async ({
    client,
    address,
}: GetNonceParams): Promise<string> => {
    if (!isAddress(address))
        throw new Error(`Invalid address ${address} given`);
    const result = await client.query(
        "SELECT value FROM nonces WHERE address = $1",
        [address],
    );
    const nonce = result.rows[0]?.value;
    if (!nonce) throw new Error(`No nonce value found for address ${address}`);
    return nonce;
};

interface DeleteNonceParams {
    client: PgClient;
    address: Address;
}

export const deleteNonce = async ({
    client,
    address,
}: DeleteNonceParams): Promise<void> => {
    if (!isAddress(address))
        throw new Error(`Invalid address ${address} given`);
    await client.query("DELETE FROM nonces WHERE address = $1", [address]);
};

interface GetAuthenticationSchemeParams {
    jwtSecretKey: string;
}

interface DataUploaderJWTPayload extends JwtPayload {
    scp?: string[];
}

export const getAuthenticationScheme = ({
    jwtSecretKey,
}: GetAuthenticationSchemeParams): ServerAuthScheme => {
    return () => ({
        authenticate: (request, h) => {
            /**
             * @type {{ authorization?: string }} params
             */
            const headers = request.headers;
            const { authorization } = headers;

            if (!authorization)
                return unauthorized("Missing Authorization header");

            if (
                !authorization.match(
                    /^Bearer [0-9a-zA-Z]*\.[0-9a-zA-Z]*\.[0-9a-zA-Z-_]*$/,
                )
            )
                return unauthorized("Malformed Authorization header");

            try {
                const jwt = authorization.split(" ")[1];
                const payload: DataUploaderJWTPayload = jsonwebtoken.verify(
                    jwt,
                    jwtSecretKey,
                    {
                        issuer: JWT_ISSUER,
                    },
                ) as DataUploaderJWTPayload;

                return h.authenticated({
                    credentials: {
                        scope: payload.scp,
                        user: { address: payload.sub },
                    },
                });
            } catch (error) {
                return unauthorized("Invalid JWT");
            }
        },
    });
};

interface GenerateJWTParas {
    jwtSecretKey: string;
    address: Address;
}

export const generateJWT = ({
    jwtSecretKey,
    address,
}: GenerateJWTParas): string => {
    return jsonwebtoken.sign(
        // end users should only be able to access the s3 based api
        { scp: [SCOPE_S3] },
        jwtSecretKey,
        {
            expiresIn: "24 hours",
            issuer: JWT_ISSUER,
            subject: address,
        },
    );
};

interface JSONToCARParams {
    json: object;
}

interface JSONToCARReturnValue {
    cid: string;
    car: CARFile;
}

export const ipfsEncodeJSON = async ({
    json,
}: JSONToCARParams): Promise<JSONToCARReturnValue> => {
    const bytes = jsonCodec.encode(json);
    const digest = await sha256.digest(bytes);
    const cid = CID.createV1(jsonCodec.code, digest);

    return {
        cid: cid.toString(base32),
        car: await CAR.encode([{ cid, bytes }]),
    };
};
