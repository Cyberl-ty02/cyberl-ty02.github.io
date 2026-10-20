import type { CommentProviderName, CommentRuntimeConfig } from "./types.ts";

declare const __COMMENT_PREVIEW_PROVIDER__: CommentProviderName | undefined;
declare const __TWIKOO_PREVIEW_ENDPOINT__: string | undefined;

export const DEFAULT_COMMENT_PROVIDER = "twikoo" satisfies CommentProviderName;
export const TWIKOO_NETLIFY_ENDPOINT =
  "https://cybltwicom.netlify.app/.netlify/functions/twikoo";

function selectedProvider(): CommentProviderName {
  return typeof __COMMENT_PREVIEW_PROVIDER__ === "undefined"
    ? DEFAULT_COMMENT_PROVIDER
    : __COMMENT_PREVIEW_PROVIDER__;
}

function selectedTwikooEndpoint(): string {
  return typeof __TWIKOO_PREVIEW_ENDPOINT__ === "undefined"
    ? TWIKOO_NETLIFY_ENDPOINT
    : __TWIKOO_PREVIEW_ENDPOINT__;
}

/**
 * 评论提供者的唯一切换点。
 *
 * Netlify endpoint 是公开的浏览器配置，不是数据库凭据。MONGODB_URI、管理员
 * Token、Turnstile Secret 和邮件密码只能保存在服务端环境变量中。
 *
 * 普通构建不注入预览值，直接采用 DEFAULT_COMMENT_PROVIDER。
 * `bun run server:twikoo` 保留为显式本地预览入口；普通构建直接使用正式 Twikoo 配置。
 * `--comments=disabled` 可在本地验证紧急关闭状态，不会请求评论后端。
 */
export const commentRuntimeConfig = {
  provider: selectedProvider(),
  legacyWaline: {
    serverURL: "https://cyblwalcom.zeabur.app/",
    turnstileKey: "0x4AAAAAADfi8AljGZqoAdyH",
  },
  twikoo: {
    envId: selectedTwikooEndpoint(),
    includeReply: false,
  },
} satisfies CommentRuntimeConfig;

export function isConfiguredTwikooEnvId(value: string | null): value is string {
  if (!value || /[<>]|example|placeholder|your-/iu.test(value)) return false;

  try {
    const endpoint = new URL(value);
    const approvedLocalPreview =
      endpoint.protocol === "http:" &&
      endpoint.hostname === "127.0.0.1" &&
      endpoint.port === "8081" &&
      endpoint.pathname === "/";
    const approvedRemoteEndpoint =
      endpoint.protocol === "https:" &&
      endpoint.hostname.length > 0 &&
      !/\.(?:example|invalid|test)$/u.test(endpoint.hostname);
    return approvedLocalPreview || approvedRemoteEndpoint;
  } catch {
    return false;
  }
}
