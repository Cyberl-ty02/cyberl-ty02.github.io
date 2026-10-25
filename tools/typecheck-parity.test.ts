import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface FixtureFile {
  path: string;
  source: string;
}

interface Scenario {
  name: string;
  expectedCodes: string[];
  files: FixtureFile[];
}

interface Diagnostic {
  code: string;
  column: number;
  file: string;
  line: number;
}

interface CheckResult {
  diagnostics: Diagnostic[];
  exitCode: number;
}

const repositoryRoot = path.resolve(import.meta.dir, "..");
const tscEntrypoint = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cyberl-typecheck-parity-"));

const baseConfig = {
  compilerOptions: {
    allowImportingTsExtensions: true,
    lib: ["ESNext"],
    module: "Preserve",
    moduleDetection: "force",
    moduleResolution: "bundler",
    noEmit: true,
    noImplicitOverride: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    strict: true,
    target: "ESNext",
    types: [],
    verbatimModuleSyntax: true,
  },
  include: ["./**/*.ts"],
};

const scenarios: Scenario[] = [
  {
    name: "type-mismatch",
    expectedCodes: ["TS2322"],
    files: [{ path: "index.ts", source: 'const count: number = "not-a-number";\n' }],
  },
  {
    name: "implicit-any",
    expectedCodes: ["TS7006"],
    files: [{ path: "index.ts", source: "function identity(value) { return value; }\n" }],
  },
  {
    name: "unknown-name",
    expectedCodes: ["TS2304"],
    files: [{ path: "index.ts", source: "void missingSymbol;\n" }],
  },
  {
    name: "missing-module",
    expectedCodes: ["TS2307"],
    files: [
      {
        path: "index.ts",
        source: 'import value from "./does-not-exist.js";\nvoid value;\n',
      },
    ],
  },
  {
    name: "unused-expect-error",
    expectedCodes: ["TS2578"],
    files: [
      {
        path: "index.ts",
        source: "// @ts-expect-error\nconst valid: number = 1;\nvoid valid;\n",
      },
    ],
  },
  {
    name: "declaration-file",
    expectedCodes: ["TS2322"],
    files: [
      { path: "globals.d.ts", source: "declare const declaredPort: number;\n" },
      { path: "index.ts", source: "const port: string = declaredPort;\nvoid port;\n" },
    ],
  },
  {
    name: "strict-options",
    expectedCodes: ["TS1484", "TS2322"],
    files: [
      {
        path: "types.ts",
        source: "export interface Settings { name: string; }\n",
      },
      {
        path: "index.ts",
        source: [
          'import { Settings } from "./types.ts";',
          "const table: Record<string, number> = {};",
          'const exact: number = table["missing"];',
          'const settings: Settings = { name: "ok" };',
          "void exact;",
          "void settings;",
          "",
        ].join("\n"),
      },
    ],
  },
];

function removeAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/gu, "");
}

function parseDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const pattern = /^(.+(?:\.d)?\.ts)\((\d+),(\d+)\): error (TS\d+):/gmu;
  for (const match of removeAnsi(output).matchAll(pattern)) {
    diagnostics.push({
      file: path.basename(match[1]!),
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[4]!,
    });
  }
  return diagnostics.sort((left, right) =>
    `${left.file}:${left.line}:${left.column}:${left.code}`.localeCompare(
      `${right.file}:${right.line}:${right.column}:${right.code}`,
    ),
  );
}

function run(command: string[], cwd: string): CheckResult {
  const result = Bun.spawnSync(command, {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
  return {
    diagnostics: parseDiagnostics(output),
    exitCode: result.exitCode,
  };
}

function writeScenario(scenario: Scenario): string {
  const directory = path.join(temporaryRoot, scenario.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "tsconfig.json"),
    `${JSON.stringify(baseConfig, null, 2)}\n`,
    "utf8",
  );
  for (const file of scenario.files) {
    fs.writeFileSync(path.join(directory, file.path), file.source, "utf8");
  }
  return directory;
}

describe("Bun and TypeScript diagnostic parity", () => {
  for (const scenario of scenarios) {
    test(`matches ${scenario.name} diagnostics`, () => {
      const directory = writeScenario(scenario);
      const config = path.join(directory, "tsconfig.json");
      const bun = run(
        [process.execPath, "check", "--no-script", "-p", config, "--no-pretty"],
        repositoryRoot,
      );
      const typescript = run(
        [process.execPath, tscEntrypoint, "--noEmit", "-p", config, "--pretty", "false"],
        repositoryRoot,
      );

      expect(bun.exitCode).toBe(1);
      expect(typescript.exitCode).toBe(1);
      expect([...new Set(bun.diagnostics.map(({ code }) => code))].sort()).toEqual(
        scenario.expectedCodes,
      );
      expect(bun.diagnostics).toEqual(typescript.diagnostics);

      if (scenario.name === "declaration-file") {
        expect(bun.diagnostics.some(({ code }) => code === "TS2304")).toBeFalse();
      }
    });
  }
});

afterAll(() => {
  fs.rmSync(temporaryRoot, { force: true, recursive: true });
});
