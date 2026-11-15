#!/bin/bash
# ============================================================================
#  dwb Druck-Werkzeuge für Acrobat Pro einrichten
# ----------------------------------------------------------------------------
#  Kopiert dwb_acrobat.js in Acrobats Ordner für Benutzer-Skripte
#  (~/Library/Application Support/Adobe/Acrobat/DC/JavaScripts).
#
#  Aufruf: Doppelklick (fragt: Einrichten / Entfernen / Prüfen), oder Terminal:
#          ./installieren.command              richtet ein (baut vorher neu, wenn node da ist)
#          ./installieren.command --entfernen  nimmt das Skript wieder heraus
#          ./installieren.command --pruefen    prüft nur
#
#  Danach Acrobat neu starten. Das Menü heißt „dwb“ und hängt unter „Bearbeiten“.
# ============================================================================
set -e
HIER="$(cd "$(dirname "$0")" && pwd)"
ZIEL="$HOME/Library/Application Support/Adobe/Acrobat/DC/JavaScripts"
DATEI="dwb_acrobat.js"
SPOT="dwb-spot"

MODUS="einrichten"
case "${1:-}" in
    --entfernen) MODUS="entfernen" ;;
    --pruefen)   MODUS="pruefen" ;;
    "") ;;
    *) echo "Unbekannter Schalter: $1"; exit 2 ;;
esac
if [ $# -eq 0 ] && [ -t 0 ]; then
    echo "  [1] Einrichten   [2] Entfernen   [3] Prüfen"
    printf "  Auswahl (Eingabetaste = Einrichten): "
    read -r WAHL
    case "$WAHL" in 2) MODUS="entfernen" ;; 3) MODUS="pruefen" ;; esac
    echo
fi

if pgrep -f "Adobe Acrobat.app/Contents/MacOS/AdobeAcrobat" >/dev/null 2>&1; then
    echo "⚠ Acrobat läuft gerade – Änderungen greifen erst nach einem Neustart von Acrobat."
    echo
fi

case "$MODUS" in
    einrichten)
        # Sonderfarb-Helfer und Datenmodul bei Bedarf neu erzeugen, dann Skript bauen
        if command -v python3 >/dev/null 2>&1 && [ -f "$HIER/werkzeuge/spot-helfer-bauen.py" ]; then python3 "$HIER/werkzeuge/spot-helfer-bauen.py"; fi
        if command -v node >/dev/null 2>&1 && [ -d "$HIER/src" ]; then "$HIER/bauen.sh"; fi
        mkdir -p "$ZIEL"
        cp "$HIER/$DATEI" "$ZIEL/$DATEI"
        echo "✔ eingerichtet: $ZIEL/$DATEI"
        # Sonderfarb-Helfer-PDFs (echte Separationen) in einen Unterordner spiegeln
        if [ -d "$HIER/resources/spot" ]; then
            rm -rf "$ZIEL/$SPOT"
            mkdir -p "$ZIEL/$SPOT"
            cp "$HIER/resources/spot/"*.pdf "$ZIEL/$SPOT/" 2>/dev/null || true
            ANZ=$(ls -1 "$ZIEL/$SPOT/"*.pdf 2>/dev/null | wc -l | tr -d ' ')
            echo "✔ Sonderfarben eingerichtet: $ANZ Helfer-PDFs in $ZIEL/$SPOT"
        fi
        echo "  Acrobat neu starten → Menü „Bearbeiten ▸ dwb“ (in der neuen Oberfläche: ☰ Menü ▸ Bearbeiten ▸ dwb)."
        ;;
    entfernen)
        if [ -f "$ZIEL/$DATEI" ]; then rm "$ZIEL/$DATEI"; echo "✔ entfernt: $ZIEL/$DATEI"; else echo "– war nicht eingerichtet"; fi
        if [ -d "$ZIEL/$SPOT" ]; then rm -rf "$ZIEL/$SPOT"; echo "✔ Sonderfarb-Helfer entfernt: $ZIEL/$SPOT"; fi
        ;;
    pruefen)
        if [ -f "$ZIEL/$DATEI" ]; then
            if cmp -s "$ZIEL/$DATEI" "$HIER/$DATEI"; then echo "✔ eingerichtet und aktuell: $ZIEL/$DATEI"; else echo "⚠ eingerichtet, aber älter als die Datei hier – bitte neu einrichten"; fi
        else echo "✖ nicht eingerichtet"; fi
        if [ -d "$ZIEL/$SPOT" ]; then
            echo "  Sonderfarb-Helfer: $(ls -1 "$ZIEL/$SPOT/"*.pdf 2>/dev/null | wc -l | tr -d ' ') PDFs in $ZIEL/$SPOT"
        else echo "  Sonderfarb-Helfer: ✖ nicht eingerichtet (Separationen nicht verfügbar)"; fi
        ;;
esac
