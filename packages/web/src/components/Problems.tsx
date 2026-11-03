import { Callout } from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

export function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <Callout.Root color="tomato" variant="surface" size="1" className="problems" role="alert">
      <Callout.Icon><ExclamationTriangleIcon /></Callout.Icon>
      <Callout.Text>
        <strong>Ledger needs attention.</strong>
        <ul>
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      </Callout.Text>
    </Callout.Root>
  );
}
