import { Callout, Text } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";

export function Evidence() {
  return (
    <section className="evidence" aria-label="Evidence">
      <Callout.Root color="gray" variant="surface" size="2">
        <Callout.Icon><InfoCircledIcon /></Callout.Icon>
        <Callout.Text>
          <Text as="span" weight="medium">No evidence records yet.</Text> Run records (tests seen failing and passing, clippy, formatting, landings) arrive with Phase 4, under <span className="mono">docs/records/evidence/</span>. Until then the tracks' logs stay where they fall.
        </Callout.Text>
      </Callout.Root>
    </section>
  );
}
