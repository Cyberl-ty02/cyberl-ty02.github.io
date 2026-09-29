import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import git from "isomorphic-git";

import { datesFromGit } from "../plugins/date-from-git.ts";

const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-date-filter-"));
const originalPath = "source/_posts/example.md";
const renamedPath = "source/_posts/renamed.md";
const createdAt = 1_700_000_000;
const updatedAt = 1_710_000_000;
const author = {
  name: "Compatibility Test",
  email: "test@example.invalid",
  timezoneOffset: 0,
};

async function commit(message: string, timestamp: number): Promise<void> {
  await git.commit({
    fs,
    dir: repoDir,
    message,
    author: { ...author, timestamp },
  });
}

describe("date-from-git compatibility layer", () => {
  test("keeps creation time across a rename and updates modification time", async () => {
    await git.init({ fs, dir: repoDir, defaultBranch: "main" });

    const originalAbsolutePath = path.join(repoDir, originalPath);
    fs.mkdirSync(path.dirname(originalAbsolutePath), { recursive: true });
    fs.writeFileSync(originalAbsolutePath, "first\n", "utf8");
    await git.add({ fs, dir: repoDir, filepath: originalPath });
    await commit("create post", createdAt);

    const renamedAbsolutePath = path.join(repoDir, renamedPath);
    fs.renameSync(originalAbsolutePath, renamedAbsolutePath);
    await git.remove({ fs, dir: repoDir, filepath: originalPath });
    await git.add({ fs, dir: repoDir, filepath: renamedPath });
    await commit("rename post", updatedAt);

    const dates = await datesFromGit(repoDir, renamedAbsolutePath);
    expect(dates.created.valueOf()).toBe(createdAt * 1000);
    expect(dates.updated.valueOf()).toBe(updatedAt * 1000);
  });
});

afterAll(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});
