// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Docs } from "../src/components/Docs.tsx";
import { docLink, plainText } from "../src/format.ts";
import type { DocsIndex } from "../src/types.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const index: DocsIndex = {
  documents: [
    { path: "README.md", group: "root", kind: "root", title: "The project" },
    { path: "docs/alpha/next/plan.md", group: "alpha", kind: "next", title: "A plan", purpose: "**The backbone:** see [the map](../map.md) and `code`." },
    { path: "docs/alpha/reference/fees.md", group: "alpha", kind: "reference", title: "Fees" },
    { path: "docs/manual/run.md", group: "manual", kind: "manual", title: "" },
  ],
  records: ["docs/records/decisions.json", "docs/records/reports/2026-01-01/run.json"],
};

const TEXTS: Record<string, string> = {
  "docs/alpha/next/plan.md": "# A plan\n\nRead [the fees](../reference/fees.md#table), [the site](https://example.com), [the code](../../../src/main.rs) and [below](#below).\n\n| a | b |\n| --- | --- |\n| one | two |\n\n<script>window.hacked = true</script>\n",
  "docs/alpha/reference/fees.md": "# Fees\n\nThe fee table.\n",
  "docs/records/decisions.json": JSON.stringify({ schema: 1, decisions: [{ id: "A-1", text: "Decided." }], note: null }),
};

function stubServer() {
  const server = vi.fn((url: string) => {
    const path = decodeURIComponent(url.split("path=")[1] ?? "");
    const text = TEXTS[path];
    return Promise.resolve(text === undefined ? new Response(JSON.stringify({ error: `${path} does not exist` }), { status: 404 }) : new Response(JSON.stringify({ path, text })));
  });
  vi.stubGlobal("fetch", server);
  return server;
}

function Page({ docs }: { docs: DocsIndex | undefined }) {
  const [selected, select] = useState<string | null>(null);
  return <Docs index={docs} selected={selected} onSelect={select} />;
}

describe("the document links", () => {
  test("resolves a relative link against its document and leaves everything else alone", () => {
    expect(docLink("docs/alpha/next/plan.md", "../reference/fees.md#table")).toBe("docs/alpha/reference/fees.md");
    expect(docLink("docs/alpha/README.md", "./next/plan.md")).toBe("docs/alpha/next/plan.md");
    expect(docLink("docs/README.md", "records/ledger.json")).toBe("docs/records/ledger.json");
    expect(docLink("docs/alpha/next/plan.md", "https://example.com/a.md")).toBeNull();
    expect(docLink("docs/alpha/next/plan.md", "#below")).toBeNull();
    expect(docLink("docs/alpha/next/plan.md", "../../../src/main.rs")).toBeNull();
    expect(docLink("docs/alpha/next/plan.md", "/etc/a.md")).toBeNull();
  });

  test("turns a purpose's Markdown into plain words", () => {
    expect(plainText("**The backbone:** see [the map](../map.md) and `code`.")).toBe("The backbone: see the map and code.");
  });
});

describe("the docs page", () => {
  test("shows a skeleton while loading and says how to fill an empty map", () => {
    render(<Page docs={undefined} />);
    expect(screen.getByLabelText("Docs")).toHaveAttribute("aria-busy", "true");
    cleanup();
    render(<Page docs={{ documents: [], records: [] }} />);
    expect(screen.getByText(/No document map yet/)).toBeInTheDocument();
    expect(screen.getByText("tally import documents")).toBeInTheDocument();
  });

  test("lists the documents by group with their kind and purpose, then the records", () => {
    render(<Page docs={index} />);
    const list = screen.getByLabelText("Documents");
    expect(within(list).getByRole("heading", { name: "alpha" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Records" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /A plan/ })).toHaveTextContent("The backbone: see the map and code.");
    expect(within(list).getByRole("button", { name: /Fees/ })).toHaveTextContent("reference");
    expect(within(list).getByRole("button", { name: /docs\/manual\/run\.md/ })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "reports/2026-01-01/run.json" })).toBeInTheDocument();
    expect(screen.getByText(/Choose a document/)).toBeInTheDocument();
  });

  test("renders a document's Markdown and tables, and never its raw HTML", async () => {
    stubServer();
    render(<Page docs={index} />);
    fireEvent.click(screen.getByRole("button", { name: /A plan/ }));
    const reader = await screen.findByRole("article");
    expect(within(reader).getByRole("heading", { level: 1, name: "A plan" })).toBeInTheDocument();
    expect(within(reader).getByRole("table")).toHaveTextContent("two");
    expect(reader.querySelector("script")).toBeNull();
    expect(screen.getByLabelText("Docs")).toHaveClass("reading");
    expect(screen.getByRole("button", { name: /A plan/ })).toHaveAttribute("aria-current", "true");
  });

  test("follows a link to another document in place, opens the web in a new tab, and leaves source paths as text", async () => {
    const server = stubServer();
    render(<Page docs={index} />);
    fireEvent.click(screen.getByRole("button", { name: /A plan/ }));
    const reader = await screen.findByRole("article");
    expect(within(reader).getByRole("link", { name: "the site" })).toHaveAttribute("target", "_blank");
    expect(within(reader).getByRole("link", { name: "the site" })).toHaveAttribute("rel", "noreferrer");
    expect(within(reader).queryByRole("link", { name: "the code" })).toBeNull();
    expect(within(reader).getByText("the code")).toBeInTheDocument();
    fireEvent.click(within(reader).getByRole("link", { name: "the fees" }));
    expect(await screen.findByText("The fee table.")).toBeInTheDocument();
    expect(server).toHaveBeenLastCalledWith(`/api/docs/read?path=${encodeURIComponent("docs/alpha/reference/fees.md")}`);
  });

  test("shows a record as a tree whose branches open on demand", async () => {
    stubServer();
    render(<Page docs={index} />);
    fireEvent.click(screen.getByRole("button", { name: "decisions.json" }));
    const reader = await screen.findByRole("article");
    expect(within(reader).getByText("schema")).toBeInTheDocument();
    expect(within(reader).getByText("1 item")).toBeInTheDocument();
    expect(within(reader).queryByText("A-1")).toBeNull();
    const branch = within(reader).getByText("decisions").closest("details")!;
    branch.open = true;
    fireEvent(branch, new Event("toggle"));
    await waitFor(() => expect(within(reader).getByText("A-1")).toBeInTheDocument());
  });

  test("says what went wrong when a document cannot be read, and goes back to the list", async () => {
    stubServer();
    render(<Page docs={index} />);
    fireEvent.click(screen.getByRole("button", { name: /Fees/ }));
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button", { name: "All documents" }));
    expect(screen.getByLabelText("Docs")).not.toHaveClass("reading");
    fireEvent.click(screen.getByRole("button", { name: /docs\/manual\/run\.md/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("docs/manual/run.md does not exist");
  });
});
