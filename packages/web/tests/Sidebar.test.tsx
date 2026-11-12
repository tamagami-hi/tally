// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Sidebar, type SidebarProps } from "../src/components/Sidebar.tsx";
import { index } from "./repos-fixture.ts";

afterEach(cleanup);

function draw(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = { index, current: "alpha", collapsed: false, onToggle: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onDefault: vi.fn(), ...overrides };
  render(<Sidebar {...props} />);
  return props;
}

const row = (name: string): HTMLElement => screen.getByRole("link", { name: new RegExp(`^${name}\\b`) }).closest("li") as HTMLElement;

describe("the sidebar", () => {
  test("lists each repository with a link to its board, its progress and who is working", () => {
    draw();

    expect(screen.getByRole("link", { name: /^alpha\b/ })).toHaveAttribute("href", "/r/alpha/");
    expect(within(row("alpha")).getByText("50%")).toBeInTheDocument();
    expect(within(row("alpha")).getByText("2 working")).toBeInTheDocument();
    expect(within(row("alpha")).getByText("1 to answer")).toBeInTheDocument();
    expect(within(row("beta")).getByText("3 problems")).toBeInTheDocument();
  });

  test("marks the board that is open and the default repository", () => {
    draw();

    expect(screen.getByRole("link", { name: /^alpha\b/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^beta\b/ })).not.toHaveAttribute("aria-current");
    expect(within(row("alpha")).getByText("default")).toBeInTheDocument();
    expect(within(row("beta")).queryByText("default")).toBeNull();
  });

  test("shows what is wrong with a repository it cannot read", () => {
    draw();

    expect(within(row("beta")).getByRole("alert")).toHaveTextContent("its config.json is not valid JSON");
  });

  test("collapses to a strip that still links to each board", () => {
    const props = draw({ collapsed: true });

    expect(screen.getByRole("button", { name: "Show repositories" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "alpha" })).toHaveAttribute("href", "/r/alpha/");
    expect(screen.queryByText("2 working")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show repositories" }));
    expect(props.onToggle).toHaveBeenCalledOnce();
  });

  test("asks to add a repository", () => {
    const props = draw();

    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));

    expect(props.onAdd).toHaveBeenCalledOnce();
  });

  test("removes a repository only after it is confirmed", () => {
    const props = draw();

    fireEvent.click(within(row("beta")).getByRole("button", { name: "Remove beta" }));
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(within(row("beta")).getByText("Remove beta from the list? Its records stay in the repository.")).toBeInTheDocument();
    fireEvent.click(within(row("beta")).getByRole("button", { name: "Remove" }));

    expect(props.onRemove).toHaveBeenCalledWith("beta");
  });

  test("lets a removal be called off", () => {
    const props = draw();

    fireEvent.click(within(row("beta")).getByRole("button", { name: "Remove beta" }));
    fireEvent.click(within(row("beta")).getByRole("button", { name: "Keep" }));

    expect(props.onRemove).not.toHaveBeenCalled();
    expect(within(row("beta")).getByRole("button", { name: "Remove beta" })).toBeInTheDocument();
  });

  test("offers to make another repository the default, and not the one that is", () => {
    const props = draw();

    fireEvent.click(within(row("beta")).getByRole("button", { name: "Make beta the default" }));

    expect(props.onDefault).toHaveBeenCalledWith("beta");
    expect(within(row("alpha")).queryByRole("button", { name: /the default/ })).toBeNull();
  });

  test("says so when nothing is listed", () => {
    draw({ index: { workspace: "/work", repos: [] }, current: null });

    expect(screen.getByText("No repository yet.")).toBeInTheDocument();
  });
});
