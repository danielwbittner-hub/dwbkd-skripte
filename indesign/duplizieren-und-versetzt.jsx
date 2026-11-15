// ============================================================================
// Duplizieren-und-versetzt.jsx  —  Adobe InDesign                 Version 1.2
// ----------------------------------------------------------------------------
// „Bearbeiten > Duplizieren und versetzt einfügen“ (Step and Repeat) mit
// SPEICHERBAREN Werten: oben im Fenster ein Feld „Voreinstellungen“ (Dropdown
// + Speichern + Löschen) für benannte Presets. Außerdem stehen die zuletzt
// benutzten Werte beim nächsten Öffnen automatisch wieder da — Schluss mit
// jedesmal neu eintippen.
//
// LIVE-VORSCHAU: Die Kopien erscheinen schon während der Eingabe direkt im
// Dokument hinter dem Fenster und werden bei jeder Änderung neu gezeichnet
// (abschaltbar; ab 400 Kopien automatisch aus, damit das Tippen flüssig
// bleibt). „Erstellen“ baut sie am Ende als EIN sauberer Rückgängig-Schritt.
//
// Die ausgewählten Objekte werden vervielfältigt und dabei versetzt — als
// Reihe (Anzahl) oder als Raster (Zeilen × Spalten). „Versatz“ ist wie in
// InDesign der Abstand von Kante zu Kante jeweils ZUR Ausgangsposition;
// alternativ lässt sich der Wert als reiner Zwischenraum verstehen (dann wird
// die Objektgröße dazugerechnet — praktisch für Nutzen-Montagen).
//
// Zählweise wie in InDesign: die Zahl zählt die ZUSÄTZLICHEN Kopien, das
// Original kommt dazu. Eine Zeile „Ergebnis: N Objekte insgesamt“ zeigt
// laufend, was wirklich herauskommt.
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de
// ============================================================================

#target indesign

(function () {

    if (app.documents.length === 0) { alert("Kein Dokument geöffnet."); return; }
    var doc = app.activeDocument;

    // -------------------------------------------- Auswahl auf Objekte eingrenzen
    // Nur echte Seitenobjekte (keine Textmarke, kein Textbereich). Erkennbar
    // daran, dass sich geometricBounds lesen lässt.
    var auswahl = [];
    var roh = app.selection;
    for (var i = 0; i < roh.length; i++) {
        try {
            var gb = roh[i].geometricBounds;
            if (gb && gb.length === 4 && typeof roh[i].duplicate === "function") auswahl.push(roh[i]);
        } catch (e) {}
    }
    if (auswahl.length === 0) {
        alert("Bitte zuerst ein oder mehrere Objekte auswählen\n" +
              "(ein markierter Text oder eine Textmarke zählt nicht).");
        return;
    }

    // ------------------------------------------------------------ Einheiten
    var einheiten = ["mm", "cm", "pt", "Zoll", "px"];
    var nachPt    = { "mm": 2.834645669291339, "cm": 28.34645669291339,
                      "pt": 1, "Zoll": 72, "px": 1 };   // px = 72 dpi
    function einheitAusDoc() {
        try {
            switch (doc.viewPreferences.horizontalMeasurementUnits) {
                case MeasurementUnits.MILLIMETERS: return 0;
                case MeasurementUnits.CENTIMETERS: return 1;
                case MeasurementUnits.POINTS:      return 2;
                case MeasurementUnits.INCHES:
                case MeasurementUnits.INCHES_DECIMAL: return 3;
                case MeasurementUnits.PIXELS:      return 4;
            }
        } catch (e) {}
        return 0;
    }

    // ======================================================================
    // Voreinstellungen (benannte Presets + zuletzt verwendet) — dwbPrefs
    // Datei: Folder.userData/Duplizieren-und-versetzt-Presets.txt
    // Format:  [Name]  +  schlüssel=wert-Zeilen ;  [__last__] = zuletzt
    // ======================================================================
    function dwbPrefs(parent, fileName) {
        var datei = new File(Folder.userData.fsName + "/" + fileName);
        var LETZTE = "__last__";

        function lesen() {
            var m = {};
            try {
                if (!datei.exists) return m;
                datei.encoding = "UTF-8";
                datei.open("r");
                var txt = datei.read(); datei.close();
                var zeilen = txt.split(/\r\n|\r|\n/);
                var akt = null;
                for (var k = 0; k < zeilen.length; k++) {
                    var z = zeilen[k];
                    if (z.length === 0) continue;
                    var mm = z.match(/^\[(.*)\]$/);
                    if (mm) { akt = mm[1]; m[akt] = {}; continue; }
                    if (akt === null) continue;
                    var p = z.indexOf("=");
                    if (p < 0) continue;
                    m[akt][z.substring(0, p)] = z.substring(p + 1);
                }
            } catch (e) {}
            return m;
        }
        function schreiben(m) {
            try {
                var out = [];
                for (var name in m) {
                    if (!m.hasOwnProperty(name)) continue;
                    out.push("[" + name + "]");
                    var o = m[name];
                    for (var kk in o) if (o.hasOwnProperty(kk)) out.push(kk + "=" + o[kk]);
                }
                datei.encoding = "UTF-8";
                datei.open("w");
                datei.write(out.join("\n"));
                datei.close();
            } catch (e) {}
        }
        function namen(m) {
            var n = [];
            for (var name in m) if (m.hasOwnProperty(name) && name !== LETZTE) n.push(name);
            n.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
            return n;
        }

        var daten = lesen();

        var panel = parent.add("panel", undefined, "Voreinstellungen");
        panel.orientation = "row";
        panel.alignChildren = "center";
        panel.margins = [12, 14, 12, 10];
        var dd  = panel.add("dropdownlist", undefined, namen(daten));
        dd.preferredSize.width = 180;
        var bSpei = panel.add("button", undefined, "Speichern …");
        var bLoe  = panel.add("button", undefined, "Löschen");

        var api = {
            panel: panel,
            activate: function (getState, setState) {
                bSpei.onClick = function () {
                    var vorgabe = (dd.selection && dd.selection.text) ? dd.selection.text : "";
                    var name = prompt("Name der Voreinstellung:", vorgabe, "Speichern");
                    if (name === null) return;
                    name = String(name).replace(/[\[\]\r\n=]/g, "").replace(/^\s+|\s+$/g, "");
                    if (name === "" || name === LETZTE) { alert("Bitte einen gültigen Namen eingeben."); return; }
                    daten[name] = getState();
                    schreiben(daten);
                    dd.removeAll();
                    var ns = namen(daten);
                    for (var x = 0; x < ns.length; x++) dd.add("item", ns[x]);
                    for (var y = 0; y < dd.items.length; y++)
                        if (dd.items[y].text === name) { dd.selection = y; break; }
                };
                bLoe.onClick = function () {
                    if (!dd.selection) { alert("Keine Voreinstellung gewählt."); return; }
                    var name = dd.selection.text;
                    if (!confirm("Voreinstellung „" + name + "“ löschen?")) return;
                    delete daten[name];
                    schreiben(daten);
                    dd.removeAll();
                    var ns = namen(daten);
                    for (var x = 0; x < ns.length; x++) dd.add("item", ns[x]);
                    dd.selection = null;
                };
                dd.onChange = function () {
                    if (dd.selection && daten[dd.selection.text]) setState(daten[dd.selection.text]);
                };
                // Zuletzt verwendete Werte wiederherstellen.
                if (daten[LETZTE]) setState(daten[LETZTE]);
            },
            saveLast: function (getState) {
                daten[LETZTE] = getState();
                schreiben(daten);
            }
        };
        return api;
    }

    // ------------------------------------------------------------ Das Fenster
    var win = new Window("dialog", "Duplizieren und versetzt");
    win.orientation = "column";
    win.alignChildren = "fill";
    win.margins = 16;
    win.spacing = 10;

    var prefs = dwbPrefs(win, "Duplizieren-und-versetzt-Presets.txt");

    // --- Anzahl / Raster ---------------------------------------------------
    var pZahl = win.add("panel", undefined, "Anzahl");
    pZahl.orientation = "column";
    pZahl.alignChildren = "left";
    pZahl.margins = [12, 16, 12, 10];
    pZahl.spacing = 8;

    var cbRaster = pZahl.add("checkbox", undefined, "Als Raster anordnen");

    var gReihe = pZahl.add("group");
    gReihe.add("statictext", undefined, "Anzahl Kopien");
    var etAnzahl = gReihe.add("edittext", undefined, "3");
    etAnzahl.preferredSize.width = 55;

    var gRaster = pZahl.add("group");
    gRaster.add("statictext", undefined, "Zeilen");
    var etZeilen = gRaster.add("edittext", undefined, "2");
    etZeilen.preferredSize.width = 45;
    gRaster.add("statictext", undefined, "   Spalten");
    var etSpalten = gRaster.add("edittext", undefined, "2");
    etSpalten.preferredSize.width = 45;

    // --- Versatz -----------------------------------------------------------
    var pVers = win.add("panel", undefined, "Versatz");
    pVers.orientation = "column";
    pVers.alignChildren = "left";
    pVers.margins = [12, 16, 12, 10];
    pVers.spacing = 8;

    var gV = pVers.add("group");
    gV.add("statictext", undefined, "Vertikal").preferredSize.width = 55;
    var etV = gV.add("edittext", undefined, "0");
    etV.preferredSize.width = 60;
    var ddEinheitV = gV.add("dropdownlist", undefined, einheiten);
    ddEinheitV.preferredSize.width = 60;

    var gH = pVers.add("group");
    gH.add("statictext", undefined, "Horizontal").preferredSize.width = 55;
    var etH = gH.add("edittext", undefined, "40");
    etH.preferredSize.width = 60;
    var hinweisE = gH.add("statictext", undefined, "(Einheit wie oben)");
    hinweisE.preferredSize.width = 130;

    var cbAbstand = pVers.add("checkbox", undefined, "Versatz als Abstand zwischen den Objekten");

    // --- Optionen ----------------------------------------------------------
    var cbGruppe = win.add("checkbox", undefined, "Original und Kopien gruppieren");
    var cbVorschau = win.add("checkbox", undefined, "Live-Vorschau im Dokument");
    cbVorschau.value = true;

    // --- Ergebniszeile -----------------------------------------------------
    var txtErgebnis = win.add("statictext", undefined, "");
    txtErgebnis.characters = 40;
    var txtHinweis = win.add("statictext", undefined, "");
    txtHinweis.characters = 40;
    var txtTipp = win.add("statictext", undefined, "Tipp: Werte mit ↑ / ↓ ändern, mit Umschalt (⇧) in 10er-Schritten.");
    try { txtTipp.graphics.foregroundColor = txtTipp.graphics.newPen(txtTipp.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) {}

    // --- Fußzeile ----------------------------------------------------------
    var fuss = win.add("group");
    fuss.alignment = "right";
    fuss.add("button", undefined, "Abbrechen", { name: "cancel" });
    fuss.add("button", undefined, "Erstellen", { name: "ok" });

    // ------------------------------------------------------------ Logik
    ddEinheitV.selection = einheitAusDoc();

    function nz(txt, vorgabe) {
        var v = parseFloat(String(txt).replace(",", "."));
        return isNaN(v) ? vorgabe : v;
    }
    function positionen() {
        if (cbRaster.value) {
            var z = Math.max(1, Math.round(nz(etZeilen.text, 1)));
            var s = Math.max(1, Math.round(nz(etSpalten.text, 1)));
            return z * s;                       // inkl. Original
        }
        return Math.max(1, Math.round(nz(etAnzahl.text, 1))) + 1;   // Kopien + Original
    }
    function aktualisieren() {
        gReihe.enabled  = !cbRaster.value;
        gRaster.enabled =  cbRaster.value;
        var gesamt = positionen() * auswahl.length;
        txtErgebnis.text = "Ergebnis: " + gesamt + (gesamt === 1 ? " Objekt" : " Objekte") + " insgesamt";
    }
    // Schrittweite (in Punkten) aus den aktuellen Feldern.
    function berechneSchritte() {
        var einIdx = ddEinheitV.selection ? ddEinheitV.selection.index : 0;
        var faktor = nachPt[einheiten[einIdx]];
        var vV = nz(etV.text, 0) * faktor;   // positiv = nach unten
        var vH = nz(etH.text, 0) * faktor;   // positiv = nach rechts
        var sx = vH, sy = vV;
        if (cbAbstand.value) {
            var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
            for (var a = 0; a < auswahl.length; a++) {
                var b = auswahl[a].geometricBounds;   // [y1,x1,y2,x2] in Punkten
                if (b[1] < minX) minX = b[1];
                if (b[0] < minY) minY = b[0];
                if (b[3] > maxX) maxX = b[3];
                if (b[2] > maxY) maxY = b[2];
            }
            var breite = maxX - minX, hoehe = maxY - minY;
            sx = (vH >= 0 ? vH + breite : vH - breite);
            sy = (vV >= 0 ? vV + hoehe  : vV - hoehe);
        }
        return [sx, sy];
    }
    // Erzeugt die Kopien und gibt NUR die neuen Objekte zurück
    // (ohne Gruppieren — das macht erst der Endlauf). Gleiche Logik für
    // Vorschau und Ergebnis, damit beides deckungsgleich ist.
    function erzeugeKopien() {
        var rasterAn = cbRaster.value;
        var zeilen  = rasterAn ? Math.max(1, Math.round(nz(etZeilen.text, 1)))  : positionen();
        var spalten = rasterAn ? Math.max(1, Math.round(nz(etSpalten.text, 1))) : 1;
        var sp = berechneSchritte(), sx = sp[0], sy = sp[1];
        var neu = [];
        for (var r = 0; r < zeilen; r++) {
            for (var c = 0; c < spalten; c++) {
                if (r === 0 && c === 0) continue;   // Ausgangsposition = Original
                var dx = rasterAn ? c * sx : r * sx;
                var dy = rasterAn ? r * sy : r * sy;
                for (var o = 0; o < auswahl.length; o++) {
                    var k = auswahl[o].duplicate();
                    k.move(undefined, [dx, dy]);
                    neu.push(k);
                }
            }
        }
        return neu;
    }

    // --- Live-Vorschau -----------------------------------------------------
    var vorschau = [];
    var GRENZE_VORSCHAU = 400;   // darüber aus, sonst wird das Tippen zäh
    function loeschePreview() {
        for (var i = vorschau.length - 1; i >= 0; i--) { try { vorschau[i].remove(); } catch (e) {} }
        vorschau = [];
    }
    function bauePreview() {
        loeschePreview();
        if (!cbVorschau.value) { txtHinweis.text = ""; return; }
        var neue = (positionen() - 1) * auswahl.length;
        if (neue <= 0) { txtHinweis.text = ""; return; }
        if (neue > GRENZE_VORSCHAU) {
            txtHinweis.text = "Vorschau aus (mehr als " + GRENZE_VORSCHAU + " Kopien)";
            return;
        }
        txtHinweis.text = "";
        try { vorschau = erzeugeKopien(); } catch (e) { loeschePreview(); }
    }

    cbRaster.onClick   = function () { aktualisieren(); bauePreview(); };
    cbAbstand.onClick  = function () { bauePreview(); };
    cbVorschau.onClick = function () { bauePreview(); };
    ddEinheitV.onChange = function () { bauePreview(); };
    // Beim Tippen nur die Ergebniszeile (leicht); beim Verlassen/Enter neu zeichnen.
    etAnzahl.onChanging = etZeilen.onChanging = etSpalten.onChanging = aktualisieren;
    etV.onChanging = etH.onChanging = aktualisieren;
    etAnzahl.onChange = etZeilen.onChange = etSpalten.onChange =
        etV.onChange = etH.onChange = function () { aktualisieren(); bauePreview(); };

    // Pfeiltasten im Feld: ↑/↓ = ±1, mit Umschalt (⇧) = ±10.
    function pfeilSteuerung(feld, min, nurGanz) {
        feld.addEventListener("keydown", function (ev) {
            var rauf   = (ev.keyName === "Up");
            var runter = (ev.keyName === "Down");
            if (!rauf && !runter) return;
            var schritt = ev.shiftKey ? 10 : 1;
            var wert = nz(feld.text, (min !== undefined ? min : 0));
            wert += (rauf ? schritt : -schritt);
            if (nurGanz) wert = Math.round(wert);
            if (min !== undefined && wert < min) wert = min;
            wert = Math.round(wert * 1000) / 1000;   // Float-Rauschen glätten
            feld.text = String(wert);
            ev.preventDefault();                     // Cursor nicht verschieben
            aktualisieren();
            bauePreview();
        });
    }
    pfeilSteuerung(etAnzahl,  1, true);
    pfeilSteuerung(etZeilen,  1, true);
    pfeilSteuerung(etSpalten, 1, true);
    pfeilSteuerung(etV,  undefined, false);   // darf negativ/dezimal sein
    pfeilSteuerung(etH,  undefined, false);

    // getState / setState für die Voreinstellungen
    function getState() {
        return {
            raster:  cbRaster.value ? "1" : "0",
            anzahl:  etAnzahl.text,
            zeilen:  etZeilen.text,
            spalten: etSpalten.text,
            v:       etV.text,
            h:       etH.text,
            einheit: String(ddEinheitV.selection ? ddEinheitV.selection.index : 0),
            abstand: cbAbstand.value ? "1" : "0",
            gruppe:  cbGruppe.value ? "1" : "0"
        };
    }
    function setState(v) {
        if (v.raster  !== undefined) cbRaster.value  = (v.raster === "1");
        if (v.anzahl  !== undefined) etAnzahl.text   = v.anzahl;
        if (v.zeilen  !== undefined) etZeilen.text   = v.zeilen;
        if (v.spalten !== undefined) etSpalten.text  = v.spalten;
        if (v.v       !== undefined) etV.text        = v.v;
        if (v.h       !== undefined) etH.text        = v.h;
        if (v.einheit !== undefined) {
            var ix = parseInt(v.einheit, 10);
            if (!isNaN(ix) && ix >= 0 && ix < einheiten.length) ddEinheitV.selection = ix;
        }
        if (v.abstand !== undefined) cbAbstand.value = (v.abstand === "1");
        if (v.gruppe  !== undefined) cbGruppe.value  = (v.gruppe === "1");
        aktualisieren();
        bauePreview();
    }

    // Maße in Punkten rechnen, solange der Dialog offen ist (betrifft nur das
    // Skript, nicht die Lineale) — hinterher immer zurückstellen.
    var altEinheit = null;
    try { altEinheit = app.scriptPreferences.measurementUnit; } catch (e) {}
    try { app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS; } catch (e) {}
    function einheitZurueck() {
        try { if (altEinheit !== null) app.scriptPreferences.measurementUnit = altEinheit; } catch (e) {}
    }

    prefs.activate(getState, setState);   // stellt zuletzt-verwendet her
    aktualisieren();
    bauePreview();

    // Abbrechen → Vorschau wieder entfernen.
    if (win.show() !== 1) { loeschePreview(); einheitZurueck(); return; }
    prefs.saveLast(getState);

    // ------------------------------------------------------------ Ausführen
    loeschePreview();   // Vorschau weg, gleich sauber als EIN Schritt neu bauen.

    var neueGesamt = (positionen() - 1) * auswahl.length;
    if (neueGesamt === 0) { alert("Nichts zu tun: 0 Kopien eingestellt."); einheitZurueck(); return; }
    if (neueGesamt > 2000) {
        if (!confirm("Das ergibt " + neueGesamt + " neue Objekte.\nWirklich erstellen?")) { einheitZurueck(); return; }
    }

    var gruppe = cbGruppe.value;
    app.doScript(function () {
        var alle = erzeugeKopien();     // nur die neuen Objekte
        if (gruppe && alle.length > 0) {
            for (var s = 0; s < auswahl.length; s++) alle.push(auswahl[s]);
            try {
                var wirt = (auswahl[0].parentPage && auswahl[0].parentPage.parent)
                           ? auswahl[0].parentPage.parent : auswahl[0].parent;
                wirt.groups.add(alle);
            } catch (e) { /* Gruppieren nicht möglich (z. B. verschiedene Ebenen) — still lassen */ }
        }
    }, ScriptLanguage.JAVASCRIPT, undefined,
       UndoModes.ENTIRE_SCRIPT, "Duplizieren und versetzt");

    einheitZurueck();

})();
