import { useState } from "react";

const LABEL_KEYS = ["id", "row", "path", "milestone", "name", "title"];

interface Entry {
  key: string;
  name: string;
  value: unknown;
}

function itemName(value: unknown, index: number): string {
  if (typeof value !== "object" || value === null) return String(index);
  const key = LABEL_KEYS.find((candidate) => candidate in value);
  return key === undefined ? String(index) : String((value as Record<string, unknown>)[key]);
}

function entriesOf(value: object): Entry[] {
  if (Array.isArray(value)) return value.map((item: unknown, index) => ({ key: String(index), name: itemName(item, index), value: item }));
  return Object.entries(value).map(([key, item]: [string, unknown]) => ({ key, name: key, value: item }));
}

function sizeText(value: object): string {
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  const noun = Array.isArray(value) ? "item" : "field";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function Field({ name, value }: { name: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (typeof value !== "object" || value === null) {
    return (
      <div className="json-leaf">
        <span className="json-key">{name}</span>
        <span className="json-value">{String(value)}</span>
      </div>
    );
  }
  return (
    <details className="json-branch" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span className="json-key">{name}</span> <span className="faint">{sizeText(value)}</span></summary>
      {open ? <div className="json-children">{entriesOf(value).map((entry) => <Field key={entry.key} name={entry.name} value={entry.value} />)}</div> : null}
    </details>
  );
}

export function JsonView({ text }: { text: string }) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return <pre className="json">{text}</pre>;
  }
  if (typeof value !== "object" || value === null) return <pre className="json">{text}</pre>;
  return <div className="json">{entriesOf(value).map((entry) => <Field key={entry.key} name={entry.name} value={entry.value} />)}</div>;
}
