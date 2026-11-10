[CmdletBinding()]
param(
  [int]$Port = 3000,
  [string]$CloudflaredPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $projectRoot ".tools"

if (-not $CloudflaredPath -and $env:CLOUDFLARED_PATH) {
  $CloudflaredPath = $env:CLOUDFLARED_PATH
}

if (-not $CloudflaredPath) {
  $CloudflaredPath = Join-Path $toolsDir "cloudflared.exe"
}

if (-not (Test-Path $CloudflaredPath)) {
  Write-Host "cloudflared was not found. Downloading the official Windows binary..." -ForegroundColor Cyan

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js was not found in PATH. Install Node.js 18.17+ from https://nodejs.org/ first, or pass -CloudflaredPath to an existing cloudflared.exe."
  }

  New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  $tempScript = Join-Path $env:TEMP ("download-cloudflared-" + [guid]::NewGuid().ToString("N") + ".js")
  $downloadCode = @'
const fs = require("fs");
const url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
(async () => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(300000),
    headers: { "user-agent": "cet-arena-tunnel-helper" },
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(process.argv[2], data);
  console.log("Downloaded " + data.length + " bytes");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
'@

  Set-Content -Path $tempScript -Value $downloadCode -Encoding UTF8
  try {
    & $node.Source $tempScript $CloudflaredPath
    if ($LASTEXITCODE -ne 0) {
      throw "cloudflared download failed (exit $LASTEXITCODE)."
    }
  } catch {
    Remove-Item $CloudflaredPath -Force -ErrorAction SilentlyContinue
    throw
  } finally {
    Remove-Item $tempScript -Force -ErrorAction SilentlyContinue
  }

  $signature = Get-AuthenticodeSignature -FilePath $CloudflaredPath
  $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { "" }
  if ($signature.Status -ne "Valid" -or $signer -notmatch "Cloudflare") {
    Remove-Item $CloudflaredPath -Force -ErrorAction SilentlyContinue
    throw "Downloaded cloudflared did not pass the Cloudflare digital signature check. Nothing was executed."
  }
  Write-Host "Signature verified: Cloudflare, Inc." -ForegroundColor Green
}

Write-Host ""
Write-Host "Starting Cloudflare Quick Tunnel for http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Keep this terminal open. Copy the https://*.trycloudflare.com URL below." -ForegroundColor Yellow
Write-Host ""

& $CloudflaredPath tunnel --url "http://localhost:$Port" --no-autoupdate --protocol http2 --edge-ip-version 4
exit $LASTEXITCODE
