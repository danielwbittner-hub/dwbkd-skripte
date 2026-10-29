// ============================================================================
// Anzeigename: Duplizieren und versetzt einfügen
// Duplizieren-Versetzt.jsx  —  Adobe Illustrator          ·          Version 1.1
// ----------------------------------------------------------------------------
// Bringt InDesigns „Bearbeiten > Duplizieren und versetzt einfügen“ (Step and
// Repeat) nach Illustrator: Das ausgewählte Objekt — oder mehrere zusammen —
// wird vervielfältigt und dabei um einen festen Betrag versetzt, wahlweise als
// Reihe oder als Raster.
//
// Dialog (Stand 2026-08-04, v1.0):
//   • Als Raster erstellen — Zeilen und Spalten statt einer einfachen Anzahl
//   • Anzahl / Zeilen / Spalten zählen wie in InDesign die WIEDERHOLUNGEN,
//     das Original ist immer zusätzlich dabei. Die Zeile „Ergebnis“ unter dem
//     Dialog zeigt jederzeit, wie viele Objekte am Ende herauskommen.
//   • Versatz vertikal und horizontal, Einheit frei wählbar (mm, cm, pt, px,
//     Zoll). Positive Werte versetzen nach rechts bzw. nach unten — genau wie
//     in InDesign. Voreingestellt ist die Maßeinheit des Dokuments.
//   • Vorschau live im Dokument (wie InDesign)
//
// Zusätzlich zu InDesign:
//   • „Versatz als Abstand zwischen den Objekten“ — der eingegebene Wert ist
//     dann der Zwischenraum, die Objektbreite bzw. -höhe wird automatisch
//     dazugerechnet (praktisch für Nutzen-Montage). Für eine reine Reihe:
//     Raster mit Zeilen = 0, für eine reine Spalte: Raster mit Spalten = 0.
//   • „Kopien mit Original gruppieren“
//   • Die letzten Einstellungen werden gemerkt (Datei im Benutzerordner).
//
// Verwendung:
//   1. Objekt(e) auswählen
//   2. Datei > Skripten > Andere Skripten … > diese Datei wählen
//   3. Werte eingeben, „OK“
//
// Hinweise:
//   • Die Kopien landen im selben Container wie das Original (gleiche Ebene
//     bzw. gleiche Gruppe) und sind danach ausgewählt — wie in InDesign.
//   • Rückgängig braucht ggf. mehrere Schritte (Cmd+Z mehrfach); die Vorschau
//     legt Objekte an und entfernt sie wieder.
//   • Bei sehr vielen Kopien schaltet sich die Vorschau selbst ab (> 400).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

#target illustrator

(function () {

    var TITLE       = "Duplizieren und versetzt einfügen  ·  v1.1";
    var PREVIEW_MAX = 400;    // ab so vielen Kopien keine Live-Vorschau mehr
    var WARN_MAX    = 2000;   // ab so vielen Objekten nachfragen

    var UNITS = [
        { name: "mm",   f: 2.834645669 },
        { name: "cm",   f: 28.34645669 },
        { name: "pt",   f: 1 },
        { name: "px",   f: 1 },
        { name: "Zoll", f: 72 }
    ];

    // ------------------------------------------------------------ Vorbedingungen
    if (app.documents.length === 0) {
        alert("Kein Dokument geöffnet.");
        return;
    }
    var doc = app.activeDocument;

    var sel = doc.selection;
    if (!sel || !(sel instanceof Array)) {
        alert("Bitte den Textmodus verlassen und das Objekt mit dem\n" +
              "Auswahlwerkzeug (V) auswählen.");
        return;
    }
    if (sel.length === 0) {
        alert("Bitte zuerst ein Objekt auswählen.");
        return;
    }

    // Auswahl festhalten — doc.selection ändert sich, sobald Kopien entstehen.
    var items = [];
    for (var s = 0; s < sel.length; s++) items.push(sel[s]);

    // ------------------------------------------------------------------ Helfer
    function num(txt, def) {
        var v = parseFloat(String(txt).replace(",", "."));
        return isNaN(v) ? def : v;
    }

    function intVal(txt, def) {
        var v = Math.round(num(txt, def));
        if (isNaN(v) || v < 0) v = 0;
        return v;
    }

    // Sichtbare Gesamtausdehnung der Auswahl (inkl. Konturen und Effekten) —
    // Grundlage für den Modus „Abstand zwischen den Objekten“.
    function selectionBounds(list) {
        var l = null, t = null, r = null, b = null, vb;
        for (var i = 0; i < list.length; i++) {
            try { vb = list[i].visibleBounds; } catch (e) { continue; }
            if (l === null || vb[0] < l) l = vb[0];
            if (t === null || vb[1] > t) t = vb[1];
            if (r === null || vb[2] > r) r = vb[2];
            if (b === null || vb[3] < b) b = vb[3];
        }
        if (l === null) return null;
        return { w: r - l, h: t - b };
    }
    var bnds = selectionBounds(items);

    function defaultUnitIndex() {
        try {
            switch (doc.rulerUnits) {
                case RulerUnits.Millimeters: return 0;
                case RulerUnits.Centimeters: return 1;
                case RulerUnits.Points:      return 2;
                case RulerUnits.Pixels:      return 3;
                case RulerUnits.Inches:      return 4;
            }
        } catch (e) {}
        return 0;
    }

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

    // ------------------------------------------------------------ Kopien bauen
    // stepX/stepY in pt, positives stepY bedeutet „nach unten“ (wie InDesign) —
    // Illustrators Y-Achse zeigt nach oben, deshalb unten das Minus.
    function buildCopies(o) {
        var made = [], pos = [], r, c, i, k;

        if (o.grid) {
            for (r = 0; r <= o.rows; r++)
                for (c = 0; c <= o.cols; c++) {
                    if (r === 0 && c === 0) continue;   // das Original
                    pos.push([c * o.stepX, -r * o.stepY]);
                }
        } else {
            for (i = 1; i <= o.count; i++)
                pos.push([i * o.stepX, -i * o.stepY]);
        }

        for (i = 0; i < pos.length; i++) {
            for (k = 0; k < items.length; k++) {
                var d = items[k].duplicate();
                // Muster/Verläufe mitverschieben, damit jede Kopie exakt
                // aussieht wie das Original.
                d.translate(pos[i][0], pos[i][1], true, true, true, true);
                made.push(d);
            }
        }
        return made;
    }

    // ------------------------------------------------------------------ Dialog
    var result = null;
    var previewItems = [];

    // Koordinatensystem festnageln, damit „unten“ verlässlich unten ist —
    // schon vor der Vorschau, damit Vorschau und Ergebnis identisch sind.
    var oldCS = null;
    try {
        if (typeof CoordinateSystem !== "undefined") {
            oldCS = app.coordinateSystem;
            app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        }
    } catch (eCS) { oldCS = null; }
    function restoreCS() {
        if (oldCS !== null) { try { app.coordinateSystem = oldCS; } catch (e) {} }
        oldCS = null;
    }

    var dlg = new Window("dialog", TITLE);
    dlg.orientation  = "column";
    dlg.alignChildren = "fill";
    dlg.margins = 16;
    dlg.spacing = 10;

    var prefs = dwbPrefs(dlg, "Duplizieren-Versetzt-Presets.txt");

    // ---- Wiederholen -------------------------------------------------------
    var pRep = dlg.add("panel", undefined, "Wiederholen");
    pRep.orientation  = "column";
    pRep.alignChildren = "left";
    pRep.margins = 15;
    pRep.spacing = 7;

    var cbGrid = pRep.add("checkbox", undefined, "Als Raster erstellen");
    cbGrid.value = false;

    var gCount = pRep.add("group");
    var lbCount = gCount.add("statictext", undefined, "Anzahl:");
    lbCount.preferredSize.width = 115;
    var etCount = gCount.add("edittext", undefined, "1");
    etCount.characters = 6;
    var sfCount = gCount.add("statictext", undefined, "Kopien");

    var gRows = pRep.add("group");
    var lbRows = gRows.add("statictext", undefined, "Zeilen:");
    lbRows.preferredSize.width = 115;
    var etRows = gRows.add("edittext", undefined, "1");
    etRows.characters = 6;
    var sfRows = gRows.add("statictext", undefined, "zusätzliche Reihen");

    var gCols = pRep.add("group");
    var lbCols = gCols.add("statictext", undefined, "Spalten:");
    lbCols.preferredSize.width = 115;
    var etCols = gCols.add("edittext", undefined, "1");
    etCols.characters = 6;
    var sfCols = gCols.add("statictext", undefined, "zusätzliche Spalten");

    // ---- Versatz -----------------------------------------------------------
    var pOff = dlg.add("panel", undefined, "Versatz");
    pOff.orientation  = "column";
    pOff.alignChildren = "left";
    pOff.margins = 15;
    pOff.spacing = 7;

    var gV = pOff.add("group");
    var lbV = gV.add("statictext", undefined, "Vertikal:");
    lbV.preferredSize.width = 140;
    var etOY = gV.add("edittext", undefined, "0");
    etOY.characters = 8;
    var ddUnit = gV.add("dropdownlist", undefined, undefined);
    for (var u = 0; u < UNITS.length; u++) ddUnit.add("item", UNITS[u].name);
    ddUnit.selection = defaultUnitIndex();

    var gH = pOff.add("group");
    var lbH = gH.add("statictext", undefined, "Horizontal:");
    lbH.preferredSize.width = 140;
    var etOX = gH.add("edittext", undefined, "0");
    etOX.characters = 8;

    var hint = pOff.add("statictext", undefined,
        "Positive Werte versetzen nach rechts bzw. nach unten.");
    hint.preferredSize.width = 340;
    hint.enabled = false;

    var cbGap = pOff.add("checkbox", undefined,
        "Versatz als Abstand zwischen den Objekten");
    cbGap.value = false;

    // ---- Optionen ----------------------------------------------------------
    var gOpt = dlg.add("group");
    gOpt.alignChildren = "left";
    var cbGroup = gOpt.add("checkbox", undefined, "Kopien mit Original gruppieren");
    cbGroup.value = false;

    var gPrev = dlg.add("group");
    var cbPreview = gPrev.add("checkbox", undefined, "Vorschau");
    cbPreview.value = true;

    var lbTotal = dlg.add("statictext", undefined, "");
    lbTotal.preferredSize.width = 330;

    var gBtn = dlg.add("group");
    gBtn.alignment = "right";
    gBtn.add("button", undefined, "Abbrechen", { name: "cancel" });
    var btnOK = gBtn.add("button", undefined, "OK", { name: "ok" });

    // ------------------------------------------------------------ Dialoglogik
    function collect() {
        var uf    = UNITS[ddUnit.selection.index].f;
        var grid  = cbGrid.value;
        var count = intVal(etCount.text, 1);
        var rows  = intVal(etRows.text, 1);
        var cols  = intVal(etCols.text, 1);
        var ox    = num(etOX.text, 0) * uf;
        var oy    = num(etOY.text, 0) * uf;

        var stepX = ox, stepY = oy;
        if (cbGap.value && bnds) {
            stepX = bnds.w + ox;
            stepY = bnds.h + oy;
        }
        var copies = grid ? ((rows + 1) * (cols + 1) - 1) : count;
        return {
            grid: grid, count: count, rows: rows, cols: cols,
            stepX: stepX, stepY: stepY,
            copies: copies,
            newItems: copies * items.length,
            total: (copies + 1) * items.length
        };
    }

    function syncEnable() {
        var g = cbGrid.value;
        lbCount.enabled = etCount.enabled = sfCount.enabled = !g;
        lbRows.enabled  = etRows.enabled  = sfRows.enabled  = g;
        lbCols.enabled  = etCols.enabled  = sfCols.enabled  = g;
        lbV.text = cbGap.value ? "Abstand vertikal:"   : "Vertikal:";
        lbH.text = cbGap.value ? "Abstand horizontal:" : "Horizontal:";
        hint.text = cbGap.value
            ? "Objektgröße wird dazugerechnet · reine Reihe: Raster, Zeilen = 0"
            : "Positive Werte versetzen nach rechts bzw. nach unten.";
    }

    function updateLabel() {
        var o = collect();
        if (o.copies <= 0) {
            lbTotal.text = "Ergebnis: keine Kopien";
            return o;
        }
        lbTotal.text = "Ergebnis: " + o.total + " Objekte insgesamt (" +
                       o.newItems + " neue Kopien)" +
                       (o.newItems > PREVIEW_MAX ? " · Vorschau aus" : "");
        return o;
    }

    function clearPreview() {
        for (var i = previewItems.length - 1; i >= 0; i--) {
            try { previewItems[i].remove(); } catch (e) {}
        }
        previewItems = [];
    }

    function updatePreview() {
        clearPreview();
        var o = collect();
        if (cbPreview.value && o.copies > 0 && o.newItems <= PREVIEW_MAX) {
            try { previewItems = buildCopies(o); } catch (e) { previewItems = []; }
        }
        app.redraw();
    }

    function update() {
        updateLabel();
        updatePreview();
    }

    var fields = [etCount, etRows, etCols, etOX, etOY];
    for (var fi = 0; fi < fields.length; fi++) {
        fields[fi].onChanging = updateLabel;   // beim Tippen nur die Zeile
        fields[fi].onChange   = update;        // beim Verlassen auch die Vorschau
    }
    cbGrid.onClick  = function () { syncEnable(); update(); };
    cbGap.onClick   = function () { syncEnable(); update(); };
    ddUnit.onChange = update;
    cbPreview.onClick = update;

    btnOK.onClick = function () {
        var o = collect();
        if (o.copies <= 0) {
            alert("Mit diesen Werten entstehen keine Kopien.");
            return;
        }
        if (o.total > WARN_MAX &&
            !confirm("Es entstehen " + o.newItems + " neue Objekte.\nFortfahren?")) {
            return;
        }
        result = o;
        dlg.close(1);
    };

    // Zustand <-> Bedienelemente (für Voreinstellungen & zuletzt verwendet)
    function getState() {
        return {
            grid:    cbGrid.value ? "1" : "0",
            count:   etCount.text,
            rows:    etRows.text,
            cols:    etCols.text,
            ox:      etOX.text,
            oy:      etOY.text,
            unit:    "" + ddUnit.selection.index,
            gap:     cbGap.value ? "1" : "0",
            group:   cbGroup.value ? "1" : "0",
            preview: cbPreview.value ? "1" : "0"
        };
    }
    function setState(v) {
        if (v.grid    !== undefined) cbGrid.value    = (v.grid === "1");
        if (v.count   !== undefined) etCount.text    = v.count;
        if (v.rows    !== undefined) etRows.text     = v.rows;
        if (v.cols    !== undefined) etCols.text     = v.cols;
        if (v.ox      !== undefined) etOX.text       = v.ox;
        if (v.oy      !== undefined) etOY.text       = v.oy;
        if (v.unit    !== undefined) { var uu = parseInt(v.unit, 10); if (!isNaN(uu) && uu >= 0 && uu < UNITS.length) ddUnit.selection = uu; }
        if (v.gap     !== undefined) cbGap.value     = (v.gap === "1");
        if (v.group   !== undefined) cbGroup.value   = (v.group === "1");
        if (v.preview !== undefined) cbPreview.value = (v.preview === "1");
        syncEnable();
        update();
    }
    prefs.activate(getState, setState);

    syncEnable();
    update();

    var answer = dlg.show();
    clearPreview();

    if (answer !== 1 || !result) {
        app.redraw();
        restoreCS();
        return;
    }

    // ------------------------------------------------------------------ Ablauf
    try {
        var made = buildCopies(result);

        doc.selection = null;
        var i;
        for (i = 0; i < made.length; i++) {
            try { made[i].selected = true; } catch (e1) {}
        }

        if (cbGroup.value) {
            for (i = 0; i < items.length; i++) {
                try { items[i].selected = true; } catch (e2) {}
            }
            app.executeMenuCommand("group");
        }

        app.redraw();

    } catch (err) {
        alert("Fehler: " + err.message + (err.line ? "  (Zeile " + err.line + ")" : ""));
    } finally {
        restoreCS();
    }

    prefs.saveLast();

})();
