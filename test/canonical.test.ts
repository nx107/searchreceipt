import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical.js";

describe("canonical JSON", () => {
  it("sorts object keys recursively while preserving arrays", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [3, { b: 1, a: 2 }] } })).toBe(
      '{"a":{"x":[3,{"a":2,"b":1}],"y":2},"z":1}',
    );
  });

  it("hashes bytes with an explicit algorithm prefix", () => {
    expect(sha256("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
