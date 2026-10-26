import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { parseDesktopReleaseChannel } from "../../../Apps/Desktop/DesktopReleaseChannel.ts";
import { DesktopReleaseChannelBadge } from "../../../Frontend/src/app/DesktopReleaseChannelBadge.tsx";
import { resolveDesktopReleaseChannel } from "../../../Frontend/src/app/desktopReleaseChannel.ts";

test("only an explicit launcher marker enables the development channel", () => {
  expect(parseDesktopReleaseChannel("development")).toBe("development");
  expect(parseDesktopReleaseChannel(" Development ")).toBe("development");
  expect(parseDesktopReleaseChannel("production")).toBe("production");
  expect(parseDesktopReleaseChannel(undefined)).toBe("production");
  expect(parseDesktopReleaseChannel("")).toBe("production");
});

test("the renderer only marks the surfaces whose document URL carries the channel", () => {
  expect(resolveDesktopReleaseChannel("?releaseChannel=development")).toBe("development");
  expect(resolveDesktopReleaseChannel("?surface=settings&releaseChannel=development")).toBe("development");
  expect(resolveDesktopReleaseChannel("?releaseChannel=production")).toBe("production");
  expect(resolveDesktopReleaseChannel("")).toBe("production");
});

describe("desktop release channel badge", () => {
  afterEach(() => {
    cleanup();
    delete window.seneraDesktop;
    window.history.replaceState({}, "", "/");
  });

  test("marks the surface of a development desktop window", () => {
    window.history.replaceState({}, "", "/?releaseChannel=development");
    window.seneraDesktop = { isDesktop: true };

    expect(renderBadge()).toBe(true);
  });

  test("stays hidden on a production desktop window", () => {
    window.history.replaceState({}, "", "/");
    window.seneraDesktop = { isDesktop: true };

    expect(renderBadge()).toBe(false);
  });

  test("stays hidden in web mode even when the URL asks for the development channel", () => {
    window.history.replaceState({}, "", "/?releaseChannel=development");

    expect(renderBadge()).toBe(false);
  });
});

function renderBadge() {
  const { container } = render(React.createElement(DesktopReleaseChannelBadge));
  return container.querySelector("[data-desktop-release-channel-badge]") !== null;
}
