export const JWT_ISSUER = "carrot-data-uploader";
export const NONCE_LENGTH_BYTES = 32;

/**
 * @enum {string}
 * @readonly
 */
export const SUPPORTED_FORMATS = Object.freeze({
    json: "json",
});

/**
 * @enum {string}
 * @readonly
 */
export const SUPPORTED_STORAGE_SERVICES = Object.freeze({
    ipfs: "ipfs",
    s3: "s3",
});
