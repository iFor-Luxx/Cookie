import { useEffect, useState } from "react";

/** Sigue `(prefers-color-scheme: dark)` en vivo (misma fuente que `.dark`). */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return dark;
}
