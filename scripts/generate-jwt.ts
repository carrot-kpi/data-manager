import { config } from "dotenv";
import { JWT_ISSUER } from "../src/constants.js";
import jsonwebtoken from "jsonwebtoken";

config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.log("Make sure you have a JWT_SECRET env in your .env file.");
    process.exit(1);
}

const scope = process.argv[2];
if (!scope) {
    console.log("You need to specify a scope.");
    process.exit(1);
}

console.log(
    jsonwebtoken.sign({ scp: [scope] }, JWT_SECRET, {
        expiresIn: "30 minutes",
        issuer: JWT_ISSUER,
        subject: "tester",
    }),
);
