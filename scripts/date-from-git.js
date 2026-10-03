var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// plugins/date-from-git.ts
var exports_date_from_git = {};
__export(exports_date_from_git, {
  datesFromGit: () => datesFromGit,
  registerDateFromGit: () => registerDateFromGit
});
module.exports = __toCommonJS(exports_date_from_git);
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_hexo_front_matter = __toESM(require("hexo-front-matter"));
var import_isomorphic_git = __toESM(require("isomorphic-git"));
var import_moment = __toESM(require("moment"));
async function datesFromGit(repoDir, filePath) {
  let relativePath = import_node_path.default.relative(repoDir, filePath).split(import_node_path.default.sep).join("/");
  let commitOid = await import_isomorphic_git.default.resolveRef({ fs: import_node_fs.default, dir: repoDir, ref: "HEAD" });
  const commits = [];
  while (commitOid) {
    const currentCommit = await import_isomorphic_git.default.readCommit({ fs: import_node_fs.default, dir: repoDir, oid: commitOid });
    const currentBlob = await blobOidAt(repoDir, commitOid, relativePath);
    if (!currentBlob)
      break;
    const parentOid = currentCommit.commit.parent[0];
    if (!parentOid) {
      commits.push(currentCommit);
      break;
    }
    if (!await commitExists(repoDir, parentOid)) {
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
      if (!previousPath)
        break;
      relativePath = previousPath;
    }
    commitOid = parentOid;
  }
  const now = import_moment.default();
  return {
    created: commits.length > 0 ? import_moment.default(commits.at(-1).commit.author.timestamp * 1000) : now.clone(),
    updated: commits.length > 0 ? import_moment.default(commits[0].commit.author.timestamp * 1000) : now.clone()
  };
}
async function commitExists(repoDir, commitOid) {
  try {
    await import_isomorphic_git.default.readCommit({ fs: import_node_fs.default, dir: repoDir, oid: commitOid });
    return true;
  } catch (error) {
    if (error instanceof import_isomorphic_git.Errors.NotFoundError)
      return false;
    throw error;
  }
}
async function blobOidAt(repoDir, commitOid, filePath) {
  try {
    return (await import_isomorphic_git.default.readBlob({ fs: import_node_fs.default, dir: repoDir, oid: commitOid, filepath: filePath })).oid;
  } catch (error) {
    if (error instanceof import_isomorphic_git.Errors.NotFoundError)
      return null;
    throw error;
  }
}
async function uniquePathForBlob(repoDir, commitOid, blobOid) {
  let match = null;
  for (const candidate of await import_isomorphic_git.default.listFiles({ fs: import_node_fs.default, dir: repoDir, ref: commitOid })) {
    if (await blobOidAt(repoDir, commitOid, candidate) !== blobOid)
      continue;
    if (match)
      return null;
    match = candidate;
  }
  return match;
}
function originalDateMetadata(raw) {
  const parsed = import_hexo_front_matter.default.parse(raw);
  return [parsed?.date, parsed?.updated];
}
function isMissingOrInvalid(value) {
  if (!value)
    return true;
  return Number(value.valueOf()) <= 1000;
}
function registerDateFromGit(runtime) {
  runtime.extend.filter.register("before_post_render", async (data) => {
    const filePath = import_node_path.default.resolve(runtime.config.source_dir, data.source);
    const [originalDate, originalUpdated] = originalDateMetadata(data.raw);
    if (isMissingOrInvalid(originalDate) || isMissingOrInvalid(originalUpdated)) {
      const dates = await datesFromGit(runtime.base_dir, filePath);
      if (isMissingOrInvalid(originalDate)) {
        data.date = dates.created;
        runtime.log.info(`Post ${filePath} set "date" to ${data.date.format("YYYY-MM-DD HH:mm:ss")}`);
      }
      if (isMissingOrInvalid(originalUpdated)) {
        data.updated = dates.updated;
        runtime.log.info(`Post ${filePath} set "updated" to ${data.updated.format("YYYY-MM-DD HH:mm:ss")}`);
      }
    }
    return data;
  });
}
if (typeof hexo !== "undefined")
  registerDateFromGit(hexo);
