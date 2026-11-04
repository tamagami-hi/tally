import { InfoCircledIcon } from "@radix-ui/react-icons";
import { plainText } from "../format.ts";
import type { DocsIndex, DocumentRow } from "../types.ts";
import { DocReader } from "./DocReader.tsx";

interface DocsProps {
  index: DocsIndex | undefined;
  selected: string | null;
  onSelect: (path: string | null) => void;
}

interface EntryProps {
  path: string;
  name: string;
  kind?: string;
  purpose?: string | undefined;
  selected: string | null;
  onSelect: (path: string) => void;
}

function Entry({ path, name, kind, purpose, selected, onSelect }: EntryProps) {
  return (
    <li>
      <button type="button" className="docs-entry" aria-current={selected === path ? "true" : undefined} title={path} onClick={() => onSelect(path)}>
        <span className="docs-name">
          <span className="truncate">{name}</span>
          {kind === undefined ? null : <span className="chip chip-line">{kind}</span>}
        </span>
        {purpose === undefined ? null : <span className="docs-purpose">{plainText(purpose)}</span>}
      </button>
    </li>
  );
}

function byGroup(documents: DocumentRow[]): [string, DocumentRow[]][] {
  const groups = new Map<string, DocumentRow[]>();
  for (const document of documents) groups.set(document.group, [...(groups.get(document.group) ?? []), document]);
  return [...groups];
}

export function Docs({ index, selected, onSelect }: DocsProps) {
  if (index === undefined) return <section className="docs" aria-label="Docs" aria-busy="true"><div className="skeleton evidence-skeleton" /></section>;
  if (index.documents.length === 0 && index.records.length === 0) {
    return (
      <section className="docs-empty" aria-label="Docs">
        <div className="empty">
          <InfoCircledIcon aria-hidden="true" />
          <p><b>No document map yet.</b> Run <span className="mono">tally import documents</span> in the repository to list its documents here.</p>
        </div>
      </section>
    );
  }
  return (
    <section className={selected === null ? "docs" : "docs reading"} aria-label="Docs">
      <nav className="docs-list" aria-label="Documents">
        {byGroup(index.documents).map(([group, documents]) => (
          <div key={group} className="docs-group">
            <h3>{group}</h3>
            <ul>{documents.map((d) => <Entry key={d.path} path={d.path} name={d.title === "" ? d.path : d.title} kind={d.kind} purpose={d.purpose} selected={selected} onSelect={onSelect} />)}</ul>
          </div>
        ))}
        {index.records.length === 0 ? null : (
          <div className="docs-group">
            <h3>Records</h3>
            <ul>{index.records.map((path) => <Entry key={path} path={path} name={path.replace(/^.*?records\//, "")} selected={selected} onSelect={onSelect} />)}</ul>
          </div>
        )}
      </nav>
      {selected === null
        ? <div className="doc-reader"><div className="empty"><InfoCircledIcon aria-hidden="true" /><p>Choose a document to read it here.</p></div></div>
        : <DocReader path={selected} onSelect={onSelect} />}
    </section>
  );
}
