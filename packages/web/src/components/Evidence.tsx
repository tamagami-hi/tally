import { InfoCircledIcon } from "@radix-ui/react-icons";

export function Evidence() {
  return (
    <section className="evidence" aria-label="Evidence">
      <div className="empty">
        <InfoCircledIcon aria-hidden="true" />
        <p>
          <b>No evidence records yet.</b> Run records (tests seen failing and passing, clippy, formatting, landings) arrive once sessions record them under <span className="mono">docs/records/evidence/</span>. Until then the tracks' logs stay where they fall.
        </p>
      </div>
    </section>
  );
}
