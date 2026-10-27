import katex, { type KatexOptions } from "katex";
import type { TokenizerAndRendererExtension, Tokens } from "marked";

interface MathToken extends Tokens.Generic {
  display: boolean;
  math: string;
}

interface HexoRuntime {
  extend: {
    filter: {
      register: (
        name: "marked:extensions",
        handler: (extensions: TokenizerAndRendererExtension[]) => void,
      ) => void;
    };
  };
}

declare const hexo: HexoRuntime | undefined;

export const POST_KATEX_OPTIONS = {
  maxExpand: 1000,
  maxSize: 20,
  output: "htmlAndMathml",
  strict: "warn",
  throwOnError: true,
  trust: false,
} as const satisfies KatexOptions;

function renderMath(math: string, displayMode: boolean): string {
  try {
    return katex.renderToString(math, {
      ...POST_KATEX_OPTIONS,
      displayMode,
    });
  } catch (error) {
    const summary = math.replace(/\s+/gu, " ").trim().slice(0, 80);
    throw new Error(`KaTeX could not render ${displayMode ? "block" : "inline"} math: ${summary}`, {
      cause: error,
    });
  }
}

function findClosingDollar(source: string): number {
  for (let index = 1; index < source.length; index += 1) {
    if (source[index] !== "$" || source[index - 1] === "\\") continue;
    if (/\s/u.test(source[index - 1] ?? "") || /\d/u.test(source[index + 1] ?? "")) return -1;
    return index;
  }
  return -1;
}

function inlineDollarToken(source: string): MathToken | undefined {
  if (!source.startsWith("$") || source.startsWith("$$")) return undefined;
  if (/\s/u.test(source[1] ?? "") || source[1] === "$" || source[1] === "") return undefined;
  const closing = findClosingDollar(source);
  if (closing < 2) return undefined;
  return {
    type: "inlineKatex",
    raw: source.slice(0, closing + 1),
    math: source.slice(1, closing),
    display: false,
  };
}

function inlineBracketToken(source: string): MathToken | undefined {
  if (!source.startsWith("\\(")) return undefined;
  const closing = source.indexOf("\\)", 2);
  if (closing < 3 || source.slice(2, closing).includes("\n")) return undefined;
  return {
    type: "inlineKatex",
    raw: source.slice(0, closing + 2),
    math: source.slice(2, closing),
    display: false,
  };
}

function blockToken(source: string): MathToken | undefined {
  const dollar = /^(?: {0,3})\$\$[ \t]*(?:\n([\s\S]*?)\n[ \t]*\$\$|([^\n]*?)\$\$)[ \t]*(?:\n|$)/u.exec(source);
  if (dollar) {
    const math = dollar[1] ?? dollar[2] ?? "";
    if (!math.trim()) return undefined;
    return { type: "blockKatex", raw: dollar[0], math, display: true };
  }

  const bracket = /^(?: {0,3})\\\[[ \t]*(?:\n([\s\S]*?)\n[ \t]*\\\]|([^\n]*?)\\\])[ \t]*(?:\n|$)/u.exec(source);
  if (bracket) {
    const math = bracket[1] ?? bracket[2] ?? "";
    if (!math.trim()) return undefined;
    return { type: "blockKatex", raw: bracket[0], math, display: true };
  }
  return undefined;
}

export function createMarkedKatexExtensions(): TokenizerAndRendererExtension[] {
  return [
    {
      name: "blockKatex",
      level: "block",
      start(source) {
        const candidates = [source.search(/^ {0,3}\$\$/mu), source.search(/^ {0,3}\\\[/mu)]
          .filter((index) => index >= 0);
        return candidates.length > 0 ? Math.min(...candidates) : undefined;
      },
      tokenizer(source) {
        return blockToken(source);
      },
      renderer(token) {
        const math = token as MathToken;
        return `${renderMath(math.math, true)}\n`;
      },
    },
    {
      name: "inlineKatex",
      level: "inline",
      start(source) {
        const dollars = source.indexOf("$");
        const brackets = source.indexOf("\\(");
        const candidates = [dollars, brackets].filter((index) => index >= 0);
        return candidates.length > 0 ? Math.min(...candidates) : undefined;
      },
      tokenizer(source) {
        return inlineDollarToken(source) ?? inlineBracketToken(source);
      },
      renderer(token) {
        const math = token as MathToken;
        return renderMath(math.math, false);
      },
    },
  ];
}

export function registerMarkedKatex(runtime: HexoRuntime): void {
  runtime.extend.filter.register("marked:extensions", (extensions) => {
    extensions.push(...createMarkedKatexExtensions());
  });
}

if (typeof hexo !== "undefined") registerMarkedKatex(hexo);
