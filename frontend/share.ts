/** Small adapter for Kratos-Rebirth's public share modal; no theme fork. */
export interface SharePayload {
  url: string;
  title: string;
  summary: string;
  site: string;
}

const endpoints = new Set([
  "https://connect.qq.com/widget/shareqq/index.html",
  "https://service.weibo.com/share/share.php",
  "https://www.facebook.com/sharer/sharer.php",
  "https://twitter.com/intent/tweet",
  "https://bsky.app/intent/compose",
]);

export function shareText(data: SharePayload): string {
  return `${data.title}\n${data.url}`;
}

export function expandShareUrl(template: string, data: SharePayload): string {
  const values: Record<string, string> = {
    URL: data.url, TITLE: data.title, SUMMARY: data.summary, SITE: data.site,
    TEXT: shareText(data),
  };
  const result = new URL(template.replace(/\$(URL|TITLE|SUMMARY|SITE|TEXT)\b/g,
    (_, key: string) => encodeURIComponent(values[key] ?? "")));
  if (!endpoints.has(result.origin + result.pathname) || result.username || result.password) {
    throw new Error("未知的分享入口");
  }
  return result.href;
}

export function misskeyShareUrl(instance: string, data: SharePayload): string {
  const value = instance.trim();
  if (!value || /\s/u.test(value)) throw new Error("请输入实例域名或 HTTPS 地址");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || !url.hostname.includes(".")) {
    throw new Error("请仅填写实例的 HTTPS 域名，不含路径、账号或参数");
  }
  url.pathname = "/share";
  url.searchParams.set("title", data.title);
  url.searchParams.set("url", data.url);
  return url.href;
}

export function readSharePayload(doc: Document, location: string): SharePayload {
  const meta = (name: string): string =>
    doc.querySelector<HTMLMetaElement>(`meta[property="${name}"]`)?.content ?? "";
  const candidate = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
    meta("og:url") || location;
  const url = new URL(candidate, location);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("文章地址无效");
  url.hash = "";
  return { url: url.href, title: meta("og:title") || doc.title,
    summary: meta("og:description"), site: meta("og:site_name") };
}

type ShareWindow = Window & {
  krCloseShareModal?: () => void;
  QRCodeStyling?: new (options: object) => { append: (element: HTMLElement) => void };
};
const installed = new WeakMap<Document, () => void>();

export function installShareRuntime(win: ShareWindow, doc: Document = win.document): () => void {
  const existing = installed.get(doc);
  if (existing) return existing;
  let returnFocus: HTMLElement | null = null;
  const modal = () => doc.getElementById("kr-share-modal");
  const payload = () => readSharePayload(doc, win.location.href);
  const status = (message: string) => {
    const element = doc.getElementById("blog-share-status");
    if (element) element.textContent = message;
  };
  const reset = () => {
    modal()?.classList.remove("share-show-qr");
    for (const panel of doc.querySelectorAll<HTMLElement>("[data-share-panel]")) panel.hidden = true;
    status("");
  };
  const open = (url: string) => win.open(url, "_blank", "noopener,noreferrer");
  const copy = async (text: string, field: HTMLTextAreaElement) => {
    field.value = text;
    try {
      if (!win.navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await win.navigator.clipboard.writeText(text);
      status("已复制，请到目标平台粘贴；发布前可自行修改。");
    } catch {
      field.focus(); field.select();
      status("请复制已选中的内容（Ctrl/Cmd+C 或长按复制）。");
    }
  };
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };

  const enhance = () => {
    const root = modal();
    if (!root) return;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    const title = root.querySelector<HTMLElement>(".kr-modal-title");
    if (title) { title.id = "blog-share-title"; root.setAttribute("aria-labelledby", title.id); }
    root.querySelector(".kr-modal-close")?.setAttribute("aria-label", "关闭分享");
    for (const button of root.querySelectorAll<HTMLButtonElement>(".kr-share-platform-button")) {
      const inline = button.getAttribute("onclick") ?? "";
      const match = /^krShareModalOpenPlatform\('([^']*)'\);?$/u.exec(inline);
      if (match?.[1]) { button.dataset.shareTarget = match[1]; button.removeAttribute("onclick"); }
      button.type = "button";
      button.setAttribute("aria-label", button.title);
      if (!button.querySelector(".blog-share-label")) {
        const label = element("span", button.title);
        label.className = "blog-share-label"; button.append(label);
      }
    }
    if (doc.getElementById("blog-share-status")) return;
    const body = root.querySelector(".kr-modal-body");
    if (!body) return;
    const message = root.querySelector(".kr-share-message");
    if (message) message.textContent = "选择平台分享，或复制文章链接。";
    const result = element("p"); result.id = "blog-share-status";
    result.setAttribute("role", "status"); result.setAttribute("aria-live", "polite");
    const clipboard = element("section"); clipboard.dataset.sharePanel = "copy"; clipboard.hidden = true;
    const fieldLabel = element("label", "分享内容"); fieldLabel.htmlFor = "blog-share-text";
    const field = element("textarea"); field.id = fieldLabel.htmlFor; field.readOnly = true; field.rows = 3;
    const copyButton = element("button", "复制内容"); copyButton.type = "button";
    copyButton.addEventListener("click", () => { void copy(field.value, field); });
    const bili = element("a", "打开B站动态"); bili.href = "https://t.bilibili.com/";
    bili.target = "_blank"; bili.rel = "noopener noreferrer"; bili.dataset.bilibili = "true";
    clipboard.append(fieldLabel, field, copyButton, bili);
    const form = element("form"); form.dataset.sharePanel = "instance"; form.hidden = true;
    const instanceLabel = element("label", "Misskey／兼容分支实例地址"); instanceLabel.htmlFor = "blog-share-instance";
    const input = element("input"); input.id = instanceLabel.htmlFor; input.type = "text";
    input.placeholder = "https://你的实例域名"; input.required = true; input.setAttribute("autocomplete", "url");
    input.setAttribute("aria-describedby", result.id);
    const submit = element("button", "前往实例分享"); submit.type = "submit";
    const help = element("p", "适用于 Misskey、Sharkey 等兼容实例；在目标站确认后发布。");
    form.append(instanceLabel, input, submit, help);
    form.addEventListener("submit", event => {
      event.preventDefault();
      try { open(misskeyShareUrl(input.value, payload())); status("已打开实例分享表单，请在目标站确认。"); }
      catch (error) { status(error instanceof Error ? error.message : "实例地址无效"); input.focus(); }
    });
    body.append(clipboard, form, result);
  };

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    if (target.closest(".post-actions .share")) {
      returnFocus = target.closest<HTMLElement>(".share"); reset();
      win.setTimeout(() => modal()?.querySelector<HTMLElement>(".kr-modal-close")?.focus(), 0);
    }
    const button = target.closest<HTMLButtonElement>("button[data-share-target]");
    if (!button || !modal()?.contains(button)) return;
    event.preventDefault(); event.stopPropagation();
    const route = button.dataset.shareTarget ?? "";
    reset();
    try {
      const data = payload();
      if (route === "#share-wechat") {
        modal()?.classList.add("share-show-qr");
        const qr = doc.getElementById("kr-share-qr");
        if (qr && win.QRCodeStyling) {
          qr.replaceChildren();
          new win.QRCodeStyling({ width: 180, height: 180, margin: 20, data: data.url,
            dotsOptions: { color: "#111111", type: "square" },
            backgroundOptions: { color: "#ffffff" } }).append(qr);
          status("用微信扫一扫二维码，打开文章后通过右上角菜单分享。");
        } else status("二维码暂不可用，请使用复制链接。");
      } else if (route === "#share-misskey") {
        const panel = doc.querySelector<HTMLElement>('[data-share-panel="instance"]');
        if (panel) panel.hidden = false;
        doc.getElementById("blog-share-instance")?.focus();
      } else if (["#share-copy", "#share-bilibili", "#share-native"].includes(route)) {
        const panel = doc.querySelector<HTMLElement>('[data-share-panel="copy"]');
        const field = doc.getElementById("blog-share-text") as HTMLTextAreaElement | null;
        if (!panel || !field) return;
        panel.hidden = false;
        const bili = panel.querySelector<HTMLElement>("[data-bilibili]");
        if (bili) bili.hidden = route !== "#share-bilibili";
        field.value = route === "#share-copy" ? data.url : shareText(data);
        if (route === "#share-bilibili") {
          status("复制文案后打开B站动态，粘贴并自行发布。"); field.focus();
        } else if (route === "#share-native" && win.navigator.share) {
          void win.navigator.share({ title: data.title, url: data.url }).catch((error: unknown) => {
            if (!(error instanceof Error && error.name === "AbortError")) status("系统分享暂不可用，请复制内容。");
          });
        } else void copy(field.value, field);
      } else open(expandShareUrl(route, data));
    } catch { status("分享入口暂不可用，请使用复制链接。"); }
  };
  const onKey = (event: KeyboardEvent) => {
    const root = modal();
    if (!root?.classList.contains("active")) return;
    if (event.key === "Escape") {
      win.krCloseShareModal?.(); returnFocus?.focus();
    } else if (event.key === "Tab") {
      const visible = Array.from(root.querySelectorAll<HTMLElement>("button,input,textarea,a[href]"))
        .filter(node => !node.closest("[hidden]") && !node.hasAttribute("disabled"));
      const first = visible[0]; const last = visible.at(-1);
      if (event.shiftKey && doc.activeElement === first) { last?.focus(); event.preventDefault(); }
      else if (!event.shiftKey && doc.activeElement === last) { first?.focus(); event.preventDefault(); }
    }
  };
  enhance();
  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey);
  win.addEventListener("pjax:complete", enhance);
  const cleanup = () => {
    doc.removeEventListener("click", onClick); doc.removeEventListener("keydown", onKey);
    win.removeEventListener("pjax:complete", enhance); installed.delete(doc);
  };
  installed.set(doc, cleanup);
  return cleanup;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => installShareRuntime(window), { once: true });
  } else installShareRuntime(window);
}
