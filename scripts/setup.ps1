# One-step setup on Windows 10/11. Run in PowerShell from the CityBuilder folder:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# Installs Node.js and Git with winget if they are missing, then the project's
# packages, and checks everything works.

$ErrorActionPreference = 'Stop'

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Have node)) {
  Write-Host 'Installing Node.js LTS with winget...'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
if (-not (Have git)) {
  Write-Host 'Installing Git with winget...'
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node.js $(node --version) is too old; install the LTS from https://nodejs.org and run this again." }

# npm.cmd avoids PowerShell's script execution policy blocking npm.ps1.
Write-Host 'Installing packages...'
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Write-Host 'Checking with an offline demo build...'
npm.cmd run build:world -- melbourne --synthetic --preview
if ($LASTEXITCODE -ne 0) { throw 'demo build failed' }

Write-Host ''
Write-Host 'Ready. Build a real city, then open the viewer:' -ForegroundColor Green
Write-Host '  npm.cmd run city -- "Wellington, New Zealand"'
Write-Host '  npm.cmd run dev        (then open http://localhost:5173)'
