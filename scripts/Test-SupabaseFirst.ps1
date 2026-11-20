# Runs live integration tests using local encrypted credentials. No secrets logged.
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
try {
  $h=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Get-SupabaseMcpHeaders.ps1') | ConvertFrom-Json
  if($LASTEXITCODE -ne 0){throw 'Credential helper failed.'}
  $keys=Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/crshjvjrgnnypxbpjmob/api-keys?reveal=true' -Headers @{Authorization=$h.Authorization}
  $env:TEST_SUPABASE_URL='https://crshjvjrgnnypxbpjmob.supabase.co'
  $env:TEST_SUPABASE_ANON_KEY=($keys|Where-Object name -eq 'anon').api_key
  $env:TEST_SUPABASE_SERVICE_KEY=($keys|Where-Object name -eq 'service_role').api_key
  $env:TEST_SUPABASE_ACCESS_TOKEN=$h.Authorization.Substring(7)
  $accounts=Import-Clixml -LiteralPath (Join-Path $repoRoot '.local/demo-credentials.xml')
  $data=@($accounts|ForEach-Object{@{role=$_.Role;email=$_.Login.UserName;password=$_.Login.GetNetworkCredential().Password}})
  $env:TEST_USERS_JSON=ConvertTo-Json -InputObject $data -Depth 5 -Compress
  & npx.cmd --yes deno@2.9.6 test --allow-env --allow-net=crshjvjrgnnypxbpjmob.supabase.co,api.supabase.com (Join-Path $repoRoot 'supabase/tests/integration_test.ts')
  $testExitCode=$LASTEXITCODE
} finally {
  foreach($name in @('TEST_SUPABASE_URL','TEST_SUPABASE_ANON_KEY','TEST_SUPABASE_SERVICE_KEY','TEST_SUPABASE_ACCESS_TOKEN','TEST_USERS_JSON')) {
    [Environment]::SetEnvironmentVariable($name,$null,'Process')
  }
  $h=$null;$keys=$null;$accounts=$null;$data=$null
}
exit $testExitCode
