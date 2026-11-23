# Synthesizes one WAV per line with the Windows speech engine (scratch VO for the animatic), and next
# to it <line>.words.json: where every spoken word starts in that WAV ({c, n} = character position
# and length in the line's text, t = seconds), taken from the engine's SpeakProgress events.
# Usage: powershell -File tts.ps1 -Manifest lines.json -Voice "Microsoft Zira Desktop" -Rate -1
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [string]$Voice = "Microsoft Zira Desktop",
  [int]$Rate = -1
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -Language CSharp -TypeDefinition @"
using System.Collections.Generic;
using System.Globalization;
using System.Speech.AudioFormat;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;

public static class VoLine {
  // Speaks text into wavPath and returns the word boundaries as a JSON array.
  public static string Speak(string text, string wavPath, string voice, int rate) {
    var words = new List<SpeakProgressEventArgs>();
    using (var done = new ManualResetEventSlim(false))
    using (var synth = new SpeechSynthesizer()) {
      synth.SelectVoice(voice);
      synth.Rate = rate;
      synth.SetOutputToWaveFile(wavPath, new SpeechAudioFormatInfo(22050, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
      synth.SpeakProgress += (s, e) => { lock (words) { words.Add(e); } };
      synth.SpeakCompleted += (s, e) => done.Set();
      synth.SpeakAsync(text);
      done.Wait();
      // Progress events are posted to the thread pool; let any late ones land before reading.
      Thread.Sleep(150);
      synth.SetOutputToNull();
    }
    lock (words) {
      words.Sort((a, b) => a.CharacterPosition.CompareTo(b.CharacterPosition));
      var sb = new StringBuilder("[");
      for (int i = 0; i < words.Count; i++) {
        var e = words[i];
        sb.Append(i > 0 ? "," : "")
          .Append("{\"c\":").Append(e.CharacterPosition)
          .Append(",\"n\":").Append(e.CharacterCount)
          .Append(",\"t\":").Append(e.AudioPosition.TotalSeconds.ToString("0.000", CultureInfo.InvariantCulture))
          .Append("}");
      }
      return sb.Append("]").ToString();
    }
  }
}
"@
$items = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
foreach ($item in $items) {
  $json = [VoLine]::Speak($item.text, $item.path, $Voice, $Rate)
  $wordsPath = [System.IO.Path]::ChangeExtension($item.path, ".words.json")
  [System.IO.File]::WriteAllText($wordsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output ("tts: " + [System.IO.Path]::GetFileName($item.path))
}
