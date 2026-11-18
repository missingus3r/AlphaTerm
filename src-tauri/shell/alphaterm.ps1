# AlphaTerm: shell integration para Windows PowerShell 5.1 y PowerShell 7.
# Se pasa con -EncodedCommand (no es un archivo .ps1, así que no lo frena la política de ejecución).
# Emite OSC 133 (prompt/comando/fin con código), OSC 633;E (texto del comando) y OSC 7 (carpeta).
if ($global:__AlphaTermLoaded) { return }
$global:__AlphaTermLoaded = $true
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$global:__ntRan = $false
$global:__ntOrigPrompt = $function:prompt

function global:__ntEsc([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($ch -eq '\') { [void]$sb.Append('\\') }
    elseif ($c -lt 32 -or $c -eq 127 -or $ch -eq ';') { [void]$sb.Append(('\x{0:x2}' -f $c)) }
    else { [void]$sb.Append($ch) }
  }
  $sb.ToString()
}

function global:prompt {
  $ok = $?
  $ec = $global:LASTEXITCODE
  $e = [char]27; $b = [char]7
  $out = ''
  if ($global:__ntRan) {
    $code = if ($ok) { 0 } elseif (($ec -is [int]) -and $ec -ne 0) { $ec } else { 1 }
    $out += "$e]133;D;$code$b"
    $global:__ntRan = $false
  }
  $loc = $executionContext.SessionState.Path.CurrentLocation
  if ($loc.Provider.Name -eq 'FileSystem') {
    $p = [Uri]::EscapeDataString(($loc.ProviderPath -replace '\\', '/')).Replace('%2F', '/').Replace('%3A', ':')
    $out += "$e]7;file://$env:COMPUTERNAME/$p$b"
  }
  $orig = if ($global:__ntOrigPrompt) { & $global:__ntOrigPrompt } else { "PS $loc> " }
  $global:LASTEXITCODE = $ec
  "$out$e]133;A$b$orig$e]133;B$b"
}

if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
  $global:__ntOrigReadLine = $function:PSConsoleHostReadLine
  function global:PSConsoleHostReadLine {
    $line = & $global:__ntOrigReadLine
    if ($line -and $line.Trim()) {
      $global:__ntRan = $true
      $e = [char]27; $b = [char]7
      [Console]::Write("$e]633;E;$(__ntEsc $line)$b$e]133;C$b")
    }
    $line
  }
}
