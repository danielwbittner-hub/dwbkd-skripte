// ============================================================================
// Zoom-Export.jsx  —  Adobe InDesign                   ·            Version 1.1
// ----------------------------------------------------------------------------
// Eine kleine Leiste, die offen bleiben darf: vier Zoomstufen und vier
// Exportknöpfe.
//
//   Zoom      Seite · 100 % · Objekt (Auswahl) · ganze Montagefläche
//   Export    PDF · JPG · PNG · Alle — jeweils mit einem Klick, ohne Dialog
//
// Was beim Export geschieht, steht in einer Vorgabe: Zielordner, Unterordner,
// Dateiname (mit Platzhaltern), Umfang, PDF-Exportvorgabe, Auflösung,
// Farbraum, Qualität. Vorgaben lassen sich anlegen, kopieren und umbenennen;
// sie liegen in einer Datei und überleben Neustart und Programmupdate:
//
//   ~/Library/Application Support/dwbkd/InDesign/zoom-export.json
//   (daneben liegt vor jedem Sichern eine Kopie: zoom-export.json.bak)
//
// Verwendung:
//   Fenster ▸ Hilfsprogramme ▸ Skripte ▸ Doppelklick auf dieses Script
//   (oder Datei ▸ Skripten). Das Fenster ist eine Palette und darf offen
//   bleiben, während weitergearbeitet wird.
//
// Nebenbei:
//   • Alt-Klick auf „Seite“ passt den ganzen Druckbogen ein.
//   • Alt-Klick auf PDF / JPG / PNG öffnet die Vorgaben beim passenden Reiter.
//   • „100 %“ zeigt bei einer Auswahl die Auswahl in Originalgröße.
//   • „Alle“ exportiert die in der Vorgabe angekreuzten Formate nacheinander.
//   • Esc gedrückt halten bricht einen laufenden Export nach der Datei ab.
//   • Klick auf die Statuszeile öffnet den zuletzt benutzten Exportordner.
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de
// ============================================================================

#target indesign

// Das Fenster muss eine nicht-modale Palette sein; Paletten brauchen eine
// dauerhafte Skript-Umgebung — daher targetengine.
#targetengine "dwbkd_zoomexport"

(function () {

var TITEL   = "Zoom & Export";
var VERSION = "1.1";

// Kleinste Breite eines Zoomknopfs. Die tatsächliche Breite misst sich an
// der längsten Beschriftung (siehe knopfBreite) — so passt die Leiste auch
// dann, wenn ein anderes System die Knöpfe breiter setzt.
var MIN_KNOPF = 46;

// ------------------------------------------------------- Enum-Werte einsammeln
// InDesigns Aufzählungen vertragen in einer eigenen Skript-Umgebung
// (targetengine) keinen Zugriff über eckige Klammern: ZoomOptions["FIT_PAGE"]
// ist dort undefiniert, ZoomOptions.FIT_PAGE nicht. Die Werte werden deshalb
// einmal mit Punkt-Notation eingesammelt; danach ist es eine gewöhnliche
// Tabelle, die jeden Zugriff verträgt.
var ZOOM = {
    SEITE:      ZoomOptions.FIT_PAGE,
    DRUCKBOGEN: ZoomOptions.FIT_SPREAD,
    ORIGINAL:   ZoomOptions.ACTUAL_SIZE,
    MONTAGE:    ZoomOptions.SHOW_PASTEBOARD
};
var FORMAT = {
    PDF: ExportFormat.PDF_TYPE,
    JPG: ExportFormat.JPG,
    PNG: ExportFormat.PNG_FORMAT
};
var JPG_QUALITAET = {
    LOW:     JPEGOptionsQuality.LOW,
    MEDIUM:  JPEGOptionsQuality.MEDIUM,
    HIGH:    JPEGOptionsQuality.HIGH,
    MAXIMUM: JPEGOptionsQuality.MAXIMUM
};
var JPG_FARBRAUM = {
    RGB:  JpegColorSpaceEnum.RGB,
    CMYK: JpegColorSpaceEnum.CMYK,
    GRAY: JpegColorSpaceEnum.GRAY
};
var PNG_QUALITAET = {
    LOW:     PNGQualityEnum.LOW,
    MEDIUM:  PNGQualityEnum.MEDIUM,
    HIGH:    PNGQualityEnum.HIGH,
    MAXIMUM: PNGQualityEnum.MAXIMUM
};
var PNG_FARBRAUM = {
    RGB:  PNGColorSpaceEnum.RGB,
    GRAY: PNGColorSpaceEnum.GRAY
};
var JPG_BEREICH = {
    ALLE: ExportRangeOrAllPages.EXPORT_ALL,
    TEIL: ExportRangeOrAllPages.EXPORT_RANGE
};
var PNG_BEREICH = {
    ALLE: PNGExportRangeEnum.EXPORT_ALL,
    TEIL: PNGExportRangeEnum.EXPORT_RANGE
};
var PDF_ALLE = PageRange.ALL_PAGES;

// „Auswahl in Fenster einpassen“ gibt es nur als Menübefehl, nicht im
// Skriptmodell (ZoomOptions kennt Seite, Druckbogen, Originalgröße und
// Montagefläche — mehr nicht). Die ID ist über alle Sprachen gleich, die
// Namen sind der Rückfall, falls Adobe sie einmal ändert.
var MENUE_AUSWAHL       = 118790;
var MENUE_AUSWAHL_NAMEN = ["Auswahl in Fenster einpassen", "Fit Selection in Window"];

// Auswahllisten der Oberfläche: Anzeigetext und interner Schlüssel.
var QUALITAETEN = [
    ["Maximum", "MAXIMUM"],
    ["Hoch",    "HIGH"],
    ["Mittel",  "MEDIUM"],
    ["Niedrig", "LOW"]
];
var JPG_FARBEN = [
    ["RGB",       "RGB"],
    ["CMYK",      "CMYK"],
    ["Graustufen","GRAY"]
];
var PNG_FARBEN = [
    ["RGB",        "RGB"],
    ["Graustufen", "GRAY"]
];
var UMFAENGE = [
    ["Alle Seiten",    "alle"],
    ["Aktuelle Seite", "aktuelle"],
    ["Seitenbereich",  "bereich"],
    ["Auswahl",        "auswahl"]
];
var DANACH = [
    ["nichts tun",            "nichts"],
    ["Ordner im Finder zeigen","finder"],
    ["erste Datei öffnen",    "oeffnen"]
];

// ============================================================================
//  Kleinkram
// ============================================================================

function ruhig(fn) { try { fn(); } catch (e) {} }

function trimme(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

function zahl(wert, ersatz) {
    var n = parseFloat(String(wert).replace(",", "."));
    return isNaN(n) ? ersatz : n;
}

function fuellen(n, stellen) {
    var s = String(Math.round(n));
    while (s.length < stellen) s = "0" + s;
    return s;
}

function heute() {
    var d = new Date();
    return d.getFullYear() + "-" + fuellen(d.getMonth() + 1, 2) + "-" + fuellen(d.getDate(), 2);
}

function uhrzeit() {
    var d = new Date();
    return fuellen(d.getHours(), 2) + fuellen(d.getMinutes(), 2);
}

// Alles heraus, was in Dateinamen Ärger macht.
function sauberName(s) {
    var name = String(s).replace(/[\\\/:\*\?"<>\|\r\n\t]/g, "_");
    name = trimme(name).replace(/\.+$/, "").replace(/_+$/, "");
    return name.length ? name : "Export";
}

function ohneEndung(name) {
    var text = String(name), punkt = text.lastIndexOf(".");
    return (punkt > 0) ? text.substring(0, punkt) : text;
}

function indexVon(liste, wert) {
    var i;
    for (i = 0; i < liste.length; i++) if (liste[i] === wert) return i;
    return -1;
}

// Anzeigetexte aus einer Paar-Tabelle ([Text, Schlüssel]).
function texte(tabelle) {
    var i, raus = [];
    for (i = 0; i < tabelle.length; i++) raus.push(tabelle[i][0]);
    return raus;
}

function schluesselIndex(tabelle, schluessel) {
    var i;
    for (i = 0; i < tabelle.length; i++) if (tabelle[i][1] === schluessel) return i;
    return 0;
}

function schluesselVon(tabelle, index) {
    if (index < 0 || index >= tabelle.length) return tabelle[0][1];
    return tabelle[index][1];
}

// Breite einer Beschriftung in Bildpunkten. ScriptUI kann messen; wenn nicht
// (ältere Fassung, Schrift noch nicht geladen), wird geschätzt.
function textBreite(element) {
    var breite = 0;
    ruhig(function () { breite = Math.ceil(element.graphics.measureString(element.text)[0]); });
    if (!breite || breite < 4) breite = String(element.text).length * 7;
    return breite;
}

// Eine Reihe Knöpfe auf eine gemeinsame Breite bringen: so breit wie die
// längste Beschriftung braucht, nicht breiter.
function reiheBreite(knoepfe, luft, mindestens) {
    var i, breite = mindestens;
    for (i = 0; i < knoepfe.length; i++)
        breite = Math.max(breite, textBreite(knoepfe[i]) + luft);
    return breite;
}

// Hinweiszeilen eine Nummer kleiner setzen. Schlaegt das fehl (andere
// Schriftlage, aeltere ScriptUI-Fassung), bleibt der Text einfach normal.
function kleinerSetzen(element) {
    ruhig(function () {
        element.graphics.font = ScriptUI.newFont(element.graphics.font.name,
                                                 ScriptUI.FontStyle.REGULAR, 10);
    });
}

function altGedrueckt() {
    var gedrueckt = false;
    ruhig(function () { gedrueckt = ScriptUI.environment.keyboardState.altKey === true; });
    return gedrueckt;
}

// Wird zwischen zwei Dateien eines laufenden Exports abgefragt: Esc gedrückt
// halten bricht ab, sobald die aktuelle Datei fertig geschrieben ist.
function escGedrueckt() {
    var gedrueckt = false;
    ruhig(function () { gedrueckt = ScriptUI.environment.keyboardState.keyName === "Escape"; });
    return gedrueckt;
}

// Liegt der gemerkte Fensterpunkt noch auf einem angeschlossenen Bildschirm?
// Ohne die Prüfung erschiene die Palette nach dem Abziehen des Zweitmonitors
// unerreichbar im Nichts. Lässt sich das nicht messen ($.screens fehlt),
// bleibt die gemerkte Position in Kraft — das war das bisherige Verhalten.
function positionSichtbar(x, y) {
    var ergebnis = true;
    ruhig(function () {
        var i, s, drin = false;
        if (!$.screens || !$.screens.length) return;
        for (i = 0; i < $.screens.length; i++) {
            s = $.screens[i];
            if (x >= s.left - 8 && x <= s.right - 40 &&
                y >= s.top - 8 && y <= s.bottom - 40) { drin = true; break; }
        }
        ergebnis = drin;
    });
    return ergebnis;
}

// ============================================================================
//  Vorgaben — Ablage in einer Datei
// ============================================================================

// ExtendScript hat kein JSON. Der Schreiber ist klein genug, um ihn selbst zu
// haben; gelesen wird mit eval() in einem try/catch — die Datei schreibt nur
// dieses Script.
function alsText(wert, einzug) {
    var i, teile, schluessel;
    if (wert === null || wert === undefined) return "null";
    if (typeof wert === "boolean") return wert ? "true" : "false";
    if (typeof wert === "number") return isFinite(wert) ? String(wert) : "0";
    if (wert instanceof Array) {
        teile = [];
        for (i = 0; i < wert.length; i++) teile.push(alsText(wert[i], einzug + "  "));
        return "[" + teile.join(", ") + "]";
    }
    if (typeof wert === "object") {
        teile = [];
        for (schluessel in wert) {
            if (!wert.hasOwnProperty(schluessel)) continue;
            teile.push(einzug + "  \"" + schluessel + "\": " + alsText(wert[schluessel], einzug + "  "));
        }
        return "{\n" + teile.join(",\n") + "\n" + einzug + "}";
    }
    return "\"" + String(wert)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n") + "\"";
}

function tiefeKopie(wert) {
    var kopie = null;
    try { kopie = eval("(" + alsText(wert, "") + ")"); } catch (e) { kopie = null; }
    return kopie;
}

function ordnerSicherstellen(pfad) {
    var ordner = new Folder(pfad);
    if (ordner.exists) return ordner;
    if (ordner.parent && !ordner.parent.exists) ordnerSicherstellen(ordner.parent.fsName);
    ordner.create();
    return ordner;
}

function ablageDatei() {
    var ordner = ordnerSicherstellen(Folder.userData.fsName + "/dwbkd/InDesign");
    return new File(ordner.fsName + "/zoom-export.json");
}

function pdfVorgabenNamen() {
    var namen = [], liste, i;
    ruhig(function () {
        liste = app.pdfExportPresets.everyItem().name;
        for (i = 0; i < liste.length; i++) namen.push(String(liste[i]));
    });
    return namen;
}

function standardPdfVorgabe() {
    var namen = pdfVorgabenNamen(), i,
        lieblinge = ["[Druckausgabequalität]", "[High Quality Print]", "[PDF/X-4:2008]"];
    for (i = 0; i < lieblinge.length; i++)
        if (indexVon(namen, lieblinge[i]) >= 0) return lieblinge[i];
    return namen.length ? namen[0] : "";
}

function neueVorgabe(name) {
    return {
        name:          name,
        // Ziel
        zielArt:       "dokument",      // dokument | fest | fragen
        zielOrdner:    "",
        unterordner:   "",
        muster:        "{dok}",
        // Umfang
        umfang:        "alle",          // alle | aktuelle | bereich | auswahl
        bereich:       "",
        druckbogen:    false,
        ueberschreiben:false,
        danach:        "nichts",
        // Sammelexport — welche Formate der Knopf „Alle“ nacheinander schreibt
        sammelPdf:     true,
        sammelJpg:     true,
        sammelPng:     false,
        // PDF
        pdfVorgabe:    standardPdfVorgabe(),
        pdfEinzelseiten: false,
        // JPG
        jpgQualitaet:  "MAXIMUM",
        jpgAufloesung: 300,
        jpgFarbraum:   "RGB",
        jpgIcc:        true,
        jpgKanten:     true,
        jpgAnschnitt:  false,
        // PNG
        pngQualitaet:  "MAXIMUM",
        pngAufloesung: 150,
        pngFarbraum:   "RGB",
        pngTransparenz:true,
        pngKanten:     true,
        pngAnschnitt:  false
    };
}

// Fehlende Felder aus dem Muster ergänzen — so überleben alte Ablagedateien
// eine neue Version des Scripts.
function vervollstaendigen(vorgabe) {
    var muster = neueVorgabe(vorgabe.name || "Vorgabe"), schluessel;
    for (schluessel in muster) {
        if (!muster.hasOwnProperty(schluessel)) continue;
        if (vorgabe[schluessel] === undefined) vorgabe[schluessel] = muster[schluessel];
    }
    return vorgabe;
}

var ablage = null;

// Hinweis aus dem Laden (Sicherungskopie gezogen, Datei unlesbar) — die
// Statuszeile gibt es beim Laden noch nicht, start() zeigt ihn nachträglich.
var ladeMeldung = "";

// Eine Ablagedatei lesen und grob prüfen; bei Schäden null.
function ablageLesen(datei) {
    var daten = null, text = "";
    if (!datei.exists) return null;
    try {
        datei.encoding = "UTF-8";
        datei.open("r");
        text = datei.read();
        datei.close();
        daten = eval("(" + text + ")");
    } catch (e) {
        ruhig(function () { datei.close(); });
        daten = null;
    }
    if (!daten || !daten.vorgaben || !daten.vorgaben.length) return null;
    return daten;
}

function ablageLaden() {
    var datei = ablageDatei(), sicherung = new File(datei.fsName + ".bak"), daten, i;
    ladeMeldung = "";
    daten = ablageLesen(datei);
    if (!daten && sicherung.exists) {
        // Halbe Datei nach einem Absturz beim Schreiben? Die Kopie vom
        // letzten Sichern rettet die Vorgaben.
        daten = ablageLesen(sicherung);
        if (daten) ladeMeldung = "Vorgaben aus der Sicherungskopie wiederhergestellt.";
    }
    if (!daten) {
        if (datei.exists) ladeMeldung = "Die Vorgabendatei war unlesbar — Standardvorgabe angelegt.";
        daten = {
            vorgaben:      [neueVorgabe("Standard")],
            aktiv:         "Standard",
            fenster:       null,
            letzterOrdner: ""
        };
    }
    for (i = 0; i < daten.vorgaben.length; i++) vervollstaendigen(daten.vorgaben[i]);
    if (!daten.letzterOrdner) daten.letzterOrdner = "";
    ablage = daten;
    return ablage;
}

function ablageSichern() {
    var datei = ablageDatei();
    // Erst die letzte gute Fassung beiseitelegen — stürzt InDesign mitten im
    // Schreiben ab, bliebe sonst nur eine halbe Datei übrig.
    ruhig(function () { if (datei.exists) datei.copy(datei.fsName + ".bak"); });
    try {
        datei.encoding = "UTF-8";
        datei.lineFeed = "Unix";
        datei.open("w");
        datei.write(alsText(ablage, ""));
        datei.close();
        return true;
    } catch (e) {
        ruhig(function () { datei.close(); });
        return false;
    }
}

function vorgabenNamen() {
    var i, namen = [];
    for (i = 0; i < ablage.vorgaben.length; i++) namen.push(ablage.vorgaben[i].name);
    return namen;
}

function aktiveVorgabe() {
    var i;
    for (i = 0; i < ablage.vorgaben.length; i++)
        if (ablage.vorgaben[i].name === ablage.aktiv) return ablage.vorgaben[i];
    ablage.aktiv = ablage.vorgaben[0].name;
    return ablage.vorgaben[0];
}

// ============================================================================
//  Zoom
// ============================================================================

// Ein Textmodus-Fenster (Textabschnitt) kennt kein zoomPercentage — der
// Zugriff wirft dann, und genau das ist die Prüfung.
function layoutFensterDa() {
    var da = false;
    ruhig(function () {
        da = (app.documents.length > 0) && (app.activeWindow.zoomPercentage > 0);
    });
    return da;
}

function zoomen(art, meldung) {
    if (!layoutFensterDa()) { status("Kein Dokumentfenster offen.", true); return false; }
    try {
        app.activeWindow.zoom(art);
        status(meldung + " · " + Math.round(app.activeWindow.zoomPercentage) + " %");
        return true;
    } catch (e) {
        status("Zoom nicht möglich: " + e, true);
        return false;
    }
}

function auswahlBefehl() {
    var befehl = null, i, kandidat;
    ruhig(function () {
        var treffer = app.menuActions.itemByID(MENUE_AUSWAHL);
        if (treffer.isValid) befehl = treffer;
    });
    if (befehl) return befehl;
    for (i = 0; i < MENUE_AUSWAHL_NAMEN.length; i++) {
        kandidat = null;
        ruhig(function () {
            var treffer = app.menuActions.itemByName(MENUE_AUSWAHL_NAMEN[i]);
            if (treffer.isValid) kandidat = treffer;
        });
        if (kandidat) return kandidat;
    }
    return null;
}

// Rückfallebene, falls der Menübefehl einmal nicht greift: wenigstens auf die
// richtige Seite gehen und die Größe passend stellen. Den Ausschnitt selbst
// kann das Skriptmodell nicht verschieben — LayoutWindow hat dafür nichts.
function zoomNotloesung() {
    var einheit, ausdehnung, seite = null, fenster, breitePx, hoehePx, faktor;
    if (!app.selection || !app.selection.length) return false;
    einheit = app.scriptPreferences.measurementUnit;
    try {
        app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
        ausdehnung = auswahlRahmen();
        if (!ausdehnung) return false;
        ruhig(function () { seite = app.selection[0].parentPage; });
        fenster = app.activeWindow;
        if (seite) ruhig(function () { fenster.activePage = seite; });
        breitePx = Math.abs(fenster.bounds[3] - fenster.bounds[1]) - 40;
        hoehePx  = Math.abs(fenster.bounds[2] - fenster.bounds[0]) - 40;
        if (breitePx < 60 || hoehePx < 60) { breitePx = 800; hoehePx = 600; }
        faktor = Math.min(breitePx / Math.max(ausdehnung.breite, 1),
                          hoehePx  / Math.max(ausdehnung.hoehe, 1)) * 100;
        fenster.zoomPercentage = Math.max(5, Math.min(4000, faktor));
        return true;
    } catch (e) {
        return false;
    } finally {
        ruhig(function () { app.scriptPreferences.measurementUnit = einheit; });
    }
}

// Umschließendes Rechteck der Auswahl (in der gerade gesetzten Maßeinheit).
function auswahlRahmen() {
    var i, grenzen, oben = null, links = null, unten = null, rechts = null;
    for (i = 0; i < app.selection.length; i++) {
        grenzen = null;
        ruhig(function () { grenzen = app.selection[i].visibleBounds; });
        if (!grenzen) ruhig(function () { grenzen = app.selection[i].geometricBounds; });
        if (!grenzen || grenzen.length < 4) continue;
        if (oben === null || grenzen[0] < oben)   oben   = grenzen[0];
        if (links === null || grenzen[1] < links) links  = grenzen[1];
        if (unten === null || grenzen[2] > unten) unten  = grenzen[2];
        if (rechts === null || grenzen[3] > rechts) rechts = grenzen[3];
    }
    if (oben === null) return null;
    return { breite: rechts - links, hoehe: unten - oben };
}

function zoomAufAuswahl(leise) {
    var befehl;
    if (!layoutFensterDa()) { if (!leise) status("Kein Dokumentfenster offen.", true); return false; }
    if (!app.selection || !app.selection.length) {
        if (!leise) status("Nichts ausgewählt.", true);
        return false;
    }
    befehl = auswahlBefehl();
    if (befehl) {
        try {
            // Hat die Palette den Tastaturfokus, meldet der Menübefehl sich
            // als deaktiviert. Das Dokumentfenster nach vorn zu holen reicht.
            if (!befehl.enabled) ruhig(function () { app.activeWindow.bringToFront(); });
            befehl.invoke();
            if (!leise) status("Auswahl eingepasst · " + Math.round(app.activeWindow.zoomPercentage) + " %");
            return true;
        } catch (e) {}
    }
    if (zoomNotloesung()) {
        if (!leise) status("Auswahl eingepasst (ohne Ausschnitt)");
        return true;
    }
    if (!leise) status("Auswahl ließ sich nicht einpassen.", true);
    return false;
}

function zoomOriginalgroesse() {
    if (!layoutFensterDa()) { status("Kein Dokumentfenster offen.", true); return; }
    if (app.selection && app.selection.length && zoomAufAuswahl(true)) {
        ruhig(function () { app.activeWindow.zoomPercentage = 100; });
        status("Auswahl in Originalgröße · 100 %");
        return;
    }
    zoomen(ZOOM.ORIGINAL, "Originalgröße");
}

// ============================================================================
//  Seiten und Ziele bestimmen
// ============================================================================

// Ein Wort aus dem Seitenbereich zu einem Seitenindex machen: erst der
// Seitenname, wie er im Dokument steht (Abschnitte, römische Ziffern), sonst
// die laufende Nummer ab der ersten Seite.
function seiteZuIndex(doc, wort) {
    var name = trimme(wort), i, nummer;
    if (!name.length) return -1;
    for (i = 0; i < doc.pages.length; i++)
        if (String(doc.pages[i].name) === name) return i;
    nummer = parseInt(name, 10);
    if (!isNaN(nummer) && nummer >= 1 && nummer <= doc.pages.length) return nummer - 1;
    return -1;
}

// InDesign stürzt beim Bildexport ab, wenn der Seitenbereich Seiten nennt,
// die es nicht gibt (in 21.5.1 nachgestellt). Deshalb wird der Text hier zu
// echten Seitenobjekten aufgelöst — an den Export geht nur, was existiert.
// Stücke ohne Treffer werden nicht mehr still ersetzt (vertippt „3–x“ hieße
// sonst: ganzes Dokument), sondern in die optionale Liste fehler gemeldet;
// „3-“ ohne Ende bleibt bewusst „ab Seite 3 bis zum Schluss“.
function seitenAusBereich(doc, text, fehler) {
    var teile, i, stueck, strich, a, b, bText, x, gesehen = {}, raus = [];
    teile = String(text).split(",");
    for (i = 0; i < teile.length; i++) {
        stueck = trimme(teile[i]);
        if (!stueck.length) continue;
        strich = stueck.indexOf("-", 1);
        if (strich > 0) {
            a = seiteZuIndex(doc, stueck.substring(0, strich));
            bText = trimme(stueck.substring(strich + 1));
            b = bText.length ? seiteZuIndex(doc, bText) : (doc.pages.length - 1);
            if (a < 0 || b < 0) { if (fehler) fehler.push(stueck); continue; }
            if (a > b) { x = a; a = b; b = x; }
            for (x = a; x <= b; x++)
                if (!gesehen[x]) { gesehen[x] = true; raus.push(doc.pages[x]); }
        } else {
            a = seiteZuIndex(doc, stueck);
            if (a < 0) { if (fehler) fehler.push(stueck); continue; }
            if (!gesehen[a]) { gesehen[a] = true; raus.push(doc.pages[a]); }
        }
    }
    return raus;
}

function seitenDerAuswahl(doc) {
    var i, seite, gesehen = {}, raus = [];
    if (!app.selection) return raus;
    for (i = 0; i < app.selection.length; i++) {
        seite = null;
        ruhig(function () { seite = app.selection[i].parentPage; });
        if (!seite) ruhig(function () { seite = app.selection[i].parentTextFrames[0].parentPage; });
        if (seite && !gesehen[seite.id]) { gesehen[seite.id] = true; raus.push(seite); }
    }
    return raus;
}

function seitenFuerVorgabe(doc, v, fehler) {
    var i, raus = [], aktuell = null;
    if (v.umfang === "aktuelle") {
        ruhig(function () { aktuell = app.activeWindow.activePage; });
        if (aktuell) raus.push(aktuell);
        return raus;
    }
    if (v.umfang === "bereich") return seitenAusBereich(doc, v.bereich, fehler);
    if (v.umfang === "auswahl") return seitenDerAuswahl(doc);
    for (i = 0; i < doc.pages.length; i++) raus.push(doc.pages[i]);
    return raus;
}

// Aus Seiten Druckbögen machen — je Bogen bleibt die erste getroffene Seite
// stehen, denn der Bildexport spricht einen Bogen über eine seiner Seiten an.
function zuDruckbogen(seiten) {
    var i, bogen, gesehen = {}, raus = [];
    for (i = 0; i < seiten.length; i++) {
        bogen = null;
        ruhig(function () { bogen = seiten[i].parent; });
        if (!bogen) continue;
        if (!gesehen[bogen.id]) { gesehen[bogen.id] = true; raus.push(seiten[i]); }
    }
    return raus;
}

// Objekte der Auswahl, die sich einzeln exportieren lassen (JPG/PNG/PDF).
function objekteDerAuswahl() {
    var i, raus = [], taugt;
    if (!app.selection) return raus;
    for (i = 0; i < app.selection.length; i++) {
        taugt = false;
        ruhig(function () {
            taugt = (typeof app.selection[i].exportFile === "function") &&
                    (app.selection[i].hasOwnProperty("geometricBounds") ||
                     app.selection[i].geometricBounds.length === 4);
        });
        if (taugt) raus.push(app.selection[i]);
    }
    return raus;
}

// Absolute Seitenangabe („+7“) — unabhängig von Abschnitten und
// Nummerierungen. InDesign versteht diese Schreibweise im Seitenbereich.
function absolut(seite) { return "+" + (seite.documentOffset + 1); }

// ============================================================================
//  Dateinamen und Zielordner
// ============================================================================

function nameBauen(v, doc, format, teilName, nummer) {
    var muster = trimme(v.muster), name;
    if (!muster.length) muster = "{dok}";
    name = muster;
    name = name.replace(/\{dok\}/g,     ohneEndung(doc.name));
    name = name.replace(/\{vorgabe\}/g, v.name);
    name = name.replace(/\{datum\}/g,   heute());
    name = name.replace(/\{zeit\}/g,    uhrzeit());
    name = name.replace(/\{format\}/g,  String(format).toLowerCase());
    name = name.replace(/\{seite\}/g,   (teilName === null || teilName === undefined) ? "" : String(teilName));
    name = name.replace(/\{nr\}/g,      (nummer === null || nummer === undefined) ? "" : fuellen(nummer, 3));
    return sauberName(name);
}

// Bei mehreren Dateien muss der Name unterscheiden. Wer keinen Platzhalter
// gesetzt hat, bekommt die Seite hinten angehängt — sonst überschreibt sich
// der Export selbst.
function nameMitTeil(v, doc, format, teilName, nummer, mehrere) {
    var name = nameBauen(v, doc, format, teilName, nummer), hatPlatzhalter;
    hatPlatzhalter = /\{seite\}|\{nr\}/.test(String(v.muster));
    if (mehrere && !hatPlatzhalter && teilName !== null && teilName !== undefined)
        name = name + "_" + sauberName(teilName);
    return name;
}

function zielDatei(ordner, name, endung, ueberschreiben) {
    var datei = new File(ordner.fsName + "/" + name + "." + endung), zaehler = 2;
    if (ueberschreiben) return datei;
    while (datei.exists && zaehler < 1000) {
        datei = new File(ordner.fsName + "/" + name + "_" + zaehler + "." + endung);
        zaehler++;
    }
    return datei;
}

// Die „Wohin?“-Frage beginnt im zuletzt benutzten Exportordner statt am
// Systemstandard — der steht in der Ablage und überlebt Neustarts.
function ordnerFragen(frage) {
    var start = null;
    ruhig(function () {
        var f = new Folder(ablage.letzterOrdner);
        if (ablage.letzterOrdner && f.exists) start = f;
    });
    return start ? start.selectDlg(frage) : Folder.selectDialog(frage);
}

function zielOrdner(v, doc) {
    var basis = null, ziel;
    if (v.zielArt === "fest") {
        if (trimme(v.zielOrdner).length) basis = new Folder(v.zielOrdner);
        if (!basis || !basis.exists)
            basis = ordnerFragen("Der feste Ordner der Vorgabe ist nicht da. Wohin stattdessen?");
    } else if (v.zielArt === "fragen") {
        basis = ordnerFragen("Wohin exportieren?");
    } else {
        ruhig(function () { if (doc.saved) basis = doc.filePath; });
        if (!basis || !basis.exists)
            basis = ordnerFragen("Das Dokument ist noch nicht gesichert. Wohin exportieren?");
    }
    if (!basis) return null;
    ablage.letzterOrdner = basis.fsName;
    ziel = basis;
    if (trimme(v.unterordner).length) {
        ziel = new Folder(basis.fsName + "/" + sauberName(v.unterordner));
        if (!ziel.exists) ziel = ordnerSicherstellen(ziel.fsName);
    }
    if (!ziel.exists) throw new Error("Der Zielordner ließ sich nicht anlegen:\n" + ziel.fsName);
    return ziel;
}

// ============================================================================
//  Export
// ============================================================================

// Wird von den Exportschleifen gesetzt, wenn Esc gedrückt war — exportieren()
// setzt es vor jedem Lauf zurück und meldet danach, wie weit es kam.
var exportAbbruch = false;

// Der Ordner des letzten gelungenen Exports — ein Klick auf die Statuszeile
// öffnet ihn im Finder.
var letzterExportOrdner = null;

function exportierePdf(doc, ordner, v, seiten) {
    var vorgabe = null, prefs = app.pdfExportPreferences, altBereich,
        dateien = [], i, name, datei, mehrere;

    ruhig(function () {
        var treffer = app.pdfExportPresets.itemByName(v.pdfVorgabe);
        if (treffer.isValid) vorgabe = treffer;
    });
    if (!vorgabe)
        throw new Error("Die PDF-Exportvorgabe „" + v.pdfVorgabe + "“ gibt es nicht (mehr).\n" +
                        "Bitte unter „Vorgaben“ eine andere wählen.");

    altBereich = prefs.pageRange;
    try {
        if (v.pdfEinzelseiten) {
            mehrere = seiten.length > 1;
            for (i = 0; i < seiten.length; i++) {
                if (escGedrueckt()) { exportAbbruch = true; break; }
                fortschritt("PDF · Seite " + (i + 1) + " von " + seiten.length + " …");
                prefs.pageRange = absolut(seiten[i]);
                name  = nameMitTeil(v, doc, "PDF", String(seiten[i].name), i + 1, mehrere);
                datei = zielDatei(ordner, name, "pdf", v.ueberschreiben);
                doc.exportFile(FORMAT.PDF, datei, false, vorgabe);
                dateien.push(datei);
            }
        } else {
            fortschritt("PDF wird geschrieben …");
            prefs.pageRange = (seiten.length === doc.pages.length) ? PDF_ALLE : bereichText(seiten);
            name  = nameMitTeil(v, doc, "PDF", null, null, false);
            datei = zielDatei(ordner, name, "pdf", v.ueberschreiben);
            doc.exportFile(FORMAT.PDF, datei, false, vorgabe);
            dateien.push(datei);
        }
    } finally {
        ruhig(function () { prefs.pageRange = altBereich; });
    }
    return dateien;
}

function bereichText(seiten) {
    var i, teile = [];
    for (i = 0; i < seiten.length; i++) teile.push(absolut(seiten[i]));
    return teile.join(",");
}

// --------------------------------------------------------------- JPG und PNG

function jpgSichern() {
    var p = app.jpegExportPreferences, alt = {};
    ruhig(function () { alt.aufloesung = p.exportResolution; });
    ruhig(function () { alt.qualitaet  = p.jpegQuality; });
    ruhig(function () { alt.farbraum   = p.jpegColorSpace; });
    ruhig(function () { alt.icc        = p.embedColorProfile; });
    ruhig(function () { alt.kanten     = p.antiAlias; });
    ruhig(function () { alt.anschnitt  = p.useDocumentBleeds; });
    ruhig(function () { alt.bereich    = p.jpegExportRange; });
    ruhig(function () { alt.seiten     = p.pageString; });
    ruhig(function () { alt.bogen      = p.exportingSpread; });
    ruhig(function () { alt.suffix     = p.jpegSuffix; });
    return alt;
}

function jpgZuruecksetzen(alt) {
    var p = app.jpegExportPreferences;
    ruhig(function () { p.exportResolution  = alt.aufloesung; });
    ruhig(function () { p.jpegQuality       = alt.qualitaet; });
    ruhig(function () { p.jpegColorSpace    = alt.farbraum; });
    ruhig(function () { p.embedColorProfile = alt.icc; });
    ruhig(function () { p.antiAlias         = alt.kanten; });
    ruhig(function () { p.useDocumentBleeds = alt.anschnitt; });
    ruhig(function () { p.jpegExportRange   = alt.bereich; });
    ruhig(function () { p.pageString        = alt.seiten; });
    ruhig(function () { p.exportingSpread   = alt.bogen; });
    ruhig(function () { p.jpegSuffix        = alt.suffix; });
}

function pngSichern() {
    var p = app.pngExportPreferences, alt = {};
    ruhig(function () { alt.aufloesung  = p.exportResolution; });
    ruhig(function () { alt.qualitaet   = p.pngQuality; });
    ruhig(function () { alt.farbraum    = p.pngColorSpace; });
    ruhig(function () { alt.transparent = p.transparentBackground; });
    ruhig(function () { alt.kanten      = p.antiAlias; });
    ruhig(function () { alt.anschnitt   = p.useDocumentBleeds; });
    ruhig(function () { alt.bereich     = p.pngExportRange; });
    ruhig(function () { alt.seiten      = p.pageString; });
    ruhig(function () { alt.bogen       = p.exportingSpread; });
    ruhig(function () { alt.suffix      = p.pngSuffix; });
    return alt;
}

function pngZuruecksetzen(alt) {
    var p = app.pngExportPreferences;
    ruhig(function () { p.exportResolution      = alt.aufloesung; });
    ruhig(function () { p.pngQuality            = alt.qualitaet; });
    ruhig(function () { p.pngColorSpace         = alt.farbraum; });
    ruhig(function () { p.transparentBackground = alt.transparent; });
    ruhig(function () { p.antiAlias             = alt.kanten; });
    ruhig(function () { p.useDocumentBleeds     = alt.anschnitt; });
    ruhig(function () { p.pngExportRange        = alt.bereich; });
    ruhig(function () { p.pageString            = alt.seiten; });
    ruhig(function () { p.exportingSpread       = alt.bogen; });
    ruhig(function () { p.pngSuffix             = alt.suffix; });
}

// Der Anhang, den InDesign von sich aus an Bilddateien hängt (in den
// Voreinstellungen steht dort gern noch etwas wie „_1200dpi“ vom letzten
// Export über den Dialog). Muss leer sein, sonst stimmt kein Dateiname.
function bildVorbereiten(v, format) {
    var p;
    if (format === "PNG") {
        p = app.pngExportPreferences;
        ruhig(function () { p.pngSuffix             = ""; });
        ruhig(function () { p.exportResolution      = Math.round(zahl(v.pngAufloesung, 150)); });
        ruhig(function () { p.pngQuality            = PNG_QUALITAET[v.pngQualitaet]; });
        ruhig(function () { p.pngColorSpace         = PNG_FARBRAUM[v.pngFarbraum]; });
        ruhig(function () { p.transparentBackground = v.pngTransparenz === true; });
        ruhig(function () { p.antiAlias             = v.pngKanten === true; });
        ruhig(function () { p.useDocumentBleeds     = v.pngAnschnitt === true; });
        ruhig(function () { p.exportingSpread       = v.druckbogen === true; });
    } else {
        p = app.jpegExportPreferences;
        ruhig(function () { p.jpegSuffix        = ""; });
        ruhig(function () { p.exportResolution  = Math.round(zahl(v.jpgAufloesung, 300)); });
        ruhig(function () { p.jpegQuality       = JPG_QUALITAET[v.jpgQualitaet]; });
        ruhig(function () { p.jpegColorSpace    = JPG_FARBRAUM[v.jpgFarbraum]; });
        ruhig(function () { p.embedColorProfile = v.jpgIcc === true; });
        ruhig(function () { p.antiAlias         = v.jpgKanten === true; });
        ruhig(function () { p.useDocumentBleeds = v.jpgAnschnitt === true; });
        ruhig(function () { p.exportingSpread   = v.druckbogen === true; });
    }
}

function bildBereich(format, seite) {
    var p;
    if (format === "PNG") {
        p = app.pngExportPreferences;
        ruhig(function () { p.pngExportRange = PNG_BEREICH.TEIL; });
    } else {
        p = app.jpegExportPreferences;
        ruhig(function () { p.jpegExportRange = JPG_BEREICH.TEIL; });
    }
    ruhig(function () { p.pageString = absolut(seite); });
}

function exportiereBild(doc, ordner, v, format, seiten) {
    var alt = (format === "PNG") ? pngSichern() : jpgSichern(),
        endung = (format === "PNG") ? "png" : "jpg",
        dateien = [], i, name, datei, mehrere, teil;
    try {
        bildVorbereiten(v, format);
        mehrere = seiten.length > 1;
        for (i = 0; i < seiten.length; i++) {
            if (escGedrueckt()) { exportAbbruch = true; break; }
            fortschritt(format + " · " + (v.druckbogen ? "Bogen " : "Seite ") +
                        (i + 1) + " von " + seiten.length + " …");
            bildBereich(format, seiten[i]);
            teil  = v.druckbogen ? ("Bogen-" + String(seiten[i].name)) : String(seiten[i].name);
            name  = nameMitTeil(v, doc, format, teil, i + 1, mehrere);
            datei = zielDatei(ordner, name, endung, v.ueberschreiben);
            doc.exportFile(FORMAT[format], datei);
            dateien.push(datei);
        }
    } finally {
        if (format === "PNG") pngZuruecksetzen(alt); else jpgZuruecksetzen(alt);
    }
    return dateien;
}

// Auswahl exportieren: das kann nur das Objekt selbst, nicht das Dokument.
// Seit 1.1 auch als PDF — PageItem.exportFile nimmt die PDF-Vorgabe an und
// schreibt das freigestellte Objekt, gleiches Verhalten wie bei JPG/PNG.
function exportiereObjekte(doc, ordner, v, format, objekte) {
    var alt = null, endung, pdfVorgabe = null,
        dateien = [], i, name, datei, mehrere, teil, eigen;
    if (format === "PDF") {
        endung = "pdf";
        ruhig(function () {
            var treffer = app.pdfExportPresets.itemByName(v.pdfVorgabe);
            if (treffer.isValid) pdfVorgabe = treffer;
        });
        if (!pdfVorgabe)
            throw new Error("Die PDF-Exportvorgabe „" + v.pdfVorgabe + "“ gibt es nicht (mehr).\n" +
                            "Bitte unter „Vorgaben“ eine andere wählen.");
    } else {
        alt    = (format === "PNG") ? pngSichern() : jpgSichern();
        endung = (format === "PNG") ? "png" : "jpg";
    }
    try {
        if (format !== "PDF") bildVorbereiten(v, format);
        mehrere = objekte.length > 1;
        for (i = 0; i < objekte.length; i++) {
            if (escGedrueckt()) { exportAbbruch = true; break; }
            fortschritt(format + " · Objekt " + (i + 1) + " von " + objekte.length + " …");
            // Im Ebenenbedienfeld benannte Rahmen (Logo, Teaser …) heißen
            // auch in der Datei so; nur Namenlose bekommen die Nummer.
            eigen = "";
            ruhig(function () { eigen = trimme(objekte[i].name); });
            teil  = eigen.length ? eigen : ("Objekt-" + fuellen(i + 1, 2));
            name  = nameMitTeil(v, doc, format, teil, i + 1, mehrere);
            datei = zielDatei(ordner, name, endung, v.ueberschreiben);
            if (format === "PDF") objekte[i].exportFile(FORMAT.PDF, datei, false, pdfVorgabe);
            else                  objekte[i].exportFile(FORMAT[format], datei);
            dateien.push(datei);
        }
    } finally {
        if (alt) { if (format === "PNG") pngZuruecksetzen(alt); else jpgZuruecksetzen(alt); }
    }
    return dateien;
}

// Ein Format exportieren. ordnerVorab und imSammel bedient der Sammelexport:
// der Zielordner steht dann schon fest, Rückfragen zum Seitenbereich und die
// „Danach“-Aktionen laufen dort nur einmal. Gibt die Zahl der geschriebenen
// Dateien zurück (0 bei Abbruch oder Fehler).
function exportieren(format, ordnerVorab, imSammel) {
    var doc, v, ordner = null, seiten, objekte, dateien = [],
        gesamtZahl = 0, bereichFehler = [];
    if (!app.documents.length) { status("Kein Dokument geöffnet.", true); return 0; }
    doc = app.activeDocument;
    v   = aktiveVorgabe();
    exportAbbruch = false;

    knoepfeSperren(true);
    try {
        if (v.umfang === "auswahl") {
            objekte = objekteDerAuswahl();
            if (!objekte.length) { status("Nichts ausgewählt, was sich exportieren ließe.", true); return 0; }
            ordner  = ordnerVorab || zielOrdner(v, doc);
            if (!ordner) { status("Abgebrochen."); return 0; }
            gesamtZahl = objekte.length;
            dateien = exportiereObjekte(doc, ordner, v, format, objekte);
        } else {
            seiten = seitenFuerVorgabe(doc, v, bereichFehler);
            if (!seiten.length) {
                status(v.umfang === "bereich" ? "Der Seitenbereich trifft keine Seite."
                                              : "Keine Seite zum Exportieren gefunden.", true);
                return 0;
            }
            // Stücke ohne Treffer nicht wortlos übergehen — erst nachfragen.
            if (bereichFehler.length && !imSammel &&
                !confirm("Diese Angaben aus dem Seitenbereich „" + v.bereich + "“ gibt es im Dokument nicht:\r„" +
                         bereichFehler.join("“, „") + "“\r\rDie übrigen " + seiten.length +
                         (seiten.length === 1 ? " Seite" : " Seiten") + " trotzdem exportieren?", true, TITEL)) {
                status("Export abgebrochen.", true);
                return 0;
            }
            if (format !== "PDF" && v.druckbogen) seiten = zuDruckbogen(seiten);
            ordner = ordnerVorab || zielOrdner(v, doc);
            if (!ordner) { status("Abgebrochen."); return 0; }
            gesamtZahl = (format === "PDF" && !v.pdfEinzelseiten) ? 1 : seiten.length;
            dateien = (format === "PDF")
                ? exportierePdf(doc, ordner, v, seiten)
                : exportiereBild(doc, ordner, v, format, seiten);
        }
    } catch (e) {
        alert("Export abgebrochen:\r\r" + (e.message ? e.message : e) +
              (e.line ? "\r(Zeile " + e.line + ")" : ""), TITEL);
        status("Export abgebrochen.", true);
        return 0;
    } finally {
        knoepfeSperren(false);
    }

    ablageSichern();
    letzterExportOrdner = ordner;

    if (exportAbbruch) {
        status(format + ": " + dateien.length + " von " + gesamtZahl +
               " exportiert, abgebrochen (Esc).", true);
        return dateien.length;
    }

    if (!imSammel) {
        if (v.danach === "finder")  ruhig(function () { ordner.execute(); });
        if (v.danach === "oeffnen" && dateien.length) ruhig(function () { dateien[0].execute(); });
    }

    status(format + ": " + dateien.length + (dateien.length === 1 ? " Datei" : " Dateien") +
           " → " + decodeURI(ordner.name));
    return dateien.length;
}

// Der Knopf „Alle“: exportiert die in der Vorgabe angekreuzten Formate
// nacheinander — mit EINER Zielordner-Abfrage für alle.
function sammelExportieren() {
    var doc, v, formate = [], ordner = null, i, anzahl, gesamt = 0,
        fehler = [], seiten;
    if (!app.documents.length) { status("Kein Dokument geöffnet.", true); return; }
    doc = app.activeDocument;
    v   = aktiveVorgabe();
    if (v.sammelPdf) formate.push("PDF");
    if (v.sammelJpg) formate.push("JPG");
    if (v.sammelPng) formate.push("PNG");
    if (!formate.length) {
        status("In der Vorgabe ist kein Format für den Sammelexport angekreuzt.", true);
        return;
    }
    // Den Seitenbereich einmal vorab prüfen — sonst fragte jeder
    // Formatdurchlauf erneut nach denselben Tippfehlern.
    if (v.umfang === "bereich") {
        seiten = seitenAusBereich(doc, v.bereich, fehler);
        if (!seiten.length) { status("Der Seitenbereich trifft keine Seite.", true); return; }
        if (fehler.length &&
            !confirm("Diese Angaben aus dem Seitenbereich „" + v.bereich + "“ gibt es im Dokument nicht:\r„" +
                     fehler.join("“, „") + "“\r\rDie übrigen " + seiten.length +
                     (seiten.length === 1 ? " Seite" : " Seiten") + " trotzdem exportieren?", true, TITEL)) {
            status("Export abgebrochen.", true);
            return;
        }
    }
    try {
        ordner = zielOrdner(v, doc);
    } catch (e) {
        alert("Export abgebrochen:\r\r" + (e.message ? e.message : e), TITEL);
        status("Export abgebrochen.", true);
        return;
    }
    if (!ordner) { status("Abgebrochen."); return; }

    for (i = 0; i < formate.length; i++) {
        anzahl = exportieren(formate[i], ordner, true);
        gesamt += anzahl;
        // Nach Esc oder Fehler steht die Meldung schon in der Statuszeile.
        if (anzahl <= 0 || exportAbbruch) return;
    }

    // „Danach“ nur einmal für den ganzen Stapel; „erste Datei öffnen“ hieße
    // hier drei Dateien — stattdessen zeigt auch das den Ordner.
    if (v.danach === "finder" || v.danach === "oeffnen")
        ruhig(function () { ordner.execute(); });

    status("Alle (" + formate.join(" + ") + "): " + gesamt +
           (gesamt === 1 ? " Datei" : " Dateien") + " → " + decodeURI(ordner.name));
}

// ============================================================================
//  Vorgaben bearbeiten
// ============================================================================

function vorgabenDialog(reiter) {
    var arbeit = tiefeKopie(ablage), d, kopf, ddVorgabe, btnNeu, btnKopie, btnName, btnWeg,
        tabs, tabAllgemein, tabPdf, tabJpg, tabPng, fuss, btnOk, btnAbbruch,
        rbDok, rbFest, rbFragen, etOrdner, btnOrdner, etUnter, etMuster, vorschau,
        ddUmfang, etBereich, cbBogen, cbUeber, ddDanach,
        ddPdfVorgabe, cbEinzel, cbSammelPdf, pdfNamen,
        ddJpgQual, etJpgRes, ddJpgFarbe, cbJpgIcc, cbJpgKanten, cbJpgAnschnitt, cbSammelJpg,
        ddPngQual, etPngRes, ddPngFarbe, cbPngTrans, cbPngKanten, cbPngAnschnitt, cbSammelPng,
        aktuell = 0, i, zeile, block, hinweis,
        ETIKETT = 90;   // gemeinsame Breite aller Beschriftungen links — auf allen Reitern

    if (!arbeit) { alert("Die Vorgaben ließen sich nicht lesen.", TITEL); return false; }
    for (i = 0; i < arbeit.vorgaben.length; i++)
        if (arbeit.vorgaben[i].name === arbeit.aktiv) aktuell = i;

    pdfNamen = pdfVorgabenNamen();
    if (!pdfNamen.length) pdfNamen = ["(keine PDF-Vorgabe gefunden)"];

    d = new Window("dialog", "Exportvorgaben — " + TITEL);
    d.orientation = "column";
    d.alignChildren = ["fill", "top"];
    d.margins = 14;
    d.spacing = 10;

    // ------------------------------------------------------------------ Kopf
    kopf = d.add("group");
    kopf.alignChildren = ["left", "center"];
    kopf.add("statictext", undefined, "Vorgabe:");
    ddVorgabe = kopf.add("dropdownlist", undefined, []);
    ddVorgabe.preferredSize.width = 190;
    btnNeu   = kopf.add("button", undefined, "Neu");
    btnKopie = kopf.add("button", undefined, "Kopie");
    btnName  = kopf.add("button", undefined, "Umbenennen");
    btnWeg   = kopf.add("button", undefined, "Löschen");
    btnNeu.preferredSize.width = 54;
    btnKopie.preferredSize.width = 54;
    btnName.preferredSize.width = 96;
    btnWeg.preferredSize.width = 66;

    // ------------------------------------------------------------------ Tabs
    tabs = d.add("tabbedpanel");
    tabs.alignChildren = ["fill", "top"];
    tabs.preferredSize.width = 500;

    // ---- Allgemein — drei betitelte Blöcke statt einer langen Zeilenliste
    tabAllgemein = tabs.add("tab", undefined, "Allgemein");
    tabAllgemein.orientation = "column";
    tabAllgemein.alignChildren = ["fill", "top"];
    tabAllgemein.margins = 14;
    tabAllgemein.spacing = 8;

    block = tabAllgemein.add("panel", undefined, "Ziel");
    block.orientation = "column";
    block.alignChildren = ["left", "center"];
    block.margins = 12;
    block.spacing = 5;

    rbDok    = block.add("radiobutton", undefined, "Ordner des Dokuments");
    rbFragen = block.add("radiobutton", undefined, "jedes Mal fragen");

    zeile = block.add("group");
    zeile.alignChildren = ["left", "center"];
    rbFest = zeile.add("radiobutton", undefined, "fester Ordner:");
    etOrdner = zeile.add("edittext", undefined, "");
    etOrdner.preferredSize.width = 210;
    btnOrdner = zeile.add("button", undefined, "Wählen…");
    btnOrdner.preferredSize.width = 74;

    zeile = block.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Unterordner:").preferredSize.width = ETIKETT;
    etUnter = zeile.add("edittext", undefined, "");
    etUnter.preferredSize.width = 150;
    zeile.add("statictext", undefined, "leer = direkt in den Zielordner");

    block = tabAllgemein.add("panel", undefined, "Dateiname");
    block.orientation = "column";
    block.alignChildren = ["left", "center"];
    block.margins = 12;
    block.spacing = 5;

    zeile = block.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Muster:").preferredSize.width = ETIKETT;
    etMuster = zeile.add("edittext", undefined, "");
    etMuster.preferredSize.width = 320;

    hinweis = block.add("statictext", undefined,
        "Platzhalter: {dok} {vorgabe} {seite} {nr} {datum} {zeit} {format}");
    kleinerSetzen(hinweis);

    // Beispielzeile, die beim Tippen mitgeht — spart den Testexport.
    vorschau = block.add("statictext", undefined, "Ergebnis: …");
    vorschau.preferredSize.width = 430;
    kleinerSetzen(vorschau);
    ruhig(function () {
        var g = vorschau.graphics;
        g.foregroundColor = g.newPen(g.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1);
    });

    block = tabAllgemein.add("panel", undefined, "Umfang & danach");
    block.orientation = "column";
    block.alignChildren = ["left", "center"];
    block.margins = 12;
    block.spacing = 5;

    zeile = block.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Umfang:").preferredSize.width = ETIKETT;
    ddUmfang = zeile.add("dropdownlist", undefined, texte(UMFAENGE));
    ddUmfang.preferredSize.width = 140;
    zeile.add("statictext", undefined, "Seiten:");
    etBereich = zeile.add("edittext", undefined, "");
    etBereich.preferredSize.width = 120;

    cbBogen = block.add("checkbox", undefined, "Druckbogen statt Einzelseiten (JPG/PNG; beim PDF entscheidet die PDF-Vorgabe)");
    cbUeber = block.add("checkbox", undefined, "Vorhandene Dateien überschreiben (sonst _2, _3 …)");

    zeile = block.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Danach:").preferredSize.width = ETIKETT;
    ddDanach = zeile.add("dropdownlist", undefined, texte(DANACH));
    ddDanach.preferredSize.width = 200;

    // ---- PDF
    tabPdf = tabs.add("tab", undefined, "PDF");
    tabPdf.orientation = "column";
    tabPdf.alignChildren = ["fill", "top"];
    tabPdf.margins = 14;
    tabPdf.spacing = 8;

    zeile = tabPdf.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "PDF-Vorgabe:").preferredSize.width = ETIKETT;
    ddPdfVorgabe = zeile.add("dropdownlist", undefined, pdfNamen);
    ddPdfVorgabe.preferredSize.width = 300;

    cbEinzel    = tabPdf.add("checkbox", undefined, "Eine PDF je Seite");
    cbSammelPdf = tabPdf.add("checkbox", undefined, "Gehört zum Sammelexport (Knopf „Alle“)");

    hinweis = tabPdf.add("statictext", undefined,
        "Alles Weitere — Anschnitt, Marken, Komprimierung, Druckbögen, Standards —\n" +
        "steht in der PDF-Exportvorgabe von InDesign. Nur der Seitenumfang kommt\n" +
        "aus dem Reiter „Allgemein“.", { multiline: true });
    hinweis.preferredSize.height = 48;

    // ---- JPG
    tabJpg = tabs.add("tab", undefined, "JPG");
    tabJpg.orientation = "column";
    tabJpg.alignChildren = ["fill", "top"];
    tabJpg.margins = 14;
    tabJpg.spacing = 8;

    zeile = tabJpg.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Qualität:").preferredSize.width = ETIKETT;
    ddJpgQual = zeile.add("dropdownlist", undefined, texte(QUALITAETEN));
    ddJpgQual.preferredSize.width = 120;
    zeile.add("statictext", undefined, "Auflösung:");
    etJpgRes = zeile.add("edittext", undefined, "");
    etJpgRes.preferredSize.width = 60;
    zeile.add("statictext", undefined, "ppi");

    zeile = tabJpg.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Farbraum:").preferredSize.width = ETIKETT;
    ddJpgFarbe = zeile.add("dropdownlist", undefined, texte(JPG_FARBEN));
    ddJpgFarbe.preferredSize.width = 120;

    cbJpgIcc       = tabJpg.add("checkbox", undefined, "Farbprofil einbetten");
    cbJpgKanten    = tabJpg.add("checkbox", undefined, "Kantenglättung");
    cbJpgAnschnitt = tabJpg.add("checkbox", undefined, "Anschnitt des Dokuments mit exportieren");
    cbSammelJpg    = tabJpg.add("checkbox", undefined, "Gehört zum Sammelexport (Knopf „Alle“)");

    // ---- PNG
    tabPng = tabs.add("tab", undefined, "PNG");
    tabPng.orientation = "column";
    tabPng.alignChildren = ["fill", "top"];
    tabPng.margins = 14;
    tabPng.spacing = 8;

    zeile = tabPng.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Qualität:").preferredSize.width = ETIKETT;
    ddPngQual = zeile.add("dropdownlist", undefined, texte(QUALITAETEN));
    ddPngQual.preferredSize.width = 120;
    zeile.add("statictext", undefined, "Auflösung:");
    etPngRes = zeile.add("edittext", undefined, "");
    etPngRes.preferredSize.width = 60;
    zeile.add("statictext", undefined, "ppi");

    zeile = tabPng.add("group");
    zeile.alignChildren = ["left", "center"];
    zeile.add("statictext", undefined, "Farbraum:").preferredSize.width = ETIKETT;
    ddPngFarbe = zeile.add("dropdownlist", undefined, texte(PNG_FARBEN));
    ddPngFarbe.preferredSize.width = 120;

    cbPngTrans     = tabPng.add("checkbox", undefined, "Transparenter Hintergrund");
    cbPngKanten    = tabPng.add("checkbox", undefined, "Kantenglättung");
    cbPngAnschnitt = tabPng.add("checkbox", undefined, "Anschnitt des Dokuments mit exportieren");
    cbSammelPng    = tabPng.add("checkbox", undefined, "Gehört zum Sammelexport (Knopf „Alle“)");

    // ------------------------------------------------------------------ Fuß
    fuss = d.add("group");
    fuss.alignment = "right";
    btnAbbruch = fuss.add("button", undefined, "Abbrechen", { name: "cancel" });
    btnOk      = fuss.add("button", undefined, "Sichern", { name: "ok" });

    // ------------------------------------------------------------- Verhalten
    function felderFuellen(v) {
        var index;
        rbDok.value    = (v.zielArt === "dokument");
        rbFest.value   = (v.zielArt === "fest");
        rbFragen.value = (v.zielArt === "fragen");
        etOrdner.text  = v.zielOrdner || "";
        etUnter.text   = v.unterordner || "";
        etMuster.text  = v.muster || "{dok}";
        ddUmfang.selection = schluesselIndex(UMFAENGE, v.umfang);
        etBereich.text = v.bereich || "";
        cbBogen.value  = v.druckbogen === true;
        cbUeber.value  = v.ueberschreiben === true;
        ddDanach.selection = schluesselIndex(DANACH, v.danach);

        index = indexVon(pdfNamen, v.pdfVorgabe);
        ddPdfVorgabe.selection = (index < 0) ? 0 : index;
        cbEinzel.value = v.pdfEinzelseiten === true;
        cbSammelPdf.value = v.sammelPdf === true;
        cbSammelJpg.value = v.sammelJpg === true;
        cbSammelPng.value = v.sammelPng === true;

        ddJpgQual.selection  = schluesselIndex(QUALITAETEN, v.jpgQualitaet);
        etJpgRes.text        = String(v.jpgAufloesung);
        ddJpgFarbe.selection = schluesselIndex(JPG_FARBEN, v.jpgFarbraum);
        cbJpgIcc.value       = v.jpgIcc === true;
        cbJpgKanten.value    = v.jpgKanten === true;
        cbJpgAnschnitt.value = v.jpgAnschnitt === true;

        ddPngQual.selection  = schluesselIndex(QUALITAETEN, v.pngQualitaet);
        etPngRes.text        = String(v.pngAufloesung);
        ddPngFarbe.selection = schluesselIndex(PNG_FARBEN, v.pngFarbraum);
        cbPngTrans.value     = v.pngTransparenz === true;
        cbPngKanten.value    = v.pngKanten === true;
        cbPngAnschnitt.value = v.pngAnschnitt === true;

        felderSchalten();
    }

    function felderSchalten() {
        etOrdner.enabled  = rbFest.value;
        btnOrdner.enabled = rbFest.value;
        etBereich.enabled = (schluesselVon(UMFAENGE, ddUmfang.selection.index) === "bereich");
        vorschauZeigen();
    }

    // Zeigt unter dem Muster live, wie der Dateiname aussehen wird — mit dem
    // offenen Dokument als Beispiel; die Endung .jpg steht stellvertretend.
    function vorschauZeigen() {
        var probe = {}, doc = null, umfangArt, teil, mehrere, name = "";
        ruhig(function () { if (app.documents.length) doc = app.activeDocument; });
        if (!doc) doc = { name: "Dokument.indd" };
        probe.name   = arbeit.vorgaben[aktuell].name;
        probe.muster = trimme(etMuster.text) || "{dok}";
        umfangArt = ddUmfang.selection ? schluesselVon(UMFAENGE, ddUmfang.selection.index) : "alle";
        if (umfangArt === "auswahl") {
            teil = "Objekt-01";
        } else {
            teil = "1";
            ruhig(function () { teil = String(app.activeWindow.activePage.name); });
        }
        mehrere = (umfangArt !== "aktuelle");
        ruhig(function () { name = nameMitTeil(probe, doc, "JPG", teil, 1, mehrere); });
        vorschau.text = name.length ? ("Ergebnis: " + name + ".jpg") : "";
    }

    function felderLesen(v) {
        v.zielArt        = rbFest.value ? "fest" : (rbFragen.value ? "fragen" : "dokument");
        v.zielOrdner     = trimme(etOrdner.text);
        v.unterordner    = trimme(etUnter.text);
        v.muster         = trimme(etMuster.text) || "{dok}";
        v.umfang         = schluesselVon(UMFAENGE, ddUmfang.selection.index);
        v.bereich        = trimme(etBereich.text);
        v.druckbogen     = cbBogen.value;
        v.ueberschreiben = cbUeber.value;
        v.danach         = schluesselVon(DANACH, ddDanach.selection.index);

        v.pdfVorgabe     = ddPdfVorgabe.selection ? String(ddPdfVorgabe.selection.text) : v.pdfVorgabe;
        v.pdfEinzelseiten= cbEinzel.value;
        v.sammelPdf      = cbSammelPdf.value;
        v.sammelJpg      = cbSammelJpg.value;
        v.sammelPng      = cbSammelPng.value;

        v.jpgQualitaet   = schluesselVon(QUALITAETEN, ddJpgQual.selection.index);
        v.jpgAufloesung  = Math.max(9, Math.min(2400, Math.round(zahl(etJpgRes.text, 300))));
        v.jpgFarbraum    = schluesselVon(JPG_FARBEN, ddJpgFarbe.selection.index);
        v.jpgIcc         = cbJpgIcc.value;
        v.jpgKanten      = cbJpgKanten.value;
        v.jpgAnschnitt   = cbJpgAnschnitt.value;

        v.pngQualitaet   = schluesselVon(QUALITAETEN, ddPngQual.selection.index);
        v.pngAufloesung  = Math.max(9, Math.min(2400, Math.round(zahl(etPngRes.text, 150))));
        v.pngFarbraum    = schluesselVon(PNG_FARBEN, ddPngFarbe.selection.index);
        v.pngTransparenz = cbPngTrans.value;
        v.pngKanten      = cbPngKanten.value;
        v.pngAnschnitt   = cbPngAnschnitt.value;
    }

    function listeFuellen(auswahl) {
        var k;
        ddVorgabe.removeAll();
        for (k = 0; k < arbeit.vorgaben.length; k++)
            ddVorgabe.add("item", arbeit.vorgaben[k].name);
        ddVorgabe.selection = Math.max(0, Math.min(auswahl, arbeit.vorgaben.length - 1));
    }

    function freierName(wunsch) {
        var basis = sauberName(wunsch), name = basis, k = 2, doppelt = true, j;
        while (doppelt) {
            doppelt = false;
            for (j = 0; j < arbeit.vorgaben.length; j++)
                if (arbeit.vorgaben[j].name === name) { doppelt = true; break; }
            if (doppelt) { name = basis + " " + k; k++; }
        }
        return name;
    }

    ddVorgabe.onChange = function () {
        if (!ddVorgabe.selection) return;
        if (ddVorgabe.selection.index === aktuell) return;
        felderLesen(arbeit.vorgaben[aktuell]);
        aktuell = ddVorgabe.selection.index;
        felderFuellen(arbeit.vorgaben[aktuell]);
    };

    btnNeu.onClick = function () {
        var name = prompt("Name der neuen Vorgabe:", freierName("Neue Vorgabe"), TITEL);
        if (name === null) return;
        felderLesen(arbeit.vorgaben[aktuell]);
        arbeit.vorgaben.push(vervollstaendigen(neueVorgabe(freierName(name))));
        aktuell = arbeit.vorgaben.length - 1;
        listeFuellen(aktuell);
        felderFuellen(arbeit.vorgaben[aktuell]);
    };

    btnKopie.onClick = function () {
        var kopie;
        felderLesen(arbeit.vorgaben[aktuell]);
        kopie = tiefeKopie(arbeit.vorgaben[aktuell]);
        if (!kopie) return;
        kopie.name = freierName(arbeit.vorgaben[aktuell].name + " Kopie");
        arbeit.vorgaben.push(kopie);
        aktuell = arbeit.vorgaben.length - 1;
        listeFuellen(aktuell);
        felderFuellen(arbeit.vorgaben[aktuell]);
    };

    btnName.onClick = function () {
        var name = prompt("Neuer Name:", arbeit.vorgaben[aktuell].name, TITEL);
        if (name === null || !trimme(name).length) return;
        if (name !== arbeit.vorgaben[aktuell].name)
            arbeit.vorgaben[aktuell].name = freierName(name);
        listeFuellen(aktuell);
    };

    btnWeg.onClick = function () {
        if (arbeit.vorgaben.length < 2) {
            alert("Die letzte Vorgabe lässt sich nicht löschen.", TITEL);
            return;
        }
        if (!confirm("Vorgabe „" + arbeit.vorgaben[aktuell].name + "“ löschen?", true, TITEL)) return;
        arbeit.vorgaben.splice(aktuell, 1);
        if (aktuell >= arbeit.vorgaben.length) aktuell = arbeit.vorgaben.length - 1;
        listeFuellen(aktuell);
        felderFuellen(arbeit.vorgaben[aktuell]);
    };

    btnOrdner.onClick = function () {
        var ordner = ordnerFragen("Fester Zielordner für diese Vorgabe:");
        if (ordner) { etOrdner.text = ordner.fsName; rbFest.value = true; felderSchalten(); }
    };

    rbDok.onClick = rbFest.onClick = rbFragen.onClick = felderSchalten;
    ddUmfang.onChange = felderSchalten;
    etMuster.onChanging = vorschauZeigen;

    // Eine Auflösung, die felderLesen still auf 9–2400 klemmen (oder durch den
    // Ersatzwert tauschen) würde, wird hier vor dem Sichern gemeldet.
    function aufloesungPruefen(textWert, ersatz, etikett, probleme) {
        var roh = trimme(textWert), n = parseFloat(String(roh).replace(",", "."));
        if (isNaN(n)) {
            if (roh.length) probleme.push(etikett + ": „" + roh + "“ ist keine Zahl — " +
                                          ersatz + " ppi wird verwendet.");
            return;
        }
        n = Math.round(n);
        if (n < 9 || n > 2400)
            probleme.push(etikett + ": " + n + " ppi liegt außerhalb von 9–2400 — begrenzt auf " +
                          Math.max(9, Math.min(2400, n)) + " ppi.");
    }

    // Sichern erst nach der Prüfung: Seitenbereich gegen das offene Dokument,
    // stille Klemmwerte der Auflösung. Wer will, darf trotzdem sichern —
    // das Dokument von morgen kann den Bereich ja haben.
    btnOk.onClick = function () {
        var probleme = [], fehler = [], bereichEingabe, testSeiten;
        aufloesungPruefen(etJpgRes.text, 300, "JPG-Auflösung", probleme);
        aufloesungPruefen(etPngRes.text, 150, "PNG-Auflösung", probleme);
        if (schluesselVon(UMFAENGE, ddUmfang.selection.index) === "bereich") {
            bereichEingabe = trimme(etBereich.text);
            if (!bereichEingabe.length) {
                probleme.push("Der Umfang steht auf „Seitenbereich“, das Feld „Seiten“ ist aber leer.");
            } else if (app.documents.length) {
                testSeiten = seitenAusBereich(app.activeDocument, bereichEingabe, fehler);
                if (fehler.length)
                    probleme.push("Im offenen Dokument ohne Treffer: „" + fehler.join("“, „") + "“.");
                else if (!testSeiten.length)
                    probleme.push("Der Seitenbereich trifft im offenen Dokument keine Seite.");
            }
        }
        if (probleme.length &&
            !confirm(probleme.join("\r\r") + "\r\rTrotzdem sichern?", true, TITEL)) return;
        d.close(1);
    };

    listeFuellen(aktuell);
    felderFuellen(arbeit.vorgaben[aktuell]);
    if (reiter) ruhig(function () { tabs.selection = reiter; });

    if (d.show() !== 1) return false;

    felderLesen(arbeit.vorgaben[aktuell]);
    arbeit.aktiv = arbeit.vorgaben[aktuell].name;
    ablage = arbeit;
    if (!ablageSichern())
        alert("Die Vorgaben ließen sich nicht sichern:\r" + ablageDatei().fsName, TITEL);
    return true;
}

// ============================================================================
//  Oberfläche
// ============================================================================

var w = null, ddVorgaben = null, statusText = null, stumm = false;

// Die normale Schriftfarbe der Statuszeile, einmal beim Bauen abgelesen.
// Nur wenn das gelang, färbt status() Fehler rot — sonst bliebe die Zeile
// nach dem ersten Fehler für immer rot hängen.
var statusFarbe = null;

// Alle Bedienelemente der Palette — während eines Exports gesperrt. Die
// Tiefe zählt mit, weil der Sammelexport exportieren() mehrfach ruft.
var alleKnoepfe = [], sperrTiefe = 0;

function status(text, fehler) {
    if (!statusText) return;
    ruhig(function () { statusText.text = String(text); });
    ruhig(function () {
        var g = statusText.graphics;
        if (!statusFarbe) return;
        g.foregroundColor = fehler
            ? g.newPen(g.PenType.SOLID_COLOR, [0.78, 0.25, 0.2], 1)
            : statusFarbe;
    });
}

// Fortschritt in die Statuszeile und die Palette sofort neu zeichnen —
// sonst wirkt sie bei vielen Seiten eingefroren.
function fortschritt(text) {
    status(text);
    ruhig(function () { if (w) w.update(); });
}

function knoepfeSperren(sperren) {
    var i, aus;
    sperrTiefe = Math.max(0, sperrTiefe + (sperren ? 1 : -1));
    aus = sperrTiefe > 0;
    for (i = 0; i < alleKnoepfe.length; i++)
        ruhig(function () { alleKnoepfe[i].enabled = !aus; });
}

// Eine Zeile, die zusammenfasst, was die Vorgabe beim Export tut — als
// helpTip am Auswahlfeld, damit man nicht erst den Dialog öffnen muss.
function vorgabeZusammenfassung(v) {
    var teile = [], ziel, sammel = [];
    if (v.zielArt === "fest")        ziel = "fester Ordner: " + (v.zielOrdner || "?");
    else if (v.zielArt === "fragen") ziel = "jedes Mal fragen";
    else                             ziel = "Ordner des Dokuments";
    if (trimme(v.unterordner).length) ziel += "/" + v.unterordner;
    teile.push(ziel);
    if (v.umfang === "aktuelle")      teile.push("aktuelle Seite");
    else if (v.umfang === "bereich")  teile.push("Seiten " + (v.bereich || "?"));
    else if (v.umfang === "auswahl")  teile.push("Auswahl");
    else                              teile.push("alle Seiten");
    teile.push("PDF: " + (v.pdfVorgabe || "?") + (v.pdfEinzelseiten ? " · je Seite einzeln" : ""));
    teile.push("JPG " + v.jpgAufloesung + " ppi " + v.jpgFarbraum);
    teile.push("PNG " + v.pngAufloesung + " ppi " + v.pngFarbraum);
    if (v.sammelPdf) sammel.push("PDF");
    if (v.sammelJpg) sammel.push("JPG");
    if (v.sammelPng) sammel.push("PNG");
    if (sammel.length) teile.push("Alle: " + sammel.join(" + "));
    return teile.join("  ·  ");
}

function vorgabenlisteFuellen() {
    var namen = vorgabenNamen(), index;
    stumm = true;
    ddVorgaben.removeAll();
    for (index = 0; index < namen.length; index++) ddVorgaben.add("item", namen[index]);
    index = indexVon(namen, ablage.aktiv);
    ddVorgaben.selection = (index < 0) ? 0 : index;
    ablage.aktiv = namen[(index < 0) ? 0 : index];
    stumm = false;
    ruhig(function () { ddVorgaben.helpTip = vorgabeZusammenfassung(aktiveVorgabe()); });
}

function fensterBauen() {
    var reihe, trenner, btnSeite, btnHundert, btnObjekt, btnMontage,
        btnVorgaben, btnPdf, btnJpg, btnPng, btnAlle,
        zoomKnoepfe, zoomBreite, gesamt, exportBreite, vorgabenBreite;

    w = new Window("palette", TITEL, undefined, { resizeable: false });
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    w.margins = 10;
    w.spacing = 6;

    // ----------------------------------------------------------------- Zoom
    reihe = w.add("group");
    reihe.spacing = 4;
    reihe.margins = 0;
    reihe.alignChildren = ["left", "center"];

    btnSeite   = reihe.add("button", undefined, "Seite");
    btnHundert = reihe.add("button", undefined, "100 %");
    btnObjekt  = reihe.add("button", undefined, "Objekt");
    btnMontage = reihe.add("button", undefined, "Montage");

    btnSeite.helpTip   = "Seite ins Fenster einpassen  ·  Alt-Klick: ganzer Druckbogen";
    btnHundert.helpTip = "Originalgröße (100 %)  ·  bei einer Auswahl auf die Auswahl";
    btnObjekt.helpTip  = "Auswahl ins Fenster einpassen";
    btnMontage.helpTip = "Ganze Montagefläche zeigen";

    btnSeite.onClick = function () {
        if (altGedrueckt()) zoomen(ZOOM.DRUCKBOGEN, "Druckbogen eingepasst");
        else zoomen(ZOOM.SEITE, "Seite eingepasst");
    };
    btnHundert.onClick = function () { zoomOriginalgroesse(); };
    btnObjekt.onClick  = function () { zoomAufAuswahl(false); };
    btnMontage.onClick = function () { zoomen(ZOOM.MONTAGE, "Montagefläche"); };

    trenner = w.add("panel");
    trenner.alignment = "fill";
    trenner.preferredSize.height = 1;

    // -------------------------------------------------------------- Vorgabe
    reihe = w.add("group");
    reihe.spacing = 4;
    reihe.margins = 0;
    reihe.alignChildren = ["left", "center"];

    ddVorgaben = reihe.add("dropdownlist", undefined, []);
    ddVorgaben.helpTip = "Welche Vorgabe die Exportknöpfe verwenden";

    btnVorgaben = reihe.add("button", undefined, "Vorgaben…");
    btnVorgaben.helpTip = "Vorgaben anlegen und bearbeiten";

    ddVorgaben.onChange = function () {
        if (stumm || !ddVorgaben.selection) return;
        ablage.aktiv = String(ddVorgaben.selection.text);
        ablageSichern();
        ruhig(function () { ddVorgaben.helpTip = vorgabeZusammenfassung(aktiveVorgabe()); });
        status("Vorgabe: " + ablage.aktiv);
    };
    btnVorgaben.onClick = function () {
        if (vorgabenDialog(0)) { vorgabenlisteFuellen(); status("Vorgaben gesichert."); }
    };

    // --------------------------------------------------------------- Export
    reihe = w.add("group");
    reihe.spacing = 4;
    reihe.margins = 0;
    reihe.alignChildren = ["left", "center"];

    btnPdf  = reihe.add("button", undefined, "PDF");
    btnJpg  = reihe.add("button", undefined, "JPG");
    btnPng  = reihe.add("button", undefined, "PNG");
    btnAlle = reihe.add("button", undefined, "Alle");

    btnPdf.helpTip  = "PDF nach Vorgabe exportieren  ·  Alt-Klick: Vorgaben, Reiter PDF";
    btnJpg.helpTip  = "JPG nach Vorgabe exportieren  ·  Alt-Klick: Vorgaben, Reiter JPG";
    btnPng.helpTip  = "PNG nach Vorgabe exportieren  ·  Alt-Klick: Vorgaben, Reiter PNG";
    btnAlle.helpTip = "Alle in der Vorgabe angekreuzten Formate nacheinander exportieren";

    btnPdf.onClick = function () {
        if (altGedrueckt()) { if (vorgabenDialog(1)) vorgabenlisteFuellen(); return; }
        exportieren("PDF");
    };
    btnJpg.onClick = function () {
        if (altGedrueckt()) { if (vorgabenDialog(2)) vorgabenlisteFuellen(); return; }
        exportieren("JPG");
    };
    btnPng.onClick = function () {
        if (altGedrueckt()) { if (vorgabenDialog(3)) vorgabenlisteFuellen(); return; }
        exportieren("PNG");
    };
    btnAlle.onClick = function () { sammelExportieren(); };

    // --------------------------------------------------------------- Status
    statusText = w.add("statictext", undefined, "bereit");
    statusText.preferredSize.height = 14;
    statusText.helpTip = "Klick: zuletzt benutzten Exportordner im Finder öffnen";
    kleinerSetzen(statusText);
    ruhig(function () { statusFarbe = statusText.graphics.foregroundColor; });
    ruhig(function () {
        statusText.addEventListener("mousedown", function () {
            if (letzterExportOrdner && letzterExportOrdner.exists) letzterExportOrdner.execute();
        });
    });

    // Während eines Exports wird alles hier gesperrt (siehe knoepfeSperren).
    alleKnoepfe = [btnSeite, btnHundert, btnObjekt, btnMontage,
                   ddVorgaben, btnVorgaben, btnPdf, btnJpg, btnPng, btnAlle];

    // -------------------------------------------------------------- Aufmaß
    // Erst messen, dann verteilen: die vier Zoomknöpfe bestimmen die Breite
    // der Leiste, die beiden anderen Reihen richten sich danach.
    zoomKnoepfe  = [btnSeite, btnHundert, btnObjekt, btnMontage];
    zoomBreite   = reiheBreite(zoomKnoepfe, 18, MIN_KNOPF);
    gesamt       = zoomBreite * 4 + 3 * 4;
    exportBreite = Math.floor((gesamt - 3 * 4) / 4);
    vorgabenBreite = Math.max(74, textBreite(btnVorgaben) + 18);

    btnSeite.preferredSize   = [zoomBreite, 22];
    btnHundert.preferredSize = [zoomBreite, 22];
    btnObjekt.preferredSize  = [zoomBreite, 22];
    btnMontage.preferredSize = [zoomBreite, 22];

    ddVorgaben.preferredSize  = [gesamt - vorgabenBreite - 4, 22];
    btnVorgaben.preferredSize = [vorgabenBreite, 22];

    btnPdf.preferredSize  = [exportBreite, 24];
    btnJpg.preferredSize  = [exportBreite, 24];
    btnPng.preferredSize  = [exportBreite, 24];
    btnAlle.preferredSize = [exportBreite, 24];

    statusText.preferredSize.width = gesamt;
    ruhig(function () { w.layout.layout(true); });

    w.onClose = function () {
        ruhig(function () {
            ablage.fenster = [w.location[0], w.location[1]];
            ablageSichern();
        });
        return true;
    };
}

// ============================================================================
//  Start
// ============================================================================

function start() {
    // Ein zweiter Aufruf soll das alte Fenster ablösen, nicht danebenlegen.
    ruhig(function () {
        if ($.global.dwbkdZoomExportFenster && $.global.dwbkdZoomExportFenster.visible)
            $.global.dwbkdZoomExportFenster.close();
    });

    ablageLaden();
    fensterBauen();
    vorgabenlisteFuellen();
    $.global.dwbkdZoomExportFenster = w;

    // Der Klick auf die Statuszeile soll gleich nach dem Start funktionieren —
    // der letzte Exportordner steht ja schon in der Ablage.
    ruhig(function () {
        var f = new Folder(ablage.letzterOrdner);
        if (ablage.letzterOrdner && f.exists) letzterExportOrdner = f;
    });

    w.show();
    // Die gemerkte Position nur einnehmen, wenn sie noch auf einem
    // angeschlossenen Bildschirm liegt (Zweitmonitor abgezogen?).
    if (ablage.fenster && ablage.fenster.length === 2 &&
        positionSichtbar(ablage.fenster[0], ablage.fenster[1]))
        ruhig(function () { w.location = [ablage.fenster[0], ablage.fenster[1]]; });
    status("Vorgabe: " + ablage.aktiv);
    if (ladeMeldung) status(ladeMeldung, true);
}

// Diagnose-Zugang: erlaubt es, die Bausteine aus einem anderen Script heraus
// aufzurufen — dazu dort dieselbe Skript-Umgebung angeben:
//     #targetengine "dwbkd_zoomexport"
$.global.dwbkdZoomExport = {
    version:        VERSION,
    exportieren:    exportieren,
    sammelExportieren: sammelExportieren,
    zoomen:         zoomen,
    zoomAufAuswahl: zoomAufAuswahl,
    seitenAusBereich: seitenAusBereich,
    nameMitTeil:    nameMitTeil,
    ablage:         function () { return ablage; },
    ablageLaden:    ablageLaden,
    ablageSichern:  ablageSichern,
    fenster:        function () { return w; }
};

start();

})();
