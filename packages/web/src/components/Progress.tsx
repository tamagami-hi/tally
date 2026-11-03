import { Flex, Progress as RadixProgress, Text } from "@radix-ui/themes";
import { color, percent, tone } from "../format.ts";

interface ProgressProps {
  share: number;
  label?: string;
  size?: "1" | "2" | "3";
  width?: string;
}

export function Progress({ share, label, size = "2", width = "100%" }: ProgressProps) {
  const t = tone(share);
  return (
    <Flex align="center" gap="3" style={{ width }} aria-label={label === undefined ? undefined : `${label} ${percent(share)}`}>
      <RadixProgress value={Math.round(share * 100)} size={size} color={color[t]} variant="soft" style={{ flex: 1 }} />
      <Text size={size === "3" ? "4" : "2"} weight="medium" className="mono" style={{ minWidth: "3.2em", textAlign: "right" }} color={t === "idle" ? "gray" : undefined}>
        {percent(share)}
      </Text>
    </Flex>
  );
}
