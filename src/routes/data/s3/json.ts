import { badGateway } from "@hapi/boom";
import joi from "joi";
import { S3 } from "@aws-sdk/client-s3";
import type { ServerRoute } from "@hapi/hapi";
import { Readable } from "node:stream";
import { ipfsEncodeJSON } from "../../../utils.js";
import { SCOPE_S3 } from "../../../constants.js";
import { Upload } from "@aws-sdk/lib-storage";

interface GetS3DataJSONRouteParams {
    s3: S3;
    s3BucketName: string;
}

export const getS3DataJSONRoute = async ({
    s3,
    s3BucketName,
}: GetS3DataJSONRouteParams): Promise<ServerRoute> => {
    return {
        method: "POST",
        path: "/data/s3/json",
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
                                        .label("The CID of the stored data."),
                                })
                                .required(),
                        },
                    },
                },
            },
            description: "Stores limbo JSON data on S3.",
            notes: "Stores limbo JSON data on S3.",
            tags: ["api"],
            auth: {
                access: {
                    scope: SCOPE_S3,
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
                payload: joi
                    .object({
                        data: joi
                            .object()
                            .required()
                            .description("The JSON object to store."),
                    })
                    .required(),
            },
        },
        handler: async (request, h) => {
            const { data } = request.payload as { data: object };
            const dataString = JSON.stringify(data);
            const { cid, car } = await ipfsEncodeJSON({ json: data });

            try {
                const upload = new Upload({
                    client: s3,
                    params: {
                        Bucket: s3BucketName,
                        Key: `${cid}/__car`,
                        Body: Readable.fromWeb(car.stream()),
                        ContentType: "application/vnd.ipld.car",
                        Tagging: "CarrotTemplate=false&CarrotLimbo=true",
                    },
                });
                await upload.done();
            } catch (error) {
                request.logger.error(error, "Could not upload CAR to S3");
                return badGateway("Could not upload data to S3");
            }

            try {
                const upload = new Upload({
                    client: s3,
                    params: {
                        Bucket: s3BucketName,
                        Key: cid,
                        Body: dataString,
                        ContentType: "application/json",
                        Tagging: "CarrotTemplate=false&CarrotLimbo=true",
                    },
                });
                await upload.done();
            } catch (error) {
                request.logger.error(error, "Could not upload raw data to S3");
                return badGateway("Could not upload data to S3");
            }

            return h.response({ cid }).code(200).type("application/json");
        },
    };
};
