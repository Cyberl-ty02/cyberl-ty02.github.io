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

## Article actions

All three `scaffolds/` templates default to `donate: false`; the theme-wide
`donate.enable` is also disabled, existing posts are checked, and no demo payment
codes are configured. Normal article creation needs no manual donation toggle.

Sharing uses the theme's modal and `additional_injections`, with a small
TypeScript adapter in `frontend/share.ts`. Keep `node_modules` unchanged. Platform
links in `_config.kratos-rebirth.yml` are URL-encoded from the current canonical
page when clicked, including after PJAX navigation.

- QQ, Weibo, Facebook, X/Twitter and Bluesky open their web share composers.
- WeChat displays a local QR code; it does not pretend to post to a WeChat account.
- Misskey and compatible forks use the reader's HTTPS instance `/share` form.
- Bilibili offers copyable text and the dynamic feed link, because an arbitrary
  external-URL compose intent has not been verified. Publishing stays on Bilibili.
- Copy link and native system sharing cover other apps; unavailable clipboard
  access falls back to selectable text.

Endpoint references: [QQ](https://connect.qq.com/widget/shareqq/index.html),
[Weibo](https://service.weibo.com/share/share.php),
[Facebook](https://developers.facebook.com/documentation/plugins/share-button),
[X web intents](https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/web-intent),
[Bluesky](https://docs.bsky.app/docs/advanced-guides/intent-links), and
[Misskey](https://misskey-hub.net/en/docs/for-users/features/share-form/).
Platform login, content preview policies and app installation can affect the
final platform page; tests validate the outgoing data and UI, not account posting.

Icons missing from the theme's Font Awesome set are pinned under
`vendor/share-icons/` with their upstream CC0 license and source commit. The runtime
manifest copies these local resources and license. Rebuild with `bun run
build:runtime` after changes; `tests/share.test.ts` checks encoding, instances,
PJAX, clipboard fallback and donation defaults.
