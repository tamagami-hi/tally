import { Badge, Flex, Text } from "@radix-ui/themes";
import { ArrowRightIcon, CheckIcon } from "@radix-ui/react-icons";
import { color, percent, splitNote, tone } from "../format.ts";
import type { MilestoneRow, StatusData } from "../types.ts";
import { Progress } from "./Progress.tsx";

function Milestone({ row }: { row: MilestoneRow }) {
  const t = tone(row.share);
  const tracks = row.track.split("+");
  return (
    <li className={`milestone ${t}`}>
      <div className="milestone-name">
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="2" weight="bold" className="mono">{row.id}</Text>
          <Text size="2" weight={t === "active" ? "medium" : "regular"} color={t === "idle" ? "gray" : undefined}>{row.name}</Text>
          {t === "done" ? <CheckIcon aria-label="built" className="done-mark" /> : null}
        </Flex>
        <Flex gap="1" wrap="wrap" mt="1">
          {tracks.map((track) => (
            <Badge key={track} color="gray" variant="surface" size="1" radius="medium">{track}</Badge>
          ))}
        </Flex>
      </div>
      <ul className="milestone-notes">
        {row.notes.filter((note) => !(row.built !== undefined && note === "built")).map((note) => {
          const { kind, text } = splitNote(note);
          return (
            <li key={note} className={`note ${kind}`} title={text}>
              {kind === "waits" ? <ArrowRightIcon aria-hidden="true" /> : null}
              <Text size="1" color={kind === "next" ? undefined : "gray"} className="note-text">{kind === "next" ? "next: " : ""}{text}</Text>
            </li>
          );
        })}
      </ul>
      <div className="milestone-done">
        <Progress share={row.share} label={`${row.id} ${row.name}`} />
        <Text size="1" color="gray" className="mono count">{row.count === null ? (row.built === undefined ? "" : "built") : `${row.count[0]}/${row.count[1]}`}</Text>
      </div>
    </li>
  );
}

export function Board({ status }: { status: StatusData }) {
  return (
    <section className="board" aria-label="Board">
      {status.stages.map((stage) => {
        const rows = status.rows.filter((row) => row.stage === stage.id);
        const share = status.stagePct[stage.id] ?? 0;
        return (
          <div key={stage.id} className="stage">
            <Flex align="baseline" justify="between" className="stage-head">
              <Flex align="baseline" gap="2">
                <Text size="3" weight="bold">Stage {stage.id}</Text>
                <Text size="2" color="gray">{stage.name}</Text>
              </Flex>
              <Badge color={color[tone(share)]} variant="soft" radius="medium" className="mono">{percent(share)}</Badge>
            </Flex>
            <ul className="milestones">
              {rows.map((row) => <Milestone key={row.id} row={row} />)}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
