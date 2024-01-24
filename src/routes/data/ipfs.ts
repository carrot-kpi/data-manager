import { badGateway } from "@hapi/boom";
import joi from "joi";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    GetObjectTaggingCommand,
    PutObjectTaggingCommand,
    S3Client,
} from "@aws-sdk/client-s3";
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

            // Fetch the raw CAR stream from S3
            let carStream: ReadableStream;
            try {
                const getCAR = new GetObjectCommand({
                    Bucket: s3Bucket,
                    Key: `${cid}/car`,
                });
                const car = await s3Client.send(getCAR);
                if (!car.Body)
                    throw new Error(
                        `Could not fetch object with key "${cid}/car" from S3`,
                    );
                carStream = car.Body.transformToWebStream();
            } catch (error) {
                request.logger.error(error, "Could not fetch CAR from S3");
                return badGateway("Could not upload data to IPFS");
            }

            // Upload the raw CAR on web3.storage
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

            // Feth the object's current Carrot-Template tag
            let templateTag;
            try {
                const getTags = new GetObjectTaggingCommand({
                    Bucket: s3Bucket,
                    Key: cid,
                });
                const tags = await s3Client.send(getTags);
                templateTag = tags.TagSet?.find(
                    (tag) => tag.Key === "Carrot-Template",
                );
                if (!templateTag)
                    throw new Error(
                        `No Carrot-Template tag on object with key "${cid}" on S3`,
                    );
            } catch (error) {
                request.logger.error(
                    error,
                    `Could not get Carrot-Template tag for object with key "${cid}"`,
                );
                return badGateway("Could not upload data to IPFS");
            }

            // Set the content associated with the CAR as non removable.
            // This way the lifecycle rule that removes non persisted objects
            // from the target bucket won't delete this item
            try {
                const setNonRemovableContent = new PutObjectTaggingCommand({
                    Bucket: s3Bucket,
                    Key: cid,
                    Tagging: {
                        TagSet: [
                            templateTag,
                            {
                                Key: "Carrot-Removable",
                                Value: "false",
                            },
                        ],
                    },
                });
                await s3Client.send(setNonRemovableContent);
            } catch (error) {
                request.logger.error(
                    error,
                    `Could not set object with key "${cid}" as non removable on S3`,
                );
                return badGateway("Could not upload data to IPFS");
            }

            // Manually delete the CAR and its folder object from S3 now that it's uploaded
            // on web3.storage.
            // This shouldn't be needed because of the lifecycle rule, but we do
            // this asap.
            try {
                const deleteCAR = new DeleteObjectCommand({
                    Bucket: s3Bucket,
                    Key: `${cid}/car`,
                });
                await s3Client.send(deleteCAR);
            } catch (error) {
                request.logger.error(
                    error,
                    `Could not delete CAR with key "${cid}/car" from S3`,
                );
                return badGateway("Could not upload data to IPFS");
            }

            return h.response({ cid }).code(200).type("application/json");
        },
    };
};
