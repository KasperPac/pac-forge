/**
 * Dropbox OAuth 2.0 PKCE utilities.
 * No client secret in the browser — token exchange happens server-side.
 */

const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";

/** Generate a random 128-character code verifier for PKCE. */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(96);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** SHA-256 hash → base64url encode for code_challenge. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Build the Dropbox OAuth authorize URL with PKCE. */
export function buildAuthUrl(
  appKey: string,
  redirectUri: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
  });
  return `${DROPBOX_AUTH_URL}?${params.toString()}`;
}

/** Get the redirect URI for the current environment. */
export function getRedirectUri(): string {
  return `${window.location.origin}/dropbox-callback`;
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
