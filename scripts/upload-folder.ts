import { config } from "dotenv";
import { JWT_ISSUER } from "../src/constants.js";
import jsonwebtoken from "jsonwebtoken";
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";

config();

const PORT = process.env.PORT;
if (!PORT) {
    console.log("Make sure you have a PORT env in your .env file.");
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.log("Make sure you have a JWT_SECRET env in your .env file.");
    process.exit(1);
}

const jwt = jsonwebtoken.sign({ scp: ["s3"] }, JWT_SECRET, {
    expiresIn: "30 minutes",
    issuer: JWT_ISSUER,
    subject: "tester",
});

const baseDirPath = join(import.meta.dirname, "../upload-test");
const formData = new FormData();

const prepareFolder = async (basePath: string) => {
    for (const fileName of await readdir(basePath)) {
        const filePath = join(basePath, fileName);
        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) {
            await prepareFolder(filePath);
        } else {
            const content = await readFile(filePath);
            formData.append(
                filePath.replace(baseDirPath, ""),
                new Blob([content]),
            );
        }
    }
};

await prepareFolder(baseDirPath);

const response = await fetch(`http://127.0.0.1:${PORT}/data/s3/templates`, {
    method: "POST",
    headers: {
        Authorization: `Bearer ${jwt}`,
    },
    body: formData,
});

console.log(await response.text());
