import { describe, expect, test } from "bun:test";

import { parsePostMetadata } from "../tools/content-contracts.ts";

describe("post metadata contract", () => {
  test("parses block and inline YAML collections through Hexo's parser", () => {
    const block = parsePostMetadata(`---
title: "Quoted: title"
date: 2026-11-02 00:00:00
donate: false
categories: 网站与博客
tags:
  - 博客
  - 开发工具
---
body
`);
    expect(block).toEqual({
      category: "网站与博客",
      donate: false,
      hasDate: true,
      tags: ["博客", "开发工具"],
      title: "Quoted: title",
    });

    const inline = parsePostMetadata(`---
title: Inline tags
date: 2026-11-02
donate: false
categories: 网站与博客
tags: [博客, 开发工具]
---
body
`);
    expect(inline.tags).toEqual(["博客", "开发工具"]);
  });

  test("keeps malformed field types visible to the caller", () => {
    const metadata = parsePostMetadata(`---
title: 42
date:
donate: "false"
categories: [网站与博客]
tags: 博客
---
body
`);

    expect(metadata).toEqual({
      category: undefined,
      donate: "false",
      hasDate: false,
      tags: undefined,
      title: undefined,
    });
  });

  test("rejects missing, suffix-only, JSON, and invalid YAML front matter", () => {
    expect(() => parsePostMetadata("plain body\n")).toThrow("缺少以 --- 包围");
    expect(() => parsePostMetadata("title: suffix-only\n---\nbody\n"))
      .toThrow("缺少以 --- 包围");
    expect(() => parsePostMetadata(';;;\n"title": "JSON"\n;;;\nbody\n'))
      .toThrow("缺少以 --- 包围");
    expect(() => parsePostMetadata("---\ntags: [unterminated\n---\nbody\n"))
      .toThrow();
  });
});
