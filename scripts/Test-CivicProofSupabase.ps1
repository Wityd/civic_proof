# Current verification entrypoint after the Supabase-first migration.
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-SupabaseFirst.ps1')
exit $LASTEXITCODE