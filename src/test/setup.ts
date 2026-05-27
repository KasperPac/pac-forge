import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// Radix UI primitives call hasPointerCapture / scrollIntoView which are not
// implemented in jsdom. Stub them so Select / Popover interactions don't throw.
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
}
