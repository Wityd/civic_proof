# Read-only live checks; safe while Fuji is active. Never logs login credentials.
$ErrorActionPreference='Stop'
$root='https://crshjvjrgnnypxbpjmob.supabase.co'
$repoRoot=Split-Path $PSScriptRoot -Parent
try {
  $h=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Get-SupabaseMcpHeaders.ps1') | ConvertFrom-Json
  $keys=Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/crshjvjrgnnypxbpjmob/api-keys?reveal=true' -Headers @{Authorization=$h.Authorization}
  $anon=($keys|Where-Object name -eq 'anon').api_key
  $accounts=Import-Clixml -LiteralPath (Join-Path $repoRoot '.local/demo-credentials.xml')
  foreach($account in $accounts) {
    $body=@{email=$account.Login.UserName;password=$account.Login.GetNetworkCredential().Password}|ConvertTo-Json -Compress
    $session=Invoke-RestMethod -Method Post -Uri "$root/auth/v1/token?grant_type=password" -Headers @{apikey=$anon} -ContentType 'application/json' -Body $body
    $headers=@{apikey=$anon;Authorization="Bearer $($session.access_token)"}
    try {
      $me=(Invoke-RestMethod -Uri "$root/functions/v1/civicproof-api/me" -Headers $headers).data
      $owned=Invoke-RestMethod -Uri "$root/rest/v1/suppliers?user_id=eq.$($session.user.id)&select=id,name&order=name.asc,id.asc" -Headers $headers
      if($me.role -ne $account.Role -or $null -eq $me.supplier_ids -or $null -eq $me.suppliers){throw 'Missing identity fields'}
      if(@($me.suppliers).Count -ne @($owned).Count){throw 'Owned supplier counts differ from RLS query'}
      foreach($supplier in @($me.suppliers)) {
        $matching=@($owned|Where-Object{$_.id -eq $supplier.id -and $_.name -eq $supplier.name})
        if($matching.Count -ne 1){throw 'Owned supplier does not match RLS query'}
      }
      if((@($me.supplier_ids)-join ',') -ne (@($owned|ForEach-Object{$_.id})-join ',')){throw 'Owned supplier IDs differ'}
      if($account.Role -eq 'supplier' -and $owned.Count -ne 3){throw 'Expected the three seeded suppliers'}
      if($account.Role -ne 'citizen') {
        foreach($filter in @('submitted,analysed,on_hold,approved','paid','paid, paid')) {
          $result=Invoke-RestMethod -Uri "$root/functions/v1/civicproof-api/invoices?status=$([uri]::EscapeDataString($filter))" -Headers $headers
          $allowed=@($filter.Split(',')|ForEach-Object{$_.Trim()})
          foreach($invoice in @($result.data)){if($invoice.status -notin $allowed){throw 'Filter returned an incorrect status'}}
        }
      }
      foreach($invalid in @('unknown','paid,unknown','paid,','')) {
        $status=200
        try { $null=Invoke-RestMethod -Uri "$root/functions/v1/civicproof-api/invoices?status=$([uri]::EscapeDataString($invalid))" -Headers $headers }
        catch { if(-not $_.Exception.Response){throw}; $status=[int]$_.Exception.Response.StatusCode }
        $expected=if($account.Role -eq 'citizen'){403}else{400}
        if($status -ne $expected){throw 'Invalid filter or role boundary failed'}
      }
      Write-Host "PASS $($account.Role): owned suppliers and status-filter access"
    } finally {
      $null=Invoke-RestMethod -Method Post -Uri "$root/auth/v1/logout?scope=local" -Headers $headers
    }
  }
} finally {
  $h=$null;$keys=$null;$anon=$null;$accounts=$null;$account=$null;$body=$null;$session=$null;$headers=$null
}
