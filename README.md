# Cyberl Blog

Cyberl Blog is a personal technical blog about operating systems, development
tools, and maintaining a modern Hexo site.

## Website

The published site is available at [kagaranakaki.top](https://kagaranakaki.top/).

## Technology stack

The site uses [Hexo](https://hexo.io/) with
[Kratos-Rebirth](https://github.com/Candinya/Kratos-Rebirth), Bun, TypeScript,
Twikoo, and GitHub Pages.

## Local development

[Bun](https://bun.sh/) is required. Install the locked dependencies and build the
site with:

```bash
bun install --frozen-lockfile
bun run build
```

Start the local Hexo server with:

```bash
bun run server
```

The standard TypeScript, test, and content checks can be run separately with
`bun run check`. Additional maintenance contracts are documented in
[`AGENTS.md`](AGENTS.md).

## Maintenance

This repository was created from
[`kratos-rebirth/quickstart`](https://github.com/kratos-rebirth/quickstart).
Upstream changes are reviewed and ported selectively so the blog can retain its
Bun and TypeScript workflow without forking Hexo or the theme.

See [`AGENTS.md`](AGENTS.md) for source-of-truth boundaries, complete validation
entry points, generated-resource ownership, and release safety rules.

## Related articles

- [Hexo 博客迁移 Waline 与 Bun 的踩坑记录](https://kagaranakaki.top/posts/hexo-waline-bun-notes/hexo-waline-bun-notes/)
- [从 Gitalk、Waline 到 Twikoo：Hexo 博客评论迁移与数据修复实践](https://kagaranakaki.top/posts/gitalk-waline-twikoo-migration/gitalk-waline-twikoo-migration/)

## License

The repository is available under the [MIT License](LICENSE).
