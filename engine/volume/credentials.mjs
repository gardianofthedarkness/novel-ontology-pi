// The model keys from the Windows Credential Manager (the user, 2026-11-15: "We have already stored in windows secure
// management"): generic credentials named novel-ontology/<name> (engine/characters/pipeline/vault.py writes them). Read
// for a step's environment when the caller's environment has none; never printed, logged or written anywhere.
// Elsewhere than Windows, or with no such credential, nothing.
import { spawnSync } from 'node:child_process';

/** Which stored credential gives which key, first found wins. */
export const KEY_NAMES = { WORK_LLM_API_KEY: ['deepseek', 'work-llm'], TYPESAFE_API_KEY: ['jev', 'typesafe'] };

const READ = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class NovelCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr buffer);
  static bool Plain(string s) { if (s == null) return false; string t = s.Trim(); if (t.Length == 0) return false; foreach (char ch in t) if (ch <= 32 || ch >= 127) return false; return true; }
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) return "";
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      if (c.CredentialBlobSize <= 0) return "";
      var bytes = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, bytes, 0, bytes.Length);
      string utf16 = bytes.Length % 2 == 0 ? System.Text.Encoding.Unicode.GetString(bytes) : null;
      string utf8 = System.Text.Encoding.UTF8.GetString(bytes);
      if (Plain(utf16)) return utf16.Trim();
      if (Plain(utf8)) return utf8.Trim();
      return "";
    } finally { CredFree(pointer); }
  }
}
'@
foreach ($name in $args) { [Console]::Out.WriteLine([NovelCredential]::Read('novel-ontology/' + $name)) }
`;

const cache = new Map();
/** The stored credentials by name (novel-ontology/<name>): a value, or null where there is none. One PowerShell call. */
export function readCredentials(names) {
  const wanted = [...new Set(names)].filter(name => /^[\w-]{1,40}$/.test(name) && !cache.has(name));
  if (wanted.length && process.platform === 'win32') {
    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `& { ${READ} } ${wanted.map(name => `'${name}'`).join(' ')}`], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const lines = run.status === 0 ? String(run.stdout).split(/\r?\n/) : [];
    wanted.forEach((name, n) => cache.set(name, lines[n]?.trim() || null));
  }
  return Object.fromEntries(names.map(name => [name, cache.get(name) ?? null]));
}

/** The keys an environment lacks, from the stored credentials ({ WORK_LLM_API_KEY, TYPESAFE_API_KEY } as found). */
export function storedKeys(env = process.env) {
  const missing = Object.entries(KEY_NAMES).filter(([key]) => !env[key]?.trim());
  if (!missing.length) return {};
  const found = readCredentials(missing.flatMap(([, names]) => names)), out = {};
  for (const [key, names] of missing) { const value = names.map(name => found[name]).find(Boolean); if (value) out[key] = value; }
  return out;
}
