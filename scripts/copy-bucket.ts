import { config as dotenvConfig } from "dotenv";
import { requireEnv } from "../src/utils.js";
import { Upload } from "@aws-sdk/lib-storage";
import { getS3 } from "../src/utils.js";

dotenvConfig({ path: ".env.copy-bucket" });

async function main() {
    const fromBucketAccessKeyId = requireEnv({
        name: "FROM_BUCKET_ACCESS_KEY_ID",
    });
    const fromBucketSecretAccessKey = requireEnv({
        name: "FROM_BUCKET_SECRET_ACCESS_KEY",
    });
    const fromBucketName = requireEnv({
        name: "FROM_BUCKET_NAME",
    });

    const fromS3 = getS3({
        accessKeyId: fromBucketAccessKeyId,
        secretAccessKey: fromBucketSecretAccessKey,
    });

    const toBucketAccessKeyId = requireEnv({
        name: "TO_BUCKET_ACCESS_KEY_ID",
    });
    const toBucketSecretAccessKey = requireEnv({
        name: "TO_BUCKET_SECRET_ACCESS_KEY",
    });
    const toBucketName = requireEnv({
        name: "TO_BUCKET_NAME",
    });

    const toS3 = getS3({
        accessKeyId: toBucketAccessKeyId,
        secretAccessKey: toBucketSecretAccessKey,
    });

    let continuationToken: string | undefined = undefined;
    do {
        const objects = await fromS3.listObjectsV2({
            Bucket: fromBucketName,
            ContinuationToken: continuationToken,
        });

        if (!objects.Contents || objects.Contents.length === 0) break;

        console.log(`Copying ${objects.Contents.length} objects`);

        let i = 0;
        for (const object of objects.Contents) {
            i++;

            if (!object.Key) {
                console.log("Key is undefined");
                continue;
            }

            try {
                await toS3.headObject({
                    Bucket: toBucketName,
                    Key: object.Key,
                });
                console.log(`[${i}] - ${object.Key} copied`);
                continue;
            } catch (ignore) {}

            const toCopy = await fromS3.getObject({
                Bucket: fromBucketName,
                Key: object.Key,
            });
            if (!toCopy.Body) {
                console.log(`Could not get object with key ${object.Key}`);
                continue;
            }

            const tags = await fromS3.getObjectTagging({
                Bucket: fromBucketName,
                Key: object.Key,
            });
            if (!tags.TagSet) {
                console.log(`Could not get object with key ${object.Key}`);
                continue;
            }

            const upload = new Upload({
                client: toS3,
                params: {
                    Bucket: toBucketName,
                    Key: object.Key,
                    Body: toCopy.Body,
                    Tagging: tags.TagSet?.map(({ Key, Value }) => {
                        return `${Key}=${Value}`;
                    }).join("&"),
                },
            });

            await upload.done();

            console.log(`[${i}] - ${object.Key} copied`);
        }

        continuationToken = objects.ContinuationToken;
    } while (!!continuationToken);
}

await main();
