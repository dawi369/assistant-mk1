/**
 * Home route for the current assistant workbench.
 *
 * The first screen is the usable assistant thread surface. Higher-level
 * workbench panels can wrap this route over time without turning the app into a
 * marketing or demo landing page.
 */
import { WorkbenchShell } from "@/components/workbench/workbench-shell";

export default function Home() {
  return (
    <main className="h-dvh">
      <WorkbenchShell />
    </main>
  );
}
