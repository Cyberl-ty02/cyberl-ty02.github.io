import { commentRuntimeConfig } from "./comments/config.ts";
import { installCommentRuntime } from "./comments/runtime.ts";

export const ACTIVE_COMMENT_PROVIDER = commentRuntimeConfig.provider;
export const ACTIVE_TWIKOO_ENDPOINT = commentRuntimeConfig.twikoo.envId;

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installCommentRuntime(commentRuntimeConfig);
}
