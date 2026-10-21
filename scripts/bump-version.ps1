param(
    [ValidateSet("patch", "minor", "major")]
    [string]$Type = "patch",

    [ValidateSet("all", "android", "windows")]
    [string]$Target = "all",

    [switch]$Commit,
    [switch]$Push,
    [switch]$DryRun
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonScript = Join-Path $scriptDir "bump_version.py"

$pyArgs = @($pythonScript, "--type", $Type, "--target", $Target)
if ($DryRun) {
    $pyArgs += "--dry-run"
}

python @pyArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Version bump script failed."
    exit $LASTEXITCODE
}

if ($Commit -and -not $DryRun) {
    $gitExe = "C:\Users\owenc\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe"
    if (-not (Test-Path $gitExe)) {
        $gitExe = "git"
    }

    & $gitExe add android/app/build.gradle.kts windows/package.json
    $commitMsg = "chore(release): bump version ($Target $Type)"
    & $gitExe commit -m $commitMsg

    if ($Push) {
        Write-Host "Pushing commit to remote..."
        & $gitExe push
    }
}
