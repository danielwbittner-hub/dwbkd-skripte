# dwbkd · Skripte & Werkzeuge

Eigene Skripte, Bedienfelder und Werkzeuge für **Adobe InDesign**, **Adobe
Illustrator** und **Affinity** – entstanden aus der täglichen Arbeit in Satz,
Reinzeichnung und Druckvorstufe. Kleine Helfer, die wiederkehrende Handgriffe
abnehmen.

Dieselben Werkzeuge stehen mit ausführlichen Beschreibungen auch unter
**<https://dwbkd.de/scripte.html>** zum Download bereit.

> ## ⚠️ Haftungsausschluss – bitte zuerst lesen
>
> Diese Werkzeuge greifen zum Teil tief in geöffnete Dokumente ein (Objekte,
> Pfade, Farbfelder, Formate, Verknüpfungen) und schreiben Dateien auf die
> Festplatte. **Die Nutzung erfolgt ausschließlich auf eigene Gefahr und ohne
> jede Gewähr.** Legen Sie vorher immer eine Sicherungskopie an und prüfen Sie
> jedes Ergebnis selbst. Eine Haftung für Schäden oder Datenverlust ist – soweit
> gesetzlich zulässig – ausgeschlossen. Einzelheiten:
> **[HAFTUNGSAUSSCHLUSS.md](HAFTUNGSAUSSCHLUSS.md)**.

---

## Inhalt

- [Adobe InDesign](#adobe-indesign) – 3 UXP-Bedienfelder, 8 Skripte, 3 Satz-Werkzeuge
- [Adobe Illustrator](#adobe-illustrator) – 1 CEP-Bedienfeld, 7 Werkzeuge
- [Affinity](#affinity) – 8 Skripte für Affinity 3 (Designer)

Jedes Werkzeug lässt sich einzeln herunterladen; je Programm gibt es außerdem
ein **Komplettpaket** (`*-komplett.zip`) mit allen Dateien und – bei InDesign –
Installer und Anleitung.

---

## Adobe InDesign

> Ordner [`indesign/`](indesign)

### Bedienfelder (UXP)

| Werkzeug | Datei | Beschreibung |
|---|---|---|
| **Ansicht dwb** | `ansicht-dwb.zip` | Feste Zoomknöpfe (Seite, 100 %, Objekt, Montagefläche) und beliebig viele eigene, benannte Zoomstufen. Ein Knopf legt Hilfslinien an exakt eingetippten Positionen an – waagerecht wie senkrecht, mehrere auf einmal, auf Wunsch für alle Seiten. |
| **Export dwb** | `export-dwb.zip` | Beliebig viele eigene Export-Knöpfe für PDF, JPG und PNG – jeder Knopf ein fertiger Export ohne Dialog. Zielordner, Dateiname mit Platzhaltern, Umfang, Farbraum und Größe stehen einmalig in den Einstellungen. |
| **Prüfung dwb** | `pruefung-dwb.zip` | Reinzeichnungs-Ampel: ein Klick prüft auf Übersatztext, fehlende/geänderte Verknüpfungen, RGB-Bilder, zu geringe Auflösung, Haarlinien und Objekte außerhalb des Anschnitts. Klick auf einen Fund wählt das Objekt aus und passt es ins Fenster ein. |

### Skripte

| Werkzeug | Datei | Beschreibung |
|---|---|---|
| **Importoptionen ändern** | `importoptionen.zip` | Ändert nachträglich, was InDesign sonst nur beim Platzieren fragt: PDF-Seite, „Zuschneiden auf“, transparenter Hintergrund, PSD-Ebenen, Beschnittpfad – für einen Rahmen, eine Auswahl oder das ganze Dokument. |
| **Bilder in Rahmen** | `bilder-in-rahmen.jsx` | Füllt einen Bildrahmen der Reihe nach mit vielen Bildern (eine Seite je Bild). Vorschau-Übersicht mit Umsortieren per Ziehen, ganze Ordner, Dubletten-Erkennung, Aufteilen mehrseitiger PDFs. Titel, Ort, „Foto: Autor“ und Bildunterschrift optional aus den IPTC-Metadaten. |
| **Typo-Putz** | `typo-putz.jsx` | Typografische Reinigung deutscher Texte: deutsche Anführungszeichen, richtiger Apostroph, Auslassungszeichen, Gedankenstrich, Leerzeichenputz, schmale geschützte Leerzeichen vor Einheiten. Jede Regel abwählbar, ein Rückgängig-Schritt, Protokoll am Ende. |
| **Aufräumen** | `aufraeumen.jsx` | Macht ein Dokument übergabefertig: findet unbenutzte Absatz-/Zeichenformate, unbenutzte Farbfelder und leere Ebenen. Zeigt erst den Bericht, löscht dann auf Wunsch – Gebrauchtes bleibt geschützt. |
| **Version sichern** | `version-sichern.jsx` | Sichert das Dokument und legt zusätzlich eine datierte Kopie im Unterordner „Versionen“ ab. Es wird nie etwas überschrieben oder gelöscht. |
| **Neues Dokument** | `neues-dokument.jsx` | Legt ein neues Dokument aus einer Vorlage an – Visitenkarte 85 × 55 bis Plakat A1 – mit Anschnitt, Rändern und Seitenzahl. Mit Farbfeld Reichschwarz; eigene Vorlagen ergänzt man in einer Tabelle oben im Skript. |
| **Kontaktabzug** | `kontaktabzug.jsx` | Legt alle Seiten als Miniaturen-Übersicht (A4 quer, Spaltenzahl wählbar) als PDF neben der Datei ab – praktisch für Freigaben per Mail. Das Dokument bleibt unangetastet. |
| **Zoom-Export** | `zoom-export.jsx` | Dieselben Zoom- und Exportfunktionen wie die Bedienfelder, aber als schwebende Palette – Rückfallebene für ältere InDesign-Versionen ohne UXP. |

### Satz-Werkzeuge

| Werkzeug | Datei | Beschreibung |
|---|---|---|
| **Mikrotypografie** | `mikrotypografie-dwb.jsx` | Elf abschaltbare GREP-Regeln in einem Rückgängig-Schritt: geschützte Leerzeichen in Abkürzungen und vor Einheiten, deutsche Anführungszeichen, Apostroph, Auslassungszeichen, Gedankenstrich, Entfernen von Mehrfach-Leerzeichen. Protokoll am Ende. |
| **Hurenkinder & Schusterjungen** | `hurenkinder-schusterjungen-dwb.jsx` | Palette, die typografische Ausreißer aufspürt: einzelne Anfangs-/Schlusszeilen am Spalten- und Rahmenwechsel sowie zu kurze Ausgangszeilen. Klick auf einen Fund springt an die Stelle. |
| **Überdruck & Schwarz-Check** | `ueberdruck-schwarz-check-dwb.jsx` | Prüft typische Druckfallen: Mischschwarz im Text, Registrierfarbe, weiße Flächen auf Überdruck, Überdruck allgemein, Haarlinien. Zwei Funde direkt reparierbar. |

---

## Adobe Illustrator

> Ordner [`illustrator/`](illustrator)

### Bedienfeld (CEP)

| Werkzeug | Datei | Beschreibung |
|---|---|---|
| **dwbkd Skripte** | `dwbkd-skripte-panel.zip` | Andockbares Bedienfeld, das alle Skripte eines Ordners als Schaltflächen auflistet und unverändert startet (Tasten 1–9). Neue Skripte brauchen keine Einrichtung: Datei in den Ordner legen, neu einlesen, fertig. |

### Skripte

| Werkzeug | Datei | Beschreibung |
|---|---|---|
| **Siebdruckraster** | `siebdruckraster.jsx` | Wandelt ein Bild oder eine Vektorgrafik in ein grobes Halbtonraster (Siebdruck-Look) um – Tonwerte über Punktgröße, mit Ellipsen, Kreisen, Quadraten, Rauten oder Linien. Rasterweite, Winkel, Gamma und Zufall einstellbar, optional CMYK-Separation mit vier Auszügen, Live-Vorschau. |
| **Flächen vereinen** | `flaechen-vereinen.jsx` | Vereint nebeneinander- und überlappende Flächen zu möglichst wenigen Objekten – fürs Plotten, Cutten und Lasern (z. B. QR-Codes). Optional nach Farbe getrennt; schließt winzige Rundungslücken, damit keine doppelten Schnittlinien bleiben. |
| **Duplizieren & versetzt einfügen** | `duplizieren-versetzt.jsx` | Bringt InDesigns „Duplizieren und versetzt einfügen“ (Step & Repeat) nach Illustrator: Reihe oder Raster, Versatz wahlweise als Abstand, Live-Vorschau mit Gesamtzahl. |
| **Doppelte Linien entfernen** | `doppelte-linien-entfernen.jsx` | Findet deckungsgleich übereinanderliegende Linien und entfernt Dubletten, damit beim Schneiden nicht zweimal auf derselben Kante gefahren wird. Bereich, Genauigkeit und Toleranz einstellbar, reiner Zählmodus zur Vorschau. |
| **Strichlinie in Segmente** | `strichlinie-in-segmente.jsx` | Zerlegt eine gestrichelte Kontur in einzelne, geschlossene Segmentpfade – Grundlage, um eine Strichlinie plotten, cutten oder lasern zu können. Strichmuster, Einheit und Versatz vorgebbar. |
| **Aus Fläche ausschneiden** | `aus-flaeche-ausschneiden.jsx` | Schneidet die darüberliegenden Formen aus einer Grundfläche heraus (Pathfinder „Vorderes Objekt abziehen“), ohne Umweg über das Bedienfeld. |
| **Darunterliegende aufteilen** | `darunterliegende-aufteilen.jsx` | Teilt die darunterliegenden Flächen entlang der ausgewählten Linien auf – als wären sie Messer – und trennt eine Fläche in mehrere Stücke. |

---

## Affinity

> Ordner [`affinity/`](affinity) · gebaut für **Affinity 3 (Designer)**. Alle
> erscheinen im Bedienfeld „Skripte“.

| Werkzeug | Datei | Beschreibung |
|---|---|---|
| **Siebdruckraster** | `siebdruckraster-affinity.js` | Affinity-Fassung des Halbtonrasters: das Objekt wird abgetastet und als grobes Siebdruckraster neu aufgebaut – Tonwert über Punktgröße, flächentreue Punktformen, Winkel, Gamma, Zufall. Einfarbig oder CMYK-Separation mit vier Ebenen (Multiplizieren). |
| **Risograph-Effekt** | `risograph-affinity.js` | Bildet den typischen Risografen-Look nach (bewusst „nicht ganz perfekt“). Trennung in Riso-Tinten (1–4 Farben), jede Farbe als eigenes Halbtonraster (Multiplizieren), dazu Fehlregister, Korn und Zufall. Tintenfarben aus einer Palette echter Riso-Töne. |
| **Duplizieren & versetzt einfügen** | `duplizieren-versetzt-affinity.js` | Step & Repeat für Affinity: Reihe oder Raster, Versatz oder fester Abstand, Live-Vorschau, Kopien optional in eigener Ebene. |
| **Flächen vereinen** | `flaechen-vereinen-affinity.js` | Vereint angrenzende und überlappende Flächen zu möglichst wenigen Objekten, nach Farbe getrennt – fürs Cutten und Lasern. Schließt winzige Lücken. |
| **Doppelte Linien entfernen** | `doppelte-linien-entfernen-affinity.js` | Erkennt deckungsgleiche Linien über die tatsächliche Kurvenform (auch umgekehrt gezeichnet) und entfernt die Wiederholungen. |
| **Strichlinie in Segmente** | `strichlinie-in-segmente-affinity.js` | Zerlegt eine gestrichelte Kontur in einzelne Segmentpfade; das Strichmuster richtet sich nach der gemessenen Konturbreite. |
| **Aus Fläche ausschneiden** | `aus-flaeche-ausschneiden-affinity.js` | Zieht die darüberliegenden Formen von einer Grundfläche ab und stanzt Aussparungen in deren Form. |
| **Darunterliegende aufteilen** | `darunterliegende-aufteilen-affinity.js` | Teilt die darunterliegenden Flächen entlang der ausgewählten Linien auf und trennt sie in mehrere Stücke. |

---

## Installation (Kurzüberblick)

- **InDesign – Skripte (`.jsx`):** Im Skripte-Bedienfeld (*Fenster › Hilfsprogramme › Skripte*)
  per Rechtsklick „Im Finder/Explorer anzeigen“ den Ordner *Scripts* öffnen und die Datei
  dort ablegen; danach per Doppelklick starten.
- **InDesign – Bedienfelder (`.zip`, UXP):** ZIP entpacken und die mitgelieferte
  **Anleitung** befolgen (das Komplettpaket enthält Installer für macOS und Windows).
- **Illustrator – Skripte (`.jsx`):** *Datei › Skripten › Anderes Skript …* oder in den
  Skripten-Ordner der Illustrator-Installation legen.
- **Illustrator – Bedienfeld (`.zip`, CEP):** ZIP entpacken und den Ordner in das
  CEP-`extensions`-Verzeichnis legen (siehe beiliegende Anleitung).
- **Affinity – Skripte (`.js`):** In Affinity 3 (Designer) über das Bedienfeld **Skripte**
  laden und ausführen.

Die Komplettpakete (`*-komplett.zip`) bündeln alle Dateien eines Programms; das
InDesign-Paket enthält zusätzlich Installer und eine ausführliche Anleitung.

---

## Lizenz

[MIT](LICENSE) – freie Nutzung, Änderung und Weitergabe unter Nennung des
Urheberrechtshinweises. Zusätzlich gilt der **[Haftungsausschluss](HAFTUNGSAUSSCHLUSS.md)**:
Nutzung ohne Gewähr und auf eigene Gefahr.

© 2026 Daniel W. Bittner · Kommunikationsdesign · <https://dwbkd.de>
