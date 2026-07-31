import { canonicalJson, sha256 } from "./canonical.js";
import { readContainedFile } from "./io.js";
import {
  receiptDraftSchema,
  receiptSchema,
  VERIFICATION_ASSURANCE,
  verificationResultSchema,
  type Receipt,
  type ReceiptDraft,
  type VerificationResult,
} from "./schemas.js";

export function createReceipt(input: unknown): Receipt {
  const draft = receiptDraftSchema.parse(input);
  return receiptSchema.parse({
    ...draft,
    integrity: {
      algorithm: "sha256",
      canonicalization: "searchreceipt-jcs/v0.1",
      receiptHash: sha256(canonicalJson(draft)),
    },
  });
}

export function receiptDraft(receipt: Receipt): ReceiptDraft {
  const { integrity, ...draft } = receipt;
  void integrity;
  return receiptDraftSchema.parse(draft);
}

export function isIntegrityValid(receipt: Receipt): boolean {
  return (
    receipt.integrity.receiptHash ===
    sha256(canonicalJson(receiptDraft(receipt)))
  );
}

export function validateReceipt(input: unknown): {
  receipt: Receipt;
  integrityValid: boolean;
} {
  const receipt = receiptSchema.parse(input);
  return { receipt, integrityValid: isIntegrityValid(receipt) };
}

/**
 * Parses a verification artifact and binds its identity, integrity flag,
 * evidence coverage, expected hashes, and local-content policy to one receipt.
 * This validates result consistency; only verifyReceipt performs content I/O.
 */
export function validateVerificationResult(
  receiptInput: unknown,
  resultInput: unknown,
): VerificationResult {
  const receipt = receiptSchema.parse(receiptInput);
  const integrityValid = isIntegrityValid(receipt);
  return verificationResultSchema
    .superRefine((result, context) => {
      if (result.receiptId !== receipt.id) {
        context.addIssue({
          code: "custom",
          path: ["receiptId"],
          message: "verification receipt id does not match receipt",
        });
      }
      if (result.receiptHash !== receipt.integrity.receiptHash) {
        context.addIssue({
          code: "custom",
          path: ["receiptHash"],
          message: "verification receipt hash does not match receipt",
        });
      }
      if (result.integrityValid !== integrityValid) {
        context.addIssue({
          code: "custom",
          path: ["integrityValid"],
          message: "verification integrity flag does not match receipt",
        });
      }
      if (!result.claimReferencesValid) {
        context.addIssue({
          code: "custom",
          path: ["claimReferencesValid"],
          message: "a schema-valid receipt has valid claim references",
        });
      }
      if (result.contentChecks.length !== receipt.evidence.length) {
        context.addIssue({
          code: "custom",
          path: ["contentChecks"],
          message:
            "verification result must cover every evidence item exactly once",
        });
      }
      for (const [index, evidence] of receipt.evidence.entries()) {
        const check = result.contentChecks[index];
        if (check === undefined) continue;
        if (check.evidenceId !== evidence.id) {
          context.addIssue({
            code: "custom",
            path: ["contentChecks", index, "evidenceId"],
            message: "content-check order and evidence id do not match receipt",
          });
        }
        if (check.expectedHash !== evidence.contentHash) {
          context.addIssue({
            code: "custom",
            path: ["contentChecks", index, "expectedHash"],
            message: "content-check expected hash does not match receipt",
          });
        }
        const requiredIssue = `local_content_required:${evidence.id}`;
        const hasRequiredIssue = result.issues.includes(requiredIssue);
        if (
          receipt.policy.requireLocalContent &&
          check.status === "unavailable" &&
          !hasRequiredIssue
        ) {
          context.addIssue({
            code: "custom",
            path: ["contentChecks", index],
            message:
              "required local content cannot be unavailable without an issue",
          });
        }
        if (!receipt.policy.requireLocalContent && hasRequiredIssue) {
          context.addIssue({
            code: "custom",
            path: ["issues"],
            message: "local-content-required issue contradicts receipt policy",
          });
        }
      }
    })
    .parse(resultInput);
}

export async function verifyReceipt(
  input: unknown,
  root?: string,
): Promise<VerificationResult> {
  const receipt = receiptSchema.parse(input);
  const integrityValid = isIntegrityValid(receipt);
  const issues: string[] = [];
  if (!integrityValid) issues.push("receipt_integrity_mismatch");

  const contentChecks: VerificationResult["contentChecks"] = [];
  for (const evidence of receipt.evidence) {
    const path =
      evidence.contentPath ??
      (evidence.kind === "file" ? evidence.path : undefined);
    if (path === undefined || root === undefined) {
      contentChecks.push({
        evidenceId: evidence.id,
        status: "unavailable",
        expectedHash: evidence.contentHash,
      });
      if (receipt.policy.requireLocalContent) {
        issues.push(`local_content_required:${evidence.id}`);
      }
      continue;
    }
    try {
      const actualHash = sha256(await readContainedFile(root, path));
      const status =
        actualHash === evidence.contentHash ? "verified" : "mismatch";
      contentChecks.push({
        evidenceId: evidence.id,
        status,
        expectedHash: evidence.contentHash,
        actualHash,
      });
      if (status === "mismatch")
        issues.push(`content_hash_mismatch:${evidence.id}`);
    } catch (error) {
      contentChecks.push({
        evidenceId: evidence.id,
        status: "mismatch",
        expectedHash: evidence.contentHash,
      });
      issues.push(
        `content_unreadable:${evidence.id}:${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return validateVerificationResult(receipt, {
    schemaVersion: "searchreceipt-verification/v0.1",
    receiptId: receipt.id,
    receiptHash: receipt.integrity.receiptHash,
    passed: integrityValid && issues.length === 0,
    integrityValid,
    claimReferencesValid: true,
    contentChecks,
    issues,
    assurance: VERIFICATION_ASSURANCE,
  });
}

export function compareReceipts(
  leftInput: unknown,
  rightInput: unknown,
): {
  schemaVersion: "searchreceipt-comparison/v0.1";
  leftId: string;
  rightId: string;
  equivalent: boolean;
  sameSubject: boolean;
  addedEvidence: string[];
  removedEvidence: string[];
  addedClaims: string[];
  removedClaims: string[];
  leftIntegrityValid: boolean;
  rightIntegrityValid: boolean;
} {
  const left = receiptSchema.parse(leftInput);
  const right = receiptSchema.parse(rightInput);
  const difference = (first: string[], second: string[]) =>
    first.filter((item) => !new Set(second).has(item)).sort();
  const leftEvidence = left.evidence.map(({ id }) => id);
  const rightEvidence = right.evidence.map(({ id }) => id);
  const leftClaims = left.claims.map(({ id }) => id);
  const rightClaims = right.claims.map(({ id }) => id);
  return {
    schemaVersion: "searchreceipt-comparison/v0.1",
    leftId: left.id,
    rightId: right.id,
    equivalent: canonicalJson(left) === canonicalJson(right),
    sameSubject: canonicalJson(left.subject) === canonicalJson(right.subject),
    addedEvidence: difference(rightEvidence, leftEvidence),
    removedEvidence: difference(leftEvidence, rightEvidence),
    addedClaims: difference(rightClaims, leftClaims),
    removedClaims: difference(leftClaims, rightClaims),
    leftIntegrityValid: isIntegrityValid(left),
    rightIntegrityValid: isIntegrityValid(right),
  };
}
