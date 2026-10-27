import { describe, expect, test } from "bun:test";
import { Marked } from "marked";

import {
  createMarkedKatexExtensions,
  POST_KATEX_OPTIONS,
} from "../plugins/marked-katex.ts";

function render(markdown: string): string {
  return new Marked({ extensions: createMarkedKatexExtensions() }).parse(markdown) as string;
}

describe("marked KaTeX extension", () => {
  test("renders inline mathematics with accessible HTML", () => {
    const html = render("中文 $w_{t+1}=w_t-\\eta\\nabla L(w_t)$, then $\\frac{a}{b}$.");
    expect(html.match(/class="katex"/gu)).toHaveLength(2);
    expect(html).toContain("<math");
    expect(html).toContain("η");
  });

  test("renders multiline display environments and bracket aliases", () => {
    const html = render(String.raw`Before

$$
\begin{aligned}
x &= \sum_{i=1}^{n} i \\
y &= \int_0^1 t^2\,dt
\end{aligned}
$$

\[
\begin{cases}a & x > 0 \\ b & x \le 0\end{cases}
\]

After`);
    expect(html.match(/class="katex-display"/gu)).toHaveLength(2);
    expect(html).toContain("∑");
    expect(html).toContain("∫");
  });

  test("renders supported matrix, cases, limit and nested display structures", () => {
    const html = render(String.raw`$$
\begin{matrix}1&2\\3&4\end{matrix}\quad
\begin{pmatrix}a&b\\c&d\end{pmatrix}\quad
\begin{bmatrix}x&y\\z&w\end{bmatrix}
$$

- display in a list

  $$
  \lim_{n\to\infty}\sum_{i=1}^{n}\frac{1}{i^2}
  $$

> $$
> \int_0^1 x^2\,dx
> $$`);
    expect(html.match(/class="katex-display"/gu)).toHaveLength(3);
    expect(html).toContain("pmatrix");
    expect(html).toContain("bmatrix");
    expect(html).toContain("lim");
  });

  test("keeps code, links, images and currency out of mathematics", () => {
    const html = render([
      String.raw`USD $5 and $10; $5 to $10; pay \$5, but $x$ costs \$5.`,
      "",
      "`$inline$`",
      "",
      "```sh",
      `echo '$code' && echo "$10"`,
      "```",
      "",
      `[price](https://example.test/$5 "cost $5")`,
      "",
      "![cost $5](https://example.test/image-$5.png)",
    ].join("\n"));
    expect(html.match(/class="katex"/gu)).toHaveLength(1);
    expect(html).toContain("USD $5 and $10; $5 to $10; pay $5");
    expect(html).toContain("<code>$inline$</code>");
    expect(html).toContain("echo &#39;$code&#39;");
    expect(html).toContain('href="https://example.test/$5"');
    expect(html).toContain('src="https://example.test/image-$5.png"');
  });

  test("supports aliases, tables, lists and blockquotes without changing Markdown", () => {
    const html = render(String.raw`| value | note |
| --- | --- |
| \(x^2\) | \$5 |

- item $E=mc^2$

> quote $\alpha+\beta$`);
    expect(html).toContain("<table>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<blockquote>");
    expect(html.match(/class="katex"/gu)).toHaveLength(3);
    expect(html).toContain("$5");
  });

  test("leaves unclosed delimiters and Unicode mathematics readable", () => {
    const html = render("Unclosed $x and plain ∑ α ≤ β.");
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("Unclosed $x and plain ∑ α ≤ β.");
  });

  test("fails the post build with a traceable invalid formula", () => {
    expect(() => render("Broken $\\frac{1}$ formula.")).toThrow("KaTeX could not render inline math");
    expect(() => render(String.raw`$\notACyberlCommand{x}$`)).toThrow();
  });

  test("keeps untrusted features disabled and resource limits finite", () => {
    expect(POST_KATEX_OPTIONS.trust).toBeFalse();
    expect(POST_KATEX_OPTIONS.maxSize).toBe(20);
    expect(POST_KATEX_OPTIONS.maxExpand).toBe(1000);
    for (const source of [
      String.raw`$\href{javascript:alert(1)}{x}$`,
      String.raw`$\includegraphics{https://example.test/x.png}$`,
      String.raw`$\htmlClass{bad}{x}$`,
    ]) {
      const html = render(source);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("<img");
      expect(html).not.toContain('class="bad"');
      expect(html).toContain("#cc0000");
    }
  });

  test("supports local macros without sharing definitions across formulas", () => {
    const html = render(String.raw`$\def\cyberlreal{\mathbb{R}}\cyberlreal$`);
    expect(html).toContain('mathvariant="double-struck"');
    expect(() => render(String.raw`$\cyberlreal$`)).toThrow();
  });

  test("caps dimensions and rejects runaway macro expansion", () => {
    const html = render(String.raw`$\rule{500em}{500em}$`);
    expect(html).toContain('width="20em"');
    expect(html).toContain('height="20em"');
    expect(html).not.toContain('style="border-right-width:500em');
    expect(() => render(String.raw`$\def\loop{\loop}\loop$`)).toThrow();
  });
});
