import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const base58 = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/);
const contentPath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "contentPath must be a safe relative POSIX path",
  );
const contentFields = {
  contentHash: sha256,
  contentPath: contentPath.optional(),
};

const webEvidenceSchema = z
  .object({
    id,
    kind: z.literal("web"),
    uri: z
      .string()
      .url()
      .refine((value) => value.startsWith("https://"), "HTTPS is required"),
    title: z.string().min(1).max(500).optional(),
    retrievedAt: timestamp,
    ...contentFields,
  })
  .strict();
const fileEvidenceSchema = z
  .object({
    id,
    kind: z.literal("file"),
    path: contentPath,
    capturedAt: timestamp,
    ...contentFields,
  })
  .strict();
const solanaTransactionEvidenceSchema = z
  .object({
    id,
    kind: z.literal("solanaTransaction"),
    cluster: z.enum(["mainnet-beta", "devnet", "testnet", "localnet"]),
    signature: base58(64, 88),
    slot: z.number().int().nonnegative(),
    observedAt: timestamp,
    ...contentFields,
  })
  .strict();
const solanaAccountEvidenceSchema = z
  .object({
    id,
    kind: z.literal("solanaAccount"),
    cluster: z.enum(["mainnet-beta", "devnet", "testnet", "localnet"]),
    address: base58(32, 44),
    ownerProgram: base58(32, 44).optional(),
    slot: z.number().int().nonnegative(),
    observedAt: timestamp,
    ...contentFields,
  })
  .strict();
const solanaProgramEvidenceSchema = z
  .object({
    id,
    kind: z.literal("solanaProgram"),
    cluster: z.enum(["mainnet-beta", "devnet", "testnet", "localnet"]),
    programId: base58(32, 44),
    deploymentSlot: z.number().int().nonnegative().optional(),
    observedAt: timestamp,
    ...contentFields,
  })
  .strict();

export const evidenceSchema = z.discriminatedUnion("kind", [
  webEvidenceSchema,
  fileEvidenceSchema,
  solanaTransactionEvidenceSchema,
  solanaAccountEvidenceSchema,
  solanaProgramEvidenceSchema,
]);

const provenanceSchema = z
  .object({
    producer: z.string().min(1).max(200),
    method: z.enum([
      "agent/search",
      "agent/research",
      "human/research",
      "fixture/demo",
    ]),
    benchmark: z.boolean(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.method === "fixture/demo" && value.benchmark) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fixture/demo must set benchmark to false",
      });
    }
  });

const claimSchema = z
  .object({
    id,
    statement: z.string().min(1).max(4000),
    evidenceRefs: z
      .array(id)
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items).size === items.length,
        "duplicate evidence reference",
      ),
  })
  .strict();

const policySchema = z
  .object({
    requireClaimEvidence: z.literal(true),
    requireLocalContent: z.boolean(),
    allowedHashAlgorithms: z.tuple([z.literal("sha256")]),
  })
  .strict();

const baseReceiptShape = {
  schemaVersion: z.literal("searchreceipt/v0.1"),
  id,
  createdAt: timestamp,
  subject: z
    .object({
      action: z.enum(["search", "research"]),
      query: z.string().min(1).max(8000),
    })
    .strict(),
  provenance: provenanceSchema,
  policy: policySchema,
  evidence: z.array(evidenceSchema).min(1).max(1000),
  claims: z.array(claimSchema).max(1000),
};

type BaseReceipt = z.infer<z.ZodObject<typeof baseReceiptShape>>;

function addSemanticChecks<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((value, context) => {
    const receipt = value as BaseReceipt;
    const evidenceIds = new Set<string>();
    for (const [index, evidence] of receipt.evidence.entries()) {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "id"],
          message: "duplicate evidence id",
        });
      }
      evidenceIds.add(evidence.id);
    }
    const claimIds = new Set<string>();
    for (const [index, claim] of receipt.claims.entries()) {
      if (claimIds.has(claim.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claims", index, "id"],
          message: "duplicate claim id",
        });
      }
      claimIds.add(claim.id);
      for (const reference of claim.evidenceRefs) {
        if (!evidenceIds.has(reference)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["claims", index, "evidenceRefs"],
            message: `unknown evidence reference: ${reference}`,
          });
        }
      }
    }
  });
}

export const receiptDraftSchema = addSemanticChecks(
  z.object(baseReceiptShape).strict(),
);
export const receiptSchema = addSemanticChecks(
  z
    .object({
      ...baseReceiptShape,
      integrity: z
        .object({
          algorithm: z.literal("sha256"),
          canonicalization: z.literal("searchreceipt-jcs/v0.1"),
          receiptHash: sha256,
        })
        .strict(),
    })
    .strict(),
);

export const VERIFICATION_ASSURANCE =
  "Internal integrity and supplied local snapshots only; external truth is not established." as const;

const verifiedContentCheckSchema = z
  .object({
    evidenceId: id,
    status: z.literal("verified"),
    expectedHash: sha256,
    actualHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.actualHash !== value.expectedHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actualHash"],
        message: "verified content hashes must match",
      });
    }
  });
const unavailableContentCheckSchema = z
  .object({
    evidenceId: id,
    status: z.literal("unavailable"),
    expectedHash: sha256,
  })
  .strict();
const mismatchedContentCheckSchema = z
  .object({
    evidenceId: id,
    status: z.literal("mismatch"),
    expectedHash: sha256,
    actualHash: sha256.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.actualHash === value.expectedHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actualHash"],
        message: "mismatched content hashes must differ",
      });
    }
  });

const contentCheckSchema = z.union([
  verifiedContentCheckSchema,
  unavailableContentCheckSchema,
  mismatchedContentCheckSchema,
]);

export const verificationResultSchema = z
  .object({
    schemaVersion: z.literal("searchreceipt-verification/v0.1"),
    receiptId: id,
    receiptHash: sha256,
    passed: z.boolean(),
    integrityValid: z.boolean(),
    claimReferencesValid: z.boolean(),
    contentChecks: z.array(contentCheckSchema).min(1).max(1000),
    issues: z
      .array(z.string().min(1).max(4000))
      .max(2001)
      .refine(
        (items) => new Set(items).size === items.length,
        "duplicate verification issue",
      ),
    assurance: z.literal(VERIFICATION_ASSURANCE),
  })
  .strict()
  .superRefine((value, context) => {
    const checkIds = new Set<string>();
    for (const [index, check] of value.contentChecks.entries()) {
      if (checkIds.has(check.evidenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contentChecks", index, "evidenceId"],
          message: "duplicate content-check evidence id",
        });
      }
      checkIds.add(check.evidenceId);

      if (check.status === "mismatch") {
        const hasMatchingIssue =
          check.actualHash === undefined
            ? value.issues.some((issue) =>
                issue.startsWith(`content_unreadable:${check.evidenceId}:`),
              )
            : value.issues.includes(
                `content_hash_mismatch:${check.evidenceId}`,
              );
        if (!hasMatchingIssue) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contentChecks", index],
            message: "mismatch content check requires a corresponding issue",
          });
        }
      }
    }

    const issueIsExplained = (issue: string) =>
      (issue === "receipt_integrity_mismatch" && !value.integrityValid) ||
      (issue === "claim_references_invalid" && !value.claimReferencesValid) ||
      value.contentChecks.some(
        (check) =>
          (check.status === "unavailable" &&
            issue === `local_content_required:${check.evidenceId}`) ||
          (check.status === "mismatch" &&
            ((check.actualHash === undefined &&
              issue.startsWith(`content_unreadable:${check.evidenceId}:`)) ||
              (check.actualHash !== undefined &&
                issue === `content_hash_mismatch:${check.evidenceId}`))),
      );
    if (value.issues.some((issue) => !issueIsExplained(issue))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issues"],
        message: "verification result contains an unexplained issue",
      });
    }
    if (
      value.integrityValid ===
      value.issues.includes("receipt_integrity_mismatch")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["integrityValid"],
        message: "integrity flag and issue are inconsistent",
      });
    }
    if (
      value.claimReferencesValid ===
      value.issues.includes("claim_references_invalid")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimReferencesValid"],
        message: "claim-reference flag and issue are inconsistent",
      });
    }
    const expectedPassed =
      value.integrityValid &&
      value.claimReferencesValid &&
      value.contentChecks.every((check) => check.status !== "mismatch") &&
      value.issues.length === 0;
    if (value.passed !== expectedPassed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passed"],
        message: "inconsistent verification result",
      });
    }
  });

export type ReceiptDraft = z.infer<typeof receiptDraftSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
