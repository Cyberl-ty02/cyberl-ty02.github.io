# Repository guidance

## Project principles

Cyberl Blog is a personal Hexo blog, not a large application platform. Keep its
build and maintenance workflow small, reviewable, and reproducible.

The engineering direction is:

- Bun-first
- TypeScript-standard
- Node-compatible
- Upstream-friendly

Prefer the published Hexo and Kratos-Rebirth interfaces. Do not replace a small
compatibility layer with a private framework fork or unnecessary abstraction.

## Sources of truth

- `package.json` defines the supported project commands and direct dependencies.
- `bun.lock` pins the dependency graph; `bunfig.toml` defines the repository
  registry policy.
- `frontend/` contains browser runtime source, including the comment dispatcher
  and providers.
- `plugins/` contains TypeScript source for local Hexo plugins.
- `tools/` contains build and validation tooling.
- `tests/` contains the main executable contracts.
- `source/_posts/` contains article source.
- `tools/runtime-artifacts.ts` is the manifest for generated and vendored runtime
  resources.
- `source/comments/` contains tracked browser runtime outputs and vendored Twikoo
  files.
- `scripts/date-from-git.js` is the generated CommonJS entry that Hexo loads.
- `public/` is ignored Hexo output and is not a source directory.

Do not treat generated JavaScript as the primary handwritten source. Conversely,
do not delete a tracked generated file merely because it is generated: some of
these files are required production interfaces. When generation logic changes,
use the normal build path to refresh tracked outputs and verify them with the
existing contracts.

## Validation

Use the commands defined in `package.json`:

```bash
bun install --frozen-lockfile
bun run check
bun run check:types:fast
bun run test:typecheck-parity
bun run build
bun run tools/check-linked-worktree.ts
```

- `bun run check` runs the TypeScript CLI check, the main tests, and content
  validation.
- `bun run check:types:fast` is the independent Bun-native fast type check.
- `bun run test:typecheck-parity` compares selected Bun and TypeScript
  diagnostics.
- The fast check and diagnostic parity contract are not part of the default
  `check` command or the current pull-request workflow. Run them explicitly for
  type-system or toolchain changes.
- `bun run build` builds tracked runtime resources, generates the Hexo site, and
  validates generated output. CI explicitly runs `bun run clean` before its site
  build.
- `tools/check-linked-worktree.ts` may perform a frozen install and complete build
  in a temporary detached worktree, then safely remove that managed worktree.

Do not encode current test counts, article counts, commit SHAs, or workflow run
IDs as permanent requirements. The executable contracts are authoritative.

## Compatibility boundaries

- Browser assets are built as ESM.
- Hexo loads `scripts/date-from-git.js` as Node-compatible CommonJS.
- TypeScript is the source and static-checking baseline for blog-owned code.
- Bun runs project tools and builds owned runtime assets.
- Hexo and Kratos-Rebirth remain upstream JavaScript/EJS dependencies.
- The Git date plugin must work in a normal checkout and a detached linked
  worktree. The latter has a `.git` file and shared `commondir`, so its read-only
  Git CLI fallback is intentional.
- Theme classes containing `waline` can be compatibility markers. Their names
  alone do not prove that the retired Waline runtime is active.

Preserve the TypeScript source to browser ESM and Hexo CommonJS split. Do not move
raw TypeScript into `scripts/` or rewrite stable upstream integration without an
independent compatibility reason.

## Mathematics

Posts use Markdown with the repository's KaTeX extension. Prefer `$...$` for
inline math and `$$...$$` on separate lines for display math. Escape an ordinary
dollar as `\$` when it could be mistaken for a delimiter. Inline code and fenced
code retain normal Markdown semantics. The blog also accepts `\(...\)` and
`\[...\]`, but they are compatibility aliases rather than the preferred
cross-editor form. KaTeX is not a complete LaTeX engine; check its supported
functions when using uncommon commands. Source remains plain UTF-8 and readable
offline, while accurate visual output requires a Markdown/KaTeX renderer.

## Comments and runtime resources

The production comment provider is Twikoo. The `disabled` provider is a local
no-backend preview mode. Provider selection and endpoint validation live in
`frontend/comments/config.ts` and `tools/comment-provider-build.ts`.

`bun run server:disabled` previews without a comment backend. `bun run
server:twikoo` explicitly selects Twikoo but still uses the public production
Netlify endpoint, so it is not an isolated backend mode. Only a runtime build
with both `--comments=twikoo` and
`--twikoo-endpoint=http://127.0.0.1:8081` points the generated client at the
validated loopback test backend. This is a build-time override: a later `bun run
server` rebuilds the default runtime and must not be assumed to retain it. Do not
add an automatic local database or comment-backend launcher without a separate
demonstrated need.

The production backend is maintained outside this static-site repository. Never
commit database credentials, backend secrets, admin tokens, raw comment exports,
or private backup data. Do not operate on historical comments or private backups
as part of routine blog maintenance.

Runtime resources are declared by `tools/runtime-artifacts.ts`. Keep the vendored
Twikoo client, its declared locale files, and its LICENSE together. Relevant
contracts include `tests/comments.test.ts`,
`tests/comment-provider-build.test.ts`, and
`tests/runtime-artifacts.test.ts`.

## CI, releases, and upstream maintenance

`.github/workflows/build.yml` builds pull requests, but Pages artifact upload and
deployment are restricted to pushes to `main`. A pull-request validation must not
be described as a production release.

Keep third-party Actions pinned to full commit SHAs. Do not push `main`, rewrite
history, merge a pull request, or start a production deployment without explicit
authorization.

This repository originated from `kratos-rebirth/quickstart`. The scheduled
upstream check compares its reviewed baseline with upstream. Review upstream
changes file by file and port only compatible changes; never merge unrelated
template history wholesale. Dependency updates must retain the lockfile and pass
frozen installation plus the existing contracts.

## Navigation and safety

Start with these files when investigating a change:

- Commands and dependencies: `package.json`
- Runtime build: `tools/build-runtime.ts` and `tools/runtime-artifacts.ts`
- Content and output checks: `tools/check-content.ts` and
  `tools/check-generated.ts`
- Git/date compatibility: `plugins/date-from-git.ts` and
  `tests/date-from-git.test.ts`
- Worktree parity: `tools/check-linked-worktree.ts` and
  `tests/linked-worktree-contract.test.ts`
- CI and release boundary: `.github/workflows/build.yml`
- Upstream monitoring: `.github/workflows/check-quickstart-upstream.yml`
- Engineering history: the two blog articles linked from `README.md` and the Git
  history for the affected paths

Do not delete licenses, declared locales, the Hexo date compatibility entry, or
required tracked runtime outputs. Do not casually alter the production comment
system, clean ignored historical backups, or publish private paths and sensitive
data. Generated search and sitemap files can contain known byte-level
nondeterminism. The linked-worktree contract compares article paths, rendered
dates, and runtime-resource hashes; it does not parse search-index JSON or
Sitemap XML. Their parseability was checked in an independent production smoke
test, not by the current permanent automation. Continue to investigate new or
unexplained differences instead of weakening the existing contracts.
