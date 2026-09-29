declare module "hexo-front-matter" {
  interface FrontMatter {
    date?: unknown;
    updated?: unknown;
    [key: string]: unknown;
  }

  const frontMatter: {
    parse: (source: string) => FrontMatter;
  };

  export default frontMatter;
}
