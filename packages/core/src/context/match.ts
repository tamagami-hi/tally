const ANY_DEPTH = "**";
const WILD = "*";
const HERE = ".";

export function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "" && segment !== HERE);
}

const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const within = (pattern: string): RegExp => new RegExp(`^${pattern.split(WILD).map(literal).join(".*")}$`);

function wildsMeet(a: string, b: string): boolean {
  const headA = a.slice(0, a.indexOf(WILD));
  const headB = b.slice(0, b.indexOf(WILD));
  const tailA = a.slice(a.lastIndexOf(WILD) + 1);
  const tailB = b.slice(b.lastIndexOf(WILD) + 1);
  return (headA.startsWith(headB) || headB.startsWith(headA)) && (tailA.endsWith(tailB) || tailB.endsWith(tailA));
}

function segmentsMeet(a: string, b: string): boolean {
  if (!a.includes(WILD)) return b.includes(WILD) ? within(b).test(a) : a === b;
  return b.includes(WILD) ? wildsMeet(a, b) : within(a).test(b);
}

function meet(a: readonly string[], b: readonly string[], bIsAnArea: boolean): boolean {
  const [first, ...rest] = a;
  const [other, ...others] = b;
  if (first === undefined) return true;
  if (other === undefined) return bIsAnArea || a.every((segment) => segment === ANY_DEPTH);
  if (first === ANY_DEPTH) return meet(rest, b, bIsAnArea) || meet(a, others, bIsAnArea);
  if (other === ANY_DEPTH) return meet(a, others, bIsAnArea) || meet(rest, b, bIsAnArea);
  return segmentsMeet(first, other) && meet(rest, others, bIsAnArea);
}

const asksForAnArea = (asked: string): boolean => asked.endsWith("/") || asked.includes(WILD) || segmentsOf(asked).length === 0;

export function overlaps(path: string, area: string): boolean {
  return meet(segmentsOf(path), segmentsOf(area), true);
}

export function applies(path: string, asked: string): boolean {
  return meet(segmentsOf(path), segmentsOf(asked), asksForAnArea(asked));
}
