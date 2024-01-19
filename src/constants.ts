export const JWT_ISSUER = "carrot-data-uploader";
export const NONCE_LENGTH_BYTES = 32;

export enum DataFormat {
    Json = "json",
}

export const MIME_TYPE: Record<DataFormat, string> = {
    [DataFormat.Json]: "application/json",
};

export enum StorageService {
    Ipfs = "ipfs",
    S3 = "s3",
}
