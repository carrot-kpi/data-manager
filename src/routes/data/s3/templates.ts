import joi from "joi";
import { S3 } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { ServerRoute } from "@hapi/hapi";
import { Readable } from "node:stream";
import { SCOPE_TEMPLATES } from "../../../constants.js";
import { ipfsEncodeDirectory } from "../../../utils.js";
import { badGateway, badRequest } from "@hapi/boom";
import { join } from "node:path";

interface GetS3DataTemplatesRouteParams {
    s3: S3;
    s3BucketName: string;
}

export const getS3DataTemplatesRoute = async ({
    s3,
    s3BucketName,
}: GetS3DataTemplatesRouteParams): Promise<ServerRoute> => {
    return {
        method: "POST",
        path: "/data/s3/templates",
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
                            description:
                                "The template was successfully stored.",
                            schema: joi
                                .object({
                                    cid: joi
                                        .string()
                                        .label("The CID of the stored data."),
                                })
                                .required(),
                        },
                    },
                    payloadType: "form",
                },
            },
            description: "Stores limbo templates data on S3.",
            notes: "Stores limbo templates data on S3.",
            tags: ["api"],
            auth: {
                access: {
                    scope: SCOPE_TEMPLATES,
                },
            },
            payload: {
                allow: "multipart/form-data",
                maxBytes: 5_000_000, // 5Mb
                multipart: {
                    output: "stream",
                },
                parse: true,
                timeout: 60000,
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
            },
        },
        handler: async (request, h) => {
            const template = request.payload as Record<string, Readable>;
            for (let fileName of Object.keys(request.payload)) {
                if (fileName === "/__car" || fileName === "__car") {
                    return badRequest(
                        'Can\'t store a folder with a file named "__car" in it',
                    );
                }
            }
            const { cid, car } = await ipfsEncodeDirectory({
                directory: template,
            });

            try {
                const carUpload = new Upload({
                    client: s3,
                    params: {
                        Bucket: s3BucketName,
                        Body: Readable.fromWeb(car.stream()),
                        Key: `${cid}/__car`,
                        ContentType: "application/vnd.ipld.car",
                        Tagging: "CarrotTemplate=true&CarrotLimbo=true",
                    },
                });
                await carUpload.done();
            } catch (error) {
                request.logger.error(error, "Could not upload CAR to S3");
                return badGateway("Could not upload template data to S3");
            }

            try {
                const promises = Object.entries(template).map(
                    ([fileName, stream]) => {
                        const upload = new Upload({
                            client: s3,
                            params: {
                                Bucket: s3BucketName,
                                Key: join(cid, fileName),
                                Body: stream,
                                Tagging: "CarrotTemplate=true&CarrotLimbo=true",
                            },
                        });
                        return upload.done();
                    },
                );
                await Promise.all(promises);
            } catch (error) {
                request.logger.error(
                    error,
                    "Could not upload raw template data to S3",
                );
                return badGateway("Could not upload template data to S3");
            }

            return h.response({ cid }).code(200).type("application/json");
        },
    };
};
