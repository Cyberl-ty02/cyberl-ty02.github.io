var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// plugins/marked-katex.ts
var exports_marked_katex = {};
__export(exports_marked_katex, {
  POST_KATEX_OPTIONS: () => POST_KATEX_OPTIONS,
  createMarkedKatexExtensions: () => createMarkedKatexExtensions,
  registerMarkedKatex: () => registerMarkedKatex
});
module.exports = __toCommonJS(exports_marked_katex);
var import_katex = __toESM(require("katex"));
var POST_KATEX_OPTIONS = {
  maxExpand: 1000,
  maxSize: 20,
  output: "htmlAndMathml",
  strict: "warn",
  throwOnError: true,
  trust: false
};
function renderMath(math, displayMode) {
  try {
    return import_katex.default.renderToString(math, {
      ...POST_KATEX_OPTIONS,
      displayMode
    });
  } catch (error) {
    const summary = math.replace(/\s+/gu, " ").trim().slice(0, 80);
    throw new Error(`KaTeX could not render ${displayMode ? "block" : "inline"} math: ${summary}`, {
      cause: error
    });
  }
}
function findClosingDollar(source) {
  for (let index = 1;index < source.length; index += 1) {
    if (source[index] !== "$" || source[index - 1] === "\\")
      continue;
    if (/\s/u.test(source[index - 1] ?? "") || /\d/u.test(source[index + 1] ?? ""))
      return -1;
    return index;
  }
  return -1;
}
function inlineDollarToken(source) {
  if (!source.startsWith("$") || source.startsWith("$$"))
    return;
  if (/\s/u.test(source[1] ?? "") || source[1] === "$" || source[1] === "")
    return;
  const closing = findClosingDollar(source);
  if (closing < 2)
    return;
  return {
    type: "inlineKatex",
    raw: source.slice(0, closing + 1),
    math: source.slice(1, closing),
    display: false
  };
}
function inlineBracketToken(source) {
  if (!source.startsWith("\\("))
    return;
  const closing = source.indexOf("\\)", 2);
  if (closing < 3 || source.slice(2, closing).includes(`
`))
    return;
  return {
    type: "inlineKatex",
    raw: source.slice(0, closing + 2),
    math: source.slice(2, closing),
    display: false
  };
}
function blockToken(source) {
  const dollar = /^(?: {0,3})\$\$[ \t]*(?:\n([\s\S]*?)\n[ \t]*\$\$|([^\n]*?)\$\$)[ \t]*(?:\n|$)/u.exec(source);
  if (dollar) {
    const math = dollar[1] ?? dollar[2] ?? "";
    if (!math.trim())
      return;
    return { type: "blockKatex", raw: dollar[0], math, display: true };
  }
  const bracket = /^(?: {0,3})\\\[[ \t]*(?:\n([\s\S]*?)\n[ \t]*\\\]|([^\n]*?)\\\])[ \t]*(?:\n|$)/u.exec(source);
  if (bracket) {
    const math = bracket[1] ?? bracket[2] ?? "";
    if (!math.trim())
      return;
    return { type: "blockKatex", raw: bracket[0], math, display: true };
  }
  return;
}
function createMarkedKatexExtensions() {
  return [
    {
      name: "blockKatex",
      level: "block",
      start(source) {
        const candidates = [source.search(/^ {0,3}\$\$/mu), source.search(/^ {0,3}\\\[/mu)].filter((index) => index >= 0);
        return candidates.length > 0 ? Math.min(...candidates) : undefined;
      },
      tokenizer(source) {
        return blockToken(source);
      },
      renderer(token) {
        const math = token;
        return `${renderMath(math.math, true)}
`;
      }
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
        const math = token;
        return renderMath(math.math, false);
      }
    }
  ];
}
function registerMarkedKatex(runtime) {
  runtime.extend.filter.register("marked:extensions", (extensions) => {
    extensions.push(...createMarkedKatexExtensions());
  });
}
if (typeof hexo !== "undefined")
  registerMarkedKatex(hexo);
