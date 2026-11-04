import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const NEAR_PX = 600;

interface Row {
  hash: string;
}

export function scrollerOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

const isNearBottom = (scroller: HTMLElement): boolean => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_PX;

export function useNearBottom(list: RefObject<HTMLElement | null>, active: boolean, onNear: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    const check = (): void => {
      if (list.current !== null && isNearBottom(scrollerOf(list.current))) onNear();
    };
    check();
    window.addEventListener("scroll", check, { capture: true, passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check, { capture: true });
      window.removeEventListener("resize", check);
    };
  }, [list, active, onNear]);
}

function rowsMoved(before: readonly Row[], after: readonly Row[], inView: number): number {
  const placed = new Map(after.map((row, index) => [row.hash, index]));
  for (let index = inView; index < before.length; index += 1) {
    const now = placed.get(before[index]?.hash ?? "");
    if (now !== undefined) return now - index;
  }
  return 0;
}

const viewTop = (scroller: HTMLElement): number => (scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top);

export function useKeptScroll(list: RefObject<HTMLElement | null>, rows: readonly Row[], rowHeight: number): void {
  const shown = useRef(rows);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = rows;
    if (before === rows || list.current === null) return;
    const scroller = scrollerOf(list.current);
    if (scroller.scrollTop === 0) return;
    const inView = Math.max(0, Math.floor((viewTop(scroller) - list.current.getBoundingClientRect().top) / rowHeight));
    scroller.scrollTop += rowsMoved(before, rows, inView) * rowHeight;
  }, [list, rows, rowHeight]);
}
