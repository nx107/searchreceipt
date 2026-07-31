import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const MAX_TEMPORARY_ATTEMPTS = 8;
const forbiddenObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

type ObjectState = "firstKeyOrEnd" | "key" | "colon" | "value" | "commaOrEnd";
type ArrayState = "firstValueOrEnd" | "value" | "commaOrEnd";
type Container =
  | { kind: "object"; state: ObjectState; keys: Set<string> }
  | { kind: "array"; state: ArrayState };

function syntaxError(offset: number, message: string): never {
  throw new SyntaxError(`invalid JSON at offset ${String(offset)}: ${message}`);
}

function stringEnd(source: string, start: number): number {
  for (let index = start + 1; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 0x22) return index + 1;
    if (code <= 0x1f) syntaxError(index, "unescaped control character");
    if (code !== 0x5c) continue;
    index += 1;
    const escaped = source[index];
    if (escaped === undefined) syntaxError(index, "unterminated escape");
    if (escaped === "u") {
      const hexadecimal = source.slice(index + 1, index + 5);
      if (!/^[a-fA-F0-9]{4}$/.test(hexadecimal)) {
        syntaxError(index, "invalid Unicode escape");
      }
      index += 4;
    } else if (!'"\\/bfnrt'.includes(escaped)) {
      syntaxError(index, "invalid escape");
    }
  }
  syntaxError(start, "unterminated string");
}

function decodedString(source: string, start: number): [string, number] {
  const end = stringEnd(source, start);
  return [JSON.parse(source.slice(start, end)) as string, end];
}

/**
 * Validates raw JSON grammar while retaining object-member boundaries that
 * native JSON.parse erases. Duplicate and prototype-sensitive names are
 * rejected from their decoded spelling at every object depth.
 */
export function parseStrictJson(source: string): unknown {
  const stack: Container[] = [];
  const root = { state: "value" as "value" | "end" };
  let index = 0;

  const skipWhitespace = () => {
    while (/[\t\n\r ]/.test(source[index] ?? "")) {
      index += 1;
    }
  };

  const completeValue = () => {
    const parent = stack.at(-1);
    if (parent === undefined) {
      if (root.state !== "value") syntaxError(index, "unexpected value");
      root.state = "end";
    } else if (
      (parent.kind === "object" && parent.state === "value") ||
      (parent.kind === "array" &&
        (parent.state === "firstValueOrEnd" || parent.state === "value"))
    ) {
      parent.state = "commaOrEnd";
    } else {
      syntaxError(index, "unexpected value");
    }
  };

  const beginValue = () => {
    const character = source[index];
    if (character === "{") {
      index += 1;
      stack.push({ kind: "object", state: "firstKeyOrEnd", keys: new Set() });
      return;
    }
    if (character === "[") {
      index += 1;
      stack.push({ kind: "array", state: "firstValueOrEnd" });
      return;
    }
    if (character === '"') {
      [, index] = decodedString(source, index);
      completeValue();
      return;
    }
    for (const literal of ["true", "false", "null"] as const) {
      if (source.startsWith(literal, index)) {
        index += literal.length;
        completeValue();
        return;
      }
    }
    const numberMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      source.slice(index),
    );
    const number = numberMatch ? numberMatch[0] : undefined;
    if (number !== undefined) {
      index += number.length;
      completeValue();
      return;
    }
    syntaxError(index, "expected a JSON value");
  };

  for (;;) {
    skipWhitespace();
    const container = stack.at(-1);
    if (container === undefined) {
      if (root.state === "value") {
        if (index === source.length)
          syntaxError(index, "expected a JSON value");
        beginValue();
        continue;
      }
      if (index !== source.length) syntaxError(index, "trailing content");
      return JSON.parse(source) as unknown;
    }

    const character = source[index];
    if (container.kind === "object") {
      if (container.state === "firstKeyOrEnd" && character === "}") {
        index += 1;
        stack.pop();
        completeValue();
      } else if (
        container.state === "firstKeyOrEnd" ||
        container.state === "key"
      ) {
        if (character !== '"') syntaxError(index, "expected an object key");
        const [key, end] = decodedString(source, index);
        if (container.keys.has(key)) {
          throw new SyntaxError(`duplicate JSON object key: ${key}`);
        }
        if (forbiddenObjectKeys.has(key)) {
          throw new SyntaxError(`forbidden JSON object key: ${key}`);
        }
        container.keys.add(key);
        index = end;
        container.state = "colon";
      } else if (container.state === "colon") {
        if (character !== ":") syntaxError(index, "expected ':'");
        index += 1;
        container.state = "value";
      } else if (container.state === "value") {
        beginValue();
      } else if (character === ",") {
        index += 1;
        container.state = "key";
      } else if (character === "}") {
        index += 1;
        stack.pop();
        completeValue();
      } else {
        syntaxError(index, "expected ',' or '}'");
      }
    } else if (container.state === "firstValueOrEnd" && character === "]") {
      index += 1;
      stack.pop();
      completeValue();
    } else if (
      container.state === "firstValueOrEnd" ||
      container.state === "value"
    ) {
      beginValue();
    } else if (character === ",") {
      index += 1;
      container.state = "value";
    } else if (character === "]") {
      index += 1;
      stack.pop();
      completeValue();
    } else {
      syntaxError(index, "expected ',' or ']'");
    }
  }
}

export async function readJsonFile(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("input must be a regular, non-symlink file");
  }
  if (info.size > MAX_JSON_BYTES) {
    throw new Error(`input exceeds ${String(MAX_JSON_BYTES)} bytes`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error(`input exceeds ${String(MAX_JSON_BYTES)} bytes`);
  }
  return parseStrictJson(bytes.toString("utf8"));
}

function isContained(root: string, target: string): boolean {
  const child = relative(root, target);
  return (
    child !== "" &&
    !child.startsWith(`..${sep}`) &&
    child !== ".." &&
    !isAbsolute(child)
  );
}

export async function readContainedFile(
  rootPath: string,
  relativePath: string,
): Promise<Buffer> {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error("unsafe content path");
  }
  const rootInfo = await lstat(rootPath);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("root must be a real directory");
  }
  const root = await realpath(rootPath);
  const lexicalTarget = resolve(root, relativePath);
  if (!isContained(root, lexicalTarget))
    throw new Error("content path escapes root");
  let cursor = root;
  for (const part of relative(root, lexicalTarget).split(sep)) {
    cursor = resolve(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) {
      throw new Error("content path contains a symlink");
    }
  }
  const target = await realpath(lexicalTarget);
  if (!isContained(root, target)) throw new Error("content path escapes root");
  const info = await stat(target);
  if (!info.isFile()) throw new Error("content must be a regular file");
  if (info.size > MAX_CONTENT_BYTES) {
    throw new Error(`content exceeds ${String(MAX_CONTENT_BYTES)} bytes`);
  }
  return readFile(target);
}

function randomTemporaryToken(): string {
  return randomBytes(16).toString("hex");
}

export async function writeFileAtomic(
  path: string,
  content: string,
  temporaryToken: () => string = randomTemporaryToken,
): Promise<void> {
  const target = resolve(path);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1) {
      throw new Error("refusing protected output target");
    }
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  await access(parent, constants.W_OK);

  let temporary: string | undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < MAX_TEMPORARY_ATTEMPTS; attempt += 1) {
    const token = temporaryToken();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(token)) {
      throw new Error("invalid temporary-file token");
    }
    temporary = `${target}.tmp-${token}`;
    try {
      handle = await open(temporary, "wx", 0o600);
      break;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw error;
    }
  }
  if (handle === undefined || temporary === undefined) {
    throw new Error("unable to allocate a unique temporary output file");
  }

  let closed = false;
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporary, target);
  } finally {
    if (!closed) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
