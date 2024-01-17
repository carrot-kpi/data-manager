import { badGateway } from "@hapi/boom";

/**
 * @param {{ w3UpClient: import("@web3-storage/w3up-client").Client }} params
 * @returns {import("@hapi/hapi").ServerRoute}
 */
export const getStoreRoute = async ({ w3UpClient }) => {
    const { default: joi } = await import("joi");

    return {
        method: "POST",
        path: "/store",
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
            description: "Store text-like data on web3.storage.",
            notes: "Stores text-like data on web3.storage.",
            tags: ["api"],
            payload: {
                maxBytes: 1024, // 1kb
            },
            validate: {
                payload: joi.object({
                    content: joi
                        .string()
                        .regex(/^[A-Za-z0-9+/]*={0,2}$/)
                        .required()
                        .description("The base64-encoded text to store."),
                }),
            },
        },
        handler: async (request, h) => {
            /** @type {{ content: string }} */
            const payload = request.payload;
            const { content: base64Content } = payload;
            const content = Buffer.from(base64Content, "base64").toString();

            let cid;
            try {
                const blob = new Blob([content]);
                cid = await w3UpClient.uploadFile(blob);
            } catch (error) {
                request.logger.error(error, "Could not upload to web3.storage");
                return badGateway("Could not upload file");
            }

            return h.response({ cid }).code(200);
        },
    };
};
