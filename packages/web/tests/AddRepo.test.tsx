// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AddRepo, type AddRepoProps } from "../src/components/AddRepo.tsx";
import type { FolderListing } from "../src/types.ts";

afterEach(cleanup);

const listing: FolderListing = {
  dir: "/work/projects",
  parent: "/work",
  folders: [
    { name: "tracked", path: "/work/projects/tracked", isRepo: true, hasRecords: true, listed: null },
    { name: "fresh", path: "/work/projects/fresh", isRepo: true, hasRecords: false, listed: null },
    { name: "known", path: "/work/projects/known", isRepo: true, hasRecords: true, listed: "alpha" },
    { name: "notes", path: "/work/projects/notes", isRepo: false, hasRecords: false, listed: null },
  ],
};

function draw(overrides: Partial<AddRepoProps> = {}) {
  const props: AddRepoProps = { listing, error: null, busy: false, onOpen: vi.fn(), onAdd: vi.fn(), onClose: vi.fn(), ...overrides };
  render(<AddRepo {...props} />);
  return props;
}

describe("adding a repository", () => {
  test("shows the folder it is in and goes up to its parent", () => {
    const props = draw();

    expect(screen.getByText("/work/projects")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Up to /work" }));

    expect(props.onOpen).toHaveBeenCalledWith("/work");
  });

  test("cannot go above the workspace", () => {
    draw({ listing: { ...listing, parent: null } });

    expect(screen.queryByRole("button", { name: /^Up to/ })).toBeNull();
  });

  test("opens a folder that is not a repository", () => {
    const props = draw();

    fireEvent.click(screen.getByRole("button", { name: "Open notes" }));

    expect(props.onOpen).toHaveBeenCalledWith("/work/projects/notes");
  });

  test("adds a repository under the name typed, or under its folder's name", () => {
    const props = draw();

    fireEvent.click(screen.getByRole("button", { name: "Add tracked" }));
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Add fresh" }));

    expect(props.onAdd).toHaveBeenNthCalledWith(1, "/work/projects/tracked", "");
    expect(props.onAdd).toHaveBeenNthCalledWith(2, "/work/projects/fresh", "mine");
  });

  test("says which repositories tally will start tracking, and which are listed already", () => {
    draw();

    expect(screen.getByText("tally will start its records")).toBeInTheDocument();
    expect(screen.getByText("listed as alpha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add known" })).toBeNull();
  });

  test("shows why an add was refused", () => {
    draw({ error: "the name mine is taken by /work/other" });

    expect(screen.getByRole("alert")).toHaveTextContent("the name mine is taken by /work/other");
  });

  test("waits while a folder is read or an add is in flight", () => {
    draw({ listing: undefined });
    expect(screen.getByText("Reading the folder…")).toBeInTheDocument();
    cleanup();

    draw({ busy: true });
    expect(screen.getByRole("button", { name: "Add tracked" })).toBeDisabled();
  });

  test("closes", () => {
    const props = draw();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
