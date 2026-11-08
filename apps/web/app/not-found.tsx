import { Button, TesselMark } from "@tessel/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <TesselMark className="size-10" />
      <h1 className="text-3xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-muted max-w-sm">The link may be old or mistyped.</p>
      <Button asChild variant="secondary">
        <Link href="/">Go to the home page</Link>
      </Button>
    </main>
  );
}
