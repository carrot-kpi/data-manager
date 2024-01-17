import { badGateway } from "@hapi/boom";
import joi from "joi";

/**
 * @param {{ w3UpClient: import("@web3-storage/w3up-client").Client }} params
 * @returns {import("@hapi/hapi").ServerRoute}
 */
export const getStoreJsonDataRoute = async ({ w3UpClient }) => {
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
            const content = Buffer.from(JSON.stringify(data)).toString();
            const blob = new Blob([content]);

            let cid;
            try {
                cid = await w3UpClient.uploadFile(blob);
            } catch (error) {
                request.logger.error(error, "Could not upload data to w3up");
                return badGateway("Could not upload data to w3up");
            }

            return h.response({ cid }).code(200);
        },
    };
};
