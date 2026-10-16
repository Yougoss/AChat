import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ProviderAuthControls } from "../../src/components/ProviderAuthControls.tsx";

test("renders explicit provider authentication state and sign-in controls", () => {
  const html = renderToStaticMarkup(React.createElement(ProviderAuthControls, {
    providers: [{
      providerId: "github-copilot",
      name: "GitHub Copilot",
      authState: "unauthenticated",
    }],
  }));

  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Not connected/);
  assert.match(html, /Sign in to GitHub Copilot/);
});

test("renders a provider sign-out control when authenticated", () => {
  const html = renderToStaticMarkup(React.createElement(ProviderAuthControls, {
    providers: [{
      providerId: "github-copilot",
      name: "GitHub Copilot",
      authState: "authenticated",
    }],
  }));

  assert.match(html, /Connected/);
  assert.match(html, /Sign out of GitHub Copilot/);
});

test("only renders GitHub Copilot authentication controls in the POC", () => {
  const html = renderToStaticMarkup(React.createElement(ProviderAuthControls, {
    providers: [
      {
        providerId: "github-copilot",
        name: "GitHub Copilot",
        authState: "unauthenticated",
      },
      {
        providerId: "anthropic",
        name: "Anthropic",
        authState: "authenticated",
      },
    ],
  }));

  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Sign in to GitHub Copilot/);
  assert.doesNotMatch(html, /Anthropic|Sign out of Anthropic/);
});
