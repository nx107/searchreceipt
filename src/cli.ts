#!/usr/bin/env node
import { ZodError } from "zod";
import { canonicalJson } from "./canonical.js";
import { readJsonFile, writeFileAtomic } from "./io.js";
import {
  compareReceipts,
  createReceipt,
  validateReceipt,
  verifyReceipt,
} from "./receipt.js";

const VERSION = "0.1.0";
const HELP = `SearchReceipt v${VERSION}

Usage:
  searchreceipt create <draft.json> [--output <receipt.json>]
  searchreceipt validate <receipt.json> [--json]
  searchreceipt verify <receipt.json> [--root <snapshot-root>] [--json]
  searchreceipt compare <left.json> <right.json> [--json]
  searchreceipt --help | --version

Exit codes: 0 success, 1 invalid input or failed validation/verification, 2 usage error.
`;

interface ParsedArguments {
  positionals: string[];
  json: boolean;
  output?: string;
  root?: string;
}

function parseArguments(values: string[]): ParsedArguments {
  const result: ParsedArguments = { positionals: [], json: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    if (value === "--json") result.json = true;
    else if (value === "--output" || value === "-o") {
      const next = values[index + 1];
      if (next === undefined) throw new Error(`${value} requires a path`);
      result.output = next;
      index += 1;
    } else if (value === "--root") {
      const next = values[index + 1];
      if (next === undefined) throw new Error("--root requires a path");
      result.root = next;
      index += 1;
    } else if (value.startsWith("-"))
      throw new Error(`unknown option: ${value}`);
    else result.positionals.push(value);
  }
  return result;
}

function machine(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}

function requireCount(values: string[], expected: number): void {
  if (values.length !== expected) {
    throw new Error(
      `expected ${String(expected)} path argument(s), received ${String(values.length)}`,
    );
  }
}

function pathAt(values: string[], index: number): string {
  const value = values[index];
  if (value === undefined) throw new Error("missing required path argument");
  return value;
}

async function main(): Promise<number> {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw[0] === "--help" || raw[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (raw[0] === "--version" || raw[0] === "-V") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const command = raw[0];
  const arguments_ = parseArguments(raw.slice(1));

  if (command === "create") {
    requireCount(arguments_.positionals, 1);
    const receipt = createReceipt(
      await readJsonFile(pathAt(arguments_.positionals, 0)),
    );
    const output = machine(receipt);
    if (arguments_.output === undefined) process.stdout.write(output);
    else await writeFileAtomic(arguments_.output, output);
    return 0;
  }
  if (command === "validate") {
    requireCount(arguments_.positionals, 1);
    const { receipt, integrityValid } = validateReceipt(
      await readJsonFile(pathAt(arguments_.positionals, 0)),
    );
    const result = {
      schemaVersion: "searchreceipt-validation/v0.1",
      receiptId: receipt.id,
      valid: integrityValid,
      issues: integrityValid ? [] : ["receipt_integrity_mismatch"],
    };
    if (arguments_.json) process.stdout.write(machine(result));
    else
      process.stdout.write(
        integrityValid
          ? `VALID ${receipt.id}\n`
          : `INVALID ${receipt.id}: receipt_integrity_mismatch\n`,
      );
    return integrityValid ? 0 : 1;
  }
  if (command === "verify") {
    requireCount(arguments_.positionals, 1);
    const result = await verifyReceipt(
      await readJsonFile(pathAt(arguments_.positionals, 0)),
      arguments_.root,
    );
    if (arguments_.json) process.stdout.write(machine(result));
    else
      process.stdout.write(
        `${result.passed ? "VERIFIED" : "NOT VERIFIED"} ${result.receiptId}; ${result.assurance}\n`,
      );
    return result.passed ? 0 : 1;
  }
  if (command === "compare") {
    requireCount(arguments_.positionals, 2);
    const result = compareReceipts(
      await readJsonFile(pathAt(arguments_.positionals, 0)),
      await readJsonFile(pathAt(arguments_.positionals, 1)),
    );
    if (arguments_.json) process.stdout.write(machine(result));
    else
      process.stdout.write(
        `${result.equivalent ? "EQUIVALENT" : "DIFFERENT"} ${result.leftId} ${result.rightId}\n`,
      );
    return 0;
  }
  throw new Error(`unknown command: ${command ?? ""}`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const json = process.argv.includes("--json");
    const message =
      error instanceof ZodError
        ? error.issues
            .map(
              (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
            )
            .join("; ")
        : error instanceof Error
          ? error.message
          : "unknown error";
    if (json) {
      process.stderr.write(
        machine({
          schemaVersion: "searchreceipt-error/v0.1",
          error: "invalid_input",
          message,
        }),
      );
    } else process.stderr.write(`Error: ${message}\n`);
    process.exitCode =
      message.startsWith("expected") || message.startsWith("unknown command")
        ? 2
        : 1;
  });
