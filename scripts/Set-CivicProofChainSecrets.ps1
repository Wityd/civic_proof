# Run privately in your terminal. Never paste a deployer private key into chat.
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$expectedSigner='0xC3D73FAf9aa330D3448bEEF134Cff4560C75f753'
$key=Read-Host "P3 deployer key for $expectedSigner (hidden)" -AsSecureString
try {
  $plain=[System.Management.Automation.PSCredential]::new('deployer',$key).GetNetworkCredential().Password
  if($plain -notmatch '^0x[0-9a-fA-F]{64}$'){throw 'Expected 0x followed by 64 hex characters.'}
  $env:CIVICPROOF_DEPLOYER_KEY=$plain
  $checker=Join-Path $repoRoot '.local/check-signer.ts'
  $code=@'
import { Wallet } from 'npm:ethers@6.17.0/wallet';
console.log(new Wallet(Deno.env.get('CIVICPROOF_DEPLOYER_KEY')!).address);
'@
  [IO.File]::WriteAllText($checker,$code,[Text.UTF8Encoding]::new($false))
  $address=& npx.cmd --yes deno@2.9.6 run --no-prompt --allow-env=CIVICPROOF_DEPLOYER_KEY,WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE $checker
  if($LASTEXITCODE -ne 0 -or ($address|Select-Object -Last 1) -ine $expectedSigner){throw 'This key does not match the contract deployer. Nothing was saved.'}
  $h=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Get-SupabaseMcpHeaders.ps1')|ConvertFrom-Json
  $body=ConvertTo-Json -InputObject @(
    @{name='DEPLOYER_PRIVATE_KEY';value=$plain},
    @{name='FUJI_RPC_URL';value='https://api.avax-test.network/ext/bc/C/rpc'},
    @{name='WALLET_CONFIRMATIONS';value='2'}
  ) -Compress
  $null=Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/crshjvjrgnnypxbpjmob/secrets' -Headers @{Authorization=$h.Authorization} -ContentType 'application/json' -Body $body
  Write-Host 'Chain secrets saved. No key was printed. Tell Codex the secret is configured.'
}catch{
  Write-Host 'Secret setup did not complete. Confirm the correct testnet deployer key and retry; no key was printed.'
  exit 1
}finally{
  [Environment]::SetEnvironmentVariable('CIVICPROOF_DEPLOYER_KEY',$null,'Process')
  $plain=$null;$body=$null;$h=$null;$key.Dispose()
}
