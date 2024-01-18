import { badGateway } from "@hapi/boom";
import joi from "joi";
import { PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * @param {{
 *      w3UpClient: import("@web3-storage/w3up-client").Client,
 *      s3Client: import("@aws-sdk/client-s3").S3Client,
 *      s3Bucket: string
 * }} params
 * @returns {import("@hapi/hapi").ServerRoute}
 */
export const getStoreJsonDataRoute = async ({
    w3UpClient,
    s3Client,
    s3Bucket,
}) => {
    return {
        method: "POST",
        path: "/data/json",
        options: {
            plugins: {
                "hapi-swagger": {
                    responses: {
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
                                        .label("The cid for the stored data."),
                                })
                                .required(),
                        },
                    },
                },
            },
            description: "Stores JSON data on web3.storage.",
            notes: "Stores JSON data on web3.storage through the w3up service.",
            tags: ["api"],
            payload: {
                maxBytes: 1024, // 1kb
            },
            validate: {
                payload: joi.object({
                    data: joi
                        .object()
                        .required()
                        .description("The JSON object to store."),
                }),
            },
        },
        handler: async (request, h) => {
            /** @type {{ data: object }} */
            const payload = request.payload;
            const { data } = payload;
            const dataString = JSON.stringify(data);

            /** @type {string} */
            let cid;
            try {
                cid = (
                    await w3UpClient.uploadFile(new Blob([dataString]))
                ).toString();
            } catch (error) {
                request.logger.error(error, "Could not upload data to w3up");
                return badGateway("Could not upload data to w3up");
            }

            try {
                const put = new PutObjectCommand({
                    ACL: "public-read",
                    Bucket: s3Bucket,
                    Body: dataString,
                    Key: cid,
                    ContentType: "application/json",
                });
                await s3Client.send(put);
            } catch (error) {
                request.logger.error(error, "Could not upload data to s3");
                return badGateway("Could not upload data to s3");
            }

            return h.response({ cid }).code(200);
        },
    };
};
