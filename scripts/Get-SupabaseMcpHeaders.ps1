# Internal MCP credential helper. Never run directly in a terminal: stdout is
# an Authorization header intended for Codex, not for display or logging.
[CmdletBinding()]
param(
    [string]$TokenPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($TokenPath)) {
    $TokenPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.local/supabase-token.xml'
}
if (-not (Test-Path -LiteralPath $TokenPath -PathType Leaf)) {
    throw 'Supabase token is not configured. Run scripts/Set-SupabaseToken.ps1 privately first.'
}

$supabaseToken = Import-Clixml -LiteralPath $TokenPath
if ($supabaseToken -isnot [System.Security.SecureString]) {
    throw 'Invalid credential file. Run scripts/Set-SupabaseToken.ps1 again.'
}

try {
    $credential = [System.Management.Automation.PSCredential]::new('supabase', $supabaseToken)
    $tokenText = $credential.GetNetworkCredential().Password
    if ([string]::IsNullOrWhiteSpace($tokenText) -or $tokenText -match '[\r\n]') {
        throw 'Invalid token value. Run scripts/Set-SupabaseToken.ps1 again.'
    }
    @{ Authorization = 'Bearer ' + $tokenText } | ConvertTo-Json -Compress
} finally {
    $tokenText = $null
    $credential = $null
    $supabaseToken.Dispose()
}
