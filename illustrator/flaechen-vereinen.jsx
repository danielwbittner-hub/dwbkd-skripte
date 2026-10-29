// ============================================================================
// Anzeigename: Flächen vereinen
// Flaechen-Vereinen.jsx  —  Adobe Illustrator          ·          Version 1.1
// ----------------------------------------------------------------------------
// Vereint nebeneinanderliegende oder überlappende Flächen (Pathfinder
// „Vereinen") zu möglichst wenigen Objekten — z. B. QR-Codes, Pixel-Grafiken
// oder gerasterte Motive, damit beim Plotten/Cutten/Lasern nicht hunderte
// Einzelquadrate geschnitten werden, sondern eine zusammenhängende Fläche.
//
// Funktionen (Stand 2026-08-04, v1.0):
//   • Bereich: nur Auswahl oder gesamtes Dokument (sichtbar & entsperrt)
//   • Getrennt nach Farbe vereinen: gleiche Füllfarbe = eine Gruppe, damit
//     mehrfarbige Motive (z. B. Logo + QR) ihre Farben behalten
//   • Haarlinien-Lücken schließen: jede Fläche wird vor dem Vereinen minimal
//     vergrößert (Standard 0,02 mm je Seite). QR-Codes aus SVG-Generatoren
//     haben durch Rundungsfehler oft winzige Spalte zwischen den Modulen —
//     ohne diesen Schritt bleiben sie als doppelte Schnittlinien stehen.
//   • Originale behalten: vereint wahlweise eine Kopie auf einer neuen
//     Ebene „Vereint", das Original bleibt unangetastet
//   • Leere Restgruppen werden nach dem Vereinen aufgeräumt
//
// Verwendung:
//   1. Objekte auswählen (oder nichts auswählen = ganzes Dokument)
//   2. Datei > Skripten > Andere Skripten … > diese Datei wählen
//   3. Optionen einstellen, „Vereinen"
//
// Hinweise:
//   • Text vorher in Pfade umwandeln (Schrift > In Pfade umwandeln),
//     Textrahmen werden übersprungen und im Ergebnis gemeldet.
//   • Konturen bleiben Konturen — sollen Konturstärken mitgeschnitten
//     werden, vorher Objekt > Pfad > Konturlinie anwenden.
//   • Rückgängig braucht ggf. mehrere Schritte (Cmd+Z mehrfach), da das
//     Script mehrere Menübefehle ausführt.
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

#target illustrator

(function () {

    var MM = 2.834645669;                     // mm -> pt

    if (app.documents.length === 0) {
        alert("Kein Dokument geöffnet.");
        return;
    }
    var doc = app.activeDocument;

    // ===== Voreinstellungen + „zuletzt verwendet" (dwbkd, gemeinsam) ============
    // Fügt oben ein Panel mit Dropdown + Speichern/Löschen ein. Nach dem Aufbau
    // der Bedienelemente activate(getState, setState) aufrufen (lädt die zuletzt
    // verwendeten Werte); saveLast() nach OK aufrufen. Datei je Skript unter
    // <Benutzerdaten>/<fileName>, Format: [Name] + schlüssel=wert, [__last__].
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

    // ------------------------------------------------------------------ Farben
    // Lesbarer Schlüssel je Farbe — dient gleichzeitig als Gruppenname.
    function colorKey(c) {
        if (!c) return "keine";
        switch (c.typename) {
            case "RGBColor":
                return "RGB " + Math.round(c.red) + "/" + Math.round(c.green) + "/" + Math.round(c.blue);
            case "CMYKColor":
                return "CMYK " + Math.round(c.cyan) + "/" + Math.round(c.magenta) + "/" +
                       Math.round(c.yellow) + "/" + Math.round(c.black);
            case "GrayColor":
                return "Grau " + Math.round(c.gray) + "%";
            case "SpotColor":
                return "Vollton " + c.spot.name + " " + Math.round(c.tint) + "%";
            case "GradientColor":
                return "Verlauf " + c.gradient.name;
            case "PatternColor":
                return "Muster " + c.pattern.name;
            case "NoColor":
                return "keine";
            default:
                return c.typename;
        }
    }

    // Gruppenschlüssel eines Objekts: Füllung vor Kontur, sonst „unbemalt".
    function paintKey(it) {
        var p = it;
        if (it.typename === "CompoundPathItem") {
            if (it.pathItems.length === 0) return "leer";
            p = it.pathItems[0];
        }
        if (p.filled)  return "Fläche " + colorKey(p.fillColor);
        if (p.stroked) return "Kontur " + colorKey(p.strokeColor);
        return "unbemalt";
    }

    // ------------------------------------------------------------------ Sammeln
    // Rekursiv alle geeigneten Pfade/zusammengesetzten Pfade einsammeln.
    // Übersprungen: gesperrt, ausgeblendet, Schnittmasken, Hilfslinien,
    // Textrahmen (gemeldet) und Sonstiges (Bilder, Diagramme …).
    function collectFromContainer(cont, out, skipped) {
        for (var i = 0; i < cont.pageItems.length; i++) {
            var it = cont.pageItems[i];
            if (it.locked || it.hidden) continue;
            switch (it.typename) {
                case "GroupItem":
                    collectFromContainer(it, out, skipped);
                    break;
                case "PathItem":
                    if (!it.clipping && !it.guides) out.push(it);
                    break;
                case "CompoundPathItem":
                    out.push(it);
                    break;
                case "TextFrame":
                    skipped.text++;
                    break;
                default:
                    skipped.other++;
            }
        }
    }

    function collectFromLayer(layer, out, skipped) {
        if (layer.locked || !layer.visible) return;
        collectFromContainer(layer, out, skipped);
        for (var i = 0; i < layer.layers.length; i++)
            collectFromLayer(layer.layers[i], out, skipped);
    }

    function collectFromSelection(sel, out, skipped) {
        for (var i = 0; i < sel.length; i++) {
            var it = sel[i];
            if (it.locked || it.hidden) continue;
            switch (it.typename) {
                case "GroupItem":
                    collectFromContainer(it, out, skipped);
                    break;
                case "PathItem":
                    if (!it.clipping && !it.guides) out.push(it);
                    break;
                case "CompoundPathItem":
                    out.push(it);
                    break;
                case "TextFrame":
                    skipped.text++;
                    break;
                default:
                    skipped.other++;
            }
        }
    }

    // ------------------------------------------------------------------ Helfer
    // Fläche um delta (pt) je Seite vergrößern — schließt Haarlinien-Lücken.
    // Skaliert um den Mittelpunkt; bei Rechtecken (QR-Module) exakt, bei
    // freien Formen eine sehr gute Näherung für so kleine Beträge.
    function addOverlap(it, delta) {
        var b;
        try { b = it.geometricBounds; } catch (e) { return; }
        var w = b[2] - b[0], h = b[1] - b[3];
        if (w < 0.001 || h < 0.001) return;   // Linien ohne Fläche auslassen
        it.resize((w + 2 * delta) / w * 100, (h + 2 * delta) / h * 100,
                  true, true, true, false, 100, Transformation.CENTER);
    }

    // Pathfinder „Vereinen" auf eine Objektliste anwenden.
    // Weg: gruppieren -> Live-Pathfinder „Hinzufügen" -> Aussehen umwandeln.
    // Ergebnis ist ein Pfad bzw. ein zusammengesetzter Pfad.
    function unite(items) {
        doc.selection = null;
        for (var i = 0; i < items.length; i++) items[i].selected = true;
        app.executeMenuCommand("group");
        app.executeMenuCommand("Live Pathfinder Add");
        app.executeMenuCommand("expandStyle");
        // Hüllgruppe(n) entfernen, bis nur noch Pfade übrig sind
        for (var pass = 0; pass < 3; pass++) {
            var sel = doc.selection, hasGroup = false;
            for (var j = 0; j < sel.length; j++)
                if (sel[j].typename === "GroupItem") { hasGroup = true; break; }
            if (!hasGroup) break;
            app.executeMenuCommand("ungroup");
        }
        var res = [], out = doc.selection;
        for (var k = 0; k < out.length; k++) res.push(out[k]);
        return res;
    }

    function uniqueLayerName(base) {
        var names = {}, i;
        for (i = 0; i < doc.layers.length; i++) names[doc.layers[i].name] = true;
        if (!names[base]) return base;
        for (i = 2; i < 100; i++)
            if (!names[base + " " + i]) return base + " " + i;
        return base + " " + (new Date().getTime() % 1000);
    }

    // ------------------------------------------------------------------ Dialog
    function showDialog(selCount) {
        var dlg = new Window("dialog", "Flächen vereinen  ·  v1.1");
        dlg.orientation = "column";
        dlg.alignChildren = "fill";

        var prefs = dwbPrefs(dlg, "Flaechen-Vereinen-Presets.txt");

        var pScope = dlg.add("panel", undefined, "Bereich");
        pScope.orientation = "column";
        pScope.alignChildren = "left";
        pScope.margins = 15;
        var rbSel = pScope.add("radiobutton", undefined,
            "Nur Auswahl (" + selCount + " Objekt" + (selCount === 1 ? "" : "e") + ")");
        var rbAll = pScope.add("radiobutton", undefined,
            "Gesamtes Dokument (sichtbar und entsperrt)");
        if (selCount > 0) rbSel.value = true;
        else { rbAll.value = true; rbSel.enabled = false; }

        var pOpt = dlg.add("panel", undefined, "Optionen");
        pOpt.orientation = "column";
        pOpt.alignChildren = "left";
        pOpt.margins = 15;

        var cbColor = pOpt.add("checkbox", undefined,
            "Getrennt nach Farbe vereinen (gleiche Füllung = eine Fläche)");
        cbColor.value = true;

        var gGap = pOpt.add("group");
        var cbGap = gGap.add("checkbox", undefined, "Haarlinien-Lücken schließen:");
        cbGap.value = true;
        var etGap = gGap.add("edittext", undefined, "0,02");
        etGap.characters = 5;
        gGap.add("statictext", undefined, "mm je Seite");
        cbGap.onClick = function () { etGap.enabled = cbGap.value; };

        var cbKeep = pOpt.add("checkbox", undefined,
            "Originale behalten (vereinte Kopie auf neuer Ebene „Vereint“)");
        cbKeep.value = false;

        var note = dlg.add("statictext", undefined,
            "Hinweis: Text vorher in Pfade umwandeln (Schrift > In Pfade umwandeln).");
        note.enabled = false;   // dezent grau

        // Zustand <-> Bedienelemente (für Voreinstellungen & zuletzt verwendet)
        function getState() {
            return {
                scope: rbSel.value ? "sel" : "doc",
                color: cbColor.value ? "1" : "0",
                gapOn: cbGap.value ? "1" : "0",
                gap:   etGap.text,
                keep:  cbKeep.value ? "1" : "0"
            };
        }
        function setState(v) {
            if (v.scope === "sel" && rbSel.enabled) rbSel.value = true;
            else if (v.scope === "doc") rbAll.value = true;
            if (v.color !== undefined) cbColor.value = (v.color === "1");
            if (v.gapOn !== undefined) cbGap.value = (v.gapOn === "1");
            if (v.gap !== undefined) etGap.text = v.gap;
            if (v.keep !== undefined) cbKeep.value = (v.keep === "1");
            etGap.enabled = cbGap.value;      // Abhängigkeit nachziehen
        }
        prefs.activate(getState, setState);

        var gBtn = dlg.add("group");
        gBtn.alignment = "right";
        gBtn.add("button", undefined, "Abbrechen", { name: "cancel" });
        gBtn.add("button", undefined, "Vereinen", { name: "ok" });

        if (dlg.show() !== 1) return null;
        prefs.saveLast();

        var gap = 0;
        if (cbGap.value) {
            gap = parseFloat(etGap.text.replace(",", "."));
            if (isNaN(gap) || gap < 0) gap = 0;
        }
        return {
            scope:   rbSel.value ? "selection" : "document",
            byColor: cbColor.value,
            overlap: gap * MM,               // in pt
            keep:    cbKeep.value
        };
    }

    // ------------------------------------------------------------------ Ablauf
    var selCount = doc.selection ? doc.selection.length : 0;
    var opts = showDialog(selCount);
    if (!opts) return;

    var items = [], skipped = { text: 0, other: 0 };
    if (opts.scope === "selection") {
        collectFromSelection(doc.selection, items, skipped);
    } else {
        for (var L = 0; L < doc.layers.length; L++)
            collectFromLayer(doc.layers[L], items, skipped);
    }

    if (items.length < 2) {
        alert("Zu wenige geeignete Flächen gefunden (" + items.length + ").\n" +
              (skipped.text ? "Übersprungene Textrahmen: " + skipped.text +
               " — bitte vorher in Pfade umwandeln." : ""));
        return;
    }

    try {
        // Bei „Originale behalten": alles auf eine neue Ebene duplizieren
        // und nur die Kopien vereinen.
        if (opts.keep) {
            var lay = doc.layers.add();
            lay.name = uniqueLayerName("Vereint");
            var dups = [];
            for (var d = 0; d < items.length; d++)
                dups.push(items[d].duplicate(lay, ElementPlacement.PLACEATBEGINNING));
            items = dups;
        }

        // Nach Farbe (oder alles in eine) gruppieren
        var groups = [], map = {}, i;
        for (i = 0; i < items.length; i++) {
            var key = opts.byColor ? paintKey(items[i]) : "alle Flächen";
            var mk = "k_" + key;              // sichere Map-Schlüssel
            if (!map[mk]) { map[mk] = { key: key, items: [] }; groups.push(map[mk]); }
            map[mk].items.push(items[i]);
        }

        // Eltern-Gruppen merken, um leere Reste später zu entfernen
        // (nur nötig, wenn direkt am Original gearbeitet wird)
        var parents = [];
        function rememberParent(p) {
            if (!p || p.typename !== "GroupItem") return;
            for (var x = 0; x < parents.length; x++) if (parents[x] === p) return;
            parents.push(p);
        }

        var results = [], unitedGroups = 0, singles = 0;
        for (var g = 0; g < groups.length; g++) {
            var gi = groups[g].items;
            if (gi.length < 2) {              // nichts zu vereinen
                singles++;
                results.push(gi[0]);
                continue;
            }
            if (!opts.keep)
                for (i = 0; i < gi.length; i++) rememberParent(gi[i].parent);
            if (opts.overlap > 0)
                for (i = 0; i < gi.length; i++) addOverlap(gi[i], opts.overlap);
            var res = unite(gi);
            for (i = 0; i < res.length; i++) results.push(res[i]);
            unitedGroups++;
        }

        // Leergewordene Gruppen aufräumen (nach oben durchreichen)
        for (var p = 0; p < parents.length; p++) {
            try {
                var grp = parents[p];
                while (grp && grp.typename === "GroupItem" && grp.pageItems.length === 0) {
                    var up = grp.parent;
                    grp.remove();
                    grp = (up && up.typename === "GroupItem") ? up : null;
                }
            } catch (e) { /* Referenz bereits ungültig — ignorieren */ }
        }

        // Ergebnis auswählen und melden
        doc.selection = null;
        for (i = 0; i < results.length; i++) {
            try { results[i].selected = true; } catch (e2) {}
        }
        app.redraw();

        var msg = "Fertig.\n\n" +
                  "Vorher:   " + items.length + " Flächen\n" +
                  "Nachher: " + results.length + " Objekt" + (results.length === 1 ? "" : "e");
        if (opts.byColor && unitedGroups > 1)
            msg += "  (" + unitedGroups + " Farbgruppen)";
        if (singles > 0)
            msg += "\nUnverändert (einzeln in ihrer Gruppe): " + singles;
        if (skipped.text > 0)
            msg += "\n\nÜbersprungene Textrahmen: " + skipped.text +
                   "\n(Schrift > In Pfade umwandeln, dann erneut ausführen)";
        if (opts.keep)
            msg += "\n\nDas Ergebnis liegt auf der neuen Ebene „Vereint“.";
        alert(msg);

    } catch (err) {
        alert("Fehler: " + err.message +
              (err.line ? "  (Zeile " + err.line + ")" : ""));
    }

})();
