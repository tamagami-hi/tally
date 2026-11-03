import { Badge, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { MoonIcon, SunIcon } from "@radix-ui/react-icons";
import type { Layout, Live, StatusData } from "../types.ts";
import type { Scheme } from "../live.ts";
import { Progress } from "./Progress.tsx";

interface HeaderProps {
  status: StatusData;
  live: Live;
  layout: Layout;
  scheme: Scheme;
  onToggleScheme: () => void;
}

const LIVE: Record<Live, { label: string; color: "grass" | "amber" | "gray" }> = {
  connected: { label: "live", color: "grass" },
  reconnecting: { label: "reconnecting", color: "amber" },
  offline: { label: "offline", color: "gray" },
};

export function Header({ status, live, layout, scheme, onToggleScheme }: HeaderProps) {
  const state = LIVE[live];
  const pushed = status.origin === null ? "no origin" : status.unpushed > 0 ? `${status.unpushed} unpushed` : "all pushed";
  return (
    <header className={`header ${layout}`}>
      <Flex align="baseline" gap="3" className="header-title">
        <Heading size={layout === "portrait" ? "5" : "6"} trim="both">{status.name}</Heading>
        <Text size="2" color="gray">build status</Text>
        <Badge color={state.color} variant="soft" radius="full" size="1" className={`live ${live}`}>
          <span className="live-dot" aria-hidden="true" />
          {state.label}
        </Badge>
        <IconButton variant="ghost" color="gray" size="1" aria-label={scheme === "dark" ? "Switch to light" : "Switch to dark"} onClick={onToggleScheme} style={{ marginLeft: "auto" }}>
          {scheme === "dark" ? <SunIcon /> : <MoonIcon />}
        </IconButton>
      </Flex>
      <div className="header-overall">
        <Flex align="baseline" justify="between">
          <Text size="2" weight="medium">Overall</Text>
          <Text size="1" color="gray" className="mono">{status.time}</Text>
        </Flex>
        <Progress share={status.overall} size="3" label="Overall" />
      </div>
      <div className="header-stages">
        {status.stages.map((stage) => (
          <div key={stage.id} className="stage-line">
            <Text size="1" weight="medium" className="stage-id">Stage {stage.id}</Text>
            <Progress share={status.stagePct[stage.id] ?? 0} size="1" label={`Stage ${stage.id}`} />
            <Text size="1" color="gray" className="stage-name" truncate>{stage.name}</Text>
          </div>
        ))}
      </div>
      <div className="header-git">
        <Text size="1" color="gray" truncate title={status.main}><span className="mono">main {status.main.slice(0, 7)}</span> {status.main.slice(8)}</Text>
        <Text size="1" color={status.unpushed > 0 ? "amber" : "gray"}>{pushed}</Text>
        <Text size="1" color="gray">{status.today} commits today</Text>
      </div>
    </header>
  );
}
