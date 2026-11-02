declare module "hexo-front-matter" {
  interface FrontMatter {
    date?: unknown;
    updated?: unknown;
    [key: string]: unknown;
  }

  type SplitFrontMatter =
    | {
        content: string;
        data: string;
        prefixSeparator: boolean;
        separator: string;
      }
    | {
        content: string;
        data?: undefined;
        prefixSeparator?: undefined;
        separator?: undefined;
      };

  const frontMatter: {
    parse: (source: string) => FrontMatter;
    split: (source: string) => SplitFrontMatter;
  };

  export default frontMatter;
}
