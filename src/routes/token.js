import { badRequest, forbidden, internal } from "@hapi/boom";
import joi from "joi";
import { isAddress, getAddress, recoverMessageAddress } from "viem/utils";
import {
    getLoginMessage,
    deleteNonce,
    getNonce,
    generateJWT,
} from "../utils.js";

/**
 * @param {{ dbClient: import("pg").Client, jwtSecretKey: string }} params
 * @returns {import("@hapi/hapi").ServerRoute}
 */
export const getTokenRoute = ({ dbClient, jwtSecretKey }) => {
    return {
        method: "POST",
        path: "/token",
        options: {
            plugins: {
                "hapi-swagger": {
                    responses: {
                        400: {
                            description:
                                "The signature parameter was either not given or not valid.",
                        },
                        200: {
                            description:
                                "The JWT was successfully created, the response contains it.",
                            schema: joi.object({
                                token: joi.string().label("The created JWT."),
                            }),
                        },
                    },
                },
            },
            description: "Generates a new JWT token for a given user.",
            notes:
                "Generates a new JWT token for a given user, and returns it. " +
                "The token will be valid for 24 hours",
            auth: false,
            tags: ["api"],
            validate: {
                payload: joi.object({
                    address: joi
                        .string()
                        .required()
                        .regex(/0x[a-fA-F0-9]{40}/)
                        .description(
                            "The address of the account which signed the login message.",
                        ),
                    signature: joi
                        .string()
                        .required()
                        .regex(/0x[a-fA-F0-9]+/)
                        .description(
                            "A signed message that proves the user owns the address being authenticated. " +
                                "The signed message must be retrieved using the login message API.",
                        ),
                }),
            },
        },
        handler: async (request, h) => {
            /** @type {{ address: import("viem").Address, signature: import("viem").Hex }} */
            const payload = request.payload;
            const { address, signature } = payload;

            if (!isAddress(address)) return badRequest("Invalid address");
            const checksummedAddress = getAddress(address);

            let nonce;
            try {
                nonce = await getNonce({
                    client: dbClient,
                    address: checksummedAddress,
                });
            } catch (error) {
                request.logger.error(
                    error,
                    `Could not get nonce for address ${checksummedAddress}`,
                );
                return badRequest(
                    `Could not get nonce for address ${checksummedAddress}`,
                );
            }

            let recoveredAddress;
            try {
                recoveredAddress = await recoverMessageAddress({
                    message: getLoginMessage({
                        address: checksummedAddress,
                        nonce,
                    }),
                    signature,
                });
            } catch (error) {
                request.logger.error(error, "Error while recovering signer");
                return badRequest("Error while recovering signer");
            }

            if (recoveredAddress !== address)
                return forbidden("Address mismatch");

            let token;
            try {
                token = generateJWT({ jwtSecretKey, address });
            } catch (error) {
                request.logger.error(error, "Error while generating JWT");
                return internal("Error while generating JWT");
            }

            try {
                await deleteNonce({ client: dbClient, address });
            } catch (error) {
                request.logger.error(
                    error,
                    "Error while deleting nonce from database",
                );
                return internal("Error while generating JWT");
            }

            return h.response({ token }).type("application/json");
        },
    };
};
