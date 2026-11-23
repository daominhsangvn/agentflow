# Synthesizes one WAV per line with the Windows speech engine (scratch VO for the animatic).
# Usage: powershell -File tts.ps1 -Manifest lines.json -Voice "Microsoft Zira Desktop" -Rate -1
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [string]$Voice = "Microsoft Zira Desktop",
  [int]$Rate = -1
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  22050,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)
foreach ($item in $items) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($Voice)
  $synth.Rate = $Rate
  $synth.SetOutputToWaveFile($item.path, $format)
  $synth.Speak($item.text)
  $synth.Dispose()
  Write-Output ("tts: " + [System.IO.Path]::GetFileName($item.path))
}
