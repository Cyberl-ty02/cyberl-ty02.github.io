# Introduction

My own blog.

# Contents

Some codes,  some instructions.


**P.S.** try to use the **comment system.**

## Upstream maintenance

This blog was created from
[`kratos-rebirth/quickstart`](https://github.com/kratos-rebirth/quickstart),
but a repository created from a template is not a fork and does not receive
template commits automatically.

The weekly `Check quickstart upstream` workflow compares quickstart's current
`main` with the reviewed revision in `.github/quickstart-upstream.sha`. When the
template changes, it creates or updates one `upstream-sync` issue with a compare
link. Changes must be reviewed and ported selectively because this repository
uses Bun and a TypeScript validation layer and contains blog-specific
configuration, while the template may use a different package manager or
deployment workflow. Hexo and `hexo-theme-kratos-rebirth` remain the compatibility
boundary. Blog-owned TypeScript lives under `frontend/`, `plugins/` and `tools/`;
Bun compiles browser assets into `source/comments/` and the local Hexo filter into
`scripts/`, preserving the JavaScript integration points expected by Hexo and the
theme.

For a local checkout, add the read-only upstream remote once and inspect it with:

```bash
git remote add upstream https://github.com/kratos-rebirth/quickstart.git
git fetch upstream main
git diff "$(cat .github/quickstart-upstream.sha)"..upstream/main
```

Do not merge the unrelated template history wholesale. After selected changes
pass `bun install --frozen-lockfile`, `bun run check` and `bun run build`, update
`.github/quickstart-upstream.sha` to the reviewed `upstream/main` commit.

`bun run build` performs TypeScript checks and compatibility tests, validates
source content, compiles blog-owned runtime assets, generates the Hexo site, and
then validates privacy-sensitive rendered output. CI exposes the same phases as
separate steps for clearer failure logs.

Dependabot separately tracks the text `bun.lock` dependencies every day and
GitHub Actions every week through `.github/dependabot.yml`.
