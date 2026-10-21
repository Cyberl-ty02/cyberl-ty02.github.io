import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

import frontMatter from "hexo-front-matter";
import git, { Errors, type ReadCommitResult } from "isomorphic-git";
import moment, { type Moment } from "moment";

interface PostData {
  date: Moment;
  raw: string;
  source: string;
  updated: Moment;
}

interface HexoRuntime {
  base_dir: string;
  config: {
    source_dir: string;
  };
  extend: {
    filter: {
      register: (
        name: "before_post_render",
        handler: (data: PostData) => PostData | Promise<PostData>,
      ) => void;
    };
  };
  log: {
    info: (message: string) => void;
  };
}

declare const hexo: HexoRuntime | undefined;

export type GitLayout =
  | {
      kind: "directory";
      gitDir: string;
      commonDir: string;
    }
  | {
      kind: "git-file";
      gitDir: string;
      commonDir: string;
    };

export interface DateFromGitOptions {
  gitExecutable?: string;
}

export function inspectGitLayout(repoDir: string): GitLayout {
  const dotGit = path.join(repoDir, ".git");
  const stat = fs.statSync(dotGit);

  if (stat.isDirectory()) {
    return { kind: "directory", gitDir: dotGit, commonDir: dotGit };
  }
  if (!stat.isFile()) throw new Error(`${dotGit} is neither a Git directory nor a gitdir file`);

  const pointer = fs.readFileSync(dotGit, "utf8").trim().match(/^gitdir:\s*(.+)$/iu)?.[1];
  if (!pointer) throw new Error(`${dotGit} does not contain a valid gitdir pointer`);

  const gitDir = path.resolve(repoDir, pointer);
  if (!fs.statSync(gitDir).isDirectory()) throw new Error(`Git private directory is invalid`);

  const commonDirFile = path.join(gitDir, "commondir");
  const commonDir = fs.existsSync(commonDirFile)
    ? path.resolve(gitDir, fs.readFileSync(commonDirFile, "utf8").trim())
    : gitDir;
  if (!fs.statSync(commonDir).isDirectory()) throw new Error(`Git common directory is invalid`);

  return { kind: "git-file", gitDir, commonDir };
}

export async function datesFromGit(repoDir: string, filePath: string): Promise<{
  created: Moment;
  updated: Moment;
}>;
export async function datesFromGit(
  repoDir: string,
  filePath: string,
  options: DateFromGitOptions,
): Promise<{
  created: Moment;
  updated: Moment;
}>;
export async function datesFromGit(
  repoDir: string,
  filePath: string,
  options: DateFromGitOptions = {},
): Promise<{
  created: Moment;
  updated: Moment;
}> {
  const layout = inspectGitLayout(repoDir);
  if (layout.kind === "git-file") {
    return datesFromGitCli(repoDir, filePath, options.gitExecutable ?? "git");
  }

  return datesFromIsomorphicGit(repoDir, filePath);
}

async function datesFromIsomorphicGit(repoDir: string, filePath: string): Promise<{
  created: Moment;
  updated: Moment;
}> {
  let relativePath = path.relative(repoDir, filePath).split(path.sep).join("/");
  let commitOid = await git.resolveRef({ fs, dir: repoDir, ref: "HEAD" });
  const commits: ReadCommitResult[] = [];

  while (commitOid) {
    const currentCommit = await git.readCommit({ fs, dir: repoDir, oid: commitOid });
    const currentBlob = await blobOidAt(repoDir, commitOid, relativePath);
    if (!currentBlob) break;

    const parentOid = currentCommit.commit.parent[0];
    if (!parentOid) {
      commits.push(currentCommit);
      break;
    }

    // A shallow checkout still records the parent OID even though that object is
    // absent. Treat the oldest available commit as the history boundary instead
    // of asking listFiles() to walk an object that cannot exist locally.
    if (!(await commitExists(repoDir, parentOid))) {
      commits.push(currentCommit);
      break;
    }

    const parentBlob = await blobOidAt(repoDir, parentOid, relativePath);
    if (parentBlob === currentBlob) {
      commitOid = parentOid;
      continue;
    }

    commits.push(currentCommit);
    if (!parentBlob) {
      const previousPath = await uniquePathForBlob(repoDir, parentOid, currentBlob);
      if (!previousPath) break;
      relativePath = previousPath;
    }

    commitOid = parentOid;
  }

  const now = moment();

  return {
    created:
      commits.length > 0
        ? moment(commits.at(-1)!.commit.author.timestamp * 1000)
        : now.clone(),
    updated:
      commits.length > 0
        ? moment(commits[0]!.commit.author.timestamp * 1000)
        : now.clone(),
  };
}

async function datesFromGitCli(
  repoDir: string,
  filePath: string,
  executable: string,
): Promise<{ created: Moment; updated: Moment }> {
  const relativePath = path.relative(repoDir, filePath).split(path.sep).join("/");
  const args = [
    "--no-pager",
    "--literal-pathspecs",
    "-C",
    repoDir,
    "log",
    "--follow",
    "--format=%at",
    "--",
    relativePath,
  ];

  let output: string;
  try {
    output = await execFileUtf8(executable, args);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `Git CLI is required for linked worktree history, but "${executable}" was not found`,
        { cause: error },
      );
    }
    throw new Error(`Git CLI could not read linked worktree history`, { cause: error });
  }

  const timestamps = output
    .split(/\r?\n/gu)
    .map((line) => Number(line.trim()))
    .filter((timestamp) => Number.isSafeInteger(timestamp) && timestamp > 0);
  const now = moment();

  return {
    created: timestamps.length > 0 ? moment(timestamps.at(-1)! * 1000) : now.clone(),
    updated: timestamps.length > 0 ? moment(timestamps[0]! * 1000) : now.clone(),
  };
}

function execFileUtf8(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

async function commitExists(repoDir: string, commitOid: string): Promise<boolean> {
  try {
    await git.readCommit({ fs, dir: repoDir, oid: commitOid });
    return true;
  } catch (error) {
    if (error instanceof Errors.NotFoundError) return false;
    throw error;
  }
}

async function blobOidAt(
  repoDir: string,
  commitOid: string,
  filePath: string,
): Promise<string | null> {
  try {
    return (await git.readBlob({ fs, dir: repoDir, oid: commitOid, filepath: filePath }))
      .oid;
  } catch (error) {
    if (error instanceof Errors.NotFoundError) return null;
    throw error;
  }
}

async function uniquePathForBlob(
  repoDir: string,
  commitOid: string,
  blobOid: string,
): Promise<string | null> {
  let match: string | null = null;

  for (const candidate of await git.listFiles({ fs, dir: repoDir, ref: commitOid })) {
    if ((await blobOidAt(repoDir, commitOid, candidate)) !== blobOid) continue;
    if (match) return null;
    match = candidate;
  }

  return match;
}

function originalDateMetadata(raw: string): [unknown, unknown] {
  const parsed = frontMatter.parse(raw);
  return [parsed?.date, parsed?.updated];
}

function isMissingOrInvalid(value: unknown): boolean {
  if (!value) return true;
  return Number((value as { valueOf: () => unknown }).valueOf()) <= 1000;
}

export function registerDateFromGit(runtime: HexoRuntime): void {
  runtime.extend.filter.register("before_post_render", async (data) => {
    const filePath = path.resolve(runtime.config.source_dir, data.source);
    const [originalDate, originalUpdated] = originalDateMetadata(data.raw);

    if (isMissingOrInvalid(originalDate) || isMissingOrInvalid(originalUpdated)) {
      const dates = await datesFromGit(runtime.base_dir, filePath);

      if (isMissingOrInvalid(originalDate)) {
        data.date = dates.created;
        runtime.log.info(
          `Post ${filePath} set "date" to ${data.date.format("YYYY-MM-DD HH:mm:ss")}`,
        );
      }

      if (isMissingOrInvalid(originalUpdated)) {
        data.updated = dates.updated;
        runtime.log.info(
          `Post ${filePath} set "updated" to ${data.updated.format("YYYY-MM-DD HH:mm:ss")}`,
        );
      }
    }

    return data;
  });
}

if (typeof hexo !== "undefined") registerDateFromGit(hexo);
