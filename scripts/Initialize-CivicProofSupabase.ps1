# Provision the authorised CivicProof demo project. Never prints credentials.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$projectRef = 'crshjvjrgnnypxbpjmob'
$projectUrl = "https://$projectRef.supabase.co"
$managementUrl = "https://api.supabase.com/v1/projects/$projectRef"
$stage = 'load local token'
$credentialsPath = Join-Path $repoRoot '.local/demo-credentials.xml'

function Invoke-ProjectSql([string]$Query, [bool]$ReadOnly = $false) {
    $body = @{ query = $Query; read_only = $ReadOnly } | ConvertTo-Json -Depth 10 -Compress
    $rows = Invoke-RestMethod -Method Post -Uri "$managementUrl/database/query" -Headers $managementHeaders -ContentType 'application/json' -Body $body
    foreach ($row in $rows) { Write-Output $row }
}

try {
    $tokenHeader = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Get-SupabaseMcpHeaders.ps1') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Credential helper failed.' }
    $managementHeaders = @{ Authorization = $tokenHeader.Authorization }
    $stage = 'inspect project'
    $project = Invoke-RestMethod -Uri $managementUrl -Headers $managementHeaders
    if ($project.id -ne $projectRef -or $project.name -ne 'CivicProof_Project' -or $project.status -ne 'ACTIVE_HEALTHY') {
        throw 'Project identity or health check failed.'
    }
    $tables = @(Invoke-ProjectSql "select tablename from pg_tables where schemaname='public' order by tablename" $true)
    $stage = 'apply schema'
    if ($tables.Count -eq 0) {
        $null = Invoke-ProjectSql (Get-Content -LiteralPath (Join-Path $repoRoot 'supabase/schema.sql') -Raw)
    } else {
        $expectedTables = @('ai_reviews','approvals','concerns','evidence','invoice_items','invoices','milestones','projects','reference_prices','suppliers','transactions','users','verifications')
        if (@(Compare-Object $expectedTables @($tables.tablename)).Count -ne 0) {
            throw 'Unexpected schema. Inspect before continuing; no tables were replaced.'
        }
    }
    Write-Output 'Database: CivicProof schema available.'

    $stage = 'retrieve existing backend key'
    $apiKeys = Invoke-RestMethod -Uri "$managementUrl/api-keys?reveal=true" -Headers $managementHeaders
    $serviceKey = @($apiKeys | Where-Object name -eq 'service_role')[0].api_key
    if ([string]::IsNullOrWhiteSpace($serviceKey)) { throw 'Existing service-role key is unavailable.' }
    $serviceHeaders = @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey" }

    $stage = 'configure Auth'
    $null = Invoke-RestMethod -Method Patch -Uri "$managementUrl/config/auth" -Headers $managementHeaders -ContentType 'application/json' -Body (@{
        disable_signup = $true
        external_email_enabled = $true
        external_anonymous_users_enabled = $false
        password_min_length = 12
    } | ConvertTo-Json)

    $savedCredentials = @()
    if (Test-Path -LiteralPath $credentialsPath) { $savedCredentials = @(Import-Clixml -LiteralPath $credentialsPath) }
    $existingUsers = Invoke-RestMethod -Uri "$projectUrl/auth/v1/admin/users?page=1&per_page=100" -Headers $serviceHeaders
    foreach ($role in @('citizen','supplier','municipality','auditor')) {
        $stage = "create or verify $role demo account"
        $email = "$role@demo.civicproof.test"
        $existingUser = @($existingUsers.users | Where-Object email -eq $email)
        $saved = @($savedCredentials | Where-Object Role -eq $role)
        if ($existingUser.Count -gt 1 -or $saved.Count -gt 1) { throw 'Ambiguous demo account.' }
        if ($saved.Count -eq 0) {
            if ($existingUser.Count -gt 0) { throw 'Existing account has no local password record; no password was changed.' }
            $randomBytes = New-Object byte[] 32
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
            $password = [Convert]::ToBase64String($randomBytes) + 'aA1!'
            $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
            $saved = @([pscustomobject]@{ Role = $role; Login = [System.Management.Automation.PSCredential]::new($email, $securePassword) })
            $savedCredentials += $saved[0]
            $savedCredentials | Export-Clixml -LiteralPath $credentialsPath -Force
        }
        $password = $saved[0].Login.GetNetworkCredential().Password
        if ($existingUser.Count -eq 0) {
            $userBody = @{ email=$email; password=$password; email_confirm=$true; user_metadata=@{display_name="Demo $role"} } | ConvertTo-Json -Depth 5 -Compress
            $user = Invoke-RestMethod -Method Post -Uri "$projectUrl/auth/v1/admin/users" -Headers $serviceHeaders -ContentType 'application/json' -Body $userBody
        } else { $user = $existingUser[0] }
        $userId = [guid]$user.id
        # Both interpolated strings are fixed role labels; user ID is parsed as UUID.
        $null = Invoke-ProjectSql "insert into public.users (id,display_name,role) values ('$userId','Demo $role','$role') on conflict (id) do nothing;"
        $roleRow = @(Invoke-ProjectSql "select role from public.users where id='$userId'" $true)
        if ($roleRow.Count -ne 1 -or $roleRow[0].role -ne $role) { throw 'Trusted role verification failed.' }
        Write-Output "Auth: $role account and trusted database role ready."
        $password = $null
        $userBody = $null
    }

    $stage = 'create private storage buckets'
    $buckets = Invoke-RestMethod -Uri "$projectUrl/storage/v1/bucket" -Headers $serviceHeaders
    foreach ($bucket in @(
        @{id='invoices'; name='invoices'; public=$false; file_size_limit=10485760; allowed_mime_types=@('application/pdf')},
        @{id='evidence'; name='evidence'; public=$false; file_size_limit=10485760; allowed_mime_types=@('image/jpeg','image/png','image/webp')}
    )) {
        $existing = @($buckets | Where-Object id -eq $bucket.id)
        $bucketBody = $bucket | ConvertTo-Json -Depth 5 -Compress
        if ($existing.Count -eq 0) {
            $null = Invoke-RestMethod -Method Post -Uri "$projectUrl/storage/v1/bucket" -Headers $serviceHeaders -ContentType 'application/json' -Body $bucketBody
        } else {
            $null = Invoke-RestMethod -Method Put -Uri "$projectUrl/storage/v1/bucket/$($bucket.id)" -Headers $serviceHeaders -ContentType 'application/json' -Body $bucketBody
        }
        Write-Output "Storage: private $($bucket.id) bucket ready."
    }

    $stage = 'seed fictional demo data'
    $null = Invoke-ProjectSql (Get-Content -LiteralPath (Join-Path $repoRoot 'supabase/seed.sql') -Raw)
    Write-Output 'Seed: CP001, three suppliers, M1, three prices and simulated opening ledger ready.'
    Write-Output 'Passwords saved encrypted in .local/demo-credentials.xml; no secrets were printed.'
} catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'local/SQL' }
    # Do not emit request objects, response bodies or exception details containing credentials.
    Write-Error "Provisioning failed at stage '$stage' (status $status). Completed earlier stages are preserved; inspect before retrying."
    exit 1
} finally {
    $tokenHeader=$null; $managementHeaders=$null; $apiKeys=$null; $serviceKey=$null
    $serviceHeaders=$null; $password=$null; $userBody=$null; $savedCredentials=$null
}
