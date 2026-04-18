import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";

function applyOsClass() {
  const htmlElement = document.documentElement;
  const uaPlatform = navigator.platform;
  const normalizedPlatform = uaPlatform.toLowerCase();

  htmlElement.classList.remove("os-mac", "os-windows");

  if (normalizedPlatform.includes("mac")) {
    htmlElement.classList.add("os-mac");
    return;
  }

  if (normalizedPlatform.includes("win")) {
    htmlElement.classList.add("os-windows");
  }
}

applyOsClass();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
