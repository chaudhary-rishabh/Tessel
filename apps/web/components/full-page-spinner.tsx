import { Spinner, TesselMark } from "@tessel/ui";

export function FullPageSpinner({ label = "Loading Tessel" }: { label?: string }) {
  return (
    <div className="text-muted flex min-h-dvh flex-col items-center justify-center gap-4">
      <TesselMark className="size-10" />
      <Spinner label={label} />
    </div>
  );
}
