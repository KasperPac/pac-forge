import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { supabase } from "@/lib/supabase";
import { getRedirectUri } from "@/lib/dropbox-oauth";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function DropboxCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setStatus("error");
      setErrorMsg(searchParams.get("error_description") ?? errorParam);
      return;
    }

    if (!code) {
      setStatus("error");
      setErrorMsg("No authorization code received from Dropbox.");
      return;
    }

    const codeVerifier = sessionStorage.getItem("dropbox_code_verifier");
    if (!codeVerifier) {
      setStatus("error");
      setErrorMsg("Missing PKCE verifier. Please try connecting again.");
      return;
    }

    // Clean up sessionStorage
    sessionStorage.removeItem("dropbox_code_verifier");

    async function exchangeCode() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setStatus("error");
          setErrorMsg("Not authenticated. Please log in and try again.");
          return;
        }

        const { data, error } = await supabase.functions.invoke("dropbox", {
          body: {
            action: "exchange-code",
            code,
            code_verifier: codeVerifier,
            redirect_uri: getRedirectUri(),
          },
        });

        if (error) {
          setStatus("error");
          setErrorMsg(error.message ?? "Token exchange failed");
          return;
        }

        if (data?.error) {
          setStatus("error");
          setErrorMsg(data.error);
          return;
        }

        setStatus("success");
        toast({
          title: "Dropbox connected",
          description: `Connected as ${data.display_name ?? data.email ?? "user"}`,
        });

        // Redirect after short delay so user sees success
        setTimeout(() => navigate("/profile", { replace: true }), 1500);
      } catch (err) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      }
    }

    exchangeCode();
  }, [searchParams, navigate, toast]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm space-y-4 text-center">
        {status === "loading" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="font-mono text-sm text-muted-foreground">
              Connecting to Dropbox...
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
            <p className="font-mono text-sm text-green-400">
              Dropbox connected successfully!
            </p>
            <p className="text-xs text-muted-foreground">Redirecting to profile...</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="mx-auto h-8 w-8 text-destructive" />
            <p className="font-mono text-sm text-destructive">Connection failed</p>
            <p className="text-xs text-muted-foreground">{errorMsg}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/profile", { replace: true })}
            >
              Back to Profile
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
