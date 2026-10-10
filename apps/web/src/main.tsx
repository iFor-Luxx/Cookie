import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { installErrorReporter } from "./lib/error-report";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// Banco visual dev-only (plan F3): `#/lab` en desarrollo. Lazy para que
// no entre en el bundle de producción (APK offline).
const BrushLab = lazy(() =>
  import("./components/canvas/BrushLab").then((m) => ({ default: m.BrushLab })),
);
const isLab = import.meta.env.DEV && window.location.hash === "#/lab";

installErrorReporter();
createRoot(root).render(
  <StrictMode>
    {isLab ? (
      <Suspense fallback={null}>
        <BrushLab />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
