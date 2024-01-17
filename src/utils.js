import { create as createW3UpClient } from "@web3-storage/w3up-client";
import { parse as parsePrincipalKey } from "@ucanto/principal/ed25519";
import { importDAG } from "@ucanto/core/delegation";
import { CarReader } from "@ipld/car";
import { S3Client } from "@aws-sdk/client-s3";

/**
 * @param {{ principalKey: string, delegationProof: string }} params
 * @returns {import("@web3-storage/w3up-client").Client}
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
        endpoint: endpoint,
        region: "us-east-1",
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });
};
