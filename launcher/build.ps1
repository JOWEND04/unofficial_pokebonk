# PokéBonk Dedicated Launcher Build Script
param(
    [string]$OutPath = "windows/dist/PokeBonk-Launcher.exe"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (!(Test-Path $cscPath)) {
    $cscPath = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (!(Test-Path $cscPath)) {
    throw "Visual C# Compiler (csc.exe) not found on this system."
}

$iconPath = Join-Path $repoRoot "windows/build/icon.ico"
$manifestPath = Join-Path $scriptDir "launcher.manifest"
$sourcePath = Join-Path $scriptDir "src/Program.cs"
$targetExe = Join-Path $repoRoot $OutPath

$targetDir = Split-Path -Parent $targetExe
if (!(Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

Write-Host "Compiling PokéBonk Dedicated Launcher using $cscPath..." -ForegroundColor Cyan

$cscArgs = @(
    "/target:winexe",
    "/out:$targetExe",
    "/win32icon:$iconPath",
    "/win32manifest:$manifestPath",
    "/r:System.dll",
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    "/r:System.Web.Extensions.dll",
    "/optimize+",
    "/platform:anycpu",
    $sourcePath
)

& $cscPath $cscArgs

if ($LASTEXITCODE -ne 0) {
    throw "Compilation failed with exit code $LASTEXITCODE"
}

$sizeKb = [Math]::Round((Get-Item $targetExe).Length / 1024, 1)
Write-Host "Successfully built PokeBonk-Launcher.exe ($sizeKb KB) at $targetExe" -ForegroundColor Green
