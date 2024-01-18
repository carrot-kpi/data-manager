import { create as createW3UpClient } from "@web3-storage/w3up-client";
import { parse as parsePrincipalKey } from "@ucanto/principal/ed25519";
import { importDAG } from "@ucanto/core/delegation";
import { CarReader } from "@ipld/car";
import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { randomBytes } from "crypto";
import { isAddress } from "viem";
import jsonwebtoken from "jsonwebtoken";
import {
    JWT_ISSUER,
    NONCE_LENGTH_BYTES,
    SUPPORTED_STORAGE_SERVICES,
} from "./constants.js";
import { unauthorized } from "@hapi/boom";

/**
 * @param {{ principalKey: string, delegationProof: string }} params
 * @returns {Promise<import("@web3-storage/w3up-client").Client>}
 */
export const getW3UpClient = async ({ principalKey, delegationProof }) => {
    const w3UpPrincipal = parsePrincipalKey(principalKey);
    const w3UpClient = await createW3UpClient({ principal: w3UpPrincipal });

    const proofBlocks = [];
    const reader = await CarReader.fromBytes(
        Buffer.from(delegationProof, "base64"),
    );
    for await (const block of reader.blocks()) {
        proofBlocks.push(block);
    }
    const proof = importDAG(proofBlocks);

    const space = await w3UpClient.addSpace(proof);
    await w3UpClient.setCurrentSpace(space.did());

    return w3UpClient;
};

/**
 * @param {{ endpoint: string, accessKeyId: string; secretAccessKey: string }} params
 * @returns {import("@aws-sdk/client-s3").S3Client}
 */
export const getS3Client = ({ endpoint, accessKeyId, secretAccessKey }) => {
    return new S3Client({
        forcePathStyle: false, // Configures to use subdomain/virtual calling format.
        endpoint,
        region: "us-east-1",
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });
};

/**
 * @param {{ connectionString: string, logger: import("pino").Logger }} params
 * @returns {Promise<import("pg").Client>}
 */
export const getDbClient = async ({ connectionString, logger }) => {
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

/**
 * @param {{ address: string, nonce: string; }} params
 * @returns {string}
 */
export const getLoginMessage = ({ address, nonce }) => {
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

/**
 * @param {{ client: import("pg").Client, address: import("viem").Address }} params
 * @returns {Promise<string>}
 */
export const updateOrInsertNonce = async ({ client, address }) => {
    if (!isAddress(address))
        throw new Error(`Invalid address ${address} given`);
    const nonce = randomBytes(NONCE_LENGTH_BYTES).toString("hex");
    await client.query(
        "INSERT INTO nonces (address, value) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET value = EXCLUDED.value",
        [address, nonce],
    );
    return nonce;
};

/**
 * @param {{ client: import("pg").Client, address: import("viem").Address }} params
 * @returns {Promise<string>}
 */
export const getNonce = async ({ client, address }) => {
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

/**
 * @param {{ client: import("pg").Client, address: import("viem").Address }} params
 */
export const deleteNonce = async ({ client, address }) => {
    if (!isAddress(address))
        throw new Error(`Invalid address ${address} given`);
    await client.query("DELETE FROM nonces WHERE address = $1", [address]);
};

/**
 * @param {{ jwtSecretKey: string }} params
 * @returns {import("@hapi/hapi").ServerAuthScheme}
 */
export const getAuthenticationScheme = ({ jwtSecretKey }) => {
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

            const jwt = authorization.split(" ")[1];

            let scope;
            let subject;
            try {
                const payload = jsonwebtoken.verify(jwt, jwtSecretKey, {
                    issuer: JWT_ISSUER,
                });
                scope = payload.scp;
                subject = payload.sub;
            } catch (error) {
                return unauthorized("Invalid JWT");
            }

            return h.authenticated({
                credentials: { scope, user: subject },
            });
        },
    });
};

/**
 * @param {{ jwtSecretKey: string, address: import("viem").Address }} params
 * @returns {string}
 */
export const generateJWT = ({ jwtSecretKey, address }) => {
    return jsonwebtoken.sign(
        // end users should only be able to access the s3 based api
        { scp: [SUPPORTED_STORAGE_SERVICES.s3] },
        jwtSecretKey,
        {
            expiresIn: "24 hours",
            issuer: JWT_ISSUER,
            subject: address,
        },
    );
};
