import { describe, expect, test } from "bun:test";
import {
  expandShareUrl, installShareRuntime, misskeyShareUrl, readSharePayload,
  shareText, type SharePayload,
} from "../frontend/share.ts";

const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window; };
};
const { load } = require("js-yaml") as {
  load: (text: string) => { share: { platforms: { name: string; link: string; icon: string }[] }; donate: { enable: boolean; platforms: unknown[] } };
};
const config = load(await Bun.file("_config.kratos-rebirth.yml").text());
const data: SharePayload = {
  title: "中文 & quotes ' \" #? / 🦋 $URL",
  url: "https://kagaranakaki.top/posts/%E4%B8%AD%E6%96%87/?a=1&b=two",
  summary: "摘要 & more #details", site: "水天树下",
};

function setup() {
  const dom = new JSDOM('<!doctype html><html><head><title>Fallback</title></head><body><a class="share" href="#">分享</a><div class="post-actions"></div><div id="kr-share-modal" class="active"><div class="kr-modal-title">分享</div><button class="kr-modal-close">关闭</button><div class="kr-modal-body"><p class="kr-share-message"></p><div id="kr-share-qr"></div><div class="kr-share-platforms"></div></div></div></body></html>', { url: "https://kagaranakaki.top/posts/first/" });
  const { window } = dom; const doc = window.document;
  for (const [name, content] of Object.entries({ "og:title": data.title, "og:url": data.url, "og:description": data.summary })) {
    const tag = doc.createElement("meta"); tag.setAttribute("property", name); tag.content = content; doc.head.append(tag);
  }
  for (const platform of config.share.platforms) {
    const button = doc.createElement("button"); button.className = "kr-share-platform-button";
    button.title = platform.name; button.setAttribute("onclick", `krShareModalOpenPlatform('${platform.link}')`);
    doc.querySelector(".kr-share-platforms")!.append(button);
  }
  const opened: string[] = [];
  Object.defineProperty(window, "open", { value: (url: string, target: string, features: string) => {
    expect(target).toBe("_blank"); expect(features).toBe("noopener,noreferrer"); opened.push(url); return null;
  } });
  const stop = installShareRuntime(window);
  const click = (name: string) => Array.from(doc.querySelectorAll<HTMLButtonElement>(".kr-share-platform-button")).find(x => x.title === name)!.click();
  return { window, doc, opened, click, stop };
}

describe("share link contracts", () => {
  test("every configured direct endpoint preserves URL, Unicode and reserved characters exactly once", () => {
    for (const platform of config.share.platforms.filter(x => !x.link.startsWith("#"))) {
      const url = new URL(expandShareUrl(platform.link, data));
      if (platform.name === "Bluesky") expect(url.searchParams.get("text")).toBe(shareText(data));
      else {
        expect(url.searchParams.get(platform.name === "Facebook" ? "u" : "url")).toBe(data.url);
        if (platform.name !== "Facebook") expect(url.searchParams.get(platform.name === "X / Twitter" ? "text" : "title")).toBe(data.title);
      }
      expect(url.hash).toBe("");
    }
  });
  test("does not navigate to injected or obsolete arbitrary endpoints", () => {
    for (const template of ["javascript:alert(1)", "https://example.com/?url=$URL", "http://twitter.com/intent/tweet?text=$TITLE"]) {
      expect(() => expandShareUrl(template, data)).toThrow();
    }
  });
  test("supports independent Misskey-compatible instances without changing share text", () => {
    for (const instance of ["misskey.example", "https://sharkey.example/", "https://例子.example"]) {
      const url = new URL(misskeyShareUrl(instance, data));
      expect(url.pathname).toBe("/share"); expect(url.searchParams.get("title")).toBe(data.title);
      expect(url.searchParams.get("url")).toBe(data.url);
    }
    for (const value of ["", "http://instance.example", "javascript:alert(1)", "https://user@instance.example", "https://instance.example/path", "https://instance.example/?redirect=1", "https://instance.example/#x"]) {
      expect(() => misskeyShareUrl(value, data)).toThrow();
    }
  });
});

describe("theme share adapter", () => {
  test("labels all platforms, uses the current canonical page after PJAX, and installs once", () => {
    const s = setup();
    expect(installShareRuntime(s.window)).toBe(s.stop);
    s.click("QQ"); expect(s.opened).toHaveLength(1);
    expect(s.doc.querySelectorAll(".blog-share-label")).toHaveLength(config.share.platforms.length);
    const canonical = s.doc.createElement("link"); canonical.rel = "canonical";
    canonical.href = "https://kagaranakaki.top/posts/second/#section"; s.doc.head.append(canonical);
    s.window.dispatchEvent(new (s.window as unknown as { Event: typeof Event }).Event("pjax:complete"));
    s.click("微博");
    expect(new URL(s.opened[1]!).searchParams.get("url")).toBe("https://kagaranakaki.top/posts/second/");
    expect(s.opened).toHaveLength(2); s.stop();
  });
  test("Bilibili uses an explicit copy-and-compose flow, never an invented prefill API", () => {
    const s = setup(); s.click("B站动态");
    expect(s.opened).toHaveLength(0);
    expect((s.doc.getElementById("blog-share-text") as HTMLTextAreaElement).value).toBe(shareText(data));
    const link = s.doc.querySelector<HTMLAnchorElement>("[data-bilibili]")!;
    expect(link.href).toBe("https://t.bilibili.com/"); expect(link.hidden).toBeFalse();
    expect(s.doc.getElementById("blog-share-status")?.textContent).toContain("自行发布"); s.stop();
  });
  test("copy falls back to a selected readable link when clipboard permission is absent", async () => {
    const s = setup(); s.click("复制链接"); await Promise.resolve();
    const field = s.doc.getElementById("blog-share-text") as HTMLTextAreaElement;
    expect(field.value).toBe(data.url); expect(field.selectionEnd).toBe(data.url.length);
    expect(s.doc.getElementById("blog-share-status")?.textContent).toContain("Ctrl/Cmd+C"); s.stop();
  });
  test("instance form opens only a validated target and reads current article metadata", () => {
    const s = setup(); s.click("Misskey / 分支");
    const input = s.doc.getElementById("blog-share-instance") as HTMLInputElement;
    const form = s.doc.querySelector<HTMLFormElement>('form[data-share-panel="instance"]')!;
    input.value = "https://sharkey.example";
    const EventType = (s.window as unknown as { Event: typeof Event }).Event;
    form.dispatchEvent(new EventType("submit", { cancelable: true }));
    expect(s.opened).toHaveLength(1); expect(new URL(s.opened[0]!).searchParams.get("url")).toBe(data.url);
    input.value = "https://user@bad.example"; form.dispatchEvent(new EventType("submit", { cancelable: true }));
    expect(s.opened).toHaveLength(1); s.stop();
  });
  test("WeChat QR is rendered locally from the canonical URL without a share redirect", () => {
    const s = setup(); let encoded = "";
    Object.assign(s.window, { QRCodeStyling: class {
      constructor(options: { data: string }) { encoded = options.data; }
      append() {}
    } });
    s.click("微信"); expect(encoded).toBe(data.url); expect(s.opened).toHaveLength(0);
    expect(s.doc.getElementById("kr-share-modal")?.classList.contains("share-show-qr")).toBeTrue(); s.stop();
  });
  test("clipboard success copies only the canonical URL", async () => {
    const s = setup(); let copied = "";
    Object.defineProperty(s.window.navigator, "clipboard", { value: { writeText: async (text: string) => { copied = text; } } });
    s.click("复制链接"); await Promise.resolve();
    expect(copied).toBe(data.url); expect(s.doc.getElementById("blog-share-status")?.textContent).toContain("已复制"); s.stop();
  });
  test("native sharing uses a draft and user cancellation is not an error", async () => {
    const s = setup(); let draft: ShareData | undefined;
    Object.defineProperty(s.window.navigator, "share", { value: async (value: ShareData) => {
      draft = value; const error = new Error("cancelled"); error.name = "AbortError"; throw error;
    } });
    s.click("系统分享"); await Promise.resolve();
    expect(draft).toEqual({ title: data.title, url: data.url });
    expect(s.opened).toHaveLength(0); expect(s.doc.getElementById("blog-share-status")?.textContent).toBe(""); s.stop();
  });
  test("canonical metadata rejects executable protocols", () => {
    const s = setup(); const link = s.doc.createElement("link"); link.rel = "canonical"; link.href = "javascript:alert(1)"; s.doc.head.append(link);
    expect(() => readSharePayload(s.doc, s.window.location.href)).toThrow(); s.stop();
  });
});

describe("donation defaults", () => {
  test("theme and new-content scaffolds keep donations disabled without example payment codes", async () => {
    expect(config.donate.enable).toBeFalse(); expect(config.donate.platforms).toEqual([]);
    for (const name of ["post", "draft", "page"]) {
      const scaffold = await Bun.file(`scaffolds/${name}.md`).text();
      expect(scaffold).toMatch(/^donate: false$/m);
    }
    expect(await Bun.file("_config.kratos-rebirth.yml").text()).not.toContain("example_payment");
  });
});
