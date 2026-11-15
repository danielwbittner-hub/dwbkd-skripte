# Acrobat — dwb Druck-Werkzeuge

Erweiterung für **Adobe Acrobat Pro** (getestet mit 26.002 auf macOS) als
Folder-Level-JavaScript. Kein Acrobat-SDK, kein Compiler: eine Datei, die
Acrobat beim Start lädt und die ein Menü **dwb** unter **Bearbeiten** einhängt.

| Menüpunkt | Was passiert |
|---|---|
| **Anschnitt prüfen …** | liest die Seitenboxen direkt aus der Datei und rechnet je Seite den Anschnitt in mm aus (links/rechts/oben/unten), meldet fehlende TrimBox, zu kleinen Anschnitt (Soll 3 mm), Rand für Druckmarken |
| **Farbräume anzeigen …** | zählt, welche Farbräume wirklich benutzt werden: Vektorfüllungen/-konturen, Verläufe und Bilder getrennt, ICC-Profile mit Namen (z. B. „Coated FOGRA39“), Sonderfarben mit Verwendungszahl, Output-Intent, PDF/X-Kennung, Erzeuger — plus die Schriftenliste |
| **Schriften in Pfade umwandeln …** | lässt Acrobats eingebaute Preflight-Korrektur „Schriften in Kurven konvertieren“ laufen, sichert das Ergebnis als Kopie `…_Pfade.pdf` (Original bleibt unangetastet) und prüft nach, ob wirklich keine Schrift mehr drin ist |
| **Bildauflösung prüfen …** | effektive Auflösung jeder Bildplatzierung (Pixelmaß ÷ Platzierungsgröße, mit Transformationsmatrix), Ampel: unter 150 ppi ✖, unter 300 ppi ⚠, Strichbilder gut ab 600 ppi; gleiche Zeilen je Seite zusammengefasst |
| **Reinzeichnung prüfen …** | Haarlinien unter 0,25 pt und Linien mit Breite 0, Gesamtfarbauftrag über 300 % (Vektoren/Text), Text in Tiefschwarz oder RGB, Weiß auf Überdrucken, Passermarkenfarbe im Inhalt, Transparenz (Deckkraft/Mischmodus/weiche Maske/Alphakanal), uneinheitliche Seitenformate, Kommentare, Formularfelder, Ebenen, Anhänge, JavaScript, unsichtbarer Text |
| **Endformat & Anschnitt setzen …** | Dialog: Anschnitt und Markenrand in mm, alle oder nur die aktuelle Seite, wahlweise CropBox auf den Anschnittrahmen → setzt TrimBox/ArtBox und BleedBox aus der MediaBox (Kundendateien ohne Endformat); zeigt danach den Anschnitt-Bericht, sichern bleibt dir überlassen |
| **Hintergrund einfärben (CMYK / Sonderfarbe) …** | Erst ein Aufklappmenü zur Farbwahl: **CMYK direkt** · **HKS** (K Kunstdruck / N Naturpapier, 86 Töne) · **Pantone** (Solid Coated) · **eigene Farben**. Dann die Seitenauswahl (alle · jede zweite ab Seite 1 · jede zweite ab Seite 2 · nur aktuelle) und hinter/über den Inhalt. Zwei Füll-Arten: **echte Sonderfarbe** (echte `/Separation`-Platte als Vollton, eigene Druckplatte wie „HKS 43 K“ – nur für die mitgelieferten HKS-/Pantone-Farben) oder **CMYK-Annäherung** (beliebiger Tonwert, kein eigener Druckkanal). Quelle: vorgebaute Helfer-PDFs (Separation) bzw. ein flachgerechnetes CMYK-Rechteck, je Seite als Wasserzeichen; rückgängig mit ⌘Z, sichern mit ⌘S. Prüfbar über „Farbräume anzeigen“ oder die Ausgabevorschau |
| **Druck-Check (alles) …** | alle Berichte in einem Fenster |

Jeder Bericht erscheint in einem scrollbaren Fenster **und** in der
JavaScript-Konsole (⌘J), von dort lässt er sich komplett kopieren.

---

## Installation

```bash
"/Users/danielbittner/Claude Code/Acrobat/installieren.command"
```

Doppelklick tut dasselbe (fragt: Einrichten / Entfernen / Prüfen). Kopiert
`dwb_acrobat.js` nach `~/Library/Application Support/Adobe/Acrobat/DC/JavaScripts/`
— **danach Acrobat neu starten**. In der neuen Acrobat-Oberfläche steckt die
Menüleiste hinter ☰ **Menü** (oben links): dort **Bearbeiten ▸ dwb**.

Voraussetzung: Acrobat **Pro** (für die Pfad-Umwandlung; Preflight gibt es nur
dort) und JavaScript darf nicht abgeschaltet sein (Einstellungen ▸ JavaScript ▸
„Acrobat JavaScript aktivieren“).

### Wenn macOS die Ausführung blockiert

Frisch heruntergeladene `.command`-Dateien behandelt macOS als „nicht
verifiziert“ und öffnet sie beim Doppelklick zunächst nicht („… kann nicht
geöffnet werden, da Apple es nicht auf Schadsoftware prüfen konnte“). Einmal
freigeben, danach läuft die Datei normal:

* **Schnell:** Rechtsklick (ctrl-Klick) auf die Datei ▸ **Öffnen**, im
  Hinweisfenster noch einmal **Öffnen**.
* **Steht dort kein „Öffnen“** (neuere macOS): einmal doppelklicken, dann
  **Systemeinstellungen ▸ Datenschutz & Sicherheit** öffnen, nach unten rollen
  und bei der Meldung zur Datei auf **Dennoch öffnen** klicken.
* **Per Terminal** (nimmt die Sperre für alle mitgelieferten Dateien auf
  einmal): `xattr -dr com.apple.quarantine ORDNER` — statt `ORDNER` den Ordner
  ins Terminalfenster ziehen, dann Eingabetaste.

Kommt gar kein Dialog, fehlt der Datei meist nur das Ausführrecht:
`chmod +x "Pfad/zur/Datei.command"`.

---

## Wie es arbeitet (und warum so)

Acrobats JavaScript kennt keine Farbräume und keine Inhalte — nur Seitenboxen
(`getPageBox`) und die Preflight-Profile. Deshalb liest das Skript die
**gespeicherte PDF-Datei selbst** (`util.readFileIntoStream`, Base64) und
wertet sie mit einem eigenen kleinen Parser aus (`src/core.js`):

* eigene **Inflate**-Routine (Flate-Ströme, Objektströme, PNG-Prädiktor), dazu
  ASCII85/ASCIIHex/LZW/RunLength; Bilddaten (DCT/JPX/CCITT) werden nicht
  entpackt, nur ihre Wörterbücher gelesen
* Objekte in **Dateireihenfolge**, spätere Definition gewinnt (inkrementelle
  Speicherstände), kein xref nötig → auch leicht kaputte Dateien gehen
* Inhaltsströme werden **wirklich gelesen**: `k/rg/g/cs/scn/sh/Do/Tf/Tj` je
  Seite, Form-XObjects und Muster rekursiv (mit Zyklusschutz, Ergebnis je
  Form gecacht), Inline-Bilder, unsichtbarer Text (Tr 3/7)
* **ICC-Profile** werden geöffnet: Farbraum aus dem Kopf, Name aus dem
  `desc`-Tag (v2 `desc`, v4 `mluc`)
* Anschnitt = Abstand TrimBox → BleedBox (ersatzweise CropBox/MediaBox, wird
  benannt); Seitendrehung wird umgerechnet, Maße wie in Acrobat angezeigt
* der Inhaltsscanner führt die **Transformationsmatrix** mit (`cm`, `q/Q`,
  Form-Matrix, Muster-Matrix): daraus effektive ppi der Bilder und die
  tatsächliche Strichstärke (Linienbreite × Skalierung); Formulare werden je
  (Objekt, Skalierung) einmal gezählt und gecacht
* `gs`-Zustände werden aufgelöst (LW, OP/op, CA/ca, SMask, BM) – so entstehen
  „Weiß auf Überdrucken“ und die Transparenz-Zählung; gezählt wird beim Malen
  (`f`, `S`, `B`, `Tj`, `Do`, `sh`), nicht beim Setzen der Farbe

Fällt das Lesen aus (ungespeichert, Cloud, verschlüsselt), nimmt „Anschnitt
prüfen“ Acrobats `getPageBox` als Notnagel — dort ist aber nicht
unterscheidbar, ob eine TrimBox fehlt oder nur gleich der CropBox ist.

### Pfad-Umwandlung — die Falle

`doc.preflight(profil, true)` (mit Fortschrittsanzeige) meldete zwar Erfolg,
aber ein direkt anschließendes `saveAs` schrieb die Datei **ohne** die
Korrektur. Mit `bDisplayProgress = false` sitzt die Korrektur sofort im
Dokument — so steht es jetzt im Code. Das Ergebnis-Objekt heißt
`numFixed`/`numNotFixed`/`numErrors`/`numWarnings`/`numInfos` (nicht
`numFixupsApplied`, wie man vermuten würde).

Das Profil wird über den Namen gesucht (Muster `outline|pfad|kurve|kontur|zeichenweg`);
auf Deutsch heißt es **„Schriften in Kurven konvertieren“**. Trifft nichts,
zeigt das Skript alle Profile in Gruppen an; die letzte Wahl merkt sich Acrobat
(`global.dwbPfadProfil`).

---

## Dateien

```
Acrobat/
├── dwb_acrobat.js        ← gebaute Datei, das ist das „Plugin“ (src zusammengeklebt)
├── src/core.js           reiner Kern: Parser, Inflate, Farbräume, Boxen, Berichte (läuft auch in Node)
├── src/spotfarben.js     Sonderfarben-Datenmodul (HKS/Pantone) — ERZEUGT, nicht von Hand ändern
├── src/acrobat.js        Acrobat-Anbindung: Menü, Dialoge, Preflight, saveAs
├── resources/spotfarben.json        Stammdaten der Sonderfarben (einzige Quelle)
├── resources/spot/*.pdf              vorgebaute Separation-Helfer (je Farbe eine echte /Separation, Vollton)
├── werkzeuge/spot-helfer-bauen.py    erzeugt aus der JSON spotfarben.js + resources/spot/*.pdf
├── bauen.sh              klebt src/ zu dwb_acrobat.js zusammen (node --check)
├── installieren.command  einrichten / entfernen / prüfen (spiegelt resources/spot nach …/JavaScripts/dwb-spot)
└── test/pruefen.js       node test/pruefen.js datei.pdf [--nur-boxen] [--inflate-test]
```

### Sonderfarben pflegen

Einzige Datenquelle ist `resources/spotfarben.json`. Farben ergänzen/korrigieren,
dann `python3 werkzeuge/spot-helfer-bauen.py` (schreibt `src/spotfarben.js` **und**
die Helfer-PDFs neu), danach `./installieren.command`. Die echte Separation legt
je Seite eine vorgebaute PDF mit echter `/Separation`-Farbe als Wasserzeichen auf;
den Helfer-Ordner findet das Skript über `app.getPath("user","javascript") + "/dwb-spot"`.

* **HKS-CMYK**: aus einer geprüften Umrechnungstabelle (K = Kunstdruck, N = Naturpapier).
* **Pantone-CMYK**: Bridge-**Annäherung** — vor dem Druck am Fächer prüfen. Für die echte
  Separation ist der CMYK-Wert nur die Proof-/Bildschirmfarbe; die Platte trägt den Farbnamen.
* **Eigene Farben**: im Menü „Neue eigene Farbe anlegen …“ (Name + CMYK, bleibt gemerkt) —
  nur CMYK-Annäherung, keine echte Separationsplatte (die bräuchte eine vorgebaute Helfer-PDF).

`--inflate-test` vergleicht jeden Flate-Strom mit zlib (bisher überall
identisch). Der Kern wurde an Pantone-Briefbögen, Visitenkarten, einer
56-seitigen Word-Broschüre, PDF/UA-Dateien und Scans geprüft; die
56 Seiten brauchen 0,1 s in Node, in Acrobat etwa eine halbe Sekunde.

## Grenzwerte

`DWB.GRENZEN` in `src/core.js`: Haarlinie 0,25 pt, Farbauftrag 300 %,
Halbton 300 ppi (kritisch unter 150), Strichbild 600 ppi (kritisch unter 300).

## Einstellungen

Oben in `src/acrobat.js` (`dwbA.EINSTELLUNG`): Soll-Anschnitt (3 mm),
Eltern-Menü (`Edit`, interner Name), Suchmuster fürs Profil, Namenszusatz
der Kopie (`_Pfade`), Größengrenze für die Rückfrage (150 MB). Nach Änderung
`bauen.sh` und `installieren.command`, dann Acrobat neu starten.

## Grenzen

* Anschnitt wird aus den **Boxen** ermittelt, nicht aus dem Inhalt: ob eine
  Fläche tatsächlich bis in den Anschnitt reicht, sagt das Skript nicht.
* Der Farbauftrag wird nur für Vektoren und Text gemessen, nicht in Bildern
  (dazu müssten die Pixel entpackt werden). Sonderfarben zählen nicht mit.
* „Weiß auf Überdrucken“ erkennt Weiß in CMYK/RGB/Grau und Tonwert 0 bei
  Sonderfarben; Weiß über DeviceN wird nicht erkannt.
* Verschlüsselte PDFs: nur Boxen, keine Inhalte.
* Text in Formularfeldern/Anmerkungen wandelt Acrobats Korrektur nicht um —
  der Nachher-Bericht zeigt das dann als verbliebene Schrift.
