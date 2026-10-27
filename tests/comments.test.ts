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
  createTwikooPageViewTracker,
  fetchTwikooCommentCounts,
  installKatexBridge,
  protectAmbiguousInlineDollars,
  resolveTwikooCommentCounts,
  TWIKOO_KATEX_OPTIONS,
} from "../frontend/twikoo.ts";

class FakeWindow implements RuntimeWindow {
  loadComments: (() => Promise<void>) | null = null;
  location = {
    origin: "https://kagaranakaki.top",
    pathname: "/posts/current/",
  };
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
      createPageViewTracker: () => ({
        dispose: () => undefined,
        load: async () => undefined,
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
    expect(imports).toEqual(["/comments/twikoo.js?v=20261028-1"]);
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
      createPageViewTracker: () => ({
        dispose: () => undefined,
        load: async () => undefined,
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
  test("protects currency while preserving supported comment math delimiters", () => {
    expect(protectAmbiguousInlineDollars("USD $5 and $10; $5 to $10")).toBe(
      String.raw`USD \$5 and \$10; \$5 to \$10`,
    );
    expect(protectAmbiguousInlineDollars(String.raw`$x$ costs \$5`)).toBe(
      String.raw`$x$ costs \$5`,
    );
    expect(protectAmbiguousInlineDollars(String.raw`$$x^2$$ and \(y\)`)).toBe(
      String.raw`$$x^2$$ and \(y\)`,
    );
    expect(protectAmbiguousInlineDollars("unclosed $ and $$")).toBe(
      String.raw`unclosed \$ and \$\$`,
    );
  });

  test("installs one safe KaTeX auto-render bridge with ordered delimiters", () => {
    const fakeWindow = {} as Window;
    installKatexBridge(fakeWindow);
    const installed = fakeWindow.renderMathInElement;
    installKatexBridge(fakeWindow);

    expect(fakeWindow.renderMathInElement).toBe(installed);
    expect(TWIKOO_KATEX_OPTIONS.delimiters.map(({ left }) => left)).toEqual([
      "$$",
      "\\[",
      "\\(",
      "$",
    ]);
    expect(TWIKOO_KATEX_OPTIONS.ignoredTags).toContain("pre");
    expect(TWIKOO_KATEX_OPTIONS.ignoredTags).toContain("code");
    expect(TWIKOO_KATEX_OPTIONS.throwOnError).toBeFalse();
    expect(TWIKOO_KATEX_OPTIONS.trust).toBeFalse();
  });

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
    const mathOptions: Array<typeof TWIKOO_KATEX_OPTIONS> = [];
    const client = {
      getCommentsCount: async () => [],
      getVisitorsCount: async () => ({ time: 0, updated: 1 }),
      init: async ({ el, katex: options }: {
        el: string;
        envId: string;
        katex: typeof TWIKOO_KATEX_OPTIONS;
        path: string;
      }) => {
        selectors.push(el);
        mathOptions.push(options);
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
    expect(mathOptions).toEqual([TWIKOO_KATEX_OPTIONS, TWIKOO_KATEX_OPTIONS]);
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

  test("updates comment counts without changing pageview visibility", async () => {
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
        getVisitorsCount: async () => ({ time: 5, updated: 1 }),
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
    expect(pageviewWrapper.hidden).toBeFalse();
    provider.dispose();
  });
});

interface FakePageView {
  element: HTMLElement;
  wrapper: { hidden: boolean };
}

function fakePageView(path = "/posts/current/"): FakePageView {
  const wrapper = { hidden: false };
  const element = {
    dataset: { path },
    hidden: false,
    textContent: "",
    title: "",
    closest: (selector: string) => selector === "li" ? wrapper : null,
    removeAttribute: (name: string) => {
      if (name === "title") element.title = "";
    },
  } as unknown as HTMLElement;
  return { element, wrapper };
}

function pageViewDocument(getElement: () => HTMLElement | null): Document {
  return {
    createElement: () => ({}) as HTMLElement,
    querySelector: (selector: string) =>
      selector === ".pageview-count" ? getElement() : null,
    querySelectorAll: (selector: string) =>
      selector === ".pageview-count" && getElement() ? [getElement()] : [],
  } as unknown as Document;
}

async function settleRuntime(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("Twikoo article page views", () => {
  test("uses one normalized path request and renders only a confirmed response", async () => {
    const requests: Array<{ envId: string; path: string }> = [];
    const view = fakePageView("/posts/example?from=index#top");
    const tracker = createTwikooPageViewTracker(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      async () => ({
        getCommentsCount: async () => [],
        getVisitorsCount: async (options) => {
          requests.push(options);
          return { time: 12, updated: 1 };
        },
        init: async () => undefined,
      }),
    );

    await tracker.load({
      document: pageViewDocument(() => view.element),
      path: view.element.dataset.path!,
      signal: new AbortController().signal,
      viewId: 1,
    });

    expect(requests).toEqual([{
      envId: TWIKOO_NETLIFY_ENDPOINT,
      path: "/posts/example/",
    }]);
    expect(view.element.textContent).toBe("12");
    expect(view.element.dataset.countState).toBe("ready");
    expect(view.element.title).toContain("本次访问已计入后续统计");
    expect(view.wrapper.hidden).toBeFalse();
  });

  test("does not invent a count when time or increment evidence is invalid", async () => {
    for (const response of [
      { time: 3 },
      { time: -1, updated: 1 },
      { time: Number.NaN, updated: 1 },
      { time: 4, updated: 0 },
    ]) {
      const view = fakePageView();
      let requests = 0;
      const tracker = createTwikooPageViewTracker(
        withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
        async () => ({
          getCommentsCount: async () => [],
          getVisitorsCount: async () => {
            requests += 1;
            return response;
          },
          init: async () => undefined,
        }),
      );
      const context = {
        document: pageViewDocument(() => view.element),
        path: "/posts/current/",
        signal: new AbortController().signal,
        viewId: 1,
      };
      await tracker.load(context);
      await tracker.load(context);
      expect(requests).toBe(1);
      expect(view.element.textContent).toBe("—");
      expect(view.element.dataset.countState).toBe("error");
    }
  });

  test("does not retry an uncertain request failure within the same view", async () => {
    const view = fakePageView();
    let requests = 0;
    const tracker = createTwikooPageViewTracker(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      async () => ({
        getCommentsCount: async () => [],
        getVisitorsCount: async () => {
          requests += 1;
          throw new Error("timeout after send");
        },
        init: async () => undefined,
      }),
    );
    const context = {
      document: pageViewDocument(() => view.element),
      path: "/posts/current/",
      signal: new AbortController().signal,
      viewId: 1,
    };
    await tracker.load(context);
    await tracker.load(context);
    expect(requests).toBe(1);
    expect(view.element.dataset.countState).toBe("error");
  });

  test("reapplies one view result to rebuilt DOM without another request", async () => {
    let current = fakePageView();
    let requests = 0;
    const document = pageViewDocument(() => current.element);
    const tracker = createTwikooPageViewTracker(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      async () => ({
        getCommentsCount: async () => [],
        getVisitorsCount: async () => {
          requests += 1;
          return { time: 8, updated: 1 };
        },
        init: async () => undefined,
      }),
    );
    const context = {
      document,
      path: "/posts/current/",
      signal: new AbortController().signal,
      viewId: 1,
    };
    await tracker.load(context);
    current = fakePageView();
    await tracker.load(context);
    expect(requests).toBe(1);
    expect(current.element.textContent).toBe("8");
  });

  test("prevents an old asynchronous result from updating a new article", async () => {
    const first = fakePageView("/posts/first/");
    const second = fakePageView("/posts/second/");
    let current = first;
    let releaseFirst: (value: unknown) => void = () => undefined;
    const firstResponse = new Promise<unknown>((resolve) => {
      releaseFirst = resolve;
    });
    let requests = 0;
    const tracker = createTwikooPageViewTracker(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      async () => ({
        getCommentsCount: async () => [],
        getVisitorsCount: async () => {
          requests += 1;
          return requests === 1 ? firstResponse : { time: 21, updated: 1 };
        },
        init: async () => undefined,
      }),
    );
    const firstLoad = tracker.load({
      document: pageViewDocument(() => current.element),
      path: "/posts/first/",
      signal: new AbortController().signal,
      viewId: 1,
    });
    await Promise.resolve();
    current = second;
    await tracker.load({
      document: pageViewDocument(() => current.element),
      path: "/posts/second/",
      signal: new AbortController().signal,
      viewId: 2,
    });
    releaseFirst({ time: 2, updated: 1 });
    await firstLoad;
    expect(second.element.textContent).toBe("21");
    expect(requests).toBe(2);
  });

  test("counts initial, PJAX and history views once while ignoring comment reloads", async () => {
    const fakeWindow = new FakeWindow();
    let current = fakePageView();
    const document = pageViewDocument(() => current.element);
    const requestedPaths: string[] = [];
    let commentLoads = 0;
    const module: CommentProviderModule = {
      createCommentProvider: () => ({
        dispose: () => undefined,
        load: async () => {
          commentLoads += 1;
        },
      }),
      createPageViewTracker: (config) => createTwikooPageViewTracker(config, async () => ({
        getCommentsCount: async () => [],
        getVisitorsCount: async ({ path }) => {
          requestedPaths.push(path);
          return { time: requestedPaths.length, updated: 1 };
        },
        init: async () => undefined,
      })),
    };
    const importer = async () => module;
    const uninstall = installCommentRuntime(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      fakeWindow,
      document,
      importer,
    );
    expect(installCommentRuntime(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      fakeWindow,
      document,
      importer,
    )).toBe(uninstall);
    await settleRuntime();
    expect(requestedPaths).toEqual(["/posts/current/"]);

    fakeWindow.dispatch("pjax:before");
    fakeWindow.location.pathname = "/posts/next/";
    current = fakePageView("/posts/next/");
    fakeWindow.dispatch("pjax:success");
    fakeWindow.dispatch("pjax:complete");
    await settleRuntime();
    expect(requestedPaths).toEqual(["/posts/current/", "/posts/next/"]);

    await fakeWindow.loadComments?.();
    await fakeWindow.loadComments?.();
    expect(commentLoads).toBeGreaterThanOrEqual(2);
    expect(requestedPaths).toHaveLength(2);

    fakeWindow.location.pathname = "/posts/current/";
    current = fakePageView("/posts/current/");
    fakeWindow.dispatch("pjax:complete");
    await settleRuntime();
    expect(requestedPaths).toEqual([
      "/posts/current/",
      "/posts/next/",
      "/posts/current/",
    ]);
    uninstall();
  });

  test("counts a post without a comments container, including comments:false output", async () => {
    const fakeWindow = new FakeWindow();
    const view = fakePageView("/posts/no-comments/");
    let requests = 0;
    const module: CommentProviderModule = {
      createCommentProvider: () => ({ dispose: () => undefined, load: async () => undefined }),
      createPageViewTracker: (config) => createTwikooPageViewTracker(config, async () => ({
        getCommentsCount: async () => [],
        getVisitorsCount: async () => {
          requests += 1;
          return { time: 0, updated: 1 };
        },
        init: async () => undefined,
      })),
    };
    const uninstall = installCommentRuntime(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      fakeWindow,
      pageViewDocument(() => view.element),
      async () => module,
    );
    await settleRuntime();
    expect(requests).toBe(1);
    expect(view.element.textContent).toBe("0");
    uninstall();
  });

  test("never tracks disabled, loopback, preview or non-article pages", async () => {
    for (const origin of [
      "http://localhost:4000",
      "http://127.0.0.1:4000",
      "http://[::1]:4000",
      "https://preview.example.test",
    ]) {
      const fakeWindow = new FakeWindow();
      fakeWindow.location.origin = origin;
      const view = fakePageView();
      let imports = 0;
      let trackerCreations = 0;
      const module: CommentProviderModule = {
        createCommentProvider: () => ({ dispose: () => undefined, load: async () => undefined }),
        createPageViewTracker: () => {
          trackerCreations += 1;
          return { dispose: () => undefined, load: async () => undefined };
        },
      };
      const uninstall = installCommentRuntime(
        withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
        fakeWindow,
        pageViewDocument(() => view.element),
        async () => {
          imports += 1;
          return module;
        },
      );
      await settleRuntime();
      expect(imports).toBe(1); // Existing comments still load independently.
      expect(trackerCreations).toBe(0);
      expect(view.wrapper.hidden).toBeTrue();
      uninstall();
    }

    const disabledWindow = new FakeWindow();
    const disabledView = fakePageView();
    let disabledImports = 0;
    const uninstallDisabled = installCommentRuntime(
      withProvider("disabled"),
      disabledWindow,
      pageViewDocument(() => disabledView.element),
      async () => {
        disabledImports += 1;
        throw new Error("must not import");
      },
    );
    await settleRuntime();
    expect(disabledImports).toBe(0);
    expect(disabledView.wrapper.hidden).toBeTrue();
    uninstallDisabled();

    const listingWindow = new FakeWindow();
    listingWindow.location.pathname = "/categories/dev/";
    let pageViewTrackerCreations = 0;
    const module: CommentProviderModule = {
      createCommentProvider: () => ({ dispose: () => undefined, load: async () => undefined }),
      createPageViewTracker: () => {
        pageViewTrackerCreations += 1;
        return { dispose: () => undefined, load: async () => undefined };
      },
    };
    const uninstallListing = installCommentRuntime(
      withProvider("twikoo", TWIKOO_NETLIFY_ENDPOINT),
      listingWindow,
      pageViewDocument(() => null),
      async () => module,
    );
    await settleRuntime();
    expect(pageViewTrackerCreations).toBe(0);
    uninstallListing();
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

  test("renders page views only on posts without Twikoo's implicit counter id", async () => {
    const themeConfig = await Bun.file("_config.kratos-rebirth.yml").text();
    expect(themeConfig).toContain("pageview-count waline-pageview-count");
    expect(themeConfig).not.toContain('id="twikoo_visitors"');
    const visitSection = themeConfig.split("visit_count:")[1]?.split("additional_injections:")[0];
    expect(visitSection).toContain("- post");
    expect(visitSection).not.toContain("- index");
    expect(themeConfig).toContain("/comments/comments.js?v=20261028-1");
  });
});
