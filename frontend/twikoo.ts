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
  init(options: { el: string; envId: string; path: string }): Promise<void>;
}

declare global {
  interface Window {
    twikoo?: TwikooClient;
  }
}

const CLIENT_URL = "/comments/twikoo/twikoo.min.js?v=2.0.15";
let clientPromise: Promise<TwikooClient> | null = null;

function loadTwikooClient(document: Document): Promise<TwikooClient> {
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
