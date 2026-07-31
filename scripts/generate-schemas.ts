import { readFile, writeFile } from "node:fs/promises";
import * as prettier from "prettier";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  receiptDraftSchema,
  receiptSchema,
  verificationResultSchema,
} from "../src/schemas.js";

const schemas = [
  ["receipt-draft.schema.json", "SearchReceiptDraft", receiptDraftSchema],
  ["receipt.schema.json", "SearchReceipt", receiptSchema],
  [
    "verification-result.schema.json",
    "SearchReceiptVerification",
    verificationResultSchema,
  ],
] as const;

const check = process.argv.includes("--check");
const drift: string[] = [];
for (const [file, name, schema] of schemas) {
  const path = `schemas/${file}`;
  const output = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "root",
  });
  const configuration = (await prettier.resolveConfig(path)) ?? {};
  const content = await prettier.format(JSON.stringify(output), {
    ...configuration,
    filepath: path,
  });
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => "");
    if (existing !== content) drift.push(path);
  } else {
    await writeFile(path, content, "utf8");
  }
}
if (drift.length > 0) {
  throw new Error(`generated schema drift: ${drift.join(", ")}`);
}
