// ============================================================================
// Anzeigename: Siebdruckraster
// Siebdruckraster.jsx  —  Adobe Illustrator          ·          Version 2.2
// ----------------------------------------------------------------------------
// Erzeugt aus dem ausgewählten Objekt (platziertes Bild, eingebettetes Bild
// oder Vektorgrafik) ein grobes Halbtonraster wie beim Siebdruck:
// dunkle Töne = große Punkte, helle Töne = kleine Punkte.
//
// Funktionen (Stand 2026-07-23, v2.0):
//   • Punktformen: Ellipse/Kreis, Quadrat, Raute, Linie (flächengleich,
//     damit alle Formen denselben Tonwert wiedergeben)
//   • Farbmodus "Einfarbig": Schwarz, Weiß oder eigene CMYK-Farbe
//   • Farbmodus "CMYK-Separation": 4 Auszüge mit eigenen Rasterwinkeln
//     (klassisch 15/75/0/45) auf getrennten Ebenen, multiplizierend
//   • Tonwert-Gamma zur Mitteltonkorrektur (>1 = heller, <1 = dunkler)
//   • Punkte optional zu Flächen verschmelzen (Pathfinder "Vereinen")
//   • Presets: Einstellungen speichern/laden/löschen
//     (Datei: <Benutzerdaten>/Siebdruckraster-Presets.txt)
//   • Zufalls-Einflüsse (Seed-basiert, reproduzierbar): Positions-Streuung,
//     Größen-Streuung, Drehungs-Streuung sowie zufälliges Auslassen von
//     Punkten für einen handgemachten Look.
//   • NEU in 2.1 – Live-Vorschau direkt im Dialog: zeigt die Rasterwirkung
//     auf das gewählte Objekt und aktualisiert sich bei jeder Änderung
//     (Verschmelzen/Schnittmaske werden in der Vorschau nicht dargestellt).
//
// Verwendung:
//   1. Genau EIN Objekt auswählen (mehrere Objekte vorher gruppieren, Cmd+G)
//   2. Datei > Skripten > Andere Skripten … > diese Datei wählen
//   3. Parameter einstellen, OK
//
// Das Original bleibt erhalten, das Raster liegt auf neuen Ebenen.
//
// Funktionsweise: Die Auswahl wird in ein temporäres Dokument dupliziert und
// als unkomprimiertes TIFF exportiert (Graustufen, bei Separation RGB);
// dessen Pixel werden direkt aus der Datei gelesen (Illustrator selbst
// bietet keinen Pixelzugriff). Danach wird je Kanal ein um den Rasterwinkel
// gedrehtes Punktgitter über das Motiv gelegt; pro Zelle bestimmt der
// gemittelte Tonwert die Punktgröße. Die CMYK-Werte der Separation entstehen
// per Standardformel aus RGB (K = min(C', M', Y'), volle Schwarzerzeugung).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

#target illustrator

(function () {

    var MM = 2.834645669;                     // mm -> pt

    // Seed-basierter Zufallsgenerator (LCG) — reproduzierbar, da ExtendScript
    // kein seedbares Math.random kennt. Liefert Werte in [0, 1).
    function makeRng(seed) {
        var s = Math.floor(seed) % 4294967296;
        if (s < 0) s += 4294967296;
        return function () {
            s = (1664525 * s + 1013904223) % 4294967296;
            return s / 4294967296;
        };
    }

    // ------------------------------------------------------------------ Presets
    function presetFile() {
        return new File(Folder.userData + "/Siebdruckraster-Presets.txt");
    }

    // Format der Preset-Datei:  [Name]  gefolgt von  schlüssel=wert  Zeilen
    function loadPresetList() {
        var f = presetFile(), list = [], cur = null;
        if (!f.exists) return list;
        f.encoding = "UTF-8";
        if (!f.open("r")) return list;
        while (!f.eof) {
            var line = f.readln();
            if (line.length && line.charAt(line.length - 1) === "\r")
                line = line.substr(0, line.length - 1);
            if (!line.length) continue;
            if (line.charAt(0) === "[") {
                cur = { name: line.substring(1, line.length - 1), vals: {} };
                list.push(cur);
            } else if (cur) {
                var i = line.indexOf("=");
                if (i > 0) cur.vals[line.substring(0, i)] = line.substring(i + 1);
            }
        }
        f.close();
        return list;
    }

    function savePresetList(list) {
        var f = presetFile();
        f.encoding = "UTF-8";
        if (!f.open("w")) {
            alert("Preset-Datei konnte nicht geschrieben werden:\n" + f.fsName);
            return false;
        }
        for (var i = 0; i < list.length; i++) {
            f.writeln("[" + list[i].name + "]");
            for (var k in list[i].vals) f.writeln(k + "=" + list[i].vals[k]);
            f.writeln("");
        }
        f.close();
        return true;
    }

    // ----------------------------------------------------- Zuletzt verwendet
    // Eigene Datei im gleichen schlüssel=wert-Format wie ein Preset-Block.
    function lastFile() { return new File(Folder.userData + "/Siebdruckraster-Last.txt"); }
    function loadLast() {
        var f = lastFile();
        if (!f.exists) return null;
        f.encoding = "UTF-8";
        if (!f.open("r")) return null;
        var vals = {};
        while (!f.eof) {
            var line = f.readln();
            if (line.length && line.charAt(line.length - 1) === "\r")
                line = line.substr(0, line.length - 1);
            if (!line.length) continue;
            var i = line.indexOf("=");
            if (i > 0) vals[line.substring(0, i)] = line.substring(i + 1);
        }
        f.close();
        return vals;
    }
    function saveLast(vals) {
        var f = lastFile();
        f.encoding = "UTF-8";
        if (!f.open("w")) return;
        for (var k in vals) f.writeln(k + "=" + vals[k]);
        f.close();
    }

    // ------------------------------------------------------------------ Dialog
    function showDialog(doc, item) {
        var presets = loadPresetList();

        // --- Vorschau-Thumbnail des gewählten Objekts (einmalig beim Öffnen) ---
        // Kleines RGB-TIFF als Tonwertquelle für die Live-Vorschau.
        // WICHTIG: Illustrators TIFF-Export akzeptiert KEINE Auflösung unter
        // 72 dpi ("Specified value less than minimum allowed value"). Darum
        // exportieren wir fest bei 72 dpi und verkleinern die Kopie vorher auf
        // ~200 pt lange Kante → Thumbnail bleibt klein und schnell zu parsen.
        var vbp = item.visibleBounds;                 // [links, oben, rechts, unten]
        var pW = vbp[2] - vbp[0], pH = vbp[1] - vbp[3];
        var thumb = null, thumbErr = "";
        try {
            thumb = exportTiffImg(item, pW, pH, 72, true, 200);
        } catch (e1) {
            thumbErr = "RGB: " + e1.message + (e1.line ? " (Z" + e1.line + ")" : "");
            try {
                thumb = exportTiffImg(item, pW, pH, 72, false, 200);
                thumbErr += "  → Graustufen-Fallback aktiv";
            } catch (e2) {
                thumb = null;
                thumbErr += "  |  Gray: " + e2.message + (e2.line ? " (Z" + e2.line + ")" : "");
            }
        }
        try { app.activeDocument = doc; } catch (eAD) {}

        var dlg = new Window("dialog", "Siebdruck-Raster  ·  v2.2");
        dlg.orientation = "column";
        dlg.alignChildren = "fill";

        // Robuste Zahlenauswertung (Komma oder Punkt), wird von der Vorschau
        // UND bei OK verwendet.
        function num(et, def) {
            var v = parseFloat(("" + et.text).replace(",", "."));
            return isNaN(v) ? def : v;
        }
        function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

        function rowLabel(parent, label) {
            var g = parent.add("group");
            var st = g.add("statictext", undefined, label);
            st.preferredSize.width = 165;
            return g;
        }
        function numField(parent, label, def, unit) {
            var g = rowLabel(parent, label);
            var et = g.add("edittext", undefined, def);
            et.characters = 6;
            if (unit) g.add("statictext", undefined, unit);
            return et;
        }

        // --- Presets --------------------------------------------------------
        var pPre = dlg.add("panel", undefined, "Presets");
        pPre.orientation = "row";
        pPre.alignChildren = "center";
        var ddPre  = pPre.add("dropdownlist", undefined, []);
        ddPre.preferredSize.width = 220;
        var btSave = pPre.add("button", undefined, "Speichern …");
        var btDel  = pPre.add("button", undefined, "Löschen");

        // --- zwei Spalten ---------------------------------------------------
        var cols = dlg.add("group");
        cols.orientation = "row";
        cols.alignChildren = "top";
        var colL = cols.add("group");
        colL.orientation = "column";
        colL.alignChildren = "fill";
        var colR = cols.add("group");
        colR.orientation = "column";
        colR.alignChildren = "fill";

        // --- Raster (links) -------------------------------------------------
        var p1 = colL.add("panel", undefined, "Raster");
        p1.alignChildren = "left";
        var fCell  = numField(p1, "Rasterweite (Punktabstand)", "3",  "mm");
        var fAngle = numField(p1, "Rasterwinkel",               "45", "°");
        var gShape = rowLabel(p1, "Punktform");
        var ddShape = gShape.add("dropdownlist", undefined,
            ["Ellipse / Kreis", "Quadrat", "Raute", "Linie"]);
        ddShape.selection = 0;
        var fRatio = numField(p1, "Punktform: Höhe zu Breite", "65",  "% (100 = Kreis)");
        var fGain  = numField(p1, "Maximale Punktgröße",       "115", "% der Rasterweite");
        var fCut   = numField(p1, "Lichter auslassen unter",   "4",   "% Deckung");
        var fGamma = numField(p1, "Tonwert-Gamma",             "1,0", "(>1 = heller)");

        // --- Optionen (links) -----------------------------------------------
        var p2 = colL.add("panel", undefined, "Optionen");
        p2.alignChildren = "left";
        var cbStag  = p2.add("checkbox", undefined, "Reihen versetzt (Diamant-Anordnung)");
        var cbInv   = p2.add("checkbox", undefined, "Invertieren (helle Flächen = große Punkte)");
        var cbMerge = p2.add("checkbox", undefined, "Punkte zu Flächen verschmelzen (Pathfinder)");
        var cbMask  = p2.add("checkbox", undefined, "Auf Objektgrenzen zuschneiden (Schnittmaske)");
        cbMask.value = true;
        var cbHide  = p2.add("checkbox", undefined, "Original ausblenden");

        // --- Farbe (rechts) -------------------------------------------------
        var p3 = colR.add("panel", undefined, "Farbe");
        p3.alignChildren = "left";
        var gMode = rowLabel(p3, "Modus");
        var ddMode = gMode.add("dropdownlist", undefined,
            ["Einfarbig", "CMYK-Separation"]);
        ddMode.selection = 0;
        var gCol = rowLabel(p3, "Punktfarbe");
        var ddCol = gCol.add("dropdownlist", undefined,
            ["Schwarz", "Weiß", "Eigene Farbe (CMYK)"]);
        ddCol.selection = 0;

        var gCust = rowLabel(p3, "Eigene Farbe C / M / Y / K");
        var fC = gCust.add("edittext", undefined, "0");   fC.characters = 4;
        var fM = gCust.add("edittext", undefined, "100"); fM.characters = 4;
        var fY = gCust.add("edittext", undefined, "0");   fY.characters = 4;
        var fK = gCust.add("edittext", undefined, "0");   fK.characters = 4;
        gCust.add("statictext", undefined, "%");

        var gSep = rowLabel(p3, "Winkel C / M / Y / K");
        var fAC = gSep.add("edittext", undefined, "15"); fAC.characters = 4;
        var fAM = gSep.add("edittext", undefined, "75"); fAM.characters = 4;
        var fAY = gSep.add("edittext", undefined, "0");  fAY.characters = 4;
        var fAK = gSep.add("edittext", undefined, "45"); fAK.characters = 4;
        gSep.add("statictext", undefined, "°");

        p3.add("statictext", undefined, "Separation: 4 Ebenen (C/M/Y/K), multiplizierend.");

        // --- Zufall (rechts, NEU in v2.0) -----------------------------------
        var p4 = colR.add("panel", undefined, "Zufall (v2.0)");
        p4.alignChildren = "left";
        var cbRnd = p4.add("checkbox", undefined, "Zufalls-Einflüsse aktivieren");
        var fJit  = numField(p4, "Position streuen", "20", "% der Rasterweite");
        var fSize = numField(p4, "Größe streuen",     "15", "± %");
        var fAng  = numField(p4, "Drehung streuen",   "0",  "± °");
        var fDrop = numField(p4, "Punkte auslassen",  "0",  "% zufällig");
        var fSeed = numField(p4, "Startwert (Seed)",  "0",  "(0 = jedes Mal neu)");

        // --- Vorschau (dritte Spalte, NEU in v2.1) --------------------------
        var colP = cols.add("group");
        colP.orientation = "column";
        colP.alignChildren = "fill";
        var pPrev = colP.add("panel", undefined, "Vorschau (Live)");
        pPrev.alignChildren = "fill";

        var pvW = 300;
        var pvH = Math.round(pvW * pH / pW);
        if (isNaN(pvH) || pvH < 150) pvH = 150;
        if (pvH > 360) pvH = 360;

        var preview = pPrev.add("panel");                 // Zeichenfläche
        preview.preferredSize = [pvW, pvH];
        preview.onDraw = function () {
            drawPreview(this.graphics, this.size[0], this.size[1]);
        };

        var pInfo = pPrev.add("statictext", undefined,
            "Verschmelzen/Maske werden hier nicht dargestellt.",
            { multiline: true });
        pInfo.preferredSize = [pvW, 52];

        var gpv = pPrev.add("group");
        var btPrev = gpv.add("button", undefined, "Aktualisieren");
        var cbAuto = gpv.add("checkbox", undefined, "automatisch");
        cbAuto.value = true;

        var shown = false;                                // vor show() keine Auto-Refreshs

        // Aktuelle Dialogwerte als Options-Objekt (identisch zum OK-Ergebnis,
        // ohne Verschmelzen/Maske/Ausblenden – für die Vorschau unerheblich).
        function readOpts() {
            return {
                cellMM:    num(fCell, 3),
                angle:     num(fAngle, 45),
                shape:     ddShape.selection.index,
                ratio:     clamp(num(fRatio, 65) / 100, 0.2, 1),
                gain:      clamp(num(fGain, 115) / 100, 0.3, 2),
                cutoff:    clamp(num(fCut, 4) / 100, 0, 0.9),
                gamma:     clamp(num(fGamma, 1), 0.1, 5),
                separate:  ddMode.selection.index === 1,
                colorMode: ddCol.selection.index,
                custom:    [clamp(num(fC, 0), 0, 100), clamp(num(fM, 100), 0, 100),
                            clamp(num(fY, 0), 0, 100), clamp(num(fK, 0), 0, 100)],
                sepAngles: [num(fAC, 15), num(fAM, 75), num(fAY, 0), num(fAK, 45)],
                staggered: cbStag.value,
                invert:    cbInv.value,
                rnd: {
                    on:       cbRnd.value,
                    jitter:   clamp(num(fJit, 0) / 100, 0, 1),
                    sizeVar:  clamp(num(fSize, 0) / 100, 0, 1),
                    angleVar: clamp(num(fAng, 0), 0, 180),
                    dropout:  clamp(num(fDrop, 0) / 100, 0, 0.95),
                    seed:     num(fSeed, 0)
                }
            };
        }

        // Zeichnet die Rastervorschau mit denselben Formeln wie die Ausgabe,
        // nur als ScriptUI-Polygone statt echter Pfade. Formen werden als
        // Vielecke berechnet und um Raster-/Zufallswinkel gedreht.
        function drawPreview(g, cw, ch) {
            // this.size ist im onDraw mancher Illustrator-Versionen 0/unzuverlässig
            // → feste Größe aus dem Closure verwenden.
            cw = pvW; ch = pvH;
            var BT = g.BrushType.SOLID_COLOR;
            function brush(c) { return g.newBrush(BT, c); }
            function pen(c, w) { return g.newPen(g.PenType.SOLID_COLOR, c, w || 1); }
            function fillRect(c) { g.newPath(); g.rectPath(0, 0, cw, ch); g.fillPath(brush(c)); }
            function border() {    // sichtbarer Rahmen = Beweis, dass onDraw läuft
                g.newPath();
                g.moveTo(0.5, 0.5); g.lineTo(cw - 0.5, 0.5);
                g.lineTo(cw - 0.5, ch - 0.5); g.lineTo(0.5, ch - 0.5);
                g.closePath(); g.strokePath(pen([0.45, 0.45, 0.45, 1], 1));
            }

            if (!thumb) {
                fillRect([0.9, 0.9, 0.9, 1]);
                // rotes Kreuz = Thumbnail-Export fehlgeschlagen
                g.newPath(); g.moveTo(0, 0);  g.lineTo(cw, ch); g.strokePath(pen([0.7, 0.2, 0.2, 1], 2));
                g.newPath(); g.moveTo(cw, 0); g.lineTo(0, ch);  g.strokePath(pen([0.7, 0.2, 0.2, 1], 2));
                border();
                return;
            }

            var po = readOpts();
            var bg = (!po.separate && po.colorMode === 1) ? [0.5, 0.5, 0.5, 1] : [1, 1, 1, 1];
            fillRect(bg);

            var L = vbp[0], T = vbp[1], Rr = vbp[2], Bb = vbp[3];
            var W = pW, H = pH;
            if (W <= 0 || H <= 0) return;

            var cell = po.cellMM * MM;
            if (cell < 0.5) cell = 0.5;
            var chCount = po.separate ? 4 : 1;
            var nx = W / cell, ny = H / cell, pf = 1;
            // Vorschau vereinfachen, falls zu viele Punkte (Zeichengeschwindigkeit)
            if (nx * ny * chCount > 6000) pf = Math.sqrt(nx * ny * chCount / 6000);
            var pcell = cell * pf;

            var sqRatio  = Math.sqrt(po.ratio);
            var halfDiag = Math.sqrt(W * W + H * H) / 2 + pcell;
            var cx0 = L + W / 2, cy0 = Bb + H / 2;
            var margin = pcell * 0.6;
            var sampleRad = Math.max(1, Math.round(pcell * 0.45 * (thumb.width / W)));
            var sx = cw / W, sy = ch / H;

            var useRnd = po.rnd.on &&
                (po.rnd.jitter > 0 || po.rnd.sizeVar > 0 || po.rnd.angleVar > 0 || po.rnd.dropout > 0);
            var seedBase = (po.rnd.seed && po.rnd.seed > 0) ? Math.floor(po.rnd.seed) : 1;
            var R = po.rnd;

            // Kanäle: Separation = 4 Tinten, sonst 1 Farbe
            var chans = [];
            if (po.separate) {
                var ia = po.sepAngles;
                // Vorschaufarben der Tinten (Deckkraft nähert Multiplizieren an)
                var icol = [[0, 0.6, 0.85, 0.85], [0.9, 0, 0.45, 0.85],
                            [0.95, 0.85, 0, 0.85], [0, 0, 0, 0.85]];
                for (var i = 0; i < 4; i++) {
                    chans.push({
                        angle: ia[i], col: icol[i],
                        rng: useRnd ? makeRng(seedBase + i * 1009) : null,
                        cov: (function (idx) {
                            return function (v) {
                                if (v.length >= 3) return rgbToCmyk(v[0], v[1], v[2])[idx];
                                // Graustufen-Fallback: nur Schwarzkanal belegt
                                return [0, 0, 0, 1 - v[0] / 255][idx];
                            };
                        })(i)
                    });
                }
            } else {
                var rgb, c4 = po.custom;
                if (po.colorMode === 2) {
                    var kk = c4[3] / 100;
                    rgb = [(1 - c4[0] / 100) * (1 - kk), (1 - c4[1] / 100) * (1 - kk),
                           (1 - c4[2] / 100) * (1 - kk), 1];
                } else if (po.colorMode === 1) { rgb = [1, 1, 1, 1]; }
                else { rgb = [0, 0, 0, 1]; }
                chans.push({
                    angle: po.angle, col: rgb,
                    rng: useRnd ? makeRng(seedBase) : null,
                    // Einfarbig entspricht Graustufen-Export: Luma aus RGB,
                    // bei Graustufen-Thumbnail direkt der eine Kanal
                    cov: function (v) {
                        var lum = (v.length >= 3)
                            ? (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) : v[0];
                        return 1 - lum / 255;
                    }
                });
            }

            var segs = (nx * ny > 1500) ? 8 : 12;         // Ecken für Ellipsen-Vieleck

            for (var ci = 0; ci < chans.length; ci++) {
                var dch = chans[ci];
                var br = brush(dch.col);
                var a = Math.PI / 180 * dch.angle, cosA = Math.cos(a), sinA = Math.sin(a);
                var doRotate = (dch.angle % 180 !== 0) && (po.shape !== 0 || po.ratio < 1);
                var rng = dch.rng, row = 0;

                for (var gy = -halfDiag; gy <= halfDiag; gy += pcell) {
                    var xOff = (po.staggered && (row % 2 === 1)) ? pcell / 2 : 0;
                    for (var gx = -halfDiag + xOff; gx <= halfDiag; gx += pcell) {
                        var X = cx0 + gx * cosA - gy * sinA;
                        var Y = cy0 + gx * sinA + gy * cosA;
                        if (X < L - margin || X > Rr + margin ||
                            Y < Bb - margin || Y > T + margin) continue;

                        var u = (X - L) / W, vv = (T - Y) / H;
                        var vals = avgPixels(thumb, u * thumb.width, vv * thumb.height, sampleRad);
                        var covr = dch.cov(vals);
                        if (po.invert) covr = 1 - covr;
                        if (po.gamma !== 1) covr = Math.pow(covr, po.gamma);
                        if (covr <= po.cutoff) continue;

                        var jx = 0, jy = 0, sizeScale = 1, extraAngle = 0;
                        if (rng) {
                            if (R.dropout > 0 && rng() < R.dropout) continue;
                            if (R.jitter > 0) {
                                jx = (rng() * 2 - 1) * R.jitter * pcell;
                                jy = (rng() * 2 - 1) * R.jitter * pcell;
                            }
                            if (R.sizeVar > 0) {
                                sizeScale = 1 + (rng() * 2 - 1) * R.sizeVar;
                                if (sizeScale < 0.05) sizeScale = 0.05;
                            }
                            if (R.angleVar > 0) extraAngle = (rng() * 2 - 1) * R.angleVar;
                        }
                        var Xc = X + jx, Yc = Y + jy, verts, rot;

                        if (po.shape === 3) {                 // Linie
                            var t = pcell * covr * po.gain * sizeScale;
                            if (t < 0.01) continue;
                            var len = pcell * 1.05;
                            verts = [[-len / 2, -t / 2], [len / 2, -t / 2],
                                     [len / 2, t / 2], [-len / 2, t / 2]];
                            rot = (doRotate ? dch.angle : 0) + extraAngle;
                        } else {
                            var d = pcell * Math.sqrt(covr) * po.gain * sizeScale;
                            if (d < 0.01) continue;
                            if (po.shape === 0) {             // Ellipse (Vieleck)
                                var ea = d / sqRatio / 2, eb = d * sqRatio / 2;
                                verts = [];
                                for (var si = 0; si < segs; si++) {
                                    var th = Math.PI * 2 * si / segs;
                                    verts.push([Math.cos(th) * ea, Math.sin(th) * eb]);
                                }
                            } else if (po.shape === 1) {      // Quadrat
                                var sq = d * 0.88623, sw = sq / sqRatio / 2, sh = sq * sqRatio / 2;
                                verts = [[-sw, -sh], [sw, -sh], [sw, sh], [-sw, sh]];
                            } else {                          // Raute
                                var q = d * 1.25331, dw = q / sqRatio / 2, dh = q * sqRatio / 2;
                                verts = [[0, dh], [dw, 0], [0, -dh], [-dw, 0]];
                            }
                            rot = (doRotate ? dch.angle : 0) + extraAngle;
                        }

                        var rr = Math.PI / 180 * rot, cr = Math.cos(rr), srn = Math.sin(rr);
                        g.newPath();
                        for (var p = 0; p < verts.length; p++) {
                            var vx = verts[p][0], vy = verts[p][1];
                            var rx = vx * cr - vy * srn, ry = vx * srn + vy * cr;
                            var canX = (Xc + rx - L) * sx, canY = (T - (Yc + ry)) * sy;
                            if (p === 0) g.moveTo(canX, canY); else g.lineTo(canX, canY);
                        }
                        g.closePath();
                        g.fillPath(br);
                    }
                    row++;
                }
            }
            border();
        }

        // Hinweiszeile unter der Vorschau aktualisieren (Punktzahl/Vereinfachung)
        function previewNote() {
            if (!thumb) {
                pInfo.text = "Vorschau-Bild fehlgeschlagen:\n" + (thumbErr || "unbekannter Grund");
                return;
            }
            var po = readOpts();
            var cell = po.cellMM * MM;
            if (cell < 0.5) cell = 0.5;
            var chCount = po.separate ? 4 : 1;
            var nx = pW / cell, ny = pH / cell;
            var s = "Verschmelzen/Maske werden hier nicht dargestellt.";
            if (nx * ny * chCount > 6000) s = "Vereinfachte Vorschau (grob). " + s;
            pInfo.text = s;
        }

        function refreshPreview() {
            try { previewNote(); preview.notify("onDraw"); } catch (e) {}
        }
        function refreshAuto() { if (shown && cbAuto.value) refreshPreview(); }

        // --- Abhängigkeiten der Bedienelemente ------------------------------
        function updateEnabled() {
            var sep = ddMode.selection.index === 1;
            fAngle.enabled = !sep;
            gSep.enabled   = sep;
            gCol.enabled   = !sep;
            gCust.enabled  = !sep && ddCol.selection.index === 2;
            fRatio.enabled = ddShape.selection.index !== 3;   // Linie: kein Seitenverhältnis
            var rnd = cbRnd.value;
            fJit.enabled = fSize.enabled = fAng.enabled = fDrop.enabled = fSeed.enabled = rnd;
            refreshAuto();
        }
        ddMode.onChange  = updateEnabled;
        ddCol.onChange   = updateEnabled;
        ddShape.onChange = updateEnabled;
        cbRnd.onClick    = updateEnabled;

        // --- Vorschau-Aktualisierung an Bedienelemente koppeln --------------
        var numFields = [fCell, fAngle, fRatio, fGain, fCut, fGamma,
                         fC, fM, fY, fK, fAC, fAM, fAY, fAK,
                         fJit, fSize, fAng, fDrop, fSeed];
        for (var nf = 0; nf < numFields.length; nf++) numFields[nf].onChange = refreshAuto;
        cbStag.onClick = refreshAuto;
        cbInv.onClick  = refreshAuto;
        // „Aktualisieren" erzwingt ein Neuzeichnen (auch wenn Auto aus ist)
        btPrev.onClick = function () {
            try { previewNote(); preview.hide(); preview.show(); }
            catch (e) { refreshPreview(); }
        };

        // --- Zustand lesen/schreiben (für Presets) --------------------------
        function getState() {
            return {
                cell: fCell.text, angle: fAngle.text,
                shape: "" + ddShape.selection.index,
                ratio: fRatio.text, gain: fGain.text, cut: fCut.text, gamma: fGamma.text,
                mode: "" + ddMode.selection.index, col: "" + ddCol.selection.index,
                cc: fC.text, cm: fM.text, cy: fY.text, ck: fK.text,
                aC: fAC.text, aM: fAM.text, aY: fAY.text, aK: fAK.text,
                stag: cbStag.value  ? "1" : "0",
                inv:  cbInv.value   ? "1" : "0",
                mrg:  cbMerge.value ? "1" : "0",
                mask: cbMask.value  ? "1" : "0",
                hide: cbHide.value  ? "1" : "0",
                rnd:  cbRnd.value   ? "1" : "0",
                jit: fJit.text, siz: fSize.text, ang: fAng.text,
                drp: fDrop.text, seed: fSeed.text
            };
        }
        function setState(v) {
            function txt(et, x) { if (x !== undefined) et.text = x; }
            function ddSel(list, x, max) {
                var i = parseInt(x, 10);
                if (!isNaN(i) && i >= 0 && i < max) list.selection = i;
            }
            function cb(box, x) { if (x !== undefined) box.value = (x === "1"); }
            txt(fCell, v.cell); txt(fAngle, v.angle);
            ddSel(ddShape, v.shape, 4);
            txt(fRatio, v.ratio); txt(fGain, v.gain); txt(fCut, v.cut); txt(fGamma, v.gamma);
            ddSel(ddMode, v.mode, 2); ddSel(ddCol, v.col, 3);
            txt(fC, v.cc); txt(fM, v.cm); txt(fY, v.cy); txt(fK, v.ck);
            txt(fAC, v.aC); txt(fAM, v.aM); txt(fAY, v.aY); txt(fAK, v.aK);
            cb(cbStag, v.stag); cb(cbInv, v.inv); cb(cbMerge, v.mrg);
            cb(cbMask, v.mask); cb(cbHide, v.hide);
            cb(cbRnd, v.rnd);
            txt(fJit, v.jit); txt(fSize, v.siz); txt(fAng, v.ang);
            txt(fDrop, v.drp); txt(fSeed, v.seed);
            updateEnabled();
        }

        // --- Preset-Bedienung ----------------------------------------------
        function rebuildPresets(selName) {
            ddPre.removeAll();
            for (var i = 0; i < presets.length; i++) {
                var it = ddPre.add("item", presets[i].name);
                if (selName !== null && presets[i].name === selName) ddPre.selection = it;
            }
        }
        ddPre.onChange = function () {
            if (ddPre.selection) setState(presets[ddPre.selection.index].vals);
        };
        btSave.onClick = function () {
            var name = prompt("Name des Presets:", ddPre.selection ? ddPre.selection.text : "");
            if (!name) return;
            name = ("" + name).replace(/[\[\]\r\n]/g, "");
            if (!name) return;
            var found = -1;
            for (var i = 0; i < presets.length; i++)
                if (presets[i].name === name) found = i;
            if (found >= 0) presets[found].vals = getState();
            else presets.push({ name: name, vals: getState() });
            if (savePresetList(presets)) rebuildPresets(name);
        };
        btDel.onClick = function () {
            if (!ddPre.selection) { alert("Kein Preset ausgewählt."); return; }
            var idx = ddPre.selection.index;
            if (!confirm("Preset \"" + presets[idx].name + "\" löschen?")) return;
            presets.splice(idx, 1);
            savePresetList(presets);
            rebuildPresets(null);
        };
        rebuildPresets(null);
        updateEnabled();

        // Zuletzt verwendete Einstellungen wiederherstellen (falls vorhanden)
        var _last = loadLast();
        if (_last) { try { setState(_last); } catch (eLast) {} }

        // --- OK / Abbrechen -------------------------------------------------
        var gBtn = dlg.add("group");
        gBtn.alignment = "right";
        gBtn.add("button", undefined, "Abbrechen", { name: "cancel" });
        gBtn.add("button", undefined, "OK",        { name: "ok" });

        shown = true;                         // ab jetzt dürfen Auto-Refreshs feuern
        previewNote();
        if (dlg.show() !== 1) return null;
        saveLast(getState());                 // Einstellungen für das nächste Mal merken

        // Dialogwerte + die vorschau-irrelevanten Optionen zusammenführen
        var o = readOpts();
        o.merge        = cbMerge.value;
        o.mask         = cbMask.value;
        o.hideOriginal = cbHide.value;

        if (o.cellMM < 0.2) { alert("Rasterweite zu klein (min. 0,2 mm)."); return null; }
        return o;
    }

    // ---------------------------------------------- TIFF-Parser (unkomprimiert)
    // Liest Graustufen- (1 Kanal) und RGB-TIFFs (3 Kanäle, chunky).
    function loadTiff(file) {
        file.encoding = "BINARY";
        if (!file.open("r")) throw new Error("Temporäre TIFF-Datei konnte nicht gelesen werden.");
        var s = file.read();
        file.close();

        function u8(i)  { return s.charCodeAt(i) & 0xFF; }
        var little;
        if      (u8(0) === 0x49 && u8(1) === 0x49) little = true;
        else if (u8(0) === 0x4D && u8(1) === 0x4D) little = false;
        else throw new Error("Export ist kein gültiges TIFF.");

        function u16(i) { return little ? (u8(i) | (u8(i + 1) << 8)) : ((u8(i) << 8) | u8(i + 1)); }
        function u32(i) {
            return little
                ? u8(i) + u8(i + 1) * 256 + u8(i + 2) * 65536 + u8(i + 3) * 16777216
                : u8(i) * 16777216 + u8(i + 1) * 65536 + u8(i + 2) * 256 + u8(i + 3);
        }

        var ifd = u32(4);
        var n = u16(ifd);
        var entries = {};                               // Tag -> {type, count, off}
        for (var e = 0; e < n; e++) {
            var p = ifd + 2 + e * 12;
            entries[u16(p)] = { type: u16(p + 2), count: u32(p + 4), off: p + 8 };
        }

        var TYPESIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
        function tagValues(tag) {
            var t = entries[tag];
            if (!t) return null;
            var size = (TYPESIZE[t.type] || 1) * t.count;
            var base = (size <= 4) ? t.off : u32(t.off); // klein = inline, sonst Zeiger
            var vals = [];
            for (var i = 0; i < t.count; i++) {
                if      (t.type === 3) vals.push(u16(base + i * 2));
                else if (t.type === 4) vals.push(u32(base + i * 4));
                else if (t.type === 1) vals.push(u8(base + i));
            }
            return vals;
        }
        function tagValue(tag, def) { var v = tagValues(tag); return v ? v[0] : def; }

        var w     = tagValue(256);          // ImageWidth
        var h     = tagValue(257);          // ImageLength
        var bits  = tagValue(258, 8);       // BitsPerSample
        var comp  = tagValue(259, 1);       // Compression
        var photo = tagValue(262, 1);       // PhotometricInterpretation
        var spp   = tagValue(277, 1);       // SamplesPerPixel
        var rps   = tagValue(278, h);       // RowsPerStrip
        var strips = tagValues(273);        // StripOffsets

        if (!w || !h || !strips) throw new Error("TIFF unvollständig.");
        if (comp !== 1)          throw new Error("TIFF ist komprimiert – unerwartetes Exportformat.");
        if (bits !== 8)          throw new Error("TIFF hat " + bits + " Bit/Kanal – unerwartetes Exportformat.");
        if (rps < 1) rps = h;

        return {
            width: w,
            height: h,
            channels: (spp >= 3) ? 3 : 1,
            // Kanalwert 0…255 an Pixelposition; Graustufen: 0=schwarz, 255=weiß
            sample: function (px, py, ch) {
                if (px < 0) px = 0; else if (px >= w) px = w - 1;
                if (py < 0) py = 0; else if (py >= h) py = h - 1;
                if (!ch) ch = 0; else if (ch >= spp) ch = spp - 1;
                var si = Math.floor(py / rps);
                var v = u8(strips[si] + ((py - si * rps) * w + px) * spp + ch);
                return (photo === 0) ? 255 - v : v;
            }
        };
    }

    // Kanalweiser Mittelwert eines quadratischen Pixelblocks (max. ~5x5 Stützstellen)
    function avgPixels(img, cx, cy, rad) {
        var step = Math.max(1, Math.ceil((rad * 2 + 1) / 5));
        var a0 = 0, a1 = 0, a2 = 0, cnt = 0;
        var multi = img.channels === 3;
        for (var y = cy - rad; y <= cy + rad; y += step) {
            for (var x = cx - rad; x <= cx + rad; x += step) {
                var px = Math.round(x), py = Math.round(y);
                a0 += img.sample(px, py, 0);
                if (multi) {
                    a1 += img.sample(px, py, 1);
                    a2 += img.sample(px, py, 2);
                }
                cnt++;
            }
        }
        return multi ? [a0 / cnt, a1 / cnt, a2 / cnt] : [a0 / cnt];
    }

    // ------------------------------------------------------------- Farb-Helfer
    // RGB (0…255) -> CMYK (0…1), volle Schwarzerzeugung (K = min der Buntanteile)
    function rgbToCmyk(r, g, b) {
        var c = 1 - r / 255, m = 1 - g / 255, y = 1 - b / 255;
        var k = Math.min(c, Math.min(m, y));
        if (k >= 0.999) return [0, 0, 0, 1];
        return [(c - k) / (1 - k), (m - k) / (1 - k), (y - k) / (1 - k), k];
    }

    // CMYK-Werte (0…100) als dokumentverträgliche Farbe (CMYK- oder RGB-Dokument)
    function makeColor(doc, c, m, y, k) {
        if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
            var col = new CMYKColor();
            col.cyan = c; col.magenta = m; col.yellow = y; col.black = k;
            return col;
        }
        var kk = k / 100;
        var rgb = new RGBColor();
        rgb.red   = Math.round(255 * (1 - c / 100) * (1 - kk));
        rgb.green = Math.round(255 * (1 - m / 100) * (1 - kk));
        rgb.blue  = Math.round(255 * (1 - y / 100) * (1 - kk));
        return rgb;
    }

    // ------------------------------------------- Punkte zu Flächen verschmelzen
    // Pathfinder "Vereinen" über Menübefehle; gibt die neue Gruppe zurück.
    function uniteGroup(doc, layer, grp) {
        try {
            doc.selection = null;
            grp.selected = true;
            app.executeMenuCommand("Live Pathfinder Add");
            app.executeMenuCommand("expandStyle");
            var res = (doc.selection && doc.selection.length) ? doc.selection[0] : null;
            doc.selection = null;
            if (!res) return grp;
            if (res.typename !== "GroupItem") {
                var ng = layer.groupItems.add();
                ng.name = "Rasterpunkte";
                res.move(ng, ElementPlacement.PLACEATBEGINNING);
                res = ng;
            }
            return res;
        } catch (e) {
            return grp;                       // Verschmelzen fehlgeschlagen: Punkte behalten
        }
    }

    // -------------------------------------------------- Einen Kanal rastern
    // def: { layerName, angle, color, multiply, rng, cov(vals) -> Deckung 0…1 }
    function renderChannel(doc, img, geo, o, def) {
        var layer = doc.layers.add();
        layer.name = def.layerName;
        var grp = layer.groupItems.add();
        grp.name = "Rasterpunkte";

        var rng = def.rng;                    // Zufallsgenerator oder null
        var R   = o.rnd;

        var rad  = Math.PI / 180 * def.angle;
        var cosA = Math.cos(rad), sinA = Math.sin(rad);
        var doRotate = (def.angle % 180 !== 0) && (o.shape !== 0 || o.ratio < 1);

        var made = 0, row = 0;
        for (var gy = -geo.halfDiag; gy <= geo.halfDiag; gy += geo.cell) {
            var xOff = (o.staggered && (row % 2 === 1)) ? geo.cell / 2 : 0;
            for (var gx = -geo.halfDiag + xOff; gx <= geo.halfDiag; gx += geo.cell) {
                // Gitterposition um Rasterwinkel gedreht (um Motivmitte)
                var x = geo.cx0 + gx * cosA - gy * sinA;
                var y = geo.cy0 + gx * sinA + gy * cosA;
                if (x < geo.L - geo.margin || x > geo.R + geo.margin ||
                    y < geo.B - geo.margin || y > geo.T + geo.margin) continue;

                // Tonwert an dieser Stelle abtasten
                var u = (x - geo.L) / geo.W, v = (geo.T - y) / geo.H;
                var vals = avgPixels(img, u * img.width, v * img.height, geo.sampleRad);
                var covr = def.cov(vals);                     // Deckung 0…1
                if (o.invert) covr = 1 - covr;
                if (o.gamma !== 1) covr = Math.pow(covr, o.gamma);
                if (covr <= o.cutoff) continue;

                // --- Zufalls-Einflüsse (feste Aufrufreihenfolge = reproduzierbar) ---
                var jx = 0, jy = 0, sizeScale = 1, extraAngle = 0;
                if (rng) {
                    if (R.dropout > 0 && rng() < R.dropout) continue;
                    if (R.jitter > 0) {
                        jx = (rng() * 2 - 1) * R.jitter * geo.cell;
                        jy = (rng() * 2 - 1) * R.jitter * geo.cell;
                    }
                    if (R.sizeVar > 0) {
                        sizeScale = 1 + (rng() * 2 - 1) * R.sizeVar;
                        if (sizeScale < 0.05) sizeScale = 0.05;
                    }
                    if (R.angleVar > 0) extraAngle = (rng() * 2 - 1) * R.angleVar;
                }
                var px = x + jx, py = y + jy;

                var it;
                if (o.shape === 3) {
                    // Linie: Dicke linear zur Deckung, Länge = Zelle (mit Überlappung,
                    // damit benachbarte Segmente durchgehende Linien ergeben)
                    var t = geo.cell * covr * o.gain * sizeScale;
                    if (t < 0.01) continue;
                    var len = geo.cell * 1.05;
                    it = grp.pathItems.rectangle(py + t / 2, px - len / 2, len, t);
                } else {
                    // Referenz: Kreisdurchmesser; andere Formen flächengleich skaliert
                    var d = geo.cell * Math.sqrt(covr) * o.gain * sizeScale;
                    if (d < 0.01) continue;
                    if (o.shape === 0) {                      // Ellipse (flächentreu)
                        var ew = d / geo.sqRatio, eh = d * geo.sqRatio;
                        it = grp.pathItems.ellipse(py + eh / 2, px - ew / 2, ew, eh);
                    } else if (o.shape === 1) {               // Quadrat
                        var sq = d * 0.88623;                 // sqrt(pi)/2
                        var sw = sq / geo.sqRatio, sh = sq * geo.sqRatio;
                        it = grp.pathItems.rectangle(py + sh / 2, px - sw / 2, sw, sh);
                    } else {                                  // Raute
                        var q = d * 1.25331;                  // sqrt(pi/2)
                        var dw = q / geo.sqRatio / 2, dh = q * geo.sqRatio / 2;
                        it = grp.pathItems.add();
                        it.setEntirePath([[px, py + dh], [px + dw, py], [px, py - dh], [px - dw, py]]);
                        it.closed = true;
                    }
                }
                it.filled = true;
                it.fillColor = def.color;
                it.stroked = false;
                var rot = (doRotate ? def.angle : 0) + extraAngle;
                if (rot) it.rotate(rot);
                made++;
            }
            row++;
        }

        if (made > 0 && o.merge) grp = uniteGroup(doc, layer, grp);

        if (def.multiply) {
            try { grp.blendingMode = BlendModes.MULTIPLY; } catch (ignore) {}
        }

        // Optional auf Objektgrenzen maskieren
        if (o.mask && made > 0) {
            var mrect = grp.pathItems.rectangle(geo.T, geo.L, geo.W, geo.H);
            mrect.filled = false;
            mrect.stroked = false;
            mrect.move(grp, ElementPlacement.PLACEATBEGINNING);
            mrect.clipping = true;
            grp.clipped = true;
        }
        return made;
    }

    // ------------------------------------------- Auswahl als TIFF rastern & lesen
    // Dupliziert das Objekt in ein Temporärdokument, exportiert ein
    // unkomprimiertes 8-Bit-TIFF (Graustufen oder RGB) und gibt das geparste
    // Bild zurück. Wird vom Hauptteil UND von der Dialog-Vorschau genutzt.
    // maxSidePt (optional): Kopie vor dem Export auf diese lange Kante (pt)
    // verkleinern. So bleibt das Thumbnail klein, OBWOHL bei >= 72 dpi
    // exportiert wird (Illustrator erlaubt keine niedrigere Auflösung).
    function exportTiffImg(item, W, H, ppi, wantRGB, maxSidePt) {
        var tif = new File(Folder.temp + "/siebdruckraster_tmp.tif");
        var oldUI = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        var tmpDoc = app.documents.add(DocumentColorSpace.RGB, W, H);
        try {
            var dup = item.duplicate(tmpDoc.layers[0], ElementPlacement.PLACEATBEGINNING);
            if (maxSidePt) {
                var mx = Math.max(W, H);
                if (mx > maxSidePt) {
                    var pct = maxSidePt / mx * 100;
                    try {
                        dup.resize(pct, pct, true, true, true, true, pct, Transformation.CENTER);
                    } catch (eRes) {}
                }
            }
            tmpDoc.artboards[0].artboardRect = dup.visibleBounds;

            var opt = new ExportOptionsTIFF();
            opt.imageColorSpace = wantRGB ? ImageColorSpace.RGB : ImageColorSpace.GrayScale;
            opt.resolution = ppi;
            // Neuere Illustrator-Versionen erwarten hier einen Enum-Wert,
            // ältere einen Boolean
            if (typeof AntiAliasingMethod !== "undefined") {
                opt.antiAliasing = AntiAliasingMethod.ARTOPTIMIZED;
            } else {
                opt.antiAliasing = true;
            }
            opt.lZWCompression = false;
            opt.byteOrder = TIFFByteOrder.IBMPC;
            opt.saveMultipleArtboards = false;
            tmpDoc.exportFile(tif, ExportType.TIFF, opt);
        } finally {
            tmpDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.userInteractionLevel = oldUI;
        }

        var img = loadTiff(tif);
        try { tif.remove(); } catch (ignore) {}
        return img;
    }

    // ---------------------------------------------------------------- Hauptteil
    function main(doc, item, o) {
        var cell = o.cellMM * MM;

        var vb = item.visibleBounds;          // [links, oben, rechts, unten]
        var L = vb[0], T = vb[1], R = vb[2], B = vb[3];
        var W = R - L, H = T - B;
        if (W < cell || H < cell) { alert("Das Objekt ist kleiner als die Rasterweite."); return; }

        var estimate = Math.ceil(W / cell + 1) * Math.ceil(H / cell + 1) * (o.separate ? 4 : 1);
        if (estimate > 30000 &&
            !confirm("Es entstehen ca. " + estimate + " Rasterpunkte – das kann sehr lange dauern.\nFortfahren?")) {
            return;
        }

        // --- 1. Auswahl in Temporärdokument rendern ---------------------------
        var ppi = 72 * 6 / cell;                       // Ziel: ~6 Pixel je Rasterzelle
        var maxSide = Math.max(W, H);
        if (maxSide / 72 * ppi > 3000) ppi = 3000 * 72 / maxSide;
        if (ppi < 72)  ppi = 72;
        if (ppi > 600) ppi = 600;

        // Einfarbig: Graustufen genügen; Separation: RGB für die Farbauszüge
        var img = exportTiffImg(item, W, H, ppi, o.separate);

        // --- 2. Geometrie -----------------------------------------------------
        app.activeDocument = doc;
        var geo = {
            L: L, T: T, R: R, B: B, W: W, H: H,
            cell: cell,
            cx0: L + W / 2, cy0: B + H / 2,                       // Motivmitte
            halfDiag: Math.sqrt(W * W + H * H) / 2 + cell,
            sqRatio: Math.sqrt(o.ratio),                          // flächentreue Ellipse
            sampleRad: Math.max(1, Math.round(cell * 0.45 * (img.width / W))),
            margin: cell * 0.6
        };

        // --- Zufall vorbereiten (Seed 0 = zeitbasiert, sonst reproduzierbar) --
        var useRnd = o.rnd.on &&
            (o.rnd.jitter > 0 || o.rnd.sizeVar > 0 || o.rnd.angleVar > 0 || o.rnd.dropout > 0);
        var seedBase = (o.rnd.seed && o.rnd.seed > 0)
            ? Math.floor(o.rnd.seed)
            : (new Date().getTime());

        // --- 3. Kanäle definieren und zeichnen --------------------------------
        var defs = [];
        if (o.separate) {
            var names = ["Cyan", "Magenta", "Gelb", "Schwarz"];
            var inks  = [[100, 0, 0, 0], [0, 100, 0, 0], [0, 0, 100, 0], [0, 0, 0, 100]];
            for (var i = 0; i < 4; i++) {
                defs.push({
                    layerName: "Raster " + names[i],
                    angle: o.sepAngles[i],
                    color: makeColor(doc, inks[i][0], inks[i][1], inks[i][2], inks[i][3]),
                    multiply: true,
                    // je Auszug eigener Seed-Versatz, damit die Kanäle nicht korrelieren
                    rng: useRnd ? makeRng(seedBase + i * 1009) : null,
                    cov: (function (idx) {
                        return function (vals) {
                            return rgbToCmyk(vals[0], vals[1], vals[2])[idx];
                        };
                    })(i)
                });
            }
        } else {
            var col;
            if (o.colorMode === 2) {
                col = makeColor(doc, o.custom[0], o.custom[1], o.custom[2], o.custom[3]);
            } else {
                col = new GrayColor();
                col.gray = (o.colorMode === 1) ? 0 : 100;         // Weiß : Schwarz
            }
            defs.push({
                layerName: "Siebdruckraster",
                angle: o.angle,
                color: col,
                multiply: false,
                rng: useRnd ? makeRng(seedBase) : null,
                cov: function (vals) { return 1 - vals[0] / 255; }
            });
        }

        var made = 0;
        for (var c = 0; c < defs.length; c++) made += renderChannel(doc, img, geo, o, defs[c]);

        if (o.hideOriginal) item.hidden = true;
        doc.selection = null;
        app.redraw();

        if (made === 0) {
            alert("Es wurden keine Rasterpunkte erzeugt.\nMotiv evtl. zu hell – Lichter-Schwelle senken oder \"Invertieren\" aktivieren.");
        }
    }

    // ------------------------------------------------------------------- Start
    try {
        if (app.documents.length === 0) { alert("Kein Dokument geöffnet."); return; }
        var doc = app.activeDocument;
        var sel = doc.selection;
        if (!(sel instanceof Array) || sel.length === 0) {
            alert("Bitte zuerst ein Objekt auswählen (Bild oder Grafik).");
            return;
        }
        if (sel.length > 1) {
            alert("Bitte genau EIN Objekt auswählen.\nMehrere Objekte vorher gruppieren (Cmd/Strg+G).");
            return;
        }
        var o = showDialog(doc, sel[0]);
        if (!o) return;
        main(doc, sel[0], o);
    } catch (err) {
        alert("Fehler: " + err.message + (err.line ? "  (Zeile " + err.line + ")" : ""));
    }

})();
