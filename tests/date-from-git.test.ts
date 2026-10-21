import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import git from "isomorphic-git";
import moment from "moment";

import {
  datesFromGit,
  inspectGitLayout,
  registerDateFromGit,
} from "../plugins/date-from-git.ts";

const temporaryDirectories = new Set<string>();
const createdAt = 1_700_000_000;
const updatedAt = 1_710_000_000;
const unrelatedAt = 1_720_000_000;
const author = {
  name: "Compatibility Test",
  email: "test@example.invalid",
  timezoneOffset: 0,
};

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

async function createCommit(
  dir: string,
  filepath: string,
  contents: string,
  message: string,
  timestamp: number,
): Promise<string> {
  const absolutePath = path.join(dir, filepath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  await git.add({ fs, dir, filepath });
  return git.commit({
    fs,
    dir,
    message,
    author: { ...author, timestamp },
  });
}

function runGit(
  cwd: string,
  args: string[],
  timestamp?: number,
): ReturnType<typeof Bun.spawnSync> {
  const dateEnvironment = timestamp
    ? {
        GIT_AUTHOR_DATE: `@${timestamp} +0000`,
        GIT_COMMITTER_DATE: `@${timestamp} +0000`,
      }
    : {};
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, ...dateEnvironment, GIT_OPTIONAL_LOCKS: "0" },
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args[0] ?? ""} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return result;
}

describe("date-from-git compatibility layer", () => {
  test("keeps creation time across a rename and updates modification time", async () => {
    const repoDir = temporaryDirectory("blog-date-filter-");
    const originalPath = "source/_posts/example.md";
    const renamedPath = "source/_posts/renamed.md";
    await git.init({ fs, dir: repoDir, defaultBranch: "main" });

    await createCommit(repoDir, originalPath, "first\n", "create post", createdAt);
    fs.renameSync(path.join(repoDir, originalPath), path.join(repoDir, renamedPath));
    await git.remove({ fs, dir: repoDir, filepath: originalPath });
    await git.add({ fs, dir: repoDir, filepath: renamedPath });
    await git.commit({
      fs,
      dir: repoDir,
      message: "rename post",
      author: { ...author, timestamp: updatedAt },
    });

    const dates = await datesFromGit(repoDir, path.join(repoDir, renamedPath));
    expect(dates.created.valueOf()).toBe(createdAt * 1000);
    expect(dates.updated.valueOf()).toBe(updatedAt * 1000);
  });

  test("stops safely when a shallow checkout does not contain the parent commit", async () => {
    const shallowDir = temporaryDirectory("blog-date-shallow-");
    const filepath = "source/_posts/shallow.md";
    await git.init({ fs, dir: shallowDir, defaultBranch: "main" });
    const parentOid = await createCommit(
      shallowDir,
      filepath,
      "first\n",
      "create shallow post",
      createdAt,
    );
    await createCommit(
      shallowDir,
      filepath,
      "second\n",
      "update shallow post",
      updatedAt,
    );

    fs.rmSync(
      path.join(shallowDir, ".git", "objects", parentOid.slice(0, 2), parentOid.slice(2)),
    );

    const dates = await datesFromGit(shallowDir, path.join(shallowDir, filepath));
    expect(dates.created.valueOf()).toBe(updatedAt * 1000);
    expect(dates.updated.valueOf()).toBe(updatedAt * 1000);
  });

  test("matches a normal repository from a detached linked worktree with spaces", async () => {
    const root = temporaryDirectory("blog linked worktree ");
    const mainDir = path.join(root, "main clone");
    const linkedDir = path.join(root, "linked worktree");
    const originalPath = "source/_posts/with spaces/original.md";
    const renamedPath = "source/_posts/with spaces/renamed.md";

    fs.mkdirSync(mainDir, { recursive: true });
    runGit(mainDir, ["init", "--initial-branch=main"]);
    runGit(mainDir, ["config", "user.name", author.name]);
    runGit(mainDir, ["config", "user.email", author.email]);

    const original = path.join(mainDir, originalPath);
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(original, "first\n", "utf8");
    runGit(mainDir, ["add", "--", originalPath]);
    runGit(mainDir, ["commit", "-m", "create post"], createdAt);

    fs.renameSync(original, path.join(mainDir, renamedPath));
    runGit(mainDir, ["add", "-A"]);
    runGit(mainDir, ["commit", "-m", "rename post"], updatedAt);

    fs.writeFileSync(path.join(mainDir, "unrelated.txt"), "unrelated\n", "utf8");
    runGit(mainDir, ["add", "--", "unrelated.txt"]);
    runGit(mainDir, ["commit", "-m", "unrelated change"], unrelatedAt);
    runGit(mainDir, ["worktree", "add", "--detach", linkedDir, "HEAD"]);

    try {
      const layout = inspectGitLayout(linkedDir);
      expect(layout.kind).toBe("git-file");
      expect(layout.gitDir).not.toBe(layout.commonDir);
      expect(fs.existsSync(path.join(layout.commonDir, "objects"))).toBe(true);
      expect(fs.existsSync(path.join(layout.gitDir, "commondir"))).toBe(true);

      const normalDates = await datesFromGit(mainDir, path.join(mainDir, renamedPath));
      const linkedDates = await datesFromGit(linkedDir, path.join(linkedDir, renamedPath));
      expect(linkedDates.created.valueOf()).toBe(createdAt * 1000);
      expect(linkedDates.updated.valueOf()).toBe(updatedAt * 1000);
      expect(linkedDates.created.valueOf()).toBe(normalDates.created.valueOf());
      expect(linkedDates.updated.valueOf()).toBe(normalDates.updated.valueOf());

      await expect(
        datesFromGit(linkedDir, path.join(linkedDir, renamedPath), {
          gitExecutable: "git-command-that-does-not-exist-phase5c",
        }),
      ).rejects.toThrow("Git CLI is required for linked worktree history");
    } finally {
      runGit(mainDir, ["worktree", "remove", "--force", linkedDir]);
    }
  });

  test("preserves explicit Front Matter dates without reading Git history", async () => {
    let handler:
      | ((data: {
          date: moment.Moment;
          raw: string;
          source: string;
          updated: moment.Moment;
        }) => unknown)
      | undefined;
    const runtime = {
      base_dir: path.join(os.tmpdir(), "repository-that-does-not-exist"),
      config: { source_dir: path.join(os.tmpdir(), "source-that-does-not-exist") },
      extend: {
        filter: {
          register: (
            _name: "before_post_render",
            callback: NonNullable<typeof handler>,
          ) => {
            handler = callback;
          },
        },
      },
      log: { info: () => undefined },
    };
    registerDateFromGit(runtime);

    const originalDate = moment("2020-01-02T03:04:05Z");
    const originalUpdated = moment("2021-02-03T04:05:06Z");
    const data = {
      date: originalDate,
      updated: originalUpdated,
      source: "explicit.md",
      raw: "---\ndate: 2020-01-02 03:04:05\nupdated: 2021-02-03 04:05:06\n---\ntext\n",
    };

    await handler!(data);
    expect(data.date).toBe(originalDate);
    expect(data.updated).toBe(originalUpdated);
  });
});

afterAll(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
