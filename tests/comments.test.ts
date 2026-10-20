import { describe, expect, test } from "bun:test";

import {
  commentRuntimeConfig,
  DEFAULT_COMMENT_PROVIDER,
  isConfiguredTwikooEnvId,
  TWIKOO_NETLIFY_ENDPOINT,
} from "../frontend/comments/config.ts";
import { normalizeCommentPath } from "../frontend/comments/path.ts";
import {
  installCommentRuntime,
  type RuntimeWindow,
} from "../frontend/comments/runtime.ts";
import type {
  CommentProviderModule,
  CommentRuntimeConfig,
} from "../frontend/comments/types.ts";
import {
  createTwikooProvider,
  fetchTwikooCommentCounts,
  resolveTwikooCommentCounts,
} from "../frontend/twikoo.ts";

class FakeWindow implements RuntimeWindow {
  loadComments: (() => Promise<void>) | null = null;
  location = { pathname: "/posts/current/" };
  listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

const emptyDocument = {
  createElement: () => ({}) as HTMLElement,
  querySelector: () => null,
  querySelectorAll: () => [],
} as unknown as Document;

function withProvider(
  provider: CommentRuntimeConfig["provider"],
  envId: string | null = null,
): CommentRuntimeConfig {
  return {
    ...commentRuntimeConfig,
    provider,
    twikoo: { ...commentRuntimeConfig.twikoo, envId },
  };
}

describe("comment provider configuration", () => {
  test("uses the production Twikoo endpoint as the default", () => {
    expect(DEFAULT_COMMENT_PROVIDER).toBe("twikoo");
    expect(commentRuntimeConfig.provider).toBe(DEFAULT_COMMENT_PROVIDER);
    expect(commentRuntimeConfig.twikoo.envId).toBe(TWIKOO_NETLIFY_ENDPOINT);
    expect(TWIKOO_NETLIFY_ENDPOINT)
      .toBe("https://cybltwicom.netlify.app/.netlify/functions/twikoo");
  });

  test("rejects missing and placeholder Twikoo endpoints", () => {
    expect(isConfiguredTwikooEnvId(null)).toBeFalse();
    expect(isConfiguredTwikooEnvId("https://example.netlify.app/.netlify/functions/twikoo"))
      .toBeFalse();
    expect(isConfiguredTwikooEnvId("https://comments.invalid")).toBeFalse();
    expect(isConfiguredTwikooEnvId(TWIKOO_NETLIFY_ENDPOINT)).toBeTrue();
    expect(isConfiguredTwikooEnvId("https://twikoo.kagaranakaki.top")).toBeTrue();
    expect(isConfiguredTwikooEnvId("http://127.0.0.1:8081")).toBeTrue();
    expect(isConfiguredTwikooEnvId("http://localhost:8081")).toBeFalse();
    expect(isConfiguredTwikooEnvId("http://127.0.0.1:8080")).toBeFalse();
  });

  test("does not import or contact Twikoo when its endpoint is absent", async () => {
    const fakeWindow = new FakeWindow();
    let importCount = 0;
    const uninstall = installCommentRuntime(
      withProvider("twikoo"),
      fakeWindow,
      emptyDocument,
      async () => {
        importCount += 1;
        throw new Error("must not import");
      },
    );

    await Promise.resolve();
    expect(importCount).toBe(0);
    uninstall();
  });

  test("supports a fully disabled provider without loading client code", async () => {
    const fakeWindow = new FakeWindow();
    let importCount = 0;
    const uninstall = installCommentRuntime(
      withProvider("disabled"),
      fakeWindow,
      emptyDocument,
      async () => {
        importCount += 1;
        throw new Error("must not import");
      },
    );
    await Promise.resolve();
    expect(importCount).toBe(0);
    uninstall();
  });

  test("installs one PJAX listener pair and imports only the selected provider", async () => {
    const fakeWindow = new FakeWindow();
    const imports: string[] = [];
    let loads = 0;
    let disposals = 0;
    const module: CommentProviderModule = {
      createCommentProvider: () => ({
        dispose: () => {
          disposals += 1;
        },
        load: async () => {
          loads += 1;
        },
      }),
    };
    const importer = async (specifier: string): Promise<CommentProviderModule> => {
      imports.push(specifier);
      return module;
    };

    const config = withProvider(
      "twikoo",
      "https://twikoo.kagaranakaki.top/.netlify/functions/twikoo",
    );
    const firstUninstall = installCommentRuntime(config, fakeWindow, emptyDocument, importer);
    const secondUninstall = installCommentRuntime(config, fakeWindow, emptyDocument, importer);

    expect(firstUninstall).toBe(secondUninstall);
    expect(fakeWindow.listeners.get("pjax:before")?.size).toBe(1);
    expect(fakeWindow.listeners.get("pjax:success")?.size).toBe(1);
    expect(fakeWindow.listeners.get("pjax:complete")?.size).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(imports).toEqual(["/comments/twikoo.js?v=20261020-2"]);
    expect(loads).toBe(1);

    fakeWindow.dispatch("pjax:complete");
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(2);
    expect(fakeWindow.loadComments).toBeNull();

    fakeWindow.dispatch("pjax:before");
    expect(fakeWindow.loadComments).toBeNull();
    fakeWindow.dispatch("pjax:success");
    fakeWindow.dispatch("pjax:complete");
    await fakeWindow.loadComments?.();
    expect(imports).toHaveLength(1);
    expect(loads).toBe(3);
    expect(disposals).toBeGreaterThanOrEqual(1);
    firstUninstall();
  });

  test("aborts an in-flight provider load before a PJAX replacement", async () => {
    const fakeWindow = new FakeWindow();
    const observed: { signal?: AbortSignal } = {};
    let releaseLoad: () => void = () => {
      throw new Error("load gate was not initialized");
    };
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const module: CommentProviderModule = {
      createCommentProvider: () => ({
        dispose: () => undefined,
        load: async (context) => {
          observed.signal = context.signal;
          await gate;
        },
      }),
    };
    const uninstall = installCommentRuntime(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      fakeWindow,
      emptyDocument,
      async () => module,
    );

    await Promise.resolve();
    await Promise.resolve();
    fakeWindow.dispatch("pjax:before");
    expect(observed.signal?.aborted).toBeTrue();
    releaseLoad();
    await Promise.resolve();
    uninstall();
  });
});

describe("comment paths", () => {
  test("keeps directory permalinks and removes query strings", () => {
    expect(normalizeCommentPath("/posts/example/?from=index#comments", "/fallback/"))
      .toBe("/posts/example/");
    expect(normalizeCommentPath("/posts/example", "/fallback/"))
      .toBe("/posts/example/");
    expect(normalizeCommentPath("/posts/example/index.html", "/fallback/"))
      .toBe("/posts/example/");
    expect(normalizeCommentPath(undefined, "/")).toBe("/");
    expect(normalizeCommentPath("/index.html", "/fallback/")).toBe("/");
  });

  test("canonicalizes Chinese paths to one percent-encoded key", () => {
    const encoded = "/posts/%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98/";
    expect(normalizeCommentPath("/posts/中文标题/", "/fallback/")).toBe(encoded);
    expect(normalizeCommentPath(encoded, "/fallback/")).toBe(encoded);
  });
});

describe("Twikoo PJAX initialization", () => {
  test("serializes init calls and never reuses an old page mount selector", async () => {
    type FakeMount = HTMLElement & { isConnected: boolean };
    const mounts: FakeMount[] = [];
    const fakeDocument = {
      createElement: () => {
        const mount = {
          dataset: {},
          id: "",
          isConnected: false,
          replaceChildren: () => undefined,
        } as unknown as FakeMount;
        mounts.push(mount);
        return mount;
      },
      querySelectorAll: () => [],
    } as unknown as Document;
    const makeContainer = () => {
      let child: FakeMount | undefined;
      return {
        replaceChildren(next?: FakeMount) {
          if (child) child.isConnected = false;
          child = next;
          if (child) child.isConnected = true;
        },
      } as unknown as HTMLElement;
    };

    let releaseFirstInit: () => void = () => undefined;
    let markFirstInitStarted: () => void = () => undefined;
    const firstInitGate = new Promise<void>((resolve) => {
      releaseFirstInit = resolve;
    });
    const firstInitStarted = new Promise<void>((resolve) => {
      markFirstInitStarted = resolve;
    });
    const selectors: string[] = [];
    const client = {
      getCommentsCount: async () => [],
      init: async ({ el }: { el: string }) => {
        selectors.push(el);
        if (selectors.length === 1) {
          markFirstInitStarted();
          await firstInitGate;
        }
      },
    };
    const provider = createTwikooProvider(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      async () => client,
    );
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const firstLoad = provider.load({
      container: makeContainer(),
      document: fakeDocument,
      path: "/posts/first/",
      pathname: "/posts/first/",
      signal: firstAbort.signal,
    });
    await firstInitStarted;
    expect(selectors).toEqual(["#twikoo-1"]);
    firstAbort.abort();
    const secondLoad = provider.load({
      container: makeContainer(),
      document: fakeDocument,
      path: "/posts/second/",
      pathname: "/posts/second/",
      signal: secondAbort.signal,
    });
    releaseFirstInit();
    await Promise.all([firstLoad, secondLoad]);

    expect(selectors).toHaveLength(2);
    expect(selectors[0]).not.toBe(selectors[1]);
    expect(mounts[0]?.isConnected).toBeFalse();
    provider.dispose();
  });
});

describe("Twikoo comment counts", () => {
  test("batches unique paths and treats missing rows as zero", async () => {
    const requested: string[][] = [];
    const counts = await resolveTwikooCommentCounts(
      ["/a/", "/a/", "/b/"],
      async (paths) => {
        requested.push(paths);
        return [{ url: "/a/", count: 3 }];
      },
    );

    expect(requested).toEqual([["/a/", "/b/"]]);
    expect(counts.get("/a/")).toBe(3);
    expect(counts.get("/b/")).toBe(0);
  });

  test("returns an explicit error state when the API fails", async () => {
    const result = await fetchTwikooCommentCounts(["/a/"], async () => {
      throw new Error("offline");
    });
    expect(result.status).toBe("error");
  });

  test("updates comment counts while keeping pageviews hidden", async () => {
    const pageviewWrapper = { hidden: false };
    const pageview = {
      closest: () => pageviewWrapper,
    } as unknown as HTMLElement;
    const comment = {
      dataset: { path: "/posts/hello-world/hello-world/" },
      textContent: "",
    } as unknown as HTMLElement;
    const document = {
      querySelectorAll: (selector: string) => {
        if (selector === ".pageview-count") return [pageview];
        if (selector === ".comment-count") return [comment];
        return [];
      },
    } as unknown as Document;
    const provider = createTwikooProvider(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      async () => ({
        getCommentsCount: async () => [{
          url: "/posts/hello-world/hello-world/",
          count: 6,
        }],
        init: async () => undefined,
      }),
    );

    await provider.load({
      container: null,
      document,
      path: "/posts/hello-world/hello-world/",
      pathname: "/posts/hello-world/hello-world/",
      signal: new AbortController().signal,
    });

    expect(comment.textContent).toBe("6");
    expect(comment.dataset.countState).toBe("ready");
    expect(pageviewWrapper.hidden).toBeTrue();
    provider.dispose();
  });
});

describe("rendered comment contract", () => {
  test("keeps a lazy provider-neutral container and theme-aware styles", async () => {
    const themeConfig = await Bun.file("_config.kratos-rebirth.yml").text();
    const css = await Bun.file("frontend/comments.css").text();
    expect(themeConfig).toContain("data-comments-container");
    expect(themeConfig).toContain('class="kr-comments lazy-load"');
    expect(css).toContain('html[data-theme="dark"] #comments-root');
  });

  test("keeps the upstream count class only as a template compatibility marker", async () => {
    const themeConfig = await Bun.file("_config.kratos-rebirth.yml").text();
    expect(themeConfig).toContain("comment-count waline-comment-count");
    expect(themeConfig).not.toContain('/comments/waline.css?v=');
    expect(themeConfig).not.toContain('/comments/waline-overrides.css?v=');
  });
});
