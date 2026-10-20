import { DEFAULT_COMMENT_PROVIDER } from "../frontend/comments/config.ts";
import type { CommentProviderName } from "../frontend/comments/types.ts";

const supportedProviders = new Set<CommentProviderName>([
  "twikoo",
  "disabled",
]);

export interface CommentBuildSelection {
  override: CommentProviderName | null;
  endpointOverride: string | null;
  effectiveProvider: CommentProviderName;
  define?: Record<string, string>;
}

export function resolveCommentBuildSelection(
  args: readonly string[],
): CommentBuildSelection {
  const providerArguments = args.filter((argument) => argument.startsWith("--comments="));
  const endpointArguments = args.filter((argument) => argument.startsWith("--twikoo-endpoint="));
  if (providerArguments.length > 1) {
    throw new Error("只能指定一个 --comments=<provider> 参数");
  }
  if (endpointArguments.length > 1) {
    throw new Error("只能指定一个 --twikoo-endpoint=<url> 参数");
  }

  const rawOverride = providerArguments[0]?.slice("--comments=".length);
  if (rawOverride === "legacy-waline") {
    throw new Error("legacy-waline 已退役；仅支持 twikoo 或 disabled");
  }
  if (rawOverride !== undefined && !supportedProviders.has(rawOverride as CommentProviderName)) {
    throw new Error(`不支持的评论预览提供者：${rawOverride}`);
  }

  const override = (rawOverride as CommentProviderName | undefined) ?? null;
  const endpointOverride = endpointArguments[0]?.slice("--twikoo-endpoint=".length) ?? null;
  if (endpointOverride !== null && endpointOverride !== "http://127.0.0.1:8081") {
    throw new Error("Twikoo 本地预览 endpoint 必须严格等于 http://127.0.0.1:8081");
  }
  if (endpointOverride !== null && override !== "twikoo") {
    throw new Error("指定 Twikoo 本地 endpoint 时必须同时选择 twikoo provider");
  }
  return {
    override,
    endpointOverride,
    effectiveProvider: override ?? DEFAULT_COMMENT_PROVIDER,
    // 普通构建不定义预览宏，由 config.ts 自己采用 DEFAULT_COMMENT_PROVIDER。
    define: override
      ? {
          __COMMENT_PREVIEW_PROVIDER__: JSON.stringify(override),
          ...(endpointOverride
            ? { __TWIKOO_PREVIEW_ENDPOINT__: JSON.stringify(endpointOverride) }
            : {}),
        }
      : undefined,
  };
}
