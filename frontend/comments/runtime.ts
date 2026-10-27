import { isConfiguredTwikooEnvId } from "./config.ts";
import { normalizeCommentPath } from "./path.ts";
import type {
  CommentProvider,
  CommentProviderModule,
  CommentRuntimeConfig,
} from "./types.ts";

declare global {
  interface Window {
    loadComments: (() => Promise<void>) | null;
  }
}

export interface RuntimeWindow {
  loadComments: (() => Promise<void>) | null;
  location: Pick<Location, "pathname">;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export type ProviderImporter = (specifier: string) => Promise<CommentProviderModule>;

const installations = new WeakMap<object, () => void>();

function providerAsset(config: CommentRuntimeConfig): string | null {
  switch (config.provider) {
    case "twikoo":
      return isConfiguredTwikooEnvId(config.twikoo.envId)
        ? "/comments/twikoo.js?v=20261027-1"
        : null;
    case "disabled":
      return null;
  }
}

function hideCounterParents(document: Document): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    ".comment-count, .pageview-count",
  )) {
    const wrapper = element.closest<HTMLElement>("a, li");
    if (wrapper) wrapper.hidden = true;
    else element.hidden = true;
  }
}

function renderUnavailable(
  document: Document,
  message: string,
  retry?: () => void,
): void {
  hideCounterParents(document);
  const container = document.querySelector<HTMLElement>("[data-comments-container]");
  if (!container) return;

  container.replaceChildren();
  const status = document.createElement("p");
  status.className = "comments-status comments-status--unavailable";
  status.setAttribute("role", "status");
  status.textContent = message;
  container.append(status);

  if (retry) {
    const button = document.createElement("button");
    button.className = "comments-retry";
    button.type = "button";
    button.textContent = "重试加载评论";
    button.addEventListener("click", retry, { once: true });
    container.append(button);
  }
}

export function installCommentRuntime(
  config: CommentRuntimeConfig,
  runtimeWindow: RuntimeWindow = window,
  document: Document = globalThis.document,
  importer: ProviderImporter = (specifier) => import(specifier),
): () => void {
  const existing = installations.get(runtimeWindow);
  if (existing) return existing;

  let generation = 0;
  let providerInstance: CommentProvider | null = null;
  let providerPromise: Promise<CommentProviderModule> | null = null;
  let viewAbort: AbortController | null = null;

  const disposeView = (): void => {
    generation += 1;
    viewAbort?.abort("page changed");
    viewAbort = null;
    providerInstance?.dispose();
  };

  const loadCurrentView = async (): Promise<void> => {
    disposeView();
    const currentGeneration = generation;
    const currentAbort = new AbortController();
    viewAbort = currentAbort;
    const asset = providerAsset(config);

    if (!asset) {
      renderUnavailable(
        document,
        config.provider === "disabled"
          ? "评论功能当前已关闭。"
          : "Twikoo 尚未完成服务端配置，评论功能暂未启用。",
      );
      return;
    }

    try {
      providerPromise ??= importer(asset);
      const module = await providerPromise;
      if (currentGeneration !== generation) return;

      providerInstance ??= module.createCommentProvider(config);
      const container = document.querySelector<HTMLElement>("[data-comments-container]");
      const path = normalizeCommentPath(container?.dataset.path, runtimeWindow.location.pathname);
      await providerInstance.load({
        container,
        document,
        path,
        pathname: runtimeWindow.location.pathname,
        signal: currentAbort.signal,
      });
    } catch (error) {
      if (currentGeneration !== generation) return;
      providerPromise = null;
      console.error("评论模块加载失败", error);
      renderUnavailable(
        document,
        "评论加载失败，请稍后重试。文章正文不受影响。",
        () => void loadCurrentView(),
      );
    }
  };

  const prepareLazyLoad = (): void => {
    runtimeWindow.loadComments = loadCurrentView;
  };
  const beforePjax: EventListener = () => {
    disposeView();
    runtimeWindow.loadComments = null;
  };
  let completedNavigationHasSuccess = false;
  const afterPjax: EventListener = () => {
    completedNavigationHasSuccess = true;
    prepareLazyLoad();
  };
  // Kratos-Rebirth emits success -> complete for fetched pages, but history
  // restoration emits complete only. The latter must remount directly because
  // the theme's lazy loader had no loadComments callback to consume.
  const afterPjaxComplete: EventListener = () => {
    if (completedNavigationHasSuccess) {
      completedNavigationHasSuccess = false;
      return;
    }
    void loadCurrentView();
    runtimeWindow.loadComments = null;
  };

  runtimeWindow.addEventListener("pjax:before", beforePjax);
  runtimeWindow.addEventListener("pjax:success", afterPjax);
  runtimeWindow.addEventListener("pjax:complete", afterPjaxComplete);
  prepareLazyLoad();
  // 首个页面立即加载；后续 PJAX 页面交给主题的懒加载回调。
  void loadCurrentView();
  runtimeWindow.loadComments = null;

  const uninstall = (): void => {
    disposeView();
    runtimeWindow.loadComments = null;
    runtimeWindow.removeEventListener("pjax:before", beforePjax);
    runtimeWindow.removeEventListener("pjax:success", afterPjax);
    runtimeWindow.removeEventListener("pjax:complete", afterPjaxComplete);
    installations.delete(runtimeWindow);
  };
  installations.set(runtimeWindow, uninstall);
  return uninstall;
}
