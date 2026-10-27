import renderMathInElement, {
  type RenderMathInElementOptions,
} from "katex/contrib/auto-render";

import { normalizeCommentPath } from "./comments/path.ts";
import type {
  CommentProvider,
  CommentRuntimeConfig,
  CommentViewContext,
} from "./comments/types.ts";

interface TwikooCount {
  count: number;
  url: string;
}

interface TwikooClient {
  getCommentsCount(options: {
    envId: string;
    includeReply: boolean;
    urls: string[];
  }): Promise<TwikooCount[]>;
  init(options: {
    el: string;
    envId: string;
    katex: RenderMathInElementOptions;
    path: string;
  }): Promise<void>;
}

type RenderMathInElement = typeof renderMathInElement;

declare global {
  interface Window {
    renderMathInElement?: RenderMathInElement;
    twikoo?: TwikooClient;
  }
}

const CLIENT_URL = "/comments/twikoo/twikoo.min.js?v=2.0.15";
let clientPromise: Promise<TwikooClient> | null = null;

export const TWIKOO_KATEX_OPTIONS = {
  delimiters: [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
    { left: "$", right: "$", display: false },
  ],
  ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
  maxExpand: 1000,
  maxSize: 20,
  strict: "warn",
  throwOnError: false,
  trust: false,
} as const satisfies RenderMathInElementOptions;

function closingInlineDollar(source: string, opening: number): number {
  for (let index = opening + 1; index < source.length; index += 1) {
    if (source[index] !== "$" || source[index - 1] === "\\") continue;
    if (/\s/u.test(source[index - 1] ?? "") || /\d/u.test(source[index + 1] ?? "")) return -1;
    return index;
  }
  return -1;
}

export function protectAmbiguousInlineDollars(
  source: string,
  replacement = "\\$",
): string {
  let protectedText = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === "\\" && source[index + 1] === "$") {
      protectedText += "\\$";
      index += 2;
      continue;
    }
    if (source.startsWith("$$", index)) {
      const closing = source.indexOf("$$", index + 2);
      if (closing >= 0) {
        protectedText += source.slice(index, closing + 2);
        index = closing + 2;
      } else {
        protectedText += replacement.repeat(2);
        index += 2;
      }
      continue;
    }
    if (source[index] !== "$") {
      protectedText += source[index];
      index += 1;
      continue;
    }

    const next = source[index + 1] ?? "";
    const closing = next && !/\s/u.test(next) ? closingInlineDollar(source, index) : -1;
    if (closing >= 0) {
      protectedText += source.slice(index, closing + 1);
      index = closing + 1;
    } else {
      protectedText += replacement;
      index += 1;
    }
  }
  return protectedText;
}

const ignoredMathSelector =
  "script,noscript,style,textarea,pre,code,option,.katex,.katex-display";

function transformCommentText(element: HTMLElement, transform: (text: string) => string): void {
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent?.closest(ignoredMathSelector) && node.nodeValue) {
        node.nodeValue = transform(node.nodeValue);
      }
      return;
    }
    for (const child of [...node.childNodes]) visit(child);
  };
  visit(element);
}

const safeRenderMathInElement: RenderMathInElement = (element, options) => {
  let marker = "\uE000cyberl-katex-dollar\uE001";
  while (element.textContent?.includes(marker)) marker += "\uE001";
  transformCommentText(element, (text) => protectAmbiguousInlineDollars(text, marker));
  renderMathInElement(element, options);
  transformCommentText(element, (text) => text.replaceAll(marker, "$"));
};

export function installKatexBridge(target: Window): void {
  if (target.renderMathInElement && target.renderMathInElement !== safeRenderMathInElement) {
    throw new Error("window.renderMathInElement 已被其他实现占用");
  }
  target.renderMathInElement = safeRenderMathInElement;
}

function loadTwikooClient(document: Document): Promise<TwikooClient> {
  installKatexBridge(window);
  if (window.twikoo) return Promise.resolve(window.twikoo);
  if (clientPromise) return clientPromise;

  const pending = new Promise<TwikooClient>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CLIENT_URL;
    script.async = true;
    script.dataset.twikooClient = "local";
    script.addEventListener("load", () => {
      if (window.twikoo) resolve(window.twikoo);
      else reject(new Error("本地 Twikoo 客户端加载后没有注册 window.twikoo"));
    });
    script.addEventListener("error", () => reject(new Error("本地 Twikoo 客户端加载失败")));
    document.head.append(script);
  });
  clientPromise = pending.catch((error: unknown) => {
    clientPromise = null;
    throw error;
  });

  return clientPromise;
}

export async function resolveTwikooCommentCounts(
  paths: readonly string[],
  fetchCounts: (paths: string[]) => Promise<TwikooCount[]>,
): Promise<Map<string, number>> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return new Map();

  const response = await fetchCounts(uniquePaths);
  const counts = new Map(uniquePaths.map((path) => [path, 0]));
  for (const item of response) {
    const path = normalizeCommentPath(item.url, item.url);
    if (counts.has(path)) counts.set(path, Number.isFinite(item.count) ? item.count : 0);
  }
  return counts;
}

export type TwikooCountResult =
  | { status: "ready"; counts: Map<string, number> }
  | { status: "error"; error: unknown };

export async function fetchTwikooCommentCounts(
  paths: readonly string[],
  fetchCounts: (paths: string[]) => Promise<TwikooCount[]>,
): Promise<TwikooCountResult> {
  try {
    return { status: "ready", counts: await resolveTwikooCommentCounts(paths, fetchCounts) };
  } catch (error) {
    return { status: "error", error };
  }
}

function hidePageviews(document: Document): void {
  for (const element of document.querySelectorAll<HTMLElement>(".pageview-count")) {
    const wrapper = element.closest<HTMLElement>("a, li");
    if (wrapper) wrapper.hidden = true;
    else element.hidden = true;
  }
}

async function updateCommentCounts(
  client: TwikooClient,
  config: CommentRuntimeConfig,
  document: Document,
  fallbackPath: string,
  signal: AbortSignal,
): Promise<void> {
  const elements = [...document.querySelectorAll<HTMLElement>(".comment-count")];
  const paths = elements.map((element) =>
    normalizeCommentPath(element.dataset.path, fallbackPath),
  );

  const result = await fetchTwikooCommentCounts(paths, (urls) =>
      client.getCommentsCount({
        envId: config.twikoo.envId!,
        includeReply: config.twikoo.includeReply,
        urls,
      }),
  );
  if (signal.aborted) return;
  if (result.status === "ready") {
    elements.forEach((element, index) => {
      element.textContent = String(result.counts.get(paths[index]!) ?? 0);
      element.dataset.countState = "ready";
    });
  } else {
    console.error("Twikoo 评论计数加载失败", result.error);
    for (const element of elements) {
      element.textContent = "—";
      element.dataset.countState = "error";
      element.title = "评论数暂时无法加载";
    }
  }
}

export function createTwikooProvider(
  config: CommentRuntimeConfig,
  getClient: (document: Document) => Promise<TwikooClient> = loadTwikooClient,
): CommentProvider {
  let previousContainer: HTMLElement | null = null;
  let loadSequence = 0;
  let initQueue = Promise.resolve();

  const dispose = (): void => {
    loadSequence += 1;
    previousContainer?.replaceChildren();
    previousContainer = null;
  };

  return {
    dispose,
    async load(context: CommentViewContext): Promise<void> {
      dispose();
      const sequence = loadSequence;
      hidePageviews(context.document);
      const client = await getClient(context.document);
      if (context.signal.aborted || sequence !== loadSequence) return;
      await updateCommentCounts(
        client,
        config,
        context.document,
        context.path,
        context.signal,
      );
      if (context.signal.aborted || sequence !== loadSequence) return;

      if (!context.container) return;
      previousContainer = context.container;
      const mount = context.document.createElement("div");
      mount.id = `twikoo-${sequence}`;
      mount.dataset.twikooMount = "";
      context.container.replaceChildren(mount);

      // Twikoo 2.0.15 没有公开的 destroy/abort 接口。唯一挂载 ID 防止旧请求在
      // PJAX 换页后选中新页面节点；串行队列则避免两个 init 互相卸载 Vue 应用。
      const initialize = initQueue.catch(() => undefined).then(async () => {
        if (context.signal.aborted || sequence !== loadSequence || !mount.isConnected) return;
        await client.init({
          el: `#${mount.id}`,
          envId: config.twikoo.envId!,
          katex: TWIKOO_KATEX_OPTIONS,
          path: context.path,
        });
        if (context.signal.aborted || sequence !== loadSequence) mount.replaceChildren();
      });
      initQueue = initialize.then(() => undefined, () => undefined);
      await initialize;
    },
  };
}

export function createCommentProvider(config: CommentRuntimeConfig): CommentProvider {
  return createTwikooProvider(config);
}
