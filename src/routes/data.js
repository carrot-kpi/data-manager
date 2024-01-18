import { badGateway } from "@hapi/boom";
import joi from "joi";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { SUPPORTED_FORMATS, SUPPORTED_STORAGE_SERVICES } from "../constants.js";
import { UnixFS } from "@web3-storage/upload-client";

/**
 * @param {{
 *      w3UpClient: import("@web3-storage/w3up-client").Client,
 *      s3Client: import("@aws-sdk/client-s3").S3Client,
 *      s3Bucket: string
 * }} params
 * @returns {import("@hapi/hapi").ServerRoute[]}
 */
export const getDataRoutes = async ({ w3UpClient, s3Client, s3Bucket }) => {
    const SUPPORTED_FORMAT_SERIALIZERS = {
        [SUPPORTED_FORMATS.json]: JSON.stringify,
    };

    const SUPPORTED_STORAGE_SERVICE_HANDLERS = {
        [SUPPORTED_STORAGE_SERVICES.ipfs]: async (format, request, h) => {
            /** @type {{ data: object }} */
            const payload = request.payload;
            const { data } = payload;
            const dataString = SUPPORTED_FORMAT_SERIALIZERS[format](data);
            const blob = new Blob([dataString], {
                type: "application/json",
            });

            const precalculatedCid = (
                await UnixFS.encodeFile(blob)
            ).cid.toString();

            /** @type {string} */
            let cidFromW3Up;
            try {
                cidFromW3Up = (await w3UpClient.uploadFile(blob)).toString();
            } catch (error) {
                request.logger.error(error, "Could not upload data to w3up");
                return badGateway("Could not upload data to w3up");
            }

            if (cidFromW3Up !== precalculatedCid) {
                try {
                    await w3UpClient.capability.store.remove(cidFromW3Up);
                } catch (error) {
                    request.logger.error(
                        error,
                        "Could not remove mismatching uploaded data from IPFS",
                    );
                    return badGateway(
                        "Could not remove mismatching uploaded data from IPFS",
                    );
                }
                return badGateway(
                    `CID mismatch: expected ${precalculatedCid}, got ${cidFromW3Up}`,
                );
            }

            request.logger.info(
                `Data stored on ipfs with cid ${precalculatedCid} on behalf of ${request.auth.credentials.user}`,
            );
            return h.response({ cid: precalculatedCid }).code(200);
        },
        [SUPPORTED_STORAGE_SERVICES.s3]: async (format, request, h) => {
            /** @type {{ data: object }} */
            const payload = request.payload;
            const { data } = payload;
            const dataString = SUPPORTED_FORMAT_SERIALIZERS[format](data);

            console.log(dataString, s3Bucket);

            /** @type {string} */
            const cid = (
                await UnixFS.encodeFile(
                    new Blob([dataString], {
                        type: "application/json",
                    }),
                )
            ).cid.toString();

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
                request.logger.error(error, "Could not upload data to S3");
                return badGateway("Could not upload data to S3");
            }

            return h.response({ cid }).code(200);
        },
    };

    const routes = Object.values(SUPPORTED_FORMATS).reduce(
        (accumulator, format) => {
            const formatRoutes = Object.values(SUPPORTED_STORAGE_SERVICES).map(
                (service) => {
                    console.log({ service, format });
                    return {
                        method: "POST",
                        path: `/data/${format}/${service}`,
                        options: {
                            plugins: {
                                "hapi-swagger": {
                                    responses: {
                                        401: {
                                            description: "Unauthorized caller.",
                                        },
                                        400: {
                                            description:
                                                "The request was not valid.",
                                        },
                                        502: {
                                            description:
                                                "The data could not be stored.",
                                        },
                                        200: {
                                            description:
                                                "The data was successfully stored.",
                                            schema: joi
                                                .object({
                                                    cid: joi
                                                        .string()
                                                        .label(
                                                            "The cid of the stored data.",
                                                        ),
                                                })
                                                .required(),
                                        },
                                    },
                                },
                            },
                            description: `Stores ${format.toUpperCase()} data on ${service.toUpperCase()}.`,
                            notes: `Stores ${format.toUpperCase()} data on ${service.toUpperCase()}.`,
                            tags: ["api"],
                            auth: {
                                access: {
                                    scope: service,
                                },
                            },
                            payload: {
                                maxBytes: 1024, // 1kb
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
                                    data: joi
                                        .object()
                                        .required()
                                        .description(
                                            "The JSON object to store.",
                                        ),
                                }),
                            },
                        },
                        handler: async (request, h) => {
                            const handler =
                                SUPPORTED_STORAGE_SERVICE_HANDLERS[service];
                            return handler(format, request, h);
                        },
                    };
                },
            );
            for (const route of formatRoutes) {
                accumulator.push(route);
            }
            return accumulator;
        },
        [],
    );

    console.log({ routes: routes.length });

    return routes;
};
