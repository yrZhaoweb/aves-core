import { execFileSync } from "child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("package configuration", () => {
  it("should publish explicit CommonJS, ESM, and type entry points", () => {
    const packageJsonPath = join(__dirname, "../../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      main?: string;
      module?: string;
      types?: string;
      exports?: unknown;
      scripts?: Record<string, string>;
    };

    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.module).toBe("dist/esm/index.js");
    expect(packageJson.types).toBe("dist/index.d.ts");
    expect(packageJson.exports).toEqual({
      ".": {
        import: "./dist/esm/index.js",
        require: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    });
    expect(packageJson.scripts?.["build:esm"]).toContain(
      "scripts/fix-esm-imports.js",
    );
  });

  it("should rewrite built ESM relative imports for Node resolution", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "aves-core-esm-"));
    const scriptPath = join(__dirname, "../../../scripts/fix-esm-imports.js");

    try {
      mkdirSync(join(fixtureDir, "core"), { recursive: true });
      mkdirSync(join(fixtureDir, "lazy"), { recursive: true });
      writeFileSync(
        join(fixtureDir, "index.js"),
        [
          'export { AvesClient } from "./core/AvesClient";',
          'import "./polyfill";',
          'const modulePromise = import("./lazy/module");',
        ].join("\n"),
      );

      execFileSync(process.execPath, [scriptPath, fixtureDir]);

      expect(readFileSync(join(fixtureDir, "index.js"), "utf8")).toContain(
        'from "./core/AvesClient.js"',
      );
      expect(readFileSync(join(fixtureDir, "index.js"), "utf8")).toContain(
        'import "./polyfill.js"',
      );
      expect(readFileSync(join(fixtureDir, "index.js"), "utf8")).toContain(
        'import("./lazy/module.js")',
      );
      expect(
        JSON.parse(readFileSync(join(fixtureDir, "package.json"), "utf8")),
      ).toEqual({ type: "module" });
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
