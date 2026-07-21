import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("legacy parity fixture", () => {
  it("preserves the exact latest-safe JavaScript bundle", () => {
    const directory = resolve("tests/fixtures/legacy");
    const base64 = Array.from({ length: 9 }, (_, index) =>
      readFileSync(resolve(directory, `app.base64.${String(index + 1).padStart(2, "0")}`), "utf8").trim(),
    ).join("");
    const bundle = Buffer.from(base64, "base64");
    expect(bundle.byteLength).toBe(74_295);
    expect(createHash("sha256").update(bundle).digest("hex")).toBe(
      "cc61348e2d77912430132c670e481ef749b1e90cf476649618871d66ebbfdde0",
    );
  });
});
