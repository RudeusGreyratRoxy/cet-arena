#requires -Version 5.1
<#
  用 Windows SAPI 把单词合成成 WAV（供 build_audio.py 再压成 MP3）。
  用法: powershell -NoProfile -ExecutionPolicy Bypass -File synth_wav.ps1 -WordsFile a.txt -OutDir d:\wav
  每行一个单词；输出 <OutDir>\<word>.wav
#>
param(
  [Parameter(Mandatory = $true)][string]$WordsFile,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$words = Get-Content -LiteralPath $WordsFile -Encoding UTF8 | Where-Object { $_.Trim() -ne '' }
Write-Output ("PENDING=" + $words.Count)

$voice = New-Object -ComObject SAPI.SpVoice

# 优先选英文音色
$chosen = $null
$voices = $voice.GetVoices()
for ($i = 0; $i -lt $voices.Count; $i++) {
  $desc = $voices.Item($i).GetDescription()
  if ($desc -match 'English|Zira|David|Mark') { $chosen = $voices.Item($i); break }
}
if ($chosen) {
  $voice.Voice = $chosen
  Write-Output ("VOICE=" + $chosen.GetDescription())
} else {
  Write-Output "VOICE=<default>"
}

# 语速略慢一点，方便听清
$voice.Rate = -1

$done = 0
foreach ($word in $words) {
  $w = $word.Trim()
  if ($w -eq '') { continue }
  $path = Join-Path $OutDir ($w + '.wav')
  if (Test-Path $path) { $done++; continue }

  $stream = New-Object -ComObject SAPI.SpFileStream
  # SSFMCreateForWrite = 3
  $stream.Open($path, 3, $false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak($w)
  $stream.Close()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream)

  $done++
  if ($done % 100 -eq 0) { Write-Output ("PROGRESS=" + $done) }
}

Write-Output ("DONE=" + $done)
