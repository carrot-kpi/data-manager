import { badRequest, internal } from "@hapi/boom";
import joi from "joi";
import { isAddress, getAddress } from "viem/utils";
import { getLoginMessage, updateOrInsertNonce } from "../utils.js";

/**
 * @param {{ dbClient: import("pg").Client }} params
 * @returns {import("@hapi/hapi").ServerRoute}
 */
export const getLoginMessageRoute = ({ dbClient }) => {
    return {
        method: "GET",
        path: "/login-message/{address}",
        options: {
            plugins: {
                "hapi-swagger": {
                    responses: {
                        400: {
                            description:
                                "The address parameter was either not given or not valid.",
                        },
                        200: {
                            description:
                                "The nonce was created; The response contains the full login " +
                                "message to sign in order to authenticate.",
                            schema: joi
                                .object({
                                    message: joi
                                        .string()
                                        .label(
                                            "The login message with the baked in nonce.",
                                        ),
                                })
                                .required(),
                        },
                    },
                },
            },
            description:
                "Gets a new login message to sign for a given address.",
            notes:
                "Updates or creates a new nonce for a given address (user), " +
                "and returns the login message that a user needs to sign in order " +
                "to authenticate, with the nonce baked in. This is used in order " +
                "to avoid signature replay attacks.",
            auth: false,
            tags: ["api"],
            validate: {
                params: joi.object({
                    address: joi
                        .string()
                        .required()
                        .regex(/0x[a-fA-F0-9]{40}/)
                        .description(
                            "The address for which to generate the login message.",
                        ),
                }),
            },
        },
        handler: async (request, h) => {
            const { address } = request.params;
            if (!isAddress(address)) return badRequest("invalid address");
            const checksummedAddress = getAddress(address);

            let nonce;
            try {
                nonce = await updateOrInsertNonce({
                    client: dbClient,
                    address: checksummedAddress,
                });
            } catch (error) {
                request.logger.error(
                    error,
                    `Could not update or insert nonce for address ${checksummedAddress}`,
                );
                return internal("Could not update or create nonce");
            }

            return h
                .response({
                    message: getLoginMessage({
                        address: checksummedAddress,
                        nonce,
                    }),
                })
                .type("application/json");
        },
    };
};
