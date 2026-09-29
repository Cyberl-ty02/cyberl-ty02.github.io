import {
  commentCount,
  init,
  pageviewCount,
  type WalineAbort,
  type WalineInstance,
} from "@waline/client";
import "@waline/client/waline.css";

declare global {
  interface Window {
    loadComments: (() => Promise<void>) | null;
  }
}

const serverURL = "https://cyblwalcom.zeabur.app/";
let firstVisit = true;
let waline: WalineInstance | null = null;
let abortCounters: WalineAbort[] = [];

function disposeCurrentView(): void {
  waline?.destroy();
  waline = null;

  for (const abort of abortCounters) abort("page changed");
  abortCounters = [];
}

async function loadComments(): Promise<void> {
  disposeCurrentView();

  const container = document.getElementById("w-comments");
  if (container) {
    waline = init({
      el: container,
      path: container.dataset.path ?? window.location.pathname,
      dark: 'html[data-theme="dark"]',
      serverURL,
      pageview: true,
      comment: true,
      turnstileKey: "0x4AAAAAADfi8AljGZqoAdyH",
    });
  } else {
    abortCounters.push(
      pageviewCount({ serverURL, update: false }),
      commentCount({ serverURL }),
    );
  }

  if (firstVisit) {
    firstVisit = false;
    abortCounters.push(pageviewCount({ serverURL, path: "/index.html" }));
  }
}

window.loadComments = loadComments;
void loadComments().finally(() => {
  window.loadComments = null;
});

window.addEventListener("pjax:before", disposeCurrentView);
window.addEventListener("pjax:success", () => {
  window.loadComments = loadComments;
});
