import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { docLink } from "../format.ts";
import { JsonView } from "./JsonView.tsx";

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;
const PLUGINS = [remarkGfm];

type Loaded = { path: string; text: string } | { path: string; failed: string };

async function fetchDocument(path: string): Promise<Loaded> {
  try {
    const response = await fetch(`/api/docs/read?path=${encodeURIComponent(path)}`);
    const body = (await response.json()) as { text?: string; error?: string };
    return body.text === undefined ? { path, failed: body.error ?? `the server answered ${response.status}` } : { path, text: body.text };
  } catch (error: unknown) {
    return { path, failed: error instanceof Error ? error.message : String(error) };
  }
}

function useDocument(path: string): Loaded | undefined {
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void fetchDocument(path).then((result) => {
      if (current) setLoaded(result);
    });
    return () => {
      current = false;
    };
  }, [path]);
  return loaded?.path === path ? loaded : undefined;
}

function linksFrom(path: string, onSelect: (path: string) => void): Components {
  return {
    a: ({ href, children }) => {
      const target = href === undefined ? null : docLink(path, href);
      if (target !== null) {
        return <a href={`#${target}`} onClick={(event) => { event.preventDefault(); onSelect(target); }}>{children}</a>;
      }
      if (href === undefined || !EXTERNAL.test(href)) return <span>{children}</span>;
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
    },
  };
}

interface DocReaderProps {
  path: string;
  onSelect: (path: string | null) => void;
}

export function DocReader({ path, onSelect }: DocReaderProps) {
  const loaded = useDocument(path);
  return (
    <div className="doc-reader" key={path}>
      <div className="doc-head">
        <button type="button" className="docs-back" onClick={() => onSelect(null)}><ArrowLeftIcon aria-hidden="true" />All documents</button>
        <span className="mono faint truncate" title={path}>{path}</span>
      </div>
      {loaded === undefined ? <div className="skeleton evidence-skeleton" aria-busy="true" /> : null}
      {loaded !== undefined && "failed" in loaded ? <p className="log-failed" role="alert">{loaded.failed}</p> : null}
      {loaded !== undefined && "text" in loaded ? (
        <article className="doc-body">
          {path.endsWith(".json") ? <JsonView text={loaded.text} /> : <Markdown remarkPlugins={PLUGINS} components={linksFrom(path, onSelect)}>{loaded.text}</Markdown>}
        </article>
      ) : null}
    </div>
  );
}
