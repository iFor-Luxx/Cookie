import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { installErrorReporter } from "./lib/error-report";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

installErrorReporter();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
