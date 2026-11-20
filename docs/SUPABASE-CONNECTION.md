# Connect CivicProof Supabase to Codex

Branch: `p2/backend`. Project reference: `crshjvjrgnnypxbpjmob`.

The project-scoped MCP connection is in `.codex/config.toml`. It connects to
Supabase's hosted MCP endpoint and enables database, debugging, development and
Storage tools. It can make changes: the intended target is the CivicProof demo
project. A project-scoped URL limits this connection's target; also restrict the
personal access token's permissions where supported.

## Enter the token privately

Create a personal access token in your
[Supabase account](https://supabase.com/dashboard/account/tokens). This is an
account access token, not the project's publishable/anon key or service-role key.
Give it the permissions required for the demo database and storage setup.

From PowerShell in the repository root, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Set-SupabaseToken.ps1
```

Paste the token at the hidden prompt and press Enter. Do not paste it into chat,
pass it as a command-line argument, or add it to a configuration file.
The execution-policy option applies to this PowerShell process only; it does not
change the computer's saved PowerShell policy.

The script saves `.local/supabase-token.xml`, encrypted with Windows DPAPI through
PowerShell's SecureString serialization. It can be decrypted by this Windows user
on this computer. `.local/` is ignored by Git. Encryption does not protect against
programs already running as your Windows user. Each teammate enters their own
token locally; do not share or commit this file.

## Load the connection

Restart/reload Codex and open this repository. Project configuration must be
trusted for Codex to load `.codex/config.toml`. The helper command uses a relative
path, so the connection's local working directory must be the repository root.
Look for `civicproof_supabase` in the MCP server list (`/mcp` where supported).
Then ask: "Check Supabase and list the current tables before making changes."

The MCP helper decrypts the local token and returns the Authorization header
directly to Codex. **Do not run `Get-SupabaseMcpHeaders.ps1` yourself or capture
its output in logs: it emits the credential for the MCP transport.** No global
environment variable or token value is stored in the tracked configuration.

This connection supports local Codex execution. It does not automatically attach
tools to an already running chat or make the token available to Work Cloud.

## Troubleshooting

- Missing token: run the setup script above, then reload the connection.
- Unknown `http_headers_helper` setting: update Codex or use the OAuth connection
  described in the official MCP documentation instead. Do not put a static
  Authorization header in the tracked file.
- Helper script not found: confirm the local working directory is this repo's
  root. For a custom server added in Settings, use an absolute helper script path.
- 401/403: check token expiry, project scope, organisation membership and tool
  permissions. Rerun the setup script to replace the token.
- Token exposed: revoke it in Supabase and create a replacement. Removing a local
  file does not revoke a token.

## Current verification boundary

The saved token was verified against the live Management API on 2026-11-20.
The project is `CivicProof_Project`, status `ACTIVE_HEALTHY`, region `eu-west-1`.
The initial read-only SQL inspection returned an empty project. The full Supabase
foundation was subsequently applied and verified; see
[SUPABASE-SETUP.md](SUPABASE-SETUP.md) and
[SUPABASE-VERIFICATION.md](SUPABASE-VERIFICATION.md).
MCP tools were still not exposed in the current chat; direct Management API
access works using the same local credential helper.

Verified during setup: the installed Codex CLI recognises `civicproof_supabase`
and its header helper; both scripts parse; a dummy token survives an encrypted
file round-trip and produces the expected header without printing it; Git ignores
the local credential path. Those initial checks used a dummy token; the later live
inspection used the saved credential without displaying it. The helper's default
token-path resolution was also corrected for Windows PowerShell.

## Official references

- [Supabase MCP and personal access token authentication](https://supabase.com/docs/guides/ai-tools/mcp)
- [Codex MCP configuration and HTTP header helpers](https://learn.chatgpt.com/docs/extend/mcp?surface=app)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
