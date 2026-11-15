#!/bin/bash
# Fügt Kern und Acrobat-Anbindung zu EINER Datei zusammen (Acrobat lädt Folder-Level-Scripts einzeln,
# und die Reihenfolge wäre nicht garantiert – deshalb eine Datei).
# Acrobat liest die Datei NICHT als UTF-8 (Umlaute, ✔, –, × kämen kaputt an) – darum werden alle
# Nicht-ASCII-Zeichen als \uXXXX geschrieben; das gilt in Strings, Regex und Kommentaren gleichermaßen.
set -e
HIER="$(cd "$(dirname "$0")" && pwd)"
{
  echo "/* dwb Druck-Werkzeuge f\\u00fcr Acrobat Pro - gebaut am $(date '+%Y-%m-%d %H:%M') - nicht von Hand \\u00e4ndern, sondern src/ bearbeiten und bauen.sh laufen lassen */"
  cat "$HIER/src/core.js"
  echo
  cat "$HIER/src/spotfarben.js"
  echo
  cat "$HIER/src/acrobat.js"
} | python3 -c '
import sys
s = sys.stdin.read()
out = []
for ch in s:
    o = ord(ch)
    if o < 128: out.append(ch)
    elif o > 0xFFFF:
        o -= 0x10000; out.append("\\u%04x\\u%04x" % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
    else: out.append("\\u%04x" % o)
sys.stdout.write("".join(out))
' > "$HIER/dwb_acrobat.js"
node --check "$HIER/dwb_acrobat.js"
if LC_ALL=C grep -q '[^ -~[:space:]]' "$HIER/dwb_acrobat.js"; then echo "✖ noch Nicht-ASCII-Zeichen enthalten"; exit 1; fi
echo "✔ gebaut: $HIER/dwb_acrobat.js ($(wc -c < "$HIER/dwb_acrobat.js" | tr -d ' ') Bytes, reines ASCII)"
