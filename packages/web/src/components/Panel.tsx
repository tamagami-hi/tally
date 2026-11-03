import { Flex, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  detail?: string;
  area: string;
  children: ReactNode;
}

export function Panel({ title, detail, area, children }: PanelProps) {
  return (
    <section className={`panel panel-${area}`}>
      <Flex align="baseline" gap="2" className="panel-head">
        <Text size="2" weight="bold">{title}</Text>
        {detail === undefined ? null : <Text size="1" color="gray">{detail}</Text>}
      </Flex>
      <div className="panel-body">{children}</div>
    </section>
  );
}
