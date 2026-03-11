import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Github, Loader2, Unplug } from "lucide-react";
import { useGitHubConnection } from "@/hooks/use-github";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

export function GitHubConnectDialog({
  triggerLabel = "Connect GitHub",
}: {
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [manualPollRequested, setManualPollRequested] = useState(false);
  const autoPollStartedRef = useRef(false);
  const {
    connection,
    startDeviceFlow,
    finishDeviceFlow,
    disconnect,
  } = useGitHubConnection();

  const deviceFlow = startDeviceFlow.data;

  useEffect(() => {
    if (
      !open ||
      !deviceFlow ||
      finishDeviceFlow.isPending ||
      connection.connected ||
      manualPollRequested ||
      autoPollStartedRef.current
    ) {
      return;
    }

    autoPollStartedRef.current = true;
    finishDeviceFlow.mutate(deviceFlow, {
      onSuccess: () => setOpen(false),
    });
  }, [
    connection.connected,
    deviceFlow,
    finishDeviceFlow,
    manualPollRequested,
    open,
    autoPollStartedRef,
  ]);

  const progressValue = useMemo(() => {
    if (!deviceFlow) return 0;
    if (connection.connected) return 100;
    return finishDeviceFlow.isPending ? 66 : 33;
  }, [connection.connected, deviceFlow, finishDeviceFlow.isPending]);

  const busy = startDeviceFlow.isPending || finishDeviceFlow.isPending || disconnect.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={connection.connected ? "outline" : "default"}>
          <Github className="h-4 w-4" />
          {connection.connected ? "Manage GitHub" : triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub Integration
          </DialogTitle>
          <DialogDescription>
            Connect your personal GitHub account once, then Pac-Forge can create
            private repositories and read commit history through the secure edge proxy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border/70 bg-background/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Connection
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  {connection.connected ? (
                    <>
                      <Check className="h-4 w-4 text-green-500" />
                      <span>Connected as @{connection.username}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not connected</span>
                  )}
                </div>
              </div>
              {connection.connected && (
                <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-400">
                  Ready
                </Badge>
              )}
            </div>
          </div>

          {!connection.connected && (
            <div className="space-y-4 rounded-lg border border-border/70 bg-background/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Device Flow
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Generate a one-time code, enter it on GitHub, then Pac-Forge finishes the connection automatically.
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    autoPollStartedRef.current = false;
                    setManualPollRequested(false);
                    startDeviceFlow.mutate();
                  }}
                  disabled={busy}
                >
                  {startDeviceFlow.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Start"
                  )}
                </Button>
              </div>

              <Progress value={progressValue} className="h-2" />

              {deviceFlow && (
                <div className="space-y-3">
                  <div className="rounded-md border border-border/70 bg-card/70 p-3">
                    <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Verification Code
                    </div>
                    <div className="mt-2 font-mono text-2xl font-semibold tracking-[0.3em]">
                      {deviceFlow.user_code}
                    </div>
                    <a
                      href={deviceFlow.verification_uri}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      Open GitHub verification page
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-card/50 p-3">
                    <div className="text-sm text-muted-foreground">
                      {finishDeviceFlow.isPending
                        ? "Waiting for GitHub authorization..."
                        : "If polling was interrupted, resume it after authorizing."}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setManualPollRequested(true);
                        finishDeviceFlow.mutate(deviceFlow, {
                          onSettled: () => setManualPollRequested(false),
                          onSuccess: () => setOpen(false),
                        });
                      }}
                      disabled={finishDeviceFlow.isPending}
                    >
                      {finishDeviceFlow.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Retry Polling"
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {(startDeviceFlow.isError || finishDeviceFlow.isError) && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {startDeviceFlow.error?.message ?? finishDeviceFlow.error?.message ?? "GitHub connection failed"}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {connection.connected ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Unplug className="h-4 w-4" />
              )}
              Disconnect
            </Button>
          ) : (
            <div className="text-xs text-muted-foreground">
              Requires `VITE_GITHUB_CLIENT_ID` in the frontend and `GITHUB_CLIENT_ID` in Supabase secrets.
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
