export type RuntimeTarget = "browser" | "node" | "none";
export type RuntimeFormat =
  | "esm"
  | "cjs"
  | "css"
  | "vendor-script"
  | "vendor-stylesheet"
  | "font"
  | "license";

export interface BundledRuntimeArtifact {
  kind: "bundle";
  source: string;
  output: string;
  target: Exclude<RuntimeTarget, "none">;
  format: "esm" | "cjs" | "css";
  bunFormat: "esm" | "cjs";
  minify: boolean;
  ownership: "first-party-generated";
  licenseOutput: null;
  external?: string[];
}

export interface VendoredRuntimeArtifact {
  kind: "copy";
  source: string;
  output: string;
  target: "browser" | "none";
  format: "vendor-script" | "vendor-stylesheet" | "font" | "license";
  ownership: "third-party-vendored";
  licenseOutput: string;
}

export type RuntimeArtifact = BundledRuntimeArtifact | VendoredRuntimeArtifact;

export const bundledRuntimeArtifacts = [
  {
    kind: "bundle",
    source: "frontend/comments.ts",
    output: "source/comments/comments.js",
    target: "browser",
    format: "esm",
    bunFormat: "esm",
    minify: true,
    ownership: "first-party-generated",
    licenseOutput: null,
  },
  {
    kind: "bundle",
    source: "frontend/twikoo.ts",
    output: "source/comments/twikoo.js",
    target: "browser",
    format: "esm",
    bunFormat: "esm",
    minify: true,
    ownership: "first-party-generated",
    licenseOutput: null,
  },
  {
    kind: "bundle",
    source: "frontend/comments.css",
    output: "source/comments/comments.css",
    target: "browser",
    format: "css",
    bunFormat: "esm",
    minify: true,
    ownership: "first-party-generated",
    licenseOutput: null,
  },
  {
    kind: "bundle",
    source: "frontend/katex-overrides.css",
    output: "source/katex/katex-overrides.css",
    target: "browser",
    format: "css",
    bunFormat: "esm",
    minify: true,
    ownership: "first-party-generated",
    licenseOutput: null,
  },
  {
    kind: "bundle",
    source: "plugins/date-from-git.ts",
    output: "scripts/date-from-git.js",
    target: "node",
    format: "cjs",
    bunFormat: "cjs",
    minify: false,
    ownership: "first-party-generated",
    licenseOutput: null,
    external: ["hexo-front-matter", "isomorphic-git", "moment"],
  },
  {
    kind: "bundle",
    source: "plugins/marked-katex.ts",
    output: "scripts/marked-katex.js",
    target: "node",
    format: "cjs",
    bunFormat: "cjs",
    minify: false,
    ownership: "first-party-generated",
    licenseOutput: null,
    external: ["katex", "marked"],
  },
] as const satisfies readonly BundledRuntimeArtifact[];

export const twikooLocaleNames = [
  "id-ID.js",
  "ja-JP.js",
  "ko-KR.js",
  "uz-UZ.js",
  "vi-VN.js",
  "zh-HK.js",
  "zh-TW.js",
] as const;

const twikooLicenseOutput = "source/comments/twikoo/LICENSE";
const katexLicenseOutput = "source/katex/LICENSE";

export const katexFontFamilies = [
  "KaTeX_AMS-Regular",
  "KaTeX_Caligraphic-Bold",
  "KaTeX_Caligraphic-Regular",
  "KaTeX_Fraktur-Bold",
  "KaTeX_Fraktur-Regular",
  "KaTeX_Main-Bold",
  "KaTeX_Main-BoldItalic",
  "KaTeX_Main-Italic",
  "KaTeX_Main-Regular",
  "KaTeX_Math-BoldItalic",
  "KaTeX_Math-Italic",
  "KaTeX_SansSerif-Bold",
  "KaTeX_SansSerif-Italic",
  "KaTeX_SansSerif-Regular",
  "KaTeX_Script-Regular",
  "KaTeX_Size1-Regular",
  "KaTeX_Size2-Regular",
  "KaTeX_Size3-Regular",
  "KaTeX_Size4-Regular",
  "KaTeX_Typewriter-Regular",
] as const;

export const katexFontExtensions = ["ttf", "woff", "woff2"] as const;

export const vendoredRuntimeArtifacts = [
  {
    kind: "copy",
    source: "node_modules/twikoo/dist/twikoo.min.js",
    output: "source/comments/twikoo/twikoo.min.js",
    target: "browser",
    format: "vendor-script",
    ownership: "third-party-vendored",
    licenseOutput: twikooLicenseOutput,
  },
  ...twikooLocaleNames.map(
    (locale): VendoredRuntimeArtifact => ({
      kind: "copy",
      source: `node_modules/twikoo/dist/locales/${locale}`,
      output: `source/comments/twikoo/locales/${locale}`,
      target: "browser",
      format: "vendor-script",
      ownership: "third-party-vendored",
      licenseOutput: twikooLicenseOutput,
    }),
  ),
  {
    kind: "copy",
    source: "node_modules/twikoo/LICENSE",
    output: twikooLicenseOutput,
    target: "none",
    format: "license",
    ownership: "third-party-vendored",
    licenseOutput: twikooLicenseOutput,
  },
  {
    kind: "copy",
    source: "node_modules/katex/dist/katex.min.css",
    output: "source/katex/katex.min.css",
    target: "browser",
    format: "vendor-stylesheet",
    ownership: "third-party-vendored",
    licenseOutput: katexLicenseOutput,
  },
  ...katexFontFamilies.flatMap((family) =>
    katexFontExtensions.map(
      (extension): VendoredRuntimeArtifact => ({
        kind: "copy",
        source: `node_modules/katex/dist/fonts/${family}.${extension}`,
        output: `source/katex/fonts/${family}.${extension}`,
        target: "browser",
        format: "font",
        ownership: "third-party-vendored",
        licenseOutput: katexLicenseOutput,
      }),
    ),
  ),
  {
    kind: "copy",
    source: "node_modules/katex/LICENSE",
    output: katexLicenseOutput,
    target: "none",
    format: "license",
    ownership: "third-party-vendored",
    licenseOutput: katexLicenseOutput,
  },
] as const satisfies readonly VendoredRuntimeArtifact[];

export const runtimeArtifacts: readonly RuntimeArtifact[] = [
  ...bundledRuntimeArtifacts,
  ...vendoredRuntimeArtifacts,
];
