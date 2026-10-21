import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { inspectGitLayout } from "../plugins/date-from-git.ts";
import { runtimeArtifacts } from "./runtime-artifacts.ts";

export interface ArticleSnapshot {
  path: string;
  dates: string[];
}

export interface BuildSnapshot {
  articles: ArticleSnapshot[];
  artifacts: Array<{ path: string; sha256: string }>;
}

interface RunOptions {
  allowFailure?: boolean;
  quiet?: boolean;
}

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  options?: RunOptions,
) => ReturnType<typeof Bun.spawnSync>;

export const runCommand: CommandRunner = (
  command,
  args,
  cwd,
  options = {},
) => {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    env: process.env,
    stderr: options.quiet ? "pipe" : "inherit",
    stdout: options.quiet ? "pipe" : "inherit",
  });
  if (!options.allowFailure && result.exitCode !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed with exit code ${result.exitCode}`);
  }
  return result;
};

function captureGit(
  cwd: string,
  args: string[],
  runner: CommandRunner = runCommand,
): string {
  const result = runner("git", args, cwd, { quiet: true });
  return (result.stdout?.toString() ?? "").trim();
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizePathForComparison(value: string): string {
  const normalized = normalizePath(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertControlledPath(controlledRoot: string, target: string): void {
  const relative = path.relative(path.resolve(controlledRoot), path.resolve(target));
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The temporary worktree path is outside its controlled directory");
  }
}

export function registeredWorktrees(
  repository: string,
  runner: CommandRunner = runCommand,
): string[] {
  return captureGit(repository, ["worktree", "list", "--porcelain"], runner)
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function isWorktreeRegistered(
  repository: string,
  target: string,
  runner: CommandRunner = runCommand,
): boolean {
  const normalizedTarget = normalizePathForComparison(target);
  return registeredWorktrees(repository, runner).some(
    (worktree) => normalizePathForComparison(worktree) === normalizedTarget,
  );
}

export function cleanupManagedWorktree(
  repository: string,
  controlledRoot: string,
  target: string,
  runner: CommandRunner = runCommand,
): void {
  assertControlledPath(controlledRoot, target);

  if (isWorktreeRegistered(repository, target, runner)) {
    const removal = runner(
      "git",
      ["worktree", "remove", "--force", target],
      repository,
      { allowFailure: true, quiet: true },
    );
    if (removal.exitCode !== 0) {
      throw new Error(
        `Git could not remove the managed worktree (exit ${removal.exitCode})`,
      );
    }
  } else if (fs.existsSync(target)) {
    fs.rmSync(target, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }

  if (isWorktreeRegistered(repository, target, runner)) {
    throw new Error("The temporary linked worktree remained registered after cleanup");
  }
  if (fs.existsSync(target)) {
    throw new Error("The temporary linked worktree directory remained after cleanup");
  }
}

export function addManagedWorktree(
  repository: string,
  controlledRoot: string,
  target: string,
  revision: string,
  runner: CommandRunner = runCommand,
): void {
  assertControlledPath(controlledRoot, target);
  try {
    runner(
      "git",
      ["worktree", "add", "--detach", target, revision],
      repository,
    );
  } catch (addError) {
    try {
      cleanupManagedWorktree(repository, controlledRoot, target, runner);
    } catch (cleanupError) {
      throw new AggregateError(
        [addError, cleanupError],
        "Worktree creation failed and its partial state could not be cleaned safely",
      );
    }
    throw addError;
  }
}

export async function withManagedWorktree<T>(
  repository: string,
  controlledRoot: string,
  target: string,
  revision: string,
  task: () => Promise<T>,
  runner: CommandRunner = runCommand,
): Promise<T> {
  addManagedWorktree(repository, controlledRoot, target, revision, runner);
  let taskError: unknown;

  try {
    return await task();
  } catch (error) {
    taskError = error;
    throw error;
  } finally {
    try {
      cleanupManagedWorktree(repository, controlledRoot, target, runner);
    } catch (cleanupError) {
      if (taskError) {
        throw new AggregateError(
          [taskError, cleanupError],
          "The contract failed and its managed worktree could not be cleaned safely",
        );
      }
      throw cleanupError;
    }
  }
}

async function sha256(filePath: string): Promise<string> {
  const contents = await Bun.file(filePath).arrayBuffer();
  return new Bun.CryptoHasher("sha256").update(contents).digest("hex");
}

function validateArticles(articles: ArticleSnapshot[], label: string): void {
  if (articles.length === 0) {
    throw new Error(`${label} produced no article pages`);
  }
  if (new Set(articles.map((article) => article.path)).size !== articles.length) {
    throw new Error(`${label} produced duplicate article paths`);
  }
  if (articles.some(({ dates }) => dates.length === 0)) {
    throw new Error(`${label} contains an article without a rendered date`);
  }
}

export function compareSnapshots(normal: BuildSnapshot, linked: BuildSnapshot): void {
  validateArticles(normal.articles, "Normal checkout");
  validateArticles(linked.articles, "Linked worktree");

  if (normal.articles.length !== linked.articles.length) {
    throw new Error(
      `Article count differs: normal=${normal.articles.length}, ` +
        `linked=${linked.articles.length}`,
    );
  }
  if (JSON.stringify(normal.articles) !== JSON.stringify(linked.articles)) {
    throw new Error(
      "Normal checkout and linked worktree produced different article paths or dates",
    );
  }
  if (JSON.stringify(normal.artifacts) !== JSON.stringify(linked.artifacts)) {
    throw new Error(
      "Normal checkout and linked worktree produced different runtime artifacts",
    );
  }
}

async function snapshotBuild(root: string): Promise<BuildSnapshot> {
  const articles: ArticleSnapshot[] = [];
  for await (const relativePath of new Bun.Glob("posts/**/index.html").scan({
    cwd: path.join(root, "public"),
    onlyFiles: true,
  })) {
    const normalizedPath = normalizePath(relativePath);
    const html = await Bun.file(path.join(root, "public", relativePath)).text();
    const dates = [...html.matchAll(/<time[^>]+datetime="([^"]+)"/gu)].map(
      (match) => match[1]!,
    );
    articles.push({ path: `/${normalizedPath}`, dates });
  }
  articles.sort((left, right) => left.path.localeCompare(right.path));
  validateArticles(articles, "Build");

  const artifacts = await Promise.all(
    runtimeArtifacts.map(async ({ output }) => ({
      path: normalizePath(output),
      sha256: await sha256(path.join(root, output)),
    })),
  );
  artifacts.sort((left, right) => left.path.localeCompare(right.path));

  return { articles, artifacts };
}

function removeGeneratedDirectories(root: string): void {
  for (const entry of ["node_modules", "public", "db.json"]) {
    fs.rmSync(path.join(root, entry), {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }
}

async function main(): Promise<void> {
  const repository = process.cwd();
  const temporaryBase = process.env.RUNNER_TEMP ?? os.tmpdir();
  const temporaryRoot = fs.mkdtempSync(
    path.join(temporaryBase, "cyberl-linked-worktree-"),
  );
  const linkedWorktree = path.join(temporaryRoot, "detached checkout with spaces");

  try {
    const normalLayout = inspectGitLayout(repository);
    if (normalLayout.kind !== "directory") {
      throw new Error("The contract must start from a normal Git checkout");
    }

    const normalHead = captureGit(repository, ["rev-parse", "HEAD"]);
    const normalSnapshot = await snapshotBuild(repository);

    await withManagedWorktree(
      repository,
      temporaryRoot,
      linkedWorktree,
      normalHead,
      async () => {
        const linkedLayout = inspectGitLayout(linkedWorktree);
        if (linkedLayout.kind !== "git-file") {
          throw new Error("The temporary checkout is not a linked worktree");
        }
        if (linkedLayout.gitDir === linkedLayout.commonDir) {
          throw new Error("The linked worktree does not expose a separate commondir");
        }
        if (!fs.existsSync(path.join(linkedLayout.gitDir, "commondir"))) {
          throw new Error("The linked worktree private gitdir has no commondir file");
        }
        if (!fs.existsSync(path.join(linkedLayout.commonDir, "objects"))) {
          throw new Error("The linked worktree common object directory is unavailable");
        }

        const linkedHead = captureGit(linkedWorktree, ["rev-parse", "HEAD"]);
        if (linkedHead !== normalHead) {
          throw new Error("The linked worktree is not testing the current commit");
        }
        const symbolicRef = runCommand(
          "git",
          ["symbolic-ref", "-q", "HEAD"],
          linkedWorktree,
          { allowFailure: true, quiet: true },
        );
        if (symbolicRef.exitCode === 0) {
          throw new Error("The linked worktree must use detached HEAD");
        }

        runCommand(
          process.execPath,
          ["install", "--frozen-lockfile", "--backend=copyfile"],
          linkedWorktree,
        );
        runCommand(process.execPath, ["run", "build"], linkedWorktree);

        const linkedSnapshot = await snapshotBuild(linkedWorktree);
        compareSnapshots(normalSnapshot, linkedSnapshot);

        const linkedStatus = captureGit(linkedWorktree, ["status", "--porcelain"]);
        if (linkedStatus) {
          throw new Error(
            "The linked worktree build changed tracked or untracked project files",
          );
        }

        removeGeneratedDirectories(linkedWorktree);
      },
    );

    console.log(
      `Linked-worktree contract passed: ${normalSnapshot.articles.length} articles and ` +
        `${normalSnapshot.artifacts.length} runtime artifacts are identical.`,
    );
  } finally {
    if (isWorktreeRegistered(repository, linkedWorktree)) {
      throw new Error(
        "Refusing to remove the controlled directory while its worktree is registered",
      );
    }
    fs.rmSync(temporaryRoot, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }
}

if (import.meta.main) await main();
