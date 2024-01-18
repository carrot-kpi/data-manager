import { server as createServer } from "@hapi/hapi";
import { getStoreJsonDataRoute } from "./routes/data/json.js";
import {
    getAuthenticationScheme,
    getDbClient,
    getS3Client,
    getW3UpClient,
} from "./utils.js";
import HapiPinoPlugin from "hapi-pino";
import HapiInertPlugin from "@hapi/inert";
import HapiVisionPlugin from "@hapi/vision";
import HapiSwaggerPlugin from "hapi-swagger";
import { getLoginMessageRoute } from "./routes/login-message.js";
import { getTokenRoute } from "./routes/token.js";

const DEV = process.env.NODE_ENV !== "production";

/**
 * @param {{ name: string }} params
 * @returns {string}
 */
const requireEnv = ({ name }) => {
    const env = process.env[name];
    if (!env) throw new Error(`Env ${name} is required`);
    return env;
};

const start = async () => {
    if (DEV) (await import("dotenv")).config();

    const HOST = requireEnv({ name: "HOST" });
    const PORT = requireEnv({ name: "PORT" });
    const server = createServer({
        host: HOST,
        port: PORT,
        debug: false,
        routes: {
            cors: true,
        },
    });
    await server.register([
        {
            plugin: HapiPinoPlugin,
            options: {
                formatters: {
                    level(label) {
                        return { label };
                    },
                },
                logRequestComplete(request) {
                    return request.route.settings.tags?.includes("api");
                },
            },
        },
        HapiInertPlugin,
        HapiVisionPlugin,
        {
            plugin: HapiSwaggerPlugin,
            options: {
                info: {
                    title: "W3up uploader API",
                    version: "1.0.0",
                    description:
                        "An API to access web3.storage storage services through their w3up service.",
                    contact: {
                        name: "Carrot Labs",
                        email: "tech@carrot-labs.xyz",
                    },
                },
            },
        },
    ]);

    const DB_CONNECTION_STRING = requireEnv({ name: "DB_CONNECTION_STRING" });
    const dbClient = await getDbClient({
        connectionString: DB_CONNECTION_STRING,
        logger: server.logger,
    });

    const W3UP_PRINCIPAL_KEY = requireEnv({ name: "W3UP_PRINCIPAL_KEY" });
    const W3UP_DELEGATION_PROOF = requireEnv({ name: "W3UP_DELEGATION_PROOF" });
    const w3UpClient = await getW3UpClient({
        principalKey: W3UP_PRINCIPAL_KEY,
        delegationProof: W3UP_DELEGATION_PROOF,
    });

    const S3_ENDPOINT = requireEnv({ name: "S3_ENDPOINT" });
    const S3_BUCKET = requireEnv({ name: "S3_BUCKET" });
    const S3_ACCESS_KEY_ID = requireEnv({ name: "S3_ACCESS_KEY_ID" });
    const S3_SECRET_ACCESS_KEY = requireEnv({ name: "S3_SECRET_ACCESS_KEY" });
    const s3Client = getS3Client({
        endpoint: S3_ENDPOINT,
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
    });

    const JWT_SECRET = requireEnv({ name: "JWT_SECRET" });
    server.auth.scheme(
        "jwt",
        getAuthenticationScheme({ jwtSecretKey: JWT_SECRET }),
    );
    server.auth.strategy("jwt", "jwt");
    server.auth.default("jwt");

    server.route(getLoginMessageRoute({ dbClient }));
    server.route(getTokenRoute({ dbClient, jwtSecretKey: JWT_SECRET }));
    server.route(
        await getStoreJsonDataRoute({
            w3UpClient,
            s3Client,
            s3Bucket: S3_BUCKET,
        }),
    );

    try {
        await server.start();
        server.logger.info(`Server running on ${server.info.uri}`);
    } catch (error) {
        server.logger.error(`Server running on ${server.info.uri}`);
    }
};

start();
