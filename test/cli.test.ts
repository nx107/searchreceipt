import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const draft = new URL("../fixtures/demo/draft.json", import.meta.url).pathname;
const receiptPath = new URL("../fixtures/demo/receipt.json", import.meta.url)
  .pathname;
const root = new URL("../fixtures/demo", import.meta.url).pathname;
const fixtureSha256 =
  "673af3cbebba5f68fc303b6371ab03645226c073ca9359861a3f7839bce38dc2";

describe("built CLI", () => {
  it("keeps the stored fixture byte-identical to canonical create output", async () => {
    const stored = await readFile(receiptPath, "utf8");
    const created = (await execute(process.execPath, [cli, "create", draft]))
      .stdout;
    const hash = (value: string) =>
      createHash("sha256").update(value).digest("hex");

    expect(stored).toBe(created);
    expect(hash(stored)).toBe(hash(created));
    expect(hash(stored)).toBe(fixtureSha256);
  });

  it("prints help and version successfully", async () => {
    expect((await execute(process.execPath, [cli, "--version"])).stdout).toBe(
      "0.1.0\n",
    );
    expect((await execute(process.execPath, [cli, "--help"])).stdout).toContain(
      "create",
    );
  });

  it("validates and verifies a receipt in JSON mode", async () => {
    const validation = await execute(process.execPath, [
      cli,
      "validate",
      receiptPath,
      "--json",
    ]);
    expect(JSON.parse(validation.stdout)).toMatchObject({ valid: true });
    const verification = await execute(process.execPath, [
      cli,
      "verify",
      receiptPath,
      "--root",
      root,
      "--json",
    ]);
    expect(JSON.parse(verification.stdout)).toMatchObject({ passed: true });
  });

  it("compares receipts", async () => {
    const result = await execute(process.execPath, [
      cli,
      "compare",
      receiptPath,
      receiptPath,
      "--json",
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({ equivalent: true });
  });

  it("returns nonzero and one JSON error envelope for invalid input", async () => {
    await expect(
      execute(process.execPath, [cli, "validate", draft, "--json"]),
    ).rejects.toMatchObject({ code: 1 });
    try {
      await execute(process.execPath, [cli, "validate", draft, "--json"]);
    } catch (error) {
      const failure = error as { stderr: string };
      expect(JSON.parse(failure.stderr)).toMatchObject({
        error: "invalid_input",
      });
      expect(failure.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("rejects duplicate raw keys across receipt fields in both value orders", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "searchreceipt-duplicates-"),
    );
    const draftSource = await readFile(draft, "utf8");
    const receiptSource = await readFile(receiptPath, "utf8");
    const cases = [
      [
        "top-level id",
        draftSource,
        '"id": "demo-solana-research-001"',
        '"id": "shadow"',
        "create",
      ],
      [
        "policy",
        draftSource,
        '"requireLocalContent": true',
        '"requireLocalContent": false',
        "create",
      ],
      ["evidence", draftSource, '"kind": "web"', '"kind": "file"', "create"],
      [
        "claim",
        draftSource,
        '"statement": "The synthetic receipt records transaction, account, and program identifiers as typed evidence references."',
        '"statement": "shadow"',
        "create",
      ],
      [
        "integrity",
        receiptSource,
        '"canonicalization":"searchreceipt-jcs/v0.1"',
        '"canonicalization":"shadow"',
        "validate",
      ],
      [
        "escaped top-level id",
        draftSource,
        '"id": "demo-solana-research-001"',
        '"\\u0069d": "shadow"',
        "create",
      ],
    ] as const;

    for (const [name, source, original, shadow, command] of cases) {
      for (const order of ["before", "after"] as const) {
        const replacement =
          order === "before"
            ? `${shadow},${original}`
            : `${original},${shadow}`;
        const hostile = source.replace(original, replacement);
        expect(hostile, `${name} ${order} fixture mutation`).not.toBe(source);
        const input = join(
          directory,
          `${name.replaceAll(" ", "-")}-${order}.json`,
        );
        await writeFile(input, hostile, "utf8");
        try {
          await execute(process.execPath, [cli, command, input, "--json"]);
          throw new Error(`duplicate ${name} unexpectedly accepted`);
        } catch (error) {
          const failure = error as { code?: number; stderr?: string };
          expect(failure.code).toBe(1);
          expect(failure.stderr).toBeDefined();
          const stderr = failure.stderr ?? "";
          expect(JSON.parse(stderr)).toMatchObject({
            error: "invalid_input",
          });
          expect(stderr).toContain("duplicate JSON object key");
          expect(stderr.trim().split("\n")).toHaveLength(1);
        }
      }
    }
  });

  it("rejects prototype-sensitive raw keys through the CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "searchreceipt-prototype-"));
    const source = await readFile(draft, "utf8");
    for (const key of ["__proto__", "constructor", "proto\\u0074ype"]) {
      const input = join(directory, `${key.replaceAll("\\", "-")}.json`);
      await writeFile(input, source.replace("{", `{"${key}":{},`), "utf8");
      try {
        await execute(process.execPath, [cli, "create", input, "--json"]);
        throw new Error(`prototype key ${key} unexpectedly accepted`);
      } catch (error) {
        const failure = error as { code?: number; stderr?: string };
        expect(failure.code).toBe(1);
        expect(failure.stderr ?? "").toContain("forbidden JSON object key");
      }
    }
  });
});
