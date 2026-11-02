import { DEFAULT_COMMENT_PROVIDER } from "../frontend/comments/config.ts";
import type { CommentProviderName } from "../frontend/comments/types.ts";

const COMMENT_OPTION = "--comments";
const ENDPOINT_OPTION = "--twikoo-endpoint";
const LOOPBACK_TWIKOO_ENDPOINT = "http://127.0.0.1:8081";

type PreviewOptionName = typeof COMMENT_OPTION | typeof ENDPOINT_OPTION;

const previewOptionNames: ReadonlySet<string> = new Set<PreviewOptionName>([
  COMMENT_OPTION,
  ENDPOINT_OPTION,
]);
const supportedProviders: ReadonlySet<string> = new Set<CommentProviderName>([
  "twikoo",
  "disabled",
]);

export interface CommentBuildSelection {
  readonly override: CommentProviderName | null;
  readonly endpointOverride: string | null;
  readonly effectiveProvider: CommentProviderName;
  readonly define?: Readonly<Record<string, string>>;
}

function isPreviewOptionName(value: string): value is PreviewOptionName {
  return previewOptionNames.has(value);
}

function isCommentProviderName(value: string): value is CommentProviderName {
  return supportedProviders.has(value);
}

/**
 * Parse only the build-time preview interface owned by this repository.
 *
 * Rejecting unknown and empty options is intentional: a misspelled preview
 * switch must not silently fall back to the production comment endpoint.
 */
function parsePreviewArguments(
  args: readonly string[],
): ReadonlyMap<PreviewOptionName, string> {
  const values = new Map<PreviewOptionName, string>();

  for (const argument of args) {
    const separator = argument.indexOf("=");
    const name = separator < 0 ? argument : argument.slice(0, separator);
    if (!isPreviewOptionName(name)) {
      throw new Error(`不支持的评论构建参数：${argument}`);
    }

    const value = separator < 0 ? "" : argument.slice(separator + 1);
    if (!value) {
      throw new Error(`${name} 必须使用 ${name}=<value> 并提供非空值`);
    }
    if (values.has(name)) {
      const usage = name === COMMENT_OPTION ? "<provider>" : "<url>";
      throw new Error(`只能指定一个 ${name}=${usage} 参数`);
    }
    values.set(name, value);
  }

  return values;
}

export function resolveCommentBuildSelection(
  args: readonly string[],
): CommentBuildSelection {
  const options = parsePreviewArguments(args);
  const rawOverride = options.get(COMMENT_OPTION);
  if (rawOverride === "legacy-waline") {
    throw new Error("legacy-waline 已退役；仅支持 twikoo 或 disabled");
  }
  if (rawOverride !== undefined && !isCommentProviderName(rawOverride)) {
    throw new Error(`不支持的评论预览提供者：${rawOverride}`);
  }

  const override = rawOverride ?? null;
  const endpointOverride = options.get(ENDPOINT_OPTION) ?? null;
  if (endpointOverride !== null && endpointOverride !== LOOPBACK_TWIKOO_ENDPOINT) {
    throw new Error(`Twikoo 本地预览 endpoint 必须严格等于 ${LOOPBACK_TWIKOO_ENDPOINT}`);
  }
  if (endpointOverride !== null && override !== "twikoo") {
    throw new Error("指定 Twikoo 本地 endpoint 时必须同时选择 twikoo provider");
  }

  const define = override
    ? {
        __COMMENT_PREVIEW_PROVIDER__: JSON.stringify(override),
        ...(endpointOverride
          ? { __TWIKOO_PREVIEW_ENDPOINT__: JSON.stringify(endpointOverride) }
          : {}),
      } satisfies Readonly<Record<string, string>>
    : undefined;

  return {
    override,
    endpointOverride,
    effectiveProvider: override ?? DEFAULT_COMMENT_PROVIDER,
    // 普通构建不定义预览宏，由 config.ts 自己采用 DEFAULT_COMMENT_PROVIDER。
    define,
  };
}
