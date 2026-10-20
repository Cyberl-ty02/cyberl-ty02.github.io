/**
 * 将主题输出的站内路径整理为 Twikoo 接受的、不含域名和查询参数的路径。
 * 本博客使用目录式 permalink，因此除根路径外统一保留尾斜杠。
 */
export function normalizeCommentPath(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback || "/";
  let pathname: string;

  try {
    pathname = new URL(candidate, "https://comments.invalid").pathname;
  } catch {
    pathname = fallback || "/";
  }

  pathname = pathname.replace(/\/{2,}/gu, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.endsWith("/index.html")) pathname = pathname.slice(0, -"index.html".length);
  if (pathname !== "/" && !pathname.endsWith("/") && !/\.[^/]+$/u.test(pathname)) {
    pathname += "/";
  }

  return pathname;
}
