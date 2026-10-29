// ============================================================================
// Doppelte-Linien-entfernen.jsx  —  Adobe Illustrator       ·       Version 1.1
// ----------------------------------------------------------------------------
// Findet exakt deckungsgleiche Linien UND Flächen (doppelt, dreifach oder öfter
// direkt übereinander) und löscht alle Kopien bis auf eine. So bleibt nach z. B.
// mehrfachem Einfügen, importierten PDFs/DXFs oder verschmolzenen Zeichnungen
// pro Linie/Fläche nur noch ein Objekt stehen — wichtig fürs Plotten, Cutten und
// Lasern, wo doppelte Schnittlinien doppelt gefahren werden und doppelte
// Flächen beim Füllen/Gravieren stören.
//
// Linie oder Fläche?
//   • Fläche = gefüllter Pfad (auch zusammengesetzte Pfade, z. B. QR-Module,
//     Buchstaben, Formen mit Löchern). Deckungsgleiche Mehrfach-Flächen, die
//     direkt untereinander liegen, werden genauso entfernt wie doppelte Linien.
//   • Linie  = ungefüllter Pfad (reine Kontur, offen oder geschlossen).
//   • Über die Option „Objekte" lässt sich wählen: nur Linien, nur Flächen oder
//     beide. Bei „beide" werden Linien und Flächen getrennt verglichen – eine
//     Linie wird also nie wegen einer deckungsgleichen Fläche gelöscht.
//
// Was zählt als „exakt gleich"?
//   • Gleicher Pfadverlauf: alle Ankerpunkte UND Bézier-Griffe stimmen
//     (auf Rundung genau) überein. Kurven werden also mitgeprüft, nicht nur
//     gerade Strecken.
//   • Offen/geschlossen muss übereinstimmen.
//   • Optional (aus): auch Aussehen (Kontur-/Füllfarbe & Konturstärke) muss
//     gleich sein. Standardmäßig zählt nur die Geometrie — die klassische
//     „zwei Linien exakt aufeinander"-Dublette wird so immer gefunden,
//     egal welche Farbe.
//   • Optional (an): spiegelverkehrt gezeichnete Linien (A→B und B→A) gelten
//     als dasselbe Duplikat.
//
// Funktionen (Stand 2026-10-25, v1.1):
//   • Objekte: nur Linien, nur Flächen oder beide (neu)
//   • Bereich: ganzes Dokument oder nur Auswahl
//   • Toleranz in mm (Standard 0 = exakt, fängt nur Rundungsrauschen ab)
//   • Vorschau „nur zählen" — meldet, ohne zu löschen
//   • Überspringt gesperrte/ausgeblendete Objekte, Hilfslinien, Schnittmasken
//
// Verwendung:
//   1. (optional) Objekte auswählen
//   2. Datei > Skripten > Anderes Skript … > diese Datei wählen
//   3. Optionen einstellen, „Entfernen"
//
// Hinweis: Rückgängig mit Cmd+Z stellt die gelöschten Linien wieder her.
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

#target illustrator

(function () {

    var MM = 2.834645669;                      // mm -> pt

    if (app.documents.length === 0) {
        alert("Kein Dokument geöffnet.");
        return;
    }
    var doc = app.activeDocument;
    var hatAuswahl = doc.selection && doc.selection.length > 0;

    // ===== Voreinstellungen + „zuletzt verwendet" (dwbkd, gemeinsam) ============
    // Fügt oben ein Panel mit Dropdown + Speichern/Löschen ein. Nach dem Aufbau
    // der Bedienelemente activate(getState, setState) aufrufen: lädt dann die
    // zuletzt verwendeten Werte. saveLast() nach OK aufrufen. Datei je Skript
    // unter <Benutzerdaten>/<fileName>, Format: [Name] + schlüssel=wert-Zeilen,
    // Sonderabschnitt [__last__] = zuletzt verwendet.
    function dwbPrefs(parent, fileName) {
        var LAST = "__last__";
        var store = { list: [], last: null };
        function file() { return new File(Folder.userData + "/" + fileName); }
        (function read() {
            var f = file();
            if (!f.exists) return;
            f.encoding = "UTF-8";
            if (!f.open("r")) return;
            var cur = null;
            while (!f.eof) {
                var line = f.readln();
                if (line.length && line.charAt(line.length - 1) === "\r")
                    line = line.substr(0, line.length - 1);
                if (!line.length) continue;
                if (line.charAt(0) === "[") {
                    var nm = line.substring(1, line.length - 1);
                    if (nm === LAST) { cur = {}; store.last = cur; }
                    else { cur = { __name: nm }; store.list.push(cur); }
                } else if (cur) {
                    var i = line.indexOf("=");
                    if (i > 0) cur[line.substring(0, i)] = line.substring(i + 1);
                }
            }
            f.close();
        })();
        function write() {
            var f = file();
            f.encoding = "UTF-8";
            if (!f.open("w")) { alert("Voreinstellungen konnten nicht gespeichert werden:\n" + f.fsName); return false; }
            function block(nm, o) {
                f.writeln("[" + nm + "]");
                for (var k in o) { if (k === "__name") continue; f.writeln(k + "=" + o[k]); }
                f.writeln("");
            }
            if (store.last) block(LAST, store.last);
            for (var i = 0; i < store.list.length; i++) block(store.list[i].__name, store.list[i]);
            f.close();
            return true;
        }
        var pnl = parent.add("panel", undefined, "Voreinstellungen");
        pnl.orientation = "row";
        pnl.alignChildren = "center";
        var dd = pnl.add("dropdownlist", undefined, []);
        dd.preferredSize.width = 200;
        var bS = pnl.add("button", undefined, "Speichern …");
        var bD = pnl.add("button", undefined, "Löschen");
        var self = { panel: pnl, dd: dd, getState: null, setState: null };
        function rebuild(sel) {
            dd.removeAll();
            for (var i = 0; i < store.list.length; i++) {
                var it = dd.add("item", store.list[i].__name);
                if (sel != null && store.list[i].__name === sel) dd.selection = it;
            }
        }
        dd.onChange = function () {
            if (dd.selection && self.setState) { try { self.setState(store.list[dd.selection.index]); } catch (e) {} }
        };
        bS.onClick = function () {
            if (!self.getState) return;
            var n = prompt("Name der Voreinstellung:", dd.selection ? dd.selection.text : "");
            if (!n) return;
            n = ("" + n).replace(/[\[\]\r\n=]/g, "");
            if (!n) return;
            var st = self.getState(); st.__name = n;
            var f = -1;
            for (var i = 0; i < store.list.length; i++) if (store.list[i].__name === n) f = i;
            if (f >= 0) store.list[f] = st; else store.list.push(st);
            if (write()) rebuild(n);
        };
        bD.onClick = function () {
            if (!dd.selection) { alert("Keine Voreinstellung ausgewählt."); return; }
            var idx = dd.selection.index;
            if (!confirm("Voreinstellung \"" + store.list[idx].__name + "\" löschen?")) return;
            store.list.splice(idx, 1);
            write();
            rebuild(null);
        };
        self.activate = function (getState, setState) {
            self.getState = getState; self.setState = setState;
            rebuild(null);
            if (store.last) { try { setState(store.last); } catch (e) {} }
        };
        self.saveLast = function () {
            if (!self.getState) return;
            var st = self.getState(); st.__name = undefined;
            store.last = st; write();
        };
        return self;
    }
    // ===========================================================================

    // ----------------------------------------------------------------- Dialog
    var dlg = new Window("dialog", "Doppelte Linien entfernen");
    dlg.alignChildren = "fill";
    dlg.margins = 16;
    dlg.spacing = 12;

    var prefs = dwbPrefs(dlg, "Doppelte-Linien-Presets.txt");

    var pBereich = dlg.add("panel", undefined, "Bereich");
    pBereich.alignChildren = "left";
    pBereich.margins = 14;
    var rbDoc = pBereich.add("radiobutton", undefined, "Ganzes Dokument");
    var rbSel = pBereich.add("radiobutton", undefined, "Nur Auswahl");
    rbSel.enabled = hatAuswahl;
    if (hatAuswahl) { rbSel.value = true; } else { rbDoc.value = true; }

    var pObj = dlg.add("panel", undefined, "Objekte");
    pObj.alignChildren = "left";
    pObj.margins = 14;
    pObj.spacing = 4;
    var rbLinien   = pObj.add("radiobutton", undefined, "Nur Linien (ungefüllte Pfade)");
    var rbFlaechen = pObj.add("radiobutton", undefined, "Nur Flächen (gefüllte Pfade)");
    var rbBeide    = pObj.add("radiobutton", undefined, "Beide (Linien & Flächen getrennt)");
    rbBeide.value = true;

    var pOpt = dlg.add("panel", undefined, "Vergleich");
    pOpt.alignChildren = "left";
    pOpt.margins = 14;
    pOpt.spacing = 8;
    var cbAussehen = pOpt.add("checkbox", undefined, "Auch Aussehen muss gleich sein (Farbe & Konturstärke)");
    cbAussehen.value = false;
    var cbRichtung = pOpt.add("checkbox", undefined, "Umgekehrt/gespiegelt gezeichnete Linien auch als Duplikat");
    cbRichtung.value = true;

    var gTol = pOpt.add("group");
    gTol.add("statictext", undefined, "Toleranz:");
    var etTol = gTol.add("edittext", undefined, "0");
    etTol.characters = 6;
    gTol.add("statictext", undefined, "mm (0 = exakt)");

    var cbZaehlen = dlg.add("checkbox", undefined, "Nur zählen (Vorschau, nichts löschen)");
    cbZaehlen.value = false;

    // Zustand <-> Bedienelemente (für Voreinstellungen & zuletzt verwendet)
    function getState() {
        return {
            objekte:  rbLinien.value ? "L" : rbFlaechen.value ? "F" : "B",
            bereich:  rbSel.value ? "sel" : "doc",
            aussehen: cbAussehen.value ? "1" : "0",
            richtung: cbRichtung.value ? "1" : "0",
            tol:      etTol.text,
            zaehlen:  cbZaehlen.value ? "1" : "0"
        };
    }
    function setState(v) {
        if (v.objekte === "L") rbLinien.value = true;
        else if (v.objekte === "F") rbFlaechen.value = true;
        else if (v.objekte === "B") rbBeide.value = true;
        if (v.bereich === "sel" && rbSel.enabled) rbSel.value = true;
        else if (v.bereich === "doc") rbDoc.value = true;
        if (v.aussehen !== undefined) cbAussehen.value = (v.aussehen === "1");
        if (v.richtung !== undefined) cbRichtung.value = (v.richtung === "1");
        if (v.tol !== undefined) etTol.text = v.tol;
        if (v.zaehlen !== undefined) cbZaehlen.value = (v.zaehlen === "1");
    }
    prefs.activate(getState, setState);

    var gBtn = dlg.add("group");
    gBtn.alignment = "right";
    var btnAbbr = gBtn.add("button", undefined, "Abbrechen", { name: "cancel" });
    var btnOk   = gBtn.add("button", undefined, "Entfernen", { name: "ok" });

    if (dlg.show() !== 1) return;
    prefs.saveLast();

    var modus        = rbLinien.value ? "L" : rbFlaechen.value ? "F" : "B";
    var nurAuswahl   = rbSel.value;
    var pruefAussehen = cbAussehen.value;
    var beideRichtungen = cbRichtung.value;
    var nurZaehlen   = cbZaehlen.value;

    var tolMM = parseFloat(String(etTol.text).replace(",", "."));
    if (isNaN(tolMM) || tolMM < 0) tolMM = 0;
    var tolPt = tolMM * MM;

    // ---------------------------------------------------------- Hilfsfunktionen
    // Zahl auf Toleranz runden (0 -> 0,001 pt, nur gegen Fließkomma-Rauschen).
    function q(n) {
        if (tolPt > 0) return Math.round(n / tolPt) * tolPt;
        return Math.round(n * 1000) / 1000;
    }

    function pt(p) { return q(p[0]) + "," + q(p[1]); }

    function colorKey(c) {
        if (!c) return "-";
        switch (c.typename) {
            case "RGBColor":  return "R" + Math.round(c.red) + "/" + Math.round(c.green) + "/" + Math.round(c.blue);
            case "CMYKColor": return "C" + Math.round(c.cyan) + "/" + Math.round(c.magenta) + "/" + Math.round(c.yellow) + "/" + Math.round(c.black);
            case "GrayColor": return "G" + Math.round(c.gray);
            case "SpotColor": return "S" + c.spot.name + "/" + Math.round(c.tint);
            case "NoColor":   return "-";
            default:          return c.typename;
        }
    }

    // Geometrie-Signatur eines Pfades: Anker + beide Griffe je Punkt.
    // Bei beidseitigem Vergleich wird auch die umgekehrte Punktfolge gebildet
    // (Griffe links/rechts getauscht) und der kleinere String gewählt, damit
    // A→B und B→A denselben Schlüssel ergeben.
    function geoKey(path) {
        var pts = path.pathPoints, n = pts.length, i, p;
        var vor = [], zur = [];
        for (i = 0; i < n; i++) {
            p = pts[i];
            vor.push(pt(p.anchor) + ":" + pt(p.leftDirection) + ":" + pt(p.rightDirection));
        }
        var forward = vor.join("|");
        if (!beideRichtungen) return (path.closed ? "Z" : "O") + "#" + forward;

        for (i = n - 1; i >= 0; i--) {
            p = pts[i];
            // umgekehrte Richtung: rechter und linker Griff tauschen die Rolle
            zur.push(pt(p.anchor) + ":" + pt(p.rightDirection) + ":" + pt(p.leftDirection));
        }
        var backward = zur.join("|");
        var geo = (forward <= backward) ? forward : backward;
        return (path.closed ? "Z" : "O") + "#" + geo;
    }

    // Linie = ungefüllt, Fläche = gefüllt. Ein zusammengesetzter Pfad (Fläche mit
    // Löchern, z. B. Buchstabe oder QR-Modul) zählt als eine Fläche.
    function istGefuellt(it) {
        try {
            if (it.typename === "CompoundPathItem")
                return it.pathItems.length > 0 && it.pathItems[0].filled;
            return it.filled;
        } catch (e) { return false; }
    }
    function art(it) { return istGefuellt(it) ? "F" : "L"; }

    // Geometrie eines einfachen ODER zusammengesetzten Pfades. Beim Compound
    // werden die Teilpfade sortiert verkettet, damit die Reihenfolge egal ist.
    function geoKeyOf(it) {
        if (it.typename === "CompoundPathItem") {
            var teile = [];
            for (var i = 0; i < it.pathItems.length; i++) teile.push(geoKey(it.pathItems[i]));
            teile.sort();
            return "CP{" + teile.join(";") + "}";
        }
        return geoKey(it);
    }

    // Signatur = Objektart + Geometrie (+ optional Aussehen). Die vorangestellte
    // Art trennt Linien und Flächen, auch wenn sie deckungsgleich sind.
    function signature(it, kind) {
        var key = kind + "#" + geoKeyOf(it);
        if (pruefAussehen) {
            var rep = (it.typename === "CompoundPathItem" && it.pathItems.length) ? it.pathItems[0] : it;
            var look = (rep.stroked ? "ST" + colorKey(rep.strokeColor) + "/" + q(rep.strokeWidth) : "noST") +
                       "|" + (rep.filled ? "FI" + colorKey(rep.fillColor) : "noFI");
            key += "@@" + look;
        }
        return key;
    }

    // Kandidaten einsammeln. Nur „echte" Pfade: keine Hilfslinien, keine
    // Schnittmasken, nichts Gesperrtes/Ausgeblendetes. Einzelpfade und
    // zusammengesetzte Pfade (= Flächen mit Löchern) kommen als je ein Objekt.
    function pathTauglich(it) {
        if (it.typename !== "PathItem") return false;
        if (it.guides || it.clipping) return false;
        if (it.locked || it.hidden) return false;
        if (it.parent && it.parent.typename === "CompoundPathItem") return false;
        return true;
    }
    function compoundTauglich(it) {
        if (it.typename !== "CompoundPathItem") return false;
        if (it.locked || it.hidden) return false;
        return true;
    }

    var quelle = [];
    if (nurAuswahl) {
        // Auswahl kann Gruppen enthalten — flach durchsuchen.
        (function sammeln(items) {
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (it.typename === "GroupItem") sammeln(it.pageItems);
                else if (pathTauglich(it)) quelle.push(it);
                else if (compoundTauglich(it)) quelle.push(it);
            }
        })(doc.selection);
    } else {
        var allP = doc.pathItems;
        for (var i = 0; i < allP.length; i++) if (pathTauglich(allP[i])) quelle.push(allP[i]);
        var allC = doc.compoundPathItems;
        for (var c = 0; c < allC.length; c++) if (compoundTauglich(allC[c])) quelle.push(allC[c]);
    }

    // Nach gewählter Objektart filtern (bei „Beide" bleibt alles drin).
    if (modus !== "B") {
        var gefiltert = [];
        for (var fi = 0; fi < quelle.length; fi++) if (art(quelle[fi]) === modus) gefiltert.push(quelle[fi]);
        quelle = gefiltert;
    }

    if (quelle.length === 0) {
        alert(modus === "F" ? "Keine passenden Flächen gefunden." :
              modus === "L" ? "Keine passenden Linien gefunden." :
                              "Keine passenden Linien oder Flächen gefunden.");
        return;
    }

    // ---------------------------------------------------------------- Vergleich
    var gesehen = {};
    var dubletten = [];
    for (var k = 0; k < quelle.length; k++) {
        var sig;
        try { sig = signature(quelle[k], art(quelle[k])); } catch (e) { continue; }
        if (gesehen[sig]) dubletten.push(quelle[k]);
        else gesehen[sig] = true;
    }

    var geprueft = quelle.length;
    var anzahlDub = dubletten.length;

    if (anzahlDub === 0) {
        alert("Geprüft: " + geprueft + " Objekt(e).\nKeine Duplikate gefunden.");
        return;
    }

    if (nurZaehlen) {
        // Duplikate nur markieren, nichts löschen.
        try {
            doc.selection = null;
            for (var s = 0; s < dubletten.length; s++) dubletten[s].selected = true;
        } catch (eSel) {}
        alert("Vorschau — es wurde nichts gelöscht.\n\n" +
              "Geprüft:   " + geprueft + " Objekt(e)\n" +
              "Duplikate: " + anzahlDub + " (jetzt ausgewählt)\n" +
              "Bliebe übrig: " + (geprueft - anzahlDub) + " Objekt(e)");
        return;
    }

    // ------------------------------------------------------------------ Löschen
    var geloescht = 0;
    for (var d = 0; d < dubletten.length; d++) {
        try { dubletten[d].remove(); geloescht++; } catch (eDel) {}
    }

    app.redraw();
    alert("Fertig.\n\n" +
          "Geprüft:  " + geprueft + " Objekt(e)\n" +
          "Gelöscht: " + geloescht + " Duplikat(e)\n" +
          "Übrig:    " + (geprueft - geloescht) + " Objekt(e)\n\n" +
          "Rückgängig mit Cmd+Z.");

})();
