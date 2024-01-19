import { badGateway } from "@hapi/boom";
import joi from "joi";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DataFormat, MIME_TYPE, StorageService } from "../constants.js";
import { UnixFS } from "@web3-storage/upload-client";
import type { Client as W3UpClient } from "@web3-storage/w3up-client";
import type {
    Lifecycle,
    ReqRefDefaults,
    ResponseToolkit,
    ServerRoute,
    Request,
} from "@hapi/hapi";

interface GetDataRoutesParams {
    w3UpClient: W3UpClient;
    s3Client: S3Client;
    s3Bucket: string;
}

type DataFormatSerializer = (deserialized: any) => Promise<string> | string;

type StorageServiceHandler = (
    storageFormat: DataFormat,
    request: Request<ReqRefDefaults>,
    h: ResponseToolkit,
) => Promise<Lifecycle.ReturnValue>;

export const getDataRoutes = async ({
    w3UpClient,
    s3Client,
    s3Bucket,
}: GetDataRoutesParams): Promise<ServerRoute[]> => {
    const SUPPORTED_FORMAT_SERIALIZERS: Record<
        DataFormat,
        DataFormatSerializer
    > = {
        [DataFormat.Json]: JSON.stringify,
    };

    const SUPPORTED_STORAGE_SERVICE_HANDLERS: Record<
        StorageService,
        StorageServiceHandler
    > = {
        [StorageService.Ipfs]: async (format, request, h) => {
            const { data } = request.payload as { data: object };
            const dataString = await SUPPORTED_FORMAT_SERIALIZERS[format](data);
            const blob = new Blob([dataString], {
                type: MIME_TYPE[format],
            });

            const precalculatedCid = (
                await UnixFS.encodeFile(blob)
            ).cid.toString();

            let cidFromW3Up: string;
            try {
                cidFromW3Up = (await w3UpClient.uploadFile(blob)).toString();
            } catch (error) {
                request.logger.error(error, "Could not upload data to w3up");
                return badGateway("Could not upload data to w3up");
            }

            if (cidFromW3Up !== precalculatedCid) {
                return badGateway(
                    `CID mismatch: expected ${precalculatedCid}, got ${cidFromW3Up}`,
                );
            }

            request.logger.info(
                `Data stored on ipfs with cid ${precalculatedCid} on behalf of ${request.auth.credentials.user}`,
            );
            return h
                .response({ cid: precalculatedCid })
                .code(200)
                .type("application/json");
        },
        [StorageService.S3]: async (format, request, h) => {
            const { data } = request.payload as { data: object };
            const dataString = await SUPPORTED_FORMAT_SERIALIZERS[format](data);

            /** @type {string} */
            const cid = (
                await UnixFS.encodeFile(
                    new Blob([dataString], {
                        type: MIME_TYPE[format],
                    }),
                )
            ).cid.toString();

            try {
                const put = new PutObjectCommand({
                    ACL: "public-read",
                    Bucket: s3Bucket,
                    Body: dataString,
                    Key: cid,
                    ContentType: MIME_TYPE[format],
                });
                await s3Client.send(put);
            } catch (error) {
                request.logger.error(error, "Could not upload data to S3");
                return badGateway("Could not upload data to S3");
            }

            return h.response({ cid }).code(200).type("application/json");
        },
    };

    const routes: ServerRoute[] = [];
    for (const dataFormat of Object.values(DataFormat)) {
        for (const storageService of Object.values(StorageService)) {
            routes.push({
                method: "POST",
                path: `/data/${dataFormat}/${storageService}`,
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
                    description: `Stores ${dataFormat.toUpperCase()} data on ${storageService.toUpperCase()}.`,
                    notes: `Stores ${dataFormat.toUpperCase()} data on ${storageService.toUpperCase()}.`,
                    tags: ["api"],
                    auth: {
                        access: {
                            scope: storageService,
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
                                    `The ${dataFormat.toUpperCase()} object to store.`,
                                ),
                        }),
                    },
                },
                handler: async (request, h) => {
                    return await SUPPORTED_STORAGE_SERVICE_HANDLERS[
                        storageService as unknown as StorageService
                    ](dataFormat as unknown as DataFormat, request, h);
                },
            });
        }
    }

    return routes;
};
