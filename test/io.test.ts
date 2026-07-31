import { mkdirSync } from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStrictJson, writeFileAtomic } from "../src/io.js";

describe("strict JSON parser", () => {
  it("parses valid nested JSON without changing values", () => {
    const source = '{"a":[1,true,null,{"b":"value"}],"unicode":"\\u0061"}';
    expect(parseStrictJson(source)).toEqual(JSON.parse(source));
  });

  it.each([
    '{"id":"first","id":"second"}',
    '{"nested":{"policy":true,"policy":false}}',
    '{"items":[{"hash":"first","hash":"second"}]}',
    '{"id":"first","\\u0069d":"second"}',
  ])("rejects duplicate decoded names at every object depth", (source) => {
    expect(() => parseStrictJson(source)).toThrow(/duplicate JSON object key/);
  });

  it.each([
    '{"__proto__":{}}',
    '{"nested":{"constructor":{}}}',
    '{"items":[{"proto\\u0074ype":{}}]}',
  ])("rejects prototype-sensitive decoded names", (source) => {
    expect(() => parseStrictJson(source)).toThrow(/forbidden JSON object key/);
  });

  it.each(['{"a":1,}', "[1,]", '{"a":01}', '{"a":"\\x"}'])(
    "rejects malformed JSON before semantic parsing",
    (source) => {
      expect(() => parseStrictJson(source)).toThrow(/invalid JSON/);
    },
  );
});

describe("atomic output", () => {
  it("ignores the former predictable PID candidate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "searchreceipt-atomic-"));
    const target = join(directory, "receipt.json");
    const stale = `${target}.tmp-${String(process.pid)}`;
    await writeFile(stale, "stale", "utf8");

    await writeFileAtomic(target, "new");

    expect(await readFile(target, "utf8")).toBe("new");
    expect(await readFile(stale, "utf8")).toBe("stale");
  });

  it("retries an exclusive random-token collision without clobbering it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "searchreceipt-atomic-"));
    const target = join(directory, "receipt.json");
    const collision = `${target}.tmp-collision`;
    await writeFile(collision, "owned", "utf8");
    const tokens = ["collision", "fresh"];

    await writeFileAtomic(target, "new", () => tokens.shift() ?? "unexpected");

    expect(await readFile(target, "utf8")).toBe("new");
    expect(await readFile(collision, "utf8")).toBe("owned");
    await expect(lstat(`${target}.tmp-fresh`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("treats symlink and hardlink temporary candidates as collisions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "searchreceipt-atomic-"));
    const protectedFile = join(directory, "protected");
    await writeFile(protectedFile, "protected", "utf8");

    for (const [kind, createCandidate] of [
      ["symlink", symlink],
      ["hardlink", link],
    ] as const) {
      const target = join(directory, `${kind}.json`);
      const candidate = `${target}.tmp-collision`;
      await createCandidate(protectedFile, candidate);
      const tokens = ["collision", "fresh"];
      await writeFileAtomic(target, kind, () => tokens.shift() ?? "unexpected");
      expect(await readFile(target, "utf8")).toBe(kind);
      expect(await readFile(protectedFile, "utf8")).toBe("protected");
    }
  });

  it("refuses symlink and hardlink output targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "searchreceipt-atomic-"));
    const protectedFile = join(directory, "protected");
    const symlinkTarget = join(directory, "symlink.json");
    const hardlinkTarget = join(directory, "hardlink.json");
    await writeFile(protectedFile, "protected", "utf8");
    await symlink(protectedFile, symlinkTarget);
    await link(protectedFile, hardlinkTarget);

    await expect(writeFileAtomic(symlinkTarget, "changed")).rejects.toThrow(
      /protected output target/,
    );
    await expect(writeFileAtomic(hardlinkTarget, "changed")).rejects.toThrow(
      /protected output target/,
    );
    expect(await readFile(protectedFile, "utf8")).toBe("protected");
  });

  it("cleans the exclusive temporary file when rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "searchreceipt-atomic-"));
    const target = join(directory, "receipt.json");
    const temporary = `${target}.tmp-cleanup`;

    await expect(
      writeFileAtomic(target, "new", () => {
        mkdirSync(target);
        return "cleanup";
      }),
    ).rejects.toThrow();
    await expect(lstat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
