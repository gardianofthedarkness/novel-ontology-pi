"""Keep API tokens in Windows Credential Manager (encrypted per user by Windows), never in files or output.

  python vault.py import <file.docx>   store every "name: value" line, print names only
  python vault.py list                 show which tokens are stored (names, lengths)
  from vault import get; get('huggingface')   read one inside a script
"""
import ctypes, ctypes.wintypes as w, re, sys, zipfile
from xml.etree import ElementTree as ET

PREFIX = 'novel-ontology/'
adv = ctypes.WinDLL('Advapi32', use_last_error=True)

class CREDENTIAL(ctypes.Structure):
    _fields_ = [('Flags', w.DWORD), ('Type', w.DWORD), ('TargetName', w.LPWSTR), ('Comment', w.LPWSTR),
                ('LastWritten', w.FILETIME), ('CredentialBlobSize', w.DWORD), ('CredentialBlob', ctypes.POINTER(ctypes.c_char)),
                ('Persist', w.DWORD), ('AttributeCount', w.DWORD), ('Attributes', ctypes.c_void_p),
                ('TargetAlias', w.LPWSTR), ('UserName', w.LPWSTR)]

CRED_TYPE_GENERIC, CRED_PERSIST_LOCAL_MACHINE = 1, 2
adv.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), w.DWORD]
adv.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
adv.CredFree.argtypes = [ctypes.c_void_p]
adv.CredEnumerateW.argtypes = [w.LPCWSTR, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.POINTER(ctypes.POINTER(ctypes.POINTER(CREDENTIAL)))]

def put(name, value):
    blob = value.encode('utf-8'); buf = ctypes.create_string_buffer(blob, len(blob))
    c = CREDENTIAL(Type=CRED_TYPE_GENERIC, TargetName=PREFIX + name, UserName=name, CredentialBlobSize=len(blob),
                   CredentialBlob=ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)), Persist=CRED_PERSIST_LOCAL_MACHINE)
    if not adv.CredWriteW(ctypes.byref(c), 0): raise ctypes.WinError(ctypes.get_last_error())

def get(name):
    p = ctypes.POINTER(CREDENTIAL)()
    if not adv.CredReadW(PREFIX + name, CRED_TYPE_GENERIC, 0, ctypes.byref(p)): return None
    try: return ctypes.string_at(p.contents.CredentialBlob, p.contents.CredentialBlobSize).decode('utf-8')
    finally: adv.CredFree(p)

def names():
    n, arr = w.DWORD(), ctypes.POINTER(ctypes.POINTER(CREDENTIAL))()
    if not adv.CredEnumerateW(PREFIX + '*', 0, ctypes.byref(n), ctypes.byref(arr)): return []
    try: return sorted(arr[i].contents.TargetName[len(PREFIX):] for i in range(n.value))
    finally: adv.CredFree(arr)

def docx_lines(path):
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    root = ET.fromstring(zipfile.ZipFile(path).read('word/document.xml'))
    return [''.join(t.text or '' for t in p.iter(ns + 't')) for p in root.iter(ns + 'p')]

def slug(label): return re.sub(r'[^a-z0-9]+', '-', label.strip().lower()).strip('-')

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'list'
    if cmd == 'run':                              # vault.py run <command...>: tokens exist only in that process
        import os, subprocess
        env = dict(os.environ)
        for name, var in (('huggingface', 'HF_TOKEN'), ('deepseek', 'DEEPSEEK_API_KEY'), ('jev', 'JEV_TOKEN')):
            if get(name): env[var] = get(name)
        sys.exit(subprocess.call(sys.argv[2:], env=env))
    if cmd == 'import':
        found, lines = 0, [l.strip() for l in docx_lines(sys.argv[2]) if l.strip()]
        pair = re.compile(r'([A-Za-z][\w .\-]{0,40}?)\s*[:：]\s*(\S*)')
        for i, line in enumerate(lines):
            for label, value in pair.findall(line):
                if not value and i + 1 < len(lines) and not pair.match(lines[i + 1]):
                    value = lines[i + 1]          # "jev:" with the token on the next line
                if not value: continue            # a heading such as "Tokens:"
                put(slug(label), value); found += 1
                print(f'stored {slug(label)}: {len(value)} characters')
        print(f'{found} token(s) stored')
    for n in names():
        v = get(n); print(f'  {n}: {len(v)} characters' + ('  (looks like a Hugging Face token)' if v.startswith('hf_') else ''))
