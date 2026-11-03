import { Theme } from "@radix-ui/themes";
import { useLayout, useScheme, useSnapshot } from "./live.ts";
import { Shell } from "./Shell.tsx";

export function App() {
  const { snapshot, error, live, retry } = useSnapshot();
  const layout = useLayout();
  const [scheme, toggleScheme] = useScheme();
  return (
    <Theme appearance={scheme} accentColor="indigo" grayColor="slate" radius="medium" scaling="100%" panelBackground="solid">
      <Shell snapshot={snapshot} error={error} live={live} layout={layout} scheme={scheme} onToggleScheme={toggleScheme} onRetry={retry} />
    </Theme>
  );
}
