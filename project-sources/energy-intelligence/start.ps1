$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try { node scripts/start.mjs } finally { Pop-Location }
