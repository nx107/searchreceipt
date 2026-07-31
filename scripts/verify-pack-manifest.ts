import { z } from "zod";
import { readFileSync } from "node:fs";

const packManifestSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    entryCount: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    unpackedSize: z.number().int().nonnegative(),
    files: z.array(z.object({ path: z.string() }).passthrough()),
  })
  .passthrough();

function main(): void {
  const manifests = z
    .array(packManifestSchema)
    .length(1)
    .parse(JSON.parse(readFileSync(0, "utf8")) as unknown);
  const manifest = manifests[0];
  if (manifest === undefined) throw new Error("missing npm pack manifest");

  const files = manifest.files.map(({ path }) => path);
  if (manifest.entryCount !== files.length) {
    throw new Error(
      `entryCount mismatch: ${String(manifest.entryCount)} != ${String(files.length)}`,
    );
  }

  const required = [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "package.json",
    "dist/cli.js",
    "dist/index.d.ts",
    "dist/index.js",
    "schemas/receipt-draft.schema.json",
    "schemas/receipt.schema.json",
    "schemas/verification-result.schema.json",
  ];
  const missing = required.filter((path) => !files.includes(path));

  const forbidden = files.filter(
    (path) =>
      /^(?:fixtures|reports|scripts|src|test)\//.test(path) ||
      /(?:^|\/)\.env(?:\.|$)/.test(path) ||
      /\.(?:key|pem|p12|pfx)$/i.test(path),
  );

  if (missing.length > 0 || forbidden.length > 0) {
    throw new Error(
      `invalid package contents: missing=${JSON.stringify(missing)} forbidden=${JSON.stringify(forbidden)}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      fileCount: files.length,
      packedSize: manifest.size,
      unpackedSize: manifest.unpackedSize,
      missing,
      forbidden,
    })}\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(
    `Package manifest verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}
