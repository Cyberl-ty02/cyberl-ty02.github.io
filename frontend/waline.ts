import {
  commentCount,
  init,
  pageviewCount,
  type WalineAbort,
  type WalineInstance,
} from "@waline/client";
import "@waline/client/waline.css";
import type {
  CommentProvider,
  CommentRuntimeConfig,
  CommentViewContext,
} from "./comments/types.ts";

export function createCommentProvider(config: CommentRuntimeConfig): CommentProvider {
  const { serverURL, turnstileKey } = config.legacyWaline;
  let firstVisit = true;
  let waline: WalineInstance | null = null;
  let abortCounters: WalineAbort[] = [];

  const dispose = (): void => {
    waline?.destroy();
    waline = null;
    for (const abort of abortCounters) abort("page changed");
    abortCounters = [];
  };

  return {
    dispose,
    async load(context: CommentViewContext): Promise<void> {
      dispose();
      if (context.signal.aborted) return;

      if (context.container) {
        const mount = context.document.createElement("div");
        mount.id = "w-comments";
        context.container.replaceChildren(mount);
        waline = init({
          el: mount,
          path: context.path,
          dark: 'html[data-theme="dark"]',
          serverURL,
          pageview: true,
          comment: true,
          turnstileKey,
        });
      } else {
        abortCounters.push(
          pageviewCount({ serverURL, selector: ".waline-pageview-count", update: false }),
          commentCount({ serverURL, selector: ".waline-comment-count" }),
        );
      }

      if (firstVisit) {
        firstVisit = false;
        abortCounters.push(pageviewCount({ serverURL, path: "/index.html" }));
      }
    },
  };
}
