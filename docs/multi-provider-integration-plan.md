# Multi-Provider Integration Plan

Plan for integrating GitHub (Issues/PRs + Projects v2) and Trello alongside the
existing Atlassian/Jira integration, and structuring the codebase so further
project-management tools are additive.

## Scope decisions

- **Identity model:** one provider per session. You log in with Jira *or* GitHub
  *or* Trello; that provider account is your identity, and a room is owned by one
  `(provider, workspace)`. This generalizes today's model and keeps the server
  stateless (no user DB).
- **GitHub surface:** both Issues/PRs (REST) and Projects v2 (GraphQL).
- **Write-back:** read-only. Pull a work item in, vote, done. No writes to the
  source tool.

## How Atlassian is wired in today

Atlassian runs through four distinct seams, not one module:

1. **Auth + identity** (`server/server.js:158-279`, `client/src/useAuth.ts`) —
   OAuth is Atlassian-specific, and `user.accountId` (the Atlassian account ID)
   *is* the voting identity: the stable `userId` that survives socket reconnects
   (`PokerRoom.tsx:50`, `server.js:370`). Identity and provider are the same
   thing today.
2. **Workspace partitioning** (`cloudId` throughout) — rooms are namespaced by
   Atlassian site: `roomKey(cloudId, room)` (`server.js:298`), and a room is
   *owned* by the first `cloudId` to open it (`server.js:304`, `458-463`). This
   is the multi-tenant isolation guarantee.
3. **Work-item fetching** (`server.js:316-359`) — `POST /issue` hardcodes the
   Jira REST endpoint, a `PROJ-123` regex, and an ADF description shape.
4. **Client UX** (`PokerRoom.tsx:145-163`, `SiteSelector.tsx`) — the
   "PROJ-123 or Jira URL" input, the ADF→markdown render (`adf-to-md`), and the
   site dropdown are all Jira-shaped.

## Guiding idea

Extract a **Provider** abstraction behind those four seams. Today `cloudId` is
the tenant key; generalize it to a single composite
`tenantId = "${provider}:${workspaceId}"`. Every place that uses `cloudId` today
gets fed that composite instead — that is most of the room-isolation churn, and
it is mechanical.

The session gains one field: `provider`. Because it is one provider per session,
two users in the same room are always the same provider + workspace (room
ownership enforces it), so identities never collide across providers.

## Server: the provider registry

New `server/providers/` with one module per integration, each implementing the
same interface:

```
authorizeUrl({ state, redirectUri })               // build the consent URL
exchangeCode({ code, redirectUri })                // -> { accessToken, refreshToken, expiresAt }
refresh({ refreshToken })                          // -> {...} | null  (no-op for Trello)
getIdentity({ accessToken })                       // -> { accountId, name, email, picture }
listWorkspaces({ accessToken })                    // Jira sites / GH orgs / Trello boards
fetchWorkItem({ accessToken, workspaceId, input }) // -> { id, title, body(markdown), url }
```

`atlassian.js` is just today's logic moved in. `ensureFreshToken`
(`server.js:87`) becomes `providers[session.provider].refresh(...)`.

## Server: the four seams, generalized

| Seam | Today | Change |
|---|---|---|
| **Auth routes** (`server.js:158-279`) | `/auth/login`, hardcoded Atlassian | `/auth/login/:provider`; provider carried in OAuth `state`; callback dispatches via registry. `cloudId`→`workspaceId`, `sites`→`workspaces` in session, add `provider`. |
| **Tenant key** (`server.js:298-304`, `431`, `458`) | `roomKey(cloudId, room)`, `roomOwners[room]=cloudId` | `tenantId = "${provider}:${workspaceId}"` fed into the same logic. Ownership compares `tenantId`. |
| **Work item** (`server.js:316-359`) | `POST /issue`, Jira REST + ADF | `POST /workitem` → `providers[provider].fetchWorkItem(...)`. Normalize body to markdown server-side (move `adf-to-md` here) so the client is provider-agnostic. |
| **Socket identity** (`server.js:365`) | reads `cloudId` from cookie | reads `provider` + `workspaceId`, builds `tenantId`. `userId` becomes `"${provider}:${accountId}"`. |

## Client

- `useAuth.ts`: `User` gains `provider`; rename `sites`→`workspaces`,
  `cloudId`→`workspaceId`; `login(provider)`.
- **LoginScreen**: a button per provider ("Sign in with Jira / GitHub / Trello").
- `SiteSelector.tsx` → `WorkspaceSelector` (generic label).
- `PokerRoom.tsx:159`: drop client-side `adf-to-md` (server now sends markdown);
  make the input placeholder provider-aware (`PROJ-123` / `owner/repo#12` /
  Trello card URL).

## Per-provider wrinkles (the parts that are not uniform)

- **GitHub (both surfaces):** `fetchWorkItem` resolves the input two ways — an
  `owner/repo#123` ref or github.com URL → Issues/PRs REST; a Projects v2 board
  item → GraphQL Projects v2 (`read:project`). `listWorkspaces` = the user's
  orgs + personal account. **Recommendation: register a GitHub App, not an OAuth
  App** — user-to-server tokens then expire with refresh tokens (fits
  `ensureFreshToken`) *and* Projects v2 + fine-grained access work. OAuth Apps
  cannot do fine-grained scopes.
- **Trello:** not OAuth2 — it uses `/1/authorize` and returns the token in the
  URL fragment (client-side only), so `exchangeCode` needs a tiny static
  callback page that captures the fragment and POSTs it to the server. Tokens do
  not expire, so `refresh` is a no-op. Workspaces = boards/orgs; cards by
  URL/shortlink, `desc` is already markdown.
- **Cookie size:** the session already spans two cookies for Atlassian's token
  size (`server.js:56-60`). Watch the `workspaces` list for GitHub users in many
  orgs — may need trimming.

## Phasing (de-risks the big refactor)

1. **Refactor, zero behavior change** — extract Atlassian into the registry,
   introduce `tenantId`, move ADF→md to the server, rename session fields. Ship;
   users see nothing different.
2. **Add GitHub** — Issues/PRs REST first, then Projects v2 GraphQL;
   multi-provider login screen.
3. **Add Trello** — handle its fragment-token flow.

Each provider after the refactor is purely additive — no churn to the others.
