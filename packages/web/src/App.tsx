import { useEffect } from "react";
import { useLayout, useScheme, useSnapshot } from "./live.ts";
import { Shell } from "./Shell.tsx";

export function App() {
  const { snapshot, error, live, retry } = useSnapshot();
  const layout = useLayout();
  const [scheme, toggleScheme] = useScheme();
  useEffect(() => {
    document.documentElement.dataset["theme"] = scheme;
  }, [scheme]);
  return <Shell snapshot={snapshot} error={error} live={live} layout={layout} scheme={scheme} onToggleScheme={toggleScheme} onRetry={retry} />;
}
