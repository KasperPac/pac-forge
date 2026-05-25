import { useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import pacForgeLogo from "@/../media/logos/PacForge_v2.png";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const { user, loading, signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pac-bg-50">
        <div className="font-mono text-sm text-pac-ink-500">Loading…</div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/projects" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-pac-bg-50">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 px-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Left — brand panel */}
        <aside className="hidden flex-col justify-between border-r border-pac-line-200 py-12 pr-12 lg:flex">
          <a href="https://www.pac-technologies.com.au" className="inline-flex items-center gap-3 text-pac-ink-900">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-pac-blue-600 text-pac-paper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-5 w-5">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4.2" />
                <path d="M3 12 H7 M17 12 H21 M12 3 V7 M12 17 V21" />
              </svg>
            </span>
            <span className="flex flex-col leading-none">
              <strong className="text-[15px] font-semibold tracking-tight">Pac Technologies</strong>
              <small className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-pac-ink-500">Industrial Automation</small>
            </span>
          </a>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-pac-blue-600">Forja</p>
            <h1 className="mt-3 max-w-md text-[40px] font-semibold leading-[1.1] tracking-tight text-pac-ink-900">
              The internal workspace for Pac Technologies engineers.
            </h1>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-pac-ink-700">
              PLC code generation, quote authoring, spec building, and TIA Portal integration — one place, calibrated to how we actually work on the plant floor.
            </p>
          </div>

          <div className="flex items-center gap-4 font-mono text-[12px] text-pac-ink-500">
            <span>Brisbane</span>
            <span aria-hidden="true">·</span>
            <span>Melbourne</span>
            <span aria-hidden="true">·</span>
            <a href="https://www.pac-technologies.com.au" className="text-pac-blue-600 underline-offset-4 hover:underline">
              pac-technologies.com.au
            </a>
          </div>
        </aside>

        {/* Right — auth card */}
        <main className="flex items-center justify-center py-12 lg:pl-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex flex-col items-start lg:hidden">
              <img src={pacForgeLogo} alt="Forja" className="h-12 w-auto object-contain" />
            </div>

            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-pac-blue-600">
              {isSignUp ? "New account" : "Sign in"}
            </p>
            <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-pac-ink-900">
              {isSignUp ? "Create your Forja account" : "Welcome back"}
            </h2>
            <p className="mt-2 text-sm text-pac-ink-700">
              {isSignUp
                ? "Pac Technologies staff only. Use your work email."
                : "Sign in with your work email to continue."}
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="font-mono text-[11px] uppercase tracking-[0.14em] text-pac-ink-500">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="block h-11 w-full rounded-sm border border-pac-line-200 bg-pac-paper px-3 text-sm text-pac-ink-900 placeholder:text-pac-ink-400 focus:border-pac-blue-600 focus:outline-none"
                  placeholder="you@pac-technologies.com.au"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="font-mono text-[11px] uppercase tracking-[0.14em] text-pac-ink-500">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  className="block h-11 w-full rounded-sm border border-pac-line-200 bg-pac-paper px-3 text-sm text-pac-ink-900 focus:border-pac-blue-600 focus:outline-none"
                />
              </div>

              {error && (
                <div className="rounded-sm border border-pac-signal-red bg-pac-signal-red-bg px-3 py-2 font-mono text-[12px] text-[#7C2018]">
                  {error}
                </div>
              )}

              <Button type="submit" className="h-11 w-full bg-pac-blue-600 text-pac-paper hover:bg-pac-blue-700" disabled={submitting}>
                {submitting ? "…" : isSignUp ? "Create account" : "Sign in"}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
              className="mt-6 inline-flex items-center gap-1 text-sm text-pac-ink-700 hover:text-pac-blue-700"
            >
              {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up →"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
