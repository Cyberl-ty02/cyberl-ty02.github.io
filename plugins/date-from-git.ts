import fs from "node:fs";
import path from "node:path";

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

export async function datesFromGit(repoDir: string, filePath: string): Promise<{
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
