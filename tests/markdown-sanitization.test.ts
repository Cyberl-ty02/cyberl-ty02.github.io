import { createRequire } from "node:module";

import { describe, expect, test } from "bun:test";

const require = createRequire(import.meta.url);
const renderMarkdown = require("hexo-renderer-marked/lib/renderer") as (
  this: {
    config: {
      marked: Record<string, unknown>;
      post_asset_folder: boolean;
      source_dir: string;
    };
    execFilterSync: () => void;
  },
  data: { path: string; text: string },
  options: Record<string, unknown>,
) => string;

const render = (text: string): string =>
  renderMarkdown.call(
    {
      config: {
        marked: {
          breaks: true,
          dompurify: true,
          gfm: true,
          postAsset: false,
          prependRoot: true,
        },
        post_asset_folder: false,
        source_dir: "source",
      },
      execFilterSync: () => undefined,
    },
    { path: "synthetic.md", text },
    {},
  );

// Loading JSDOM is unusually slow on a cold Windows install. Warm the renderer
// outside an individual test timeout while keeping every assertion below on the
// real Hexo renderer and DOMPurify integration path.
render("");

describe("hexo-renderer-marked DOMPurify integration", () => {
  test("preserves Markdown structures without double escaping", () => {
    const html = render(`
| name | value |
| --- | --- |
| code | \`<tag>\` |

\`\`\`html
<strong>safe</strong>
\`\`\`

[safe link](https://example.com/?a=1&b=2)
`);

    expect(html).toContain("<table>");
    expect(html).toContain("<code>&lt;tag&gt;</code>");
    expect(html).toContain("&lt;strong&gt;safe&lt;/strong&gt;");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).not.toContain("&amp;lt;");
  }, 20_000);

  test("removes executable HTML and unsafe URL attributes", () => {
    const html = render(`
<script>alert(1)</script>
<img src="x" onerror="alert(2)">
<a href="javascript:alert(3)" onclick="alert(4)">unsafe</a>
<p data-safe="yes">plain text</p>
`);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<img src="x">');
    expect(html).toContain("plain text");
  });
});
