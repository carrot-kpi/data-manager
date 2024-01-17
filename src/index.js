import { server as createServer } from "@hapi/hapi";
import { create as createW3UpClient } from "@web3-storage/w3up-client";
import { parse as parsePrincipalKey } from "@ucanto/principal/ed25519";
import { importDAG } from "@ucanto/core/delegation";
import { CarReader } from "@ipld/car";
import { getStoreJsonDataRoute } from "./routes/data/json.js";

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
    const W3UP_PRINCIPAL_KEY = requireEnv({
        name: "W3UP_PRINCIPAL_KEY",
    });
    const W3UP_DELEGATION_PROOF = requireEnv({
        name: "W3UP_DELEGATION_PROOF",
    });

    const w3UpPrincipal = parsePrincipalKey(W3UP_PRINCIPAL_KEY);
    const w3UpClient = await createW3UpClient({ principal: w3UpPrincipal });

    const proofBlocks = [];
    const reader = await CarReader.fromBytes(
        Buffer.from(W3UP_DELEGATION_PROOF, "base64"),
    );
    for await (const block of reader.blocks()) {
        proofBlocks.push(block);
    }
    const proof = importDAG(proofBlocks);

    const space = await w3UpClient.addSpace(proof);
    await w3UpClient.setCurrentSpace(space.did());

    const server = createServer({
        host: HOST,
        port: PORT,
        debug: false,
        routes: {
            cors: true,
        },
    });

    const serverPlugins = [
        {
            plugin: (await import("hapi-pino")).default,
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
    ];
    if (DEV) {
        serverPlugins.push((await import("@hapi/inert")).default);
        serverPlugins.push((await import("@hapi/vision")).default);
        serverPlugins.push({
            plugin: (await import("hapi-swagger")).default,
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
        });
    }
    await server.register(serverPlugins);

    server.route(await getStoreJsonDataRoute({ w3UpClient }));

    try {
        await server.start();
        server.logger.info(`Server running on ${server.info.uri}`);
    } catch (error) {
        server.logger.error(`Server running on ${server.info.uri}`);
    }
};

start();
