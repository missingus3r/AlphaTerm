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
  if ($global:__ntNonce) { $out += "$e]7717;ready;$global:__ntNonce$b" }
  $orig = if ($global:__ntOrigPrompt) { & $global:__ntOrigPrompt } else { "PS $loc> " }
  $global:LASTEXITCODE = $ec
  "$out$e]133;A$b$orig$e]133;B$b"
}

# Predicciones: AlphaTerm manda el atajo F12,e y se le contesta con los completados de esta sesión
# (TabExpansion2) en una OSC 7717 invisible, con el nonce que puso en ALPHATERM_NONCE. No toca el buffer.
if ($env:ALPHATERM_NONCE -and (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue)) {
  $nonce = $env:ALPHATERM_NONCE
  Remove-Item Env:ALPHATERM_NONCE -ErrorAction SilentlyContinue
  try {
    Set-PSReadLineKeyHandler -Chord 'F12,e' -BriefDescription AlphaTermCompletions -ScriptBlock {
      $buf = $null; $cur = 0
      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$buf, [ref]$cur)
      $res = [ordered]@{ b = $buf; c = $cur; i = $cur; l = 0; r = @() }
      try {
        $x = TabExpansion2 -inputScript $buf -cursorColumn $cur
        if ($x) {
          $res.i = $x.ReplacementIndex
          $res.l = $x.ReplacementLength
          $res.r = @($x.CompletionMatches | Select-Object -First 100 | ForEach-Object {
            $tip = "$($_.ToolTip)"
            if ($tip.Length -gt 200) { $tip = $tip.Substring(0, 200) }
            [ordered]@{ t = $_.CompletionText; s = $_.ListItemText; k = "$($_.ResultType)"; d = $tip }
          })
        }
      } catch {}
      $json = ConvertTo-Json $res -Compress -Depth 4
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
      [Console]::Write("$([char]27)]7717;c;$global:__ntNonce;$b64$([char]7)")
    }
    $global:__ntNonce = $nonce
  } catch {}
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
