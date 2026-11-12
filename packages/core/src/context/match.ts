const ANY_DEPTH = "**";
const WILD = "*";
const HERE = ".";

export function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "" && segment !== HERE);
}

function matchesWild(pattern: string, text: string): boolean {
  const [head = "", ...rest] = pattern.split(WILD);
  const tail = rest.at(-1);
  if (tail === undefined) return head === text;
  const end = text.length - tail.length;
  if (end < head.length || !text.startsWith(head) || !text.endsWith(tail)) return false;
  const reached = rest.slice(0, -1).reduce((from, part) => {
    const found = from < 0 ? -1 : text.indexOf(part, from);
    return found < 0 || found + part.length > end ? -1 : found + part.length;
  }, head.length);
  return reached >= 0;
}

function wildsMeet(a: string, b: string): boolean {
  const headA = a.slice(0, a.indexOf(WILD));
  const headB = b.slice(0, b.indexOf(WILD));
  const tailA = a.slice(a.lastIndexOf(WILD) + 1);
  const tailB = b.slice(b.lastIndexOf(WILD) + 1);
  return (headA.startsWith(headB) || headB.startsWith(headA)) && (tailA.endsWith(tailB) || tailB.endsWith(tailA));
}

function segmentsMeet(a: string, b: string): boolean {
  if (!a.includes(WILD)) return b.includes(WILD) ? matchesWild(b, a) : a === b;
  return b.includes(WILD) ? wildsMeet(a, b) : matchesWild(a, b);
}

function meet(a: readonly string[], b: readonly string[], bIsAnArea: boolean): boolean {
  const known = new Map<number, boolean>();
  const width = b.length + 1;
  const decide = (i: number, j: number): boolean => {
    const first = a[i];
    const other = b[j];
    if (first === undefined) return true;
    if (other === undefined) return bIsAnArea || a.slice(i).every((segment) => segment === ANY_DEPTH);
    if (first === ANY_DEPTH) return from(i + 1, j) || from(i, j + 1);
    if (other === ANY_DEPTH) return from(i, j + 1) || from(i + 1, j);
    return segmentsMeet(first, other) && from(i + 1, j + 1);
  };
  const from = (i: number, j: number): boolean => {
    const key = i * width + j;
    const answer = known.get(key) ?? decide(i, j);
    known.set(key, answer);
    return answer;
  };
  return from(0, 0);
}

const asksForAnArea = (asked: string): boolean => asked.endsWith("/") || asked.includes(WILD) || segmentsOf(asked).length === 0;

export function overlaps(path: string, area: string): boolean {
  return meet(segmentsOf(path), segmentsOf(area), true);
}

export function applies(path: string, asked: string): boolean {
  return meet(segmentsOf(path), segmentsOf(asked), asksForAnArea(asked));
}
