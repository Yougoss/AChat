import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ProjectSelector } from "../../src/components/ProjectSelector.tsx";

test("offers only the registered project roots supplied to the selector", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectSelector, {
    projects: [{
      id: "registered-project",
      name: "AChat",
      rootPath: "/work/achat",
    }],
    value: "registered-project",
    onChange() {},
  }));

  assert.match(html, /Choose a registered project/);
  assert.match(html, /AChat — \/work\/achat/);
  assert.doesNotMatch(html, /unregistered|\/tmp/i);
});

test("links to project registration from task selection when no projects are registered", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectSelector, {
    projects: [],
    value: "",
    onChange() {},
  }));

  assert.match(html, /Register a project/);
  assert.match(html, /href="\/settings\/projects"/);
  assert.doesNotMatch(html, /Choose a registered project/);
});
