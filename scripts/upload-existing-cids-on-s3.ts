import { ChainId, SUBGRAPH_URL } from "@carrot-kpi/sdk";
import { CarReader } from "@ipld/car";
import { gql, request as gqlRequest } from "graphql-request";
import { S3 } from "@aws-sdk/client-s3";
import { recursive } from "ipfs-unixfs-exporter";
import { MemoryBlockstore } from "blockstore-core";
import { config as dotenvConfig } from "dotenv";
import { CID } from "multiformats/cid";
import { requireEnv } from "../src/utils.js";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { Address, Chain, createPublicClient, http } from "viem";
import { gnosis, polygonMumbai, scrollSepolia, sepolia } from "viem/chains";
import mime from "mime";

dotenvConfig();

const IPFS_GATEWAY_URL = "https://w3s.link";
const DEFILLAMA_ORACLE_ABI = [
    {
        type: "function",
        name: "specification",
        inputs: [],
        outputs: [{ name: "", type: "string", internalType: "string" }],
        stateMutability: "view",
    },
] as const;
const CHAIN: Record<ChainId, Chain> = {
    [ChainId.GNOSIS]: gnosis,
    [ChainId.POLYGON_MUMBAI]: polygonMumbai,
    [ChainId.SCROLL_SEPOLIA]: scrollSepolia,
    [ChainId.SEPOLIA]: sepolia,
};

const bucketName = requireEnv({ name: "S3_BUCKET" });
console.log(`Using bucket name ${bucketName}`);

const s3 = new S3({
    region: "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: requireEnv({ name: "S3_ACCESS_KEY_ID" }),
        secretAccessKey: requireEnv({ name: "S3_SECRET_ACCESS_KEY" }),
    },
});

const fetchCids = async (): Promise<{ cid: string; template: boolean }[]> => {
    try {
        const cids: { cid: string; template: boolean }[] = [];
        for (const [chain, subgraphUrl] of Object.entries(SUBGRAPH_URL)) {
            if (!subgraphUrl) {
                console.warn(
                    `Skipping network ${chain} (no subgraph available)`,
                );
                continue;
            }
            const response = await gqlRequest<{
                tokenTemplates: { cid: string }[];
                oracleTemplates: { cid: string }[];
                defilLamaOracles: { oracles: { address: Address }[] }[];
                tokens: { cid: string }[];
            }>(
                subgraphUrl as string,
                gql`
                    query getCids {
                        tokenTemplates: kpitokenTemplates {
                            cid: specificationCid
                        }
                        oracleTemplates: oracleTemplates {
                            cid: specificationCid
                        }
                        defilLamaOracles: oracleTemplates(
                            where: { managerId: 1 }
                        ) {
                            oracles {
                                address: id
                            }
                        }
                        tokens: kpitokens {
                            cid: descriptionCid
                        }
                    }
                `,
            );
            response.tokens.forEach(({ cid }) =>
                cids.push({ cid, template: false }),
            );
            response.tokenTemplates
                .concat(response.oracleTemplates)
                .forEach(({ cid }) => cids.push({ cid, template: true }));

            const defiLlamaOracleAddresses = response.defilLamaOracles.flatMap(
                (defiLlamaOracle) =>
                    defiLlamaOracle.oracles.map((oracle) => oracle.address),
            );
            const publicClient = createPublicClient({
                chain: CHAIN[chain],
                transport: http(),
            });
            const defiLlamaOracleSpecificationCids =
                await publicClient.multicall({
                    allowFailure: false,
                    contracts: defiLlamaOracleAddresses.map((address) => {
                        return {
                            address,
                            abi: DEFILLAMA_ORACLE_ABI,
                            functionName: "specification",
                            args: [],
                        };
                    }),
                });
            defiLlamaOracleSpecificationCids.forEach(
                (defiLlamaOracleSpecificationCid) => {
                    cids.push({
                        cid: defiLlamaOracleSpecificationCid,
                        template: false,
                    });
                },
            );
        }

        return Array.from(
            new Set(cids.map((wrappedCid) => wrappedCid.cid)),
        ).reduce((accumulator: { cid: string; template: boolean }[], cid) => {
            const wrappedCid = cids.find(
                (wrappedCid) => wrappedCid.cid === cid,
            );
            if (wrappedCid) accumulator.push(wrappedCid);
            return accumulator;
        }, []);
    } catch (error) {
        console.error("Could not fetch CIDs", error);
        process.exit(1);
    }
};

const handleJsonCid = async (
    cid: string,
): Promise<{ objectKey: string; data: Readable; contentType: string }[]> => {
    const response = await fetch(
        `${IPFS_GATEWAY_URL}/ipfs/${cid}?download=true&format=raw`,
    );
    if (!response || !response.body)
        throw new Error(
            `Could not get raw JSON data for CID ${cid}: ${await response.text()}`,
        );
    return [
        {
            objectKey: cid,
            data: Readable.fromWeb(response.body as unknown as any),
            contentType: "application/json",
        },
    ];
};

const handleDagPbCid = async (
    cid: string,
): Promise<{ objectKey: string; data: Readable; contentType: string }[]> => {
    const response = await fetch(
        `https://w3s.link/ipfs/${cid}?download=true&format=car`,
    );
    if (!response || !response.body)
        throw new Error(
            `Could not fetch CAR data for CID ${cid}: ${await response.text()}`,
        );

    const body = new Uint8Array(await response.arrayBuffer());

    const car = await CarReader.fromBytes(body);
    const roots = await car.getRoots();
    if (roots.length === 0 || roots.length > 1)
        throw new Error(`Zero or more than one root for cid ${cid}`);

    const blockstore = new MemoryBlockstore();
    for await (const block of car.blocks()) {
        blockstore.put(block.cid, block.bytes);
    }

    const entries: {
        objectKey: string;
        data: Readable;
        contentType: string;
    }[] = [];
    for await (const entry of recursive(cid, blockstore)) {
        if (entry.type === "directory") {
            continue;
        }
        entries.push({
            objectKey: entry.path,
            data: Readable.from(entry.content()),
            contentType: mime.getType(entry.name) || "application/octet-stream",
        });
    }

    return entries;
};

const handleCid = async (
    cid: string,
): Promise<{ objectKey: string; data: Readable; contentType: string }[]> => {
    const parsedCid = CID.parse(cid);
    switch (parsedCid.code) {
        case 512: {
            return handleJsonCid(cid);
        }
        case 112: {
            return handleDagPbCid(cid);
        }
        default: {
            throw new Error(`Unsupported codec ${parsedCid.code} used`);
        }
    }
};

const main = async () => {
    const cids = await fetchCids();

    let done = 0;
    for (const { cid, template } of cids) {
        const uploads = await handleCid(cid);
        for (const upload of uploads) {
            await new Upload({
                client: s3,
                params: {
                    Bucket: bucketName,
                    Key: upload.objectKey,
                    Body: upload.data,
                    ContentType: upload.contentType,
                    Tagging: `CarrotTemplate=${template}&CarrotLimbo=false`,
                },
            }).done();
        }
        console.log(`[${++done}/${cids.length}] - ${cid}`);
    }
};

await main();
