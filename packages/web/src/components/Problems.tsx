import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

export function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="problems" role="alert">
      <ExclamationTriangleIcon aria-hidden="true" style={{ flex: "none", marginTop: 3 }} />
      <div>
        <strong>Ledger needs attention.</strong>
        <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      </div>
    </div>
  );
}
