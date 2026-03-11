# Task: Add GitHub Integration to Pac-Forge Projects

## Overview

When a user creates a new project in Pac-Forge, the app should optionally create a private GitHub repository for that project. The project detail page should show a link to the repo. This is the foundation for future revision control features.

## Architecture

### GitHub OAuth Flow
- Use GitHub's OAuth Device Flow (simpler than web flow for desktop-style apps)
- Store the GitHub access token in the user's profile in Supabase
- Token is stored once, reused for all repo operations

### New Supabase Edge Function: `github-proxy`
Create `supabase/functions/github-proxy/index.ts` to proxy GitHub API calls (keeps tokens server-side).

Endpoints it should handle (via POST body `action` field):
- `create_repo` — creates a private repo
- `get_repo` — gets repo info (for status display)
- `list_commits` — lists recent commits (for revision history display)

### Database Changes
Migration `026_github_integration.sql`:
```sql
-- Store GitHub token on user profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_access_token text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_username text;

-- Store GitHub repo URL on project
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_name text;
```

### New Files
- `supabase/functions/github-proxy/index.ts` — edge function
- `src/hooks/use-github.ts` — React hooks for GitHub operations
- `src/components/github-connect-dialog.tsx` — OAuth connection dialog
- `src/components/github-repo-card.tsx` — repo info display for project detail page

### Modified Files
- `src/routes/project-detail.tsx` — add GitHub repo section
- `src/routes/profile.tsx` — add GitHub connection status in user profile
- `src/components/forge/steps/forge-project-setup.tsx` — add "Create GitHub repo" toggle
- `supabase/migrations/026_github_integration.sql` — new migration

## Implementation Details

### GitHub OAuth Device Flow

The device flow works like this:
1. App calls `POST https://github.com/login/device/code` with your client_id
2. GitHub returns a `user_code` and `verification_uri`
3. Show user the code and tell them to go to github.com/login/device
4. Poll `POST https://github.com/login/oauth/access_token` until user completes auth
5. Store the access token in Supabase profile

You need a GitHub OAuth App registered at github.com/settings/developers. For now, use these scopes: `repo` (for creating private repos).

**IMPORTANT:** The actual OAuth app registration must be done manually by the developer. The code should accept the client_id as an environment variable: `GITHUB_CLIENT_ID` in the Supabase edge function, and `VITE_GITHUB_CLIENT_ID` for the frontend.

### Edge Function: `github-proxy`

```typescript
// POST body: { action: "create_repo", name: "pac-project-name", description: "..." }
// POST body: { action: "get_repo", repo: "owner/repo-name" }
// POST body: { action: "list_commits", repo: "owner/repo-name", per_page: 10 }
```

The edge function:
1. Authenticates the user via Supabase JWT (same pattern as `generate/index.ts`)
2. Reads the user's `github_access_token` from their profile
3. Calls the GitHub API with the token
4. Returns the result

For `create_repo`:
- POST `https://api.github.com/user/repos`
- Body: `{ name, description, private: true, auto_init: true }`
- Returns repo URL

For `list_commits`:
- GET `https://api.github.com/repos/{owner}/{repo}/commits?per_page=10`
- Returns array of commits with sha, message, author, date

### React Hook: `use-github.ts`

```typescript
export function useGitHubConnection() {
  // Check if user has GitHub connected (github_username exists on profile)
  // Start device flow OAuth
  // Save token to profile
}

export function useCreateGitHubRepo() {
  // Create a repo via the edge function
  // Save repo URL to project
}

export function useGitHubCommits(repoName: string) {
  // Fetch recent commits for display
  // TanStack Query with 30s stale time
}
```

### GitHub Connect Dialog

Simple dialog that:
1. Shows "Connect GitHub" button
2. On click: starts device flow, gets user_code
3. Shows: "Enter code XXXX-XXXX at github.com/login/device"
4. Polls for completion
5. On success: shows "Connected as @username" with a green checkmark
6. Stores token

### Project Detail Integration

Add a section to `src/routes/project-detail.tsx`:
- If GitHub repo exists: show repo name as a link, and a "Recent Commits" list (last 5-10 commits with message, author, date)
- If no repo: show "Create GitHub Repository" button
- If GitHub not connected: show "Connect GitHub first" with link to profile settings

### Forge Wizard Integration

In `forge-project-setup.tsx`, add a toggle:
- "Create GitHub repository for this project" (Switch component)
- Disabled if GitHub not connected, with tooltip "Connect GitHub in your profile settings"
- When enabled and project is created: auto-create the repo

## Configuration

The developer needs to:
1. Register a GitHub OAuth App at https://github.com/settings/developers
2. Set `GITHUB_CLIENT_ID` in Supabase secrets: `npx supabase secrets set GITHUB_CLIENT_ID=...`
3. Set `VITE_GITHUB_CLIENT_ID` in `.env` for the frontend

## Scope for Now

Keep it simple:
- Create private repos ✅
- Show repo link on project ✅
- Show recent commits ✅
- GitHub connection in user profile ✅
- Toggle in wizard ✅

NOT in scope yet (post-demo):
- Auto-committing artifacts
- TIA Portal sync to Git
- Branch management
- Diff viewing in-app
- PR workflows

## Target: Personal GitHub account

Repos will be created under the authenticated user's personal account. The code should use `POST /user/repos` (not `/orgs/{org}/repos`). Later, an org can be configured by changing to the org endpoint — keep the repo creation logic in the edge function so it's easy to swap.
