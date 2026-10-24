import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("missing Gemini configuration does not prevent module loading", () => {
  const env = { ...process.env };
  delete env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `
      import assert from "node:assert/strict";
      const { getGeminiClient, GeminiUnavailableError } = await import(${JSON.stringify(new URL("./gemini.ts", import.meta.url).href)});
      assert.throws(() => getGeminiClient(), GeminiUnavailableError);
    `,
  ], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
