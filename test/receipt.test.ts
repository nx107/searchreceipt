import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareReceipts,
  createReceipt,
  isIntegrityValid,
  verifyReceipt,
} from "../src/receipt.js";
import { receiptDraftSchema, receiptSchema } from "../src/schemas.js";
import {
  validateVerificationResult,
  verificationResultSchema,
} from "../src/index.js";
import { sha256 } from "../src/canonical.js";

const fixturePath = new URL("../fixtures/demo/draft.json", import.meta.url);
async function draft(): Promise<unknown> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
}

describe("receipt contracts", () => {
  it("creates the same deterministic receipt twice", async () => {
    const input = await draft();
    expect(createReceipt(input)).toEqual(createReceipt(input));
    expect(isIntegrityValid(createReceipt(input))).toBe(true);
  });

  it("rejects unknown fields", async () => {
    const input = (await draft()) as Record<string, unknown>;
    expect(() =>
      receiptDraftSchema.parse({ ...input, surprise: true }),
    ).toThrow();
  });

  it("rejects fixture benchmark claims", async () => {
    const input = (await draft()) as Record<string, unknown>;
    const provenance = input.provenance as Record<string, unknown>;
    expect(() =>
      receiptDraftSchema.parse({
        ...input,
        provenance: { ...provenance, benchmark: true },
      }),
    ).toThrow(/benchmark/);
  });

  it("rejects duplicate IDs and dangling evidence references", async () => {
    const input = (await draft()) as Record<string, unknown>;
    const evidence = input.evidence as Record<string, unknown>[];
    const claims = input.claims as Record<string, unknown>[];
    expect(() =>
      receiptDraftSchema.parse({
        ...input,
        evidence: [...evidence, evidence[0]],
        claims: [
          ...claims,
          { id: "bad", statement: "Unsupported", evidenceRefs: ["missing"] },
        ],
      }),
    ).toThrow(/duplicate evidence id|unknown evidence reference/);
  });

  it("detects an integrity change", async () => {
    const receipt = createReceipt(await draft());
    const changed = { ...receipt, createdAt: "2026-01-16T12:00:00.000Z" };
    expect(receiptSchema.parse(changed)).toBeDefined();
    expect(isIntegrityValid(receiptSchema.parse(changed))).toBe(false);
  });

  it("compares typed evidence and claim changes", async () => {
    const left = createReceipt(await draft());
    const right = createReceipt({
      ...((await draft()) as Record<string, unknown>),
      id: "demo-two",
      claims: [],
    });
    const comparison = compareReceipts(left, right);
    expect(comparison.sameSubject).toBe(true);
    expect(comparison.removedClaims).toHaveLength(2);
    expect(comparison.equivalent).toBe(false);
  });
});

describe("local content verification", () => {
  it("verifies the complete demo snapshots", async () => {
    const receipt = createReceipt(await draft());
    const root = new URL("../fixtures/demo", import.meta.url).pathname;
    const result = await verifyReceipt(receipt, root);
    expect(result.passed).toBe(true);
    expect(
      result.contentChecks.every(({ status }) => status === "verified"),
    ).toBe(true);
  });

  it("reports a content mismatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "searchreceipt-"));
    await writeFile(join(root, "snapshot.txt"), "changed", "utf8");
    const input = (await draft()) as Record<string, unknown>;
    const evidence = input.evidence as Record<string, unknown>[];
    const receipt = createReceipt({
      ...input,
      evidence: [
        {
          ...evidence[0],
          contentPath: "snapshot.txt",
          contentHash: sha256("expected"),
        },
      ],
      claims: [
        {
          id: "claim",
          statement: "Bound claim",
          evidenceRefs: ["ev-web-context"],
        },
      ],
    });
    const result = await verifyReceipt(receipt, root);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("content_hash_mismatch:ev-web-context");
  });

  it("rejects linked-content symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "searchreceipt-root-"));
    const outside = join(
      await mkdtemp(join(tmpdir(), "searchreceipt-outside-")),
      "secret",
    );
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, join(root, "snapshot.txt"));
    const input = (await draft()) as Record<string, unknown>;
    const evidence = input.evidence as Record<string, unknown>[];
    const receipt = createReceipt({
      ...input,
      evidence: [{ ...evidence[0], contentPath: "snapshot.txt" }],
      claims: [
        {
          id: "claim",
          statement: "Bound claim",
          evidenceRefs: ["ev-web-context"],
        },
      ],
    });
    const result = await verifyReceipt(receipt, root);
    expect(result.passed).toBe(false);
    expect(result.issues.join(" ")).toMatch(/symlink/);
  });
});

describe("verification result contract", () => {
  it("rejects the independently reviewed forged passing forms", async () => {
    const receipt = createReceipt(await draft());
    const root = new URL("../fixtures/demo", import.meta.url).pathname;
    const valid = await verifyReceipt(receipt, root);
    const first = valid.contentChecks[0];
    expect(first?.status).toBe("verified");
    if (first?.status !== "verified") throw new Error("invalid test fixture");
    const differentHash = sha256("forged");
    const forged: unknown[] = [
      { ...valid, contentChecks: [] },
      {
        ...valid,
        contentChecks: [
          {
            ...first,
            status: "mismatch",
            actualHash: differentHash,
          },
          ...valid.contentChecks.slice(1),
        ],
      },
      {
        ...valid,
        contentChecks: [
          { ...first, actualHash: differentHash },
          ...valid.contentChecks.slice(1),
        ],
      },
      {
        ...valid,
        contentChecks: [
          { ...first, actualHash: undefined },
          { ...first, actualHash: undefined },
        ],
      },
    ];

    for (const result of forged) {
      expect(verificationResultSchema.safeParse(result).success).toBe(false);
    }
  });

  it("binds result identity, integrity, exact ordered coverage, and hashes to the receipt", async () => {
    const receipt = createReceipt(await draft());
    const root = new URL("../fixtures/demo", import.meta.url).pathname;
    const valid = await verifyReceipt(receipt, root);
    expect(validateVerificationResult(receipt, valid)).toEqual(valid);

    const otherHash = sha256("other");
    const forgeries: unknown[] = [
      { ...valid, receiptId: "another-receipt" },
      { ...valid, receiptHash: otherHash },
      {
        ...valid,
        integrityValid: false,
        passed: false,
        issues: ["receipt_integrity_mismatch"],
      },
      { ...valid, contentChecks: valid.contentChecks.slice(1) },
      {
        ...valid,
        contentChecks: [
          valid.contentChecks[1],
          valid.contentChecks[0],
          ...valid.contentChecks.slice(2),
        ],
      },
      {
        ...valid,
        contentChecks: valid.contentChecks.map((check, index) =>
          index === 0
            ? { ...check, expectedHash: otherHash, actualHash: otherHash }
            : check,
        ),
      },
    ];
    for (const result of forgeries) {
      expect(() => validateVerificationResult(receipt, result)).toThrow();
    }
  });

  it("binds unavailable checks and issues to requireLocalContent policy", async () => {
    const input = (await draft()) as Record<string, unknown>;
    const required = createReceipt(input);
    const requiredResult = await verifyReceipt(required);
    expect(requiredResult.passed).toBe(false);
    expect(validateVerificationResult(required, requiredResult)).toEqual(
      requiredResult,
    );

    const policy = input.policy as Record<string, unknown>;
    const optional = createReceipt({
      ...input,
      policy: { ...policy, requireLocalContent: false },
    });
    const optionalResult = await verifyReceipt(optional);
    expect(optionalResult.passed).toBe(true);
    expect(validateVerificationResult(optional, optionalResult)).toEqual(
      optionalResult,
    );
    expect(() =>
      validateVerificationResult(required, {
        ...optionalResult,
        receiptId: required.id,
        receiptHash: required.integrity.receiptHash,
      }),
    ).toThrow(/required local content/);
  });
});
