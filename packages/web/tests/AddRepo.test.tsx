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

describe("the panel for adding a repository", () => {
  test("is a dialog that floats over the page, whatever is open behind it", () => {
    draw();

    const dialog = screen.getByRole("dialog", { name: "Add a repository" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement).toHaveClass("overlay");
  });

  test("closes on Escape, and when the page behind it is pressed, and not when the panel itself is", () => {
    const props = draw();
    const dialog = screen.getByRole("dialog", { name: "Add a repository" });

    fireEvent.mouseDown(dialog);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement ?? dialog);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  test("takes the focus when it opens and gives it back when it closes", () => {
    render(<button type="button">Add repository</button>);
    const opener = screen.getByRole("button", { name: "Add repository" });
    opener.focus();

    const props: AddRepoProps = { listing, error: null, busy: false, onOpen: vi.fn(), onAdd: vi.fn(), onClose: vi.fn() };
    const drawn = render(<AddRepo {...props} />);
    const heldInside = screen.getByRole("dialog", { name: "Add a repository" }).contains(document.activeElement);
    drawn.unmount();

    expect(heldInside).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  test("keeps Tab inside itself: from the last control to the first, and back", () => {
    draw();
    const dialog = screen.getByRole("dialog", { name: "Add a repository" });
    const controls = [...dialog.querySelectorAll<HTMLElement>("button, input")];
    const first = controls[0];
    const last = controls.at(-1);

    last?.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    const afterLast = document.activeElement;
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(afterLast).toBe(first);
    expect(document.activeElement).toBe(last);
  });
});

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
