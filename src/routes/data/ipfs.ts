import { badGateway } from "@hapi/boom";
import joi from "joi";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ServerRoute } from "@hapi/hapi";
import type { Client as W3UpClient } from "@web3-storage/w3up-client";
import { SCOPE_IPFS } from "../../constants";

interface GetDataRoutesParams {
    w3UpClient: W3UpClient;
    s3Client: S3Client;
    s3Bucket: string;
}

export const getIPFSDataRoute = async ({
    w3UpClient,
    s3Client,
    s3Bucket,
}: GetDataRoutesParams): Promise<ServerRoute> => {
    return {
        method: "POST",
        path: "/data/ipfs",
        options: {
            plugins: {
                "hapi-swagger": {
                    responses: {
                        401: {
                            description: "Unauthorized caller.",
                        },
                        400: {
                            description: "The request was not valid.",
                        },
                        502: {
                            description: "The data could not be stored.",
                        },
                        200: {
                            description: "The data was successfully stored.",
                            schema: joi
                                .object({
                                    cid: joi
                                        .string()
                                        .label("The cid of the stored data."),
                                })
                                .required(),
                        },
                    },
                },
            },
            description: "Stores JSON data on S3.",
            notes: "Stores JSON data on S3. The data has to have previously been stored on S3 in a format that the service can understand and the caller must be explicitly authorized to call this endpoint.",
            tags: ["api"],
            auth: {
                access: {
                    scope: SCOPE_IPFS,
                },
            },
            validate: {
                headers: joi
                    .object({
                        authorization: joi
                            .string()
                            .required()
                            .regex(
                                /^Bearer [0-9a-zA-Z]*\.[0-9a-zA-Z]*\.[0-9a-zA-Z-_]*$/,
                            ),
                    })
                    .unknown(),
                payload: joi.object({
                    cid: joi
                        .string()
                        .required()
                        .description(
                            "The CID of the object previously stored on S3 that needs to be persisted to IPFS.",
                        ),
                }),
            },
        },
        handler: async (request, h) => {
            const { cid } = request.payload as { cid: string };

            let carStream: ReadableStream;
            try {
                const get = new GetObjectCommand({
                    Bucket: s3Bucket,
                    Key: `${cid}/car`,
                });
                const object = await s3Client.send(get);
                if (!object.Body)
                    throw new Error(
                        `Could not fetch object with cid "${cid}/car" from S3`,
                    );
                carStream = object.Body.transformToWebStream();
            } catch (error) {
                request.logger.error(error, "Could not fetch CAR from S3");
                return badGateway("Could not fetch CAR from S3");
            }

            try {
                const cidFromUpload = await w3UpClient.uploadCAR({
                    stream: () => carStream,
                });
                if (cidFromUpload.toV1().toString() !== cid)
                    throw new Error(
                        `CID mismatch: got ${cidFromUpload.toV1().toString()}, expected ${cid}`,
                    );
            } catch (error) {
                request.logger.error(error, "Could not upload CAR to IPFS");
                return badGateway("Could not upload data to IPFS");
            }

            return h.response({ cid }).code(200).type("application/json");
        },
    };
};
