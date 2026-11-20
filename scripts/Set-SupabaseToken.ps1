[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$credentialDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.local'
$credentialPath = Join-Path $credentialDirectory 'supabase-token.xml'

Write-Host 'Enter a Supabase personal access token for the CivicProof project.'
Write-Host 'Input is hidden. The token will be encrypted for this Windows user on this computer.'
$supabaseToken = Read-Host 'Supabase access token' -AsSecureString
try {
    if ($supabaseToken.Length -eq 0) {
        throw 'No token entered. Nothing was saved.'
    }
    New-Item -ItemType Directory -Path $credentialDirectory -Force | Out-Null
    $supabaseToken | Export-Clixml -LiteralPath $credentialPath -Force
    Write-Host 'Saved locally. Restart/reload Codex for this project, then ask it to check Supabase.'
} finally {
    $supabaseToken.Dispose()
}
