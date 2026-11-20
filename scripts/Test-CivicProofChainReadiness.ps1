# Read-only: logs a public signer address and readiness checks, never credentials.
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$root='https://crshjvjrgnnypxbpjmob.supabase.co'
try {
  $h=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Get-SupabaseMcpHeaders.ps1') | ConvertFrom-Json
  $keys=Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/crshjvjrgnnypxbpjmob/api-keys?reveal=true' -Headers @{Authorization=$h.Authorization}
  $anon=($keys|Where-Object name -eq 'anon').api_key
  $account=Import-Clixml -LiteralPath (Join-Path $repoRoot '.local/demo-credentials.xml') | Where-Object Role -eq 'municipality'
  $body=@{email=$account.Login.UserName;password=$account.Login.GetNetworkCredential().Password}|ConvertTo-Json -Compress
  $session=Invoke-RestMethod -Method Post -Uri "$root/auth/v1/token?grant_type=password" -Headers @{apikey=$anon} -ContentType 'application/json' -Body $body
  $result=Invoke-RestMethod -Uri "$root/functions/v1/civicproof-api/chain/status?mode=fuji&project_id=10000000-0000-4000-8000-000000000001" -Headers @{apikey=$anon;Authorization="Bearer $($session.access_token)"}
  $result.data|ConvertTo-Json -Depth 5
  if(-not $result.data.ready){throw 'Chain preflight did not pass.'}
} catch {
  Write-Error 'Read-only chain preflight failed. Check signing configuration, roles, gas and RPC availability.'
  exit 1
} finally {
  $h=$null;$keys=$null;$anon=$null;$account=$null;$body=$null;$session=$null
}
