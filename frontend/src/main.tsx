import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Ensure zero data in web localStorage / sessionStorage
try {
  if (typeof window !== "undefined") {
    window.localStorage?.clear();
    window.sessionStorage?.clear();
  }
} catch {}

// Prevent default context menu
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Prevent touch gestures and pinch zoom
document.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  },
  { passive: false }
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  },
  { passive: false }
);

// Prevent webkit gesture zooming
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());
document.addEventListener("gestureend", (e) => e.preventDefault());

// Prevent ctrl+wheel zoom
document.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  },
  { passive: false }
);

// Prevent keyboard zoom shortcuts
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (
      e.key === "+" ||
      e.key === "-" ||
      e.key === "=" ||
      e.key === "0" ||
      e.key === "_" ||
      e.code === "NumpadAdd" ||
      e.code === "NumpadSubtract" ||
      e.code === "Digit0" ||
      e.code === "Minus" ||
      e.code === "Equal"
    ) {
      e.preventDefault();
    }
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

