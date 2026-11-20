# Live integration verification. Credentials and access tokens are never printed.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$projectUrl = 'https://crshjvjrgnnypxbpjmob.supabase.co'
$managementUrl = 'https://api.supabase.com/v1/projects/crshjvjrgnnypxbpjmob'
$stage = 'load credentials'
$report = [ordered]@{ verified_at = [DateTime]::UtcNow.ToString('o'); project_ref='crshjvjrgnnypxbpjmob'; checks=@() }
function Pass([string]$Message) { $script:report.checks += $Message; Write-Output "PASS: $Message" }
function ProjectSql([string]$Query, [bool]$ReadOnly=$true) {
    Invoke-RestMethod -Method Post -Uri "$managementUrl/database/query" -Headers $managementHeaders -ContentType 'application/json' -Body (@{query=$Query; read_only=$ReadOnly}|ConvertTo-Json -Compress)
}
function ExpectDenied([string]$Uri, [hashtable]$Headers, [string]$Method='Get', [string]$Body='') {
    try {
        if ($Method -eq 'Get') { $null = Invoke-RestMethod -Uri $Uri -Headers $Headers }
        else { $null = Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -ContentType 'text/plain' -Body $Body }
    } catch {
        $code = [int]$_.Exception.Response.StatusCode
        if ($code -in @(400,401,403,404)) { return }
        throw 'Unexpected denial status.'
    }
    throw 'Access unexpectedly allowed.'
}
try {
    $tokenHeader = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Get-SupabaseMcpHeaders.ps1') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Credential helper failed.' }
    $managementHeaders = @{Authorization=$tokenHeader.Authorization}
    $keys = Invoke-RestMethod -Uri "$managementUrl/api-keys?reveal=true" -Headers $managementHeaders
    $serviceKey = @($keys|Where-Object name -eq 'service_role')[0].api_key
    $anonKey = @($keys|Where-Object name -eq 'anon')[0].api_key
    if (-not $serviceKey -or -not $anonKey) { throw 'Project keys missing.' }
    $serviceHeaders=@{apikey=$serviceKey;Authorization="Bearer $serviceKey"}
    $anonHeaders=@{apikey=$anonKey;Authorization="Bearer $anonKey"}

    $stage = 'database constraints'
    $null = ProjectSql (Get-Content -LiteralPath (Join-Path $repoRoot 'supabase/verify.sql') -Raw) $false
    Pass '14 RLS-protected tables; database isolation, multichain wallet and workflow constraints verified with rolled-back fixtures'

    $stage = 'seed data and backend access'
    $projects = @(Invoke-RestMethod -Uri "$projectUrl/rest/v1/projects?select=code,budget_cents" -Headers $serviceHeaders)
    if ($projects.Count -ne 1 -or $projects[0].code -ne 'CP001' -or $projects[0].budget_cents -ne 200000000) { throw 'Project seed mismatch.' }
    $seedResult = @(ProjectSql "select (select count(*) from public.suppliers) as suppliers,(select count(*) from public.reference_prices) as prices,(select count(*) from public.milestones) as milestones,(select count(*) from public.invoices) as invoices,(select coalesce(sum(case when operation='fund_project' then amount_cents when operation='release' then -amount_cents else 0 end),0) from public.transactions where status='confirmed' and mode='simulated') as opening_balance_cents")
    if ($seedResult[0].suppliers -ne 3 -or $seedResult[0].prices -ne 3 -or $seedResult[0].milestones -ne 1 -or $seedResult[0].invoices -ne 0 -or $seedResult[0].opening_balance_cents -ne 200000000) { throw 'Seed counts mismatch.' }
    Pass 'Backend reads CP001; 3 suppliers, 3 prices, M1 and R2,000,000 simulated opening balance verified'

    $stage = 'Auth configuration'
    $authConfig = Invoke-RestMethod -Uri "$managementUrl/config/auth" -Headers $managementHeaders
    if (-not $authConfig.disable_signup -or -not $authConfig.external_email_enabled -or $authConfig.external_anonymous_users_enabled) { throw 'Auth config mismatch.' }
    Pass 'Email/password login enabled; public signup and anonymous sign-in disabled'

    $tableRows = @(ProjectSql "select tablename from pg_tables where schemaname='public' order by tablename")
    foreach ($table in $tableRows.tablename) { ExpectDenied "$projectUrl/rest/v1/${table}?select=*&limit=1" $anonHeaders }
    Pass 'Anonymous direct reads denied on all 14 application tables'

    $stage='four role logins and access isolation'
    $credentials = @(Import-Clixml -LiteralPath (Join-Path $repoRoot '.local/demo-credentials.xml'))
    foreach ($login in $credentials) {
        $body=@{email=$login.Login.UserName;password=$login.Login.GetNetworkCredential().Password}|ConvertTo-Json -Compress
        $session=Invoke-RestMethod -Method Post -Uri "$projectUrl/auth/v1/token?grant_type=password" -Headers @{apikey=$anonKey} -ContentType 'application/json' -Body $body
        if (-not $session.access_token -or -not $session.user.email_confirmed_at) { throw 'Demo sign-in failed.' }
        $id=[guid]$session.user.id
        $dbRole=@(ProjectSql "select role from public.users where id='$id'")
        if ($dbRole.Count -ne 1 -or $dbRole[0].role -ne $login.Role) { throw 'Role mismatch.' }
        $userHeaders=@{apikey=$anonKey;Authorization="Bearer $($session.access_token)"}
        foreach ($table in $tableRows.tablename) { ExpectDenied "$projectUrl/rest/v1/${table}?select=*&limit=1" $userHeaders }
        ExpectDenied "$projectUrl/storage/v1/object/invoices/verification/unauthorised.txt" $userHeaders 'Post' 'Verification denied upload'
        $null=Invoke-RestMethod -Method Post -Uri "$projectUrl/auth/v1/logout?scope=local" -Headers $userHeaders
        Pass "$($login.Role) sign-in, confirmed email, trusted role and direct table/storage denial verified"
        $body=$null; $session=$null; $userHeaders=$null
    }

    $stage='private storage configuration'
    $buckets=Invoke-RestMethod -Uri "$projectUrl/storage/v1/bucket" -Headers $serviceHeaders
    foreach ($bucketName in @('invoices','evidence')) {
        $bucket=@($buckets|Where-Object id -eq $bucketName)
        if ($bucket.Count -ne 1 -or $bucket[0].public -or $bucket[0].file_size_limit -ne 10485760) { throw 'Private bucket configuration mismatch.' }
        $expectedMime=if($bucketName -eq 'invoices'){@('application/pdf')}else{@('image/jpeg','image/png','image/webp')}
        if (@(Compare-Object $expectedMime @($bucket[0].allowed_mime_types)).Count -ne 0) { throw 'MIME restriction mismatch.' }
        ExpectDenied "$projectUrl/storage/v1/object/$bucketName/verification/invalid.txt" $serviceHeaders 'Post' 'Invalid MIME verification'
        $stage="private $bucketName upload and download"
        $objectKey='verification/' + [guid]::NewGuid().ToString() + $(if($bucketName -eq 'invoices'){'.pdf'}else{'.png'})
        $mime=if($bucketName -eq 'invoices'){'application/pdf'}else{'image/png'}
        $bytes=if($bucketName -eq 'invoices'){
            [Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n% CivicProof temporary access verification`n%%EOF")
        }else{
            [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1kAAAAASUVORK5CYII=')
        }
        $uploaded=$false
        try {
            $null=Invoke-RestMethod -Method Post -Uri "$projectUrl/storage/v1/object/$bucketName/$objectKey" -Headers $serviceHeaders -ContentType $mime -Body $bytes
            $uploaded=$true
            $download=Invoke-WebRequest -UseBasicParsing -Uri "$projectUrl/storage/v1/object/authenticated/$bucketName/$objectKey" -Headers $serviceHeaders
            if ($download.StatusCode -ne 200) { throw 'Backend private download failed.' }
            ExpectDenied "$projectUrl/storage/v1/object/authenticated/$bucketName/$objectKey" $anonHeaders
            ExpectDenied "$projectUrl/storage/v1/object/public/$bucketName/$objectKey" $anonHeaders
        } finally {
            if($uploaded){
                $null=Invoke-RestMethod -Method Delete -Uri "$projectUrl/storage/v1/object/$bucketName" -Headers $serviceHeaders -ContentType 'application/json' -Body (@{prefixes=@($objectKey)}|ConvertTo-Json -Compress)
            }
        }
    }
    Pass 'Both private buckets enforce MIME/10 MiB settings; backend uploads/downloads work; public reads fail; temporary files removed'

    $stage='security advisors'
    $advisor=Invoke-RestMethod -Uri "$managementUrl/advisors/security" -Headers $managementHeaders
    $lints=@($advisor.lints)
    $report.security_advisors=@($lints|ForEach-Object{[ordered]@{name=$_.name;level=$_.level;title=$_.title}})
    $errors=@($lints|Where-Object level -eq 'ERROR')
    if ($errors.Count -gt 0) { throw 'Security advisor reports errors.' }
    Pass 'Security advisor check completed without ERROR findings'

    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $repoRoot '.local/setup-verification.json') -Encoding UTF8
    Write-Output ('Advisor summary: ' + (($report.security_advisors|ForEach-Object{"$($_.level):$($_.name)"}) -join ', '))
} catch {
    $status=if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{'local/SQL'}
    Write-Output "Verification failed at stage '$stage' (status $status). No credentials printed."
    exit 1
} finally {
    $tokenHeader=$null;$managementHeaders=$null;$keys=$null;$serviceKey=$null;$anonKey=$null
    $serviceHeaders=$null;$anonHeaders=$null;$credentials=$null;$session=$null;$body=$null;$userHeaders=$null
}
