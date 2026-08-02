"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { readJsonResponse } from "@/lib/workbench/read-json-response";
import type { CloudflareWorkspaceDeletionResponse } from "@/lib/workbench/workbench-types";

export default function WorkspaceRecoveryPage() {
  const [deletion, setDeletion] = useState<CloudflareWorkspaceDeletionResponse["deletion"]>();
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const response = await fetch("/api/workbench/workspace-deletion", { cache: "no-store" });
    const body = await readJsonResponse<CloudflareWorkspaceDeletionResponse>(
      response,
      "Workspace deletion status is unavailable",
    );
    setDeletion(body.deletion);
  };

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Workspace deletion status is unavailable"),
    );
  }, []);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workbench/workspace-deletion/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceName }),
      });
      await readJsonResponse(
        response,
        "A fresh WorkOS sign-in and exact workspace name are required",
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workspace purge retry failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bg-muted/30 flex min-h-dvh items-center justify-center p-6">
      <section className="border-border bg-background w-full max-w-lg rounded-xl border p-6 shadow-sm">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Workspace lifecycle
        </p>
        <h1 className="mt-2 text-xl font-semibold">Deletion recovery</h1>
        {deletion ? (
          <div className="mt-5 space-y-4">
            <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{deletion.status}</dd>
              {deletion.phase ? (
                <>
                  <dt className="text-muted-foreground">Last phase</dt>
                  <dd>{deletion.phase.replaceAll("_", " ")}</dd>
                </>
              ) : null}
              {deletion.lastErrorCode ? (
                <>
                  <dt className="text-muted-foreground">Failure</dt>
                  <dd className="font-mono text-xs">{deletion.lastErrorCode}</dd>
                </>
              ) : null}
            </dl>
            {deletion.canRetry ? (
              <div className="space-y-3 border-t pt-4">
                <p className="text-muted-foreground text-sm">
                  Credentials remain revoked. Retry resumes the recorded purge phase and does not
                  recreate deleted content.
                </p>
                <input
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="Type the exact workspace name"
                />
                <Button disabled={busy || !workspaceName.trim()} onClick={() => void retry()}>
                  {busy ? "Retrying…" : "Retry purge"}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                This lifecycle operation does not currently require a manual retry.
              </p>
            )}
          </div>
        ) : null}
        {error ? <p className="text-destructive mt-4 text-sm">{error}</p> : null}
        <Button className="mt-5" variant="outline" asChild>
          <Link href="/">Return to workbench</Link>
        </Button>
      </section>
    </main>
  );
}
