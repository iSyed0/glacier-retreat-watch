<#
Lets other PCs on the network reach the portal on TCP 8000 (see start.bat).

Two things can stop them, both in Windows Firewall:
  1. No inbound allow rule for TCP 8000      -> add "HKH-Glacier-Watch".
  2. An inbound BLOCK rule for the Python that runs the server (Windows
     creates one when its "blocked some features" prompt is cancelled).
     Block rules beat allow rules, so (1) is useless while it exists
     -> remove it. Only rules for that exact python.exe are touched.

  -Check   report only (no admin needed): exit 0 if nothing to fix, 1 if a
           fix is needed. start.bat runs this first and only asks for admin
           (UAC) when it returns 1.
  (none)   apply the fixes -- must run elevated.
#>
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$RuleName = 'HKH-Glacier-Watch'
$Port = 8000

# The interpreter that actually listens: the venv's python.exe is only a
# launcher for the base install, and firewall rules match the base one.
$venvPython = Join-Path $PSScriptRoot '..\backend\.venv\Scripts\python.exe'
try {
    $python = (& $venvPython -c 'import sys; print(sys._base_executable)').Trim()
} catch {
    Write-Host "FAILED: can't run $venvPython -- $_" -ForegroundColor Red
    if (-not $Check) { Read-Host 'Press Enter to close' }
    exit 1
}

# Rules as Windows enforces them (ActiveStore -- includes group-policy rules)
# for the check, but rules can only be *deleted* from the local persistent
# store, so the fix re-reads them from there.
function Get-PythonBlockRules([string]$Store) {
    $filters = if ($Store) { Get-NetFirewallApplicationFilter -PolicyStore $Store -ErrorAction SilentlyContinue }
               else { Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue }
    @($filters | Where-Object { $_.Program -eq $python } | Get-NetFirewallRule |
        Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' })
}

if ($Check) {
    $blocked = (Get-PythonBlockRules 'ActiveStore').Count -gt 0
    $portRule = Get-NetFirewallRule -DisplayName $RuleName -PolicyStore ActiveStore -ErrorAction SilentlyContinue
    if ($blocked -or -not $portRule) { exit 1 }
    exit 0
}

# Fix mode runs in its own elevated window (see start.bat) -- log to a file
# next to this script and keep the window open, so a failure is visible.
$log = Join-Path $PSScriptRoot 'allow_network.log'
Start-Transcript -Path $log -Force | Out-Null
$code = 0
try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw 'Run this as Administrator.' }
    Write-Host "Python: $python"

    foreach ($rule in Get-PythonBlockRules) {
        Write-Host "Removing block rule: $($rule.DisplayName) [$($rule.Profile)]"
        Remove-NetFirewallRule -Name $rule.Name
    }
    if (-not (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)) {
        Write-Host "Allowing inbound TCP $Port ($RuleName)"
        New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port `
            -Action Allow -Profile Domain, Private | Out-Null
    }

    $left = Get-PythonBlockRules 'ActiveStore'
    if ($left.Count) {
        # Still enforced after removing the local ones -> they come from
        # group policy, which only IT can change.
        throw "Python is still blocked by $($left.Count) rule(s) from group policy -- IT must allow it."
    }
    Write-Host 'Done: other PCs can now reach port 8000.' -ForegroundColor Green
} catch {
    Write-Host "FAILED: $_" -ForegroundColor Red
    $code = 1
} finally {
    Stop-Transcript | Out-Null
    Read-Host 'Press Enter to close'
}
exit $code
