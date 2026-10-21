import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addManagedWorktree,
  cleanupManagedWorktree,
  compareSnapshots,
  registeredWorktrees,
  withManagedWorktree,
  type BuildSnapshot,
  type CommandRunner,
} from "../tools/check-linked-worktree.ts";

const temporaryRoots = new Set<string>();

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0] ?? ""} failed with exit code ${result.exitCode}`);
  }
  return (result.stdout?.toString() ?? "").trim();
}

function normalized(value: string): string {
  const resolved = path.resolve(value).split(path.sep).join("/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isRegistered(repository: string, target: string): boolean {
  const expected = normalized(target);
  return registeredWorktrees(repository).some(
    (worktree) => normalized(worktree) === expected,
  );
}

function createRepositoryFixture(): {
  root: string;
  repository: string;
  controlledRoot: string;
  sentinel: string;
  revision: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberl-worktree-contract-"));
  temporaryRoots.add(root);
  const repository = path.join(root, "repository");
  const controlledRoot = path.join(root, "managed worktrees");
  const sentinel = path.join(root, "unrelated worktree");
  fs.mkdirSync(repository);
  fs.mkdirSync(controlledRoot);

  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "Contract Test"]);
  git(repository, ["config", "user.email", "contract@example.invalid"]);
  fs.writeFileSync(path.join(repository, "fixture.txt"), "fixture\n", "utf8");
  git(repository, ["add", "--", "fixture.txt"]);
  git(repository, ["commit", "-m", "test: initialize fixture"]);
  const revision = git(repository, ["rev-parse", "HEAD"]);
  git(repository, ["worktree", "add", "--detach", sentinel, revision]);

  return { root, repository, controlledRoot, sentinel, revision };
}

function snapshot(articleCount: number): BuildSnapshot {
  return {
    articles: Array.from({ length: articleCount }, (_, index) => ({
      path: `/posts/post-${String(index + 1).padStart(2, "0")}/index.html`,
      dates: [
        `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        `2026-02-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      ],
    })),
    artifacts: Array.from({ length: 13 }, (_, index) => ({
      path: `source/runtime-${index + 1}.js`,
      sha256: String(index + 1).padStart(64, "0"),
    })),
  };
}

afterEach(() => {
  for (const root of temporaryRoots) {
    if (!fs.existsSync(root)) {
      temporaryRoots.delete(root);
      continue;
    }
    const repository = path.join(root, "repository");
    if (fs.existsSync(repository)) {
      for (const worktree of registeredWorktrees(repository)) {
        if (normalized(worktree) === normalized(repository)) continue;
        git(repository, ["worktree", "remove", "--force", worktree]);
      }
    }
    fs.rmSync(root, { force: true, recursive: true });
    temporaryRoots.delete(root);
  }
});

describe("linked-worktree build contract", () => {
  test("accepts matching dynamic snapshots after the blog grows to 24 articles", () => {
    const normal = snapshot(24);
    const linked = structuredClone(normal);

    expect(() => compareSnapshots(normal, linked)).not.toThrow();
  });

  test("rejects missing, changed, empty, or duplicate article results", () => {
    const normal = snapshot(24);
    const missing = snapshot(23);
    const changedDate = structuredClone(normal);
    changedDate.articles[0]!.dates[1] = "2027-01-01T00:00:00.000Z";
    const duplicate = structuredClone(normal);
    duplicate.articles[1]!.path = duplicate.articles[0]!.path;

    expect(() => compareSnapshots(normal, missing)).toThrow("Article count differs");
    expect(() => compareSnapshots(normal, changedDate)).toThrow(
      "different article paths or dates",
    );
    expect(() => compareSnapshots(normal, { ...normal, articles: [] })).toThrow(
      "produced no article pages",
    );
    expect(() => compareSnapshots(normal, duplicate)).toThrow(
      "duplicate article paths",
    );
  });

  test("removes only the managed worktree and preserves another registration", () => {
    const fixture = createRepositoryFixture();
    const target = path.join(fixture.controlledRoot, "temporary target");
    addManagedWorktree(
      fixture.repository,
      fixture.controlledRoot,
      target,
      fixture.revision,
    );

    cleanupManagedWorktree(fixture.repository, fixture.controlledRoot, target);

    expect(isRegistered(fixture.repository, target)).toBeFalse();
    expect(fs.existsSync(target)).toBeFalse();
    expect(isRegistered(fixture.repository, fixture.sentinel)).toBeTrue();
    expect(fs.existsSync(fixture.sentinel)).toBeTrue();
    expect(() =>
      cleanupManagedWorktree(
        fixture.repository,
        fixture.controlledRoot,
        fixture.sentinel,
      ),
    ).toThrow("outside its controlled directory");
    expect(isRegistered(fixture.repository, fixture.sentinel)).toBeTrue();
  });

  test("cleans the managed worktree after a contract failure", async () => {
    const fixture = createRepositoryFixture();
    const target = path.join(fixture.controlledRoot, "failing contract");

    await expect(
      withManagedWorktree(
        fixture.repository,
        fixture.controlledRoot,
        target,
        fixture.revision,
        async () => compareSnapshots(snapshot(24), snapshot(23)),
      ),
    ).rejects.toThrow("Article count differs");

    expect(isRegistered(fixture.repository, target)).toBeFalse();
    expect(fs.existsSync(target)).toBeFalse();
    expect(isRegistered(fixture.repository, fixture.sentinel)).toBeTrue();
  });

  test("cleans partial add failures and reports Git command failures", () => {
    const fixture = createRepositoryFixture();
    const failedTarget = path.join(fixture.controlledRoot, "failed add");
    fs.mkdirSync(failedTarget);

    expect(() =>
      addManagedWorktree(
        fixture.repository,
        fixture.controlledRoot,
        failedTarget,
        "refs/heads/does-not-exist",
      ),
    ).toThrow();
    expect(isRegistered(fixture.repository, failedTarget)).toBeFalse();
    expect(fs.existsSync(failedTarget)).toBeFalse();
    expect(isRegistered(fixture.repository, fixture.sentinel)).toBeTrue();

    const commandFailureTarget = path.join(fixture.controlledRoot, "command failure");
    fs.mkdirSync(commandFailureTarget);
    const failingRunner: CommandRunner = () => {
      throw new Error("synthetic Git failure");
    };
    expect(() =>
      cleanupManagedWorktree(
        fixture.repository,
        fixture.controlledRoot,
        commandFailureTarget,
        failingRunner,
      ),
    ).toThrow("synthetic Git failure");
    expect(fs.existsSync(commandFailureTarget)).toBeTrue();
    cleanupManagedWorktree(
      fixture.repository,
      fixture.controlledRoot,
      commandFailureTarget,
    );
  });
});
