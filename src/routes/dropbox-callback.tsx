import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";

/**
 * Dropbox OAuth callback page.
 * Saves the authorization code + PKCE verifier to sessionStorage,
 * then redirects to /profile which performs the actual token exchange.
 * This avoids auth timing issues on pages loaded after external redirects.
 */
export default function DropboxCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      // Store error for profile page to display
      sessionStorage.setItem(
        "dropbox_pending_exchange",
        JSON.stringify({ error: searchParams.get("error_description") ?? errorParam })
      );
      navigate("/profile", { replace: true });
      return;
    }

    if (!code) {
      sessionStorage.setItem(
        "dropbox_pending_exchange",
        JSON.stringify({ error: "No authorization code received from Dropbox." })
      );
      navigate("/profile", { replace: true });
      return;
    }

    const codeVerifier = sessionStorage.getItem("dropbox_code_verifier");
    if (!codeVerifier) {
      sessionStorage.setItem(
        "dropbox_pending_exchange",
        JSON.stringify({ error: "Missing PKCE verifier. Please try connecting again." })
      );
      navigate("/profile", { replace: true });
      return;
    }

    // Clean up verifier, save exchange payload for profile page
    sessionStorage.removeItem("dropbox_code_verifier");
    sessionStorage.setItem(
      "dropbox_pending_exchange",
      JSON.stringify({ code, code_verifier: codeVerifier })
    );

    navigate("/profile", { replace: true });
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
      <p className="ml-3 font-mono text-sm text-muted-foreground">
        Redirecting...
      </p>
    </div>
  );
}
