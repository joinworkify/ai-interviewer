import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("not-found page", () => {
  it("renders a 404 with links back into the app", () => {
    const html = renderToStaticMarkup(createElement(NotFound));

    expect(html).toContain("404 — Page not found");
    expect(html).toContain('href="/candidate/roles"');
    expect(html).toContain('href="/"');
  });
});
