import { Badge, Flex, Text } from "@radix-ui/themes";
import type { StatusData, TrackRow } from "../types.ts";

function Files({ track }: { track: TrackRow }) {
  if (track.files.length === 0) return null;
  return (
    <details className="files">
      <summary>
        <Text size="1" color="amber">{track.dirty} {track.dirty === 1 ? "file" : "files"} open</Text>
      </summary>
      <ul>
        {track.files.map((file) => (
          <li key={file.path} className="file">
            <Text size="1" className="mono status">{file.status}</Text>
            <Text size="1" className="mono path" truncate title={file.path}>{file.path}</Text>
            <Text size="1" className="mono diff" color="gray">{file.add === "" ? "" : `+${file.add} -${file.del}`}</Text>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Track({ track }: { track: TrackRow }) {
  return (
    <li className={`track ${track.isMain ? "main" : ""}`}>
      <Flex align="baseline" gap="2" wrap="wrap">
        <Text size="3" weight="bold">{track.track}</Text>
        <Text size="1" color="gray" className="mono">{track.head}</Text>
        <Text size="1" color="gray" style={{ marginLeft: "auto" }}>{track.when}</Text>
      </Flex>
      <Text size="2" color="gray" truncate title={track.subject} className="subject">{track.subject}</Text>
      <Flex gap="2" align="center" wrap="wrap" mt="2">
        {track.isMain ? null : (
          <Badge color={track.ahead > 0 ? "amber" : "gray"} variant="soft" size="1" className="mono">+{track.ahead} / -{track.behind}</Badge>
        )}
        {track.worktree ? (
          track.dirty === 0 ? <Badge color="grass" variant="soft" size="1">clean</Badge> : <Files track={track} />
        ) : (
          <Badge color="gray" variant="outline" size="1">no worktree</Badge>
        )}
      </Flex>
    </li>
  );
}

export function Tracks({ status }: { status: StatusData }) {
  return (
    <section className="tracks" aria-label="Tracks">
      <ul>
        {status.tracks.map((track) => <Track key={track.branch} track={track} />)}
      </ul>
    </section>
  );
}
