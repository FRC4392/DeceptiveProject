import "@testing-library/jest-dom/vitest";

// jsdom implements no Pointer Events API and no scrolling, and Radix's Select
// uses both the moment it opens. Without these three, any test that clicks a
// dropdown dies on `target.hasPointerCapture is not a function` rather than on
// anything to do with the component. Narrow, standard stand-ins.
//
// Guarded on `Element` existing at all: this file is the setup for every
// environment, and the Convex tests run on edge-runtime, where there is no DOM.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
