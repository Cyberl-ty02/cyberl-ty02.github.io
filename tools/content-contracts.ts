import frontMatter from "hexo-front-matter";

export interface PostMetadata {
  readonly category: string | undefined;
  readonly donate: unknown;
  readonly hasDate: boolean;
  readonly tags: readonly string[] | undefined;
  readonly title: string | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

/**
 * Parse the same YAML front matter that Hexo consumes, then narrow the
 * dependency's dynamic result before content validation uses it.
 */
export function parsePostMetadata(source: string): PostMetadata {
  const split = frontMatter.split(source);
  if (
    split.data === undefined ||
    split.prefixSeparator !== true ||
    split.separator !== "---"
  ) {
    throw new Error("缺少以 --- 包围的 YAML front matter");
  }

  // hexo-front-matter exposes `any`; contain it at this adapter boundary.
  const parsed: unknown = frontMatter.parse(source);
  if (!isRecord(parsed)) {
    throw new Error("YAML front matter 没有解析为对象");
  }

  return {
    category: nonEmptyString(parsed.categories),
    donate: parsed.donate,
    hasDate: Object.hasOwn(parsed, "date") && parsed.date !== null && parsed.date !== undefined,
    tags: stringList(parsed.tags),
    title: nonEmptyString(parsed.title),
  };
}
