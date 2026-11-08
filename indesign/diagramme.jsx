// ============================================================================
// Diagramme.jsx  —  Adobe InDesign                               Version 1.0
// ----------------------------------------------------------------------------
// Erzeugt vollautomatisch Diagramme aus einer Excel- oder CSV-Datei — als
// native, gruppierte InDesign-Vektorobjekte (keine platzierte Grafik). Farben
// kommen aus den FARBFELDERN des Dokuments, die Schrift aus den ABSATZFORMATEN.
//
// Diagrammtypen: Säulen, Balken, Linie, Fläche (jeweils auch gestapelt),
//                Kreis, Ring und Punkt (XY-Streudiagramm).
//
// Datenformat:  erste Zeile = Namen der Datenreihen (abwählbar),
//               erste Spalte = Beschriftungen / X-Werte (abwählbar),
//               restliche Zellen = Zahlen (deutsches Komma wird verstanden).
//
// .xlsx wird direkt gelesen (entpackt über die Zip-Funktion des Systems);
// klappt das nicht, einfach als CSV sichern. Das Diagramm wird in den
// Satzspiegel der aktiven Seite gelegt und ist danach frei verschiebbar.
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de
// ============================================================================

#target indesign

(function () {

    if (app.documents.length === 0) { alert("Kein Dokument geöffnet.\nBitte zuerst ein InDesign-Dokument öffnen — dort hinein wird das Diagramm gezeichnet."); return; }
    var doc = app.activeDocument;

    var MM = 2.834645669291339;   // Millimeter → Punkt
    var TESTP = $.global.__DWB_DIAGRAMM__ || null;   // Automatiktest-Haken (im Normalbetrieb null)

    // =========================================================================
    //  1) Datei wählen
    // =========================================================================
    var datei;
    if (TESTP) {
        datei = File(TESTP.file);
    } else {
        if ($.os.indexOf("Windows") >= 0)
            datei = File.openDialog("Excel- oder CSV-Datei wählen", "Tabellen:*.xlsx;*.csv;*.tsv;*.txt");
        else
            datei = File.openDialog("Excel- oder CSV-Datei wählen", function (f) {
                if (f instanceof Folder) return true;
                return /\.(xlsx|csv|tsv|txt)$/i.test(f.name);
            });
    }
    if (!datei) return;
    if (!datei.exists) { alert("Datei nicht gefunden:\n" + datei.fsName); return; }

    // =========================================================================
    //  2) Einlesen  →  roh = 2D-Array aus Zellen (Strings/Zahlen)
    // =========================================================================
    var roh, blattName = null;
    try {
        if (/\.xlsx$/i.test(datei.name)) {
            var x = leseXlsx(datei, TESTP ? TESTP.blatt : undefined);
            roh = x.zellen; blattName = x.blatt;
        } else {
            roh = leseCsv(datei);
        }
    } catch (e) {
        alert("Die Datei konnte nicht gelesen werden:\n" + e +
              (/\.xlsx$/i.test(datei.name) ? "\n\nTipp: In Excel als CSV (UTF-8) sichern und diese Datei wählen." : ""));
        return;
    }
    roh = beschneide(roh);
    if (!roh || roh.length === 0 || roh[0].length === 0) { alert("In der Datei wurden keine Daten gefunden."); return; }

    // =========================================================================
    //  3) Farbfelder & Absatzformate des Dokuments sammeln
    // =========================================================================
    var swatchNamen = [];
    for (var i = 0; i < doc.swatches.length; i++) {
        var sn = String(doc.swatches[i].name);
        var k = sn.replace(/[\[\]]/g, "").toLowerCase();
        if (sn === "" || k === "none" || k === "ohne" || k === "registration" || k === "registrierung") continue;
        swatchNamen.push(sn);
    }
    if (swatchNamen.length === 0) { alert("Das Dokument hat keine verwendbaren Farbfelder."); return; }

    var absFormate = [], absObjekte = [];
    var alleAbs = doc.allParagraphStyles;
    for (i = 0; i < alleAbs.length; i++) {
        var pn = String(alleAbs[i].name);
        if (pn === "[Kein Absatzformat]" || pn === "[No Paragraph Style]") continue;
        absFormate.push(pn); absObjekte.push(alleAbs[i]);
    }
    if (absFormate.length === 0) {
        // Notnagel: wenigstens das Grundformat zulassen
        absObjekte.push(doc.paragraphStyles.item(0)); absFormate.push(String(doc.paragraphStyles.item(0).name));
    }

    // =========================================================================
    //  4) Dialog  (oder Testparameter)
    // =========================================================================
    var opt = TESTP ? TESTP.opt : zeigeDialog(roh, swatchNamen, absFormate, blattName, doc);
    if (!opt) return;

    // =========================================================================
    //  5) Zeichnen  (ein Rückgängig-Schritt)
    // =========================================================================
    try {
        if (TESTP) {
            zeichne(doc, roh, opt, MM);                    // Automatiktest: ohne doScript-Hülle
        } else {
            app.doScript(function () { zeichne(doc, roh, opt, MM); },
                         ScriptLanguage.JAVASCRIPT, undefined,
                         UndoModes.ENTIRE_SCRIPT, "Diagramm erstellen");
        }
    } catch (e2) {
        alert("Beim Zeichnen ist ein Fehler aufgetreten:\n" + e2 + (e2.line ? "\n(Zeile " + e2.line + ")" : ""));
        return;
    }

    // =====================================================================
    // ============================  FUNKTIONEN  ===========================
    // =====================================================================

    // ------------------------------------------------------------ CSV lesen
    function leseCsv(file) {
        file.encoding = "UTF-8"; file.open("r"); var txt = file.read(); file.close();
        if (txt.charCodeAt(0) === 0xFEFF) txt = txt.substring(1);           // BOM weg
        // Trennzeichen der ersten Zeile erkennen
        var kopf = txt.split(/\r\n|\r|\n/)[0];
        var delim = ",";
        var zS = anzahl(kopf, ";"), zC = anzahl(kopf, ","), zT = anzahl(kopf, "\t");
        if (zT >= zS && zT >= zC) delim = "\t"; else if (zS >= zC) delim = ";";
        return parseCsv(txt, delim);
    }
    function anzahl(s, c) { var n = 0; for (var i = 0; i < s.length; i++) if (s.charAt(i) === c) n++; return n; }

    function parseCsv(txt, delim) {
        var zeilen = [], feld = "", zeile = [], imZitat = false;
        for (var i = 0; i < txt.length; i++) {
            var ch = txt.charAt(i);
            if (imZitat) {
                if (ch === '"') { if (txt.charAt(i + 1) === '"') { feld += '"'; i++; } else imZitat = false; }
                else feld += ch;
            } else {
                if (ch === '"') imZitat = true;
                else if (ch === delim) { zeile.push(feld); feld = ""; }
                else if (ch === "\n" || ch === "\r") {
                    if (ch === "\r" && txt.charAt(i + 1) === "\n") i++;
                    zeile.push(feld); feld = ""; zeilen.push(zeile); zeile = [];
                } else feld += ch;
            }
        }
        if (feld.length > 0 || zeile.length > 0) { zeile.push(feld); zeilen.push(zeile); }
        return zeilen;
    }

    // ------------------------------------------------------------ XLSX lesen
    function leseXlsx(file, wunschBlatt) {
        var ziel = new Folder(Folder.temp.fsName + "/dwb_xlsx_" + (new Date().getTime()));
        ziel.create();
        entpacke(file, ziel);

        // Shared Strings
        var ss = [];
        var ssf = File(ziel.fsName + "/xl/sharedStrings.xml");
        if (ssf.exists) ss = parseSharedStrings(leseText(ssf));

        // Blattliste (Name → Datei) über workbook.xml + rels
        var blaetter = blattListe(ziel);
        if (blaetter.length === 0) throw "Keine Arbeitsblätter gefunden.";

        var gewaehlt = blaetter[0];
        if (blaetter.length > 1 && !TESTP) {
            var namen = []; for (var k = 0; k < blaetter.length; k++) namen.push(blaetter[k].name);
            var w = waehleBlatt(namen);
            if (w < 0) throw "Abgebrochen.";
            gewaehlt = blaetter[w];
        } else if (wunschBlatt) {
            for (var m = 0; m < blaetter.length; m++) if (blaetter[m].name === wunschBlatt) gewaehlt = blaetter[m];
        }

        var zellen = parseSheet(leseText(File(gewaehlt.datei)), ss);
        try { ziel.remove(); } catch (e) {}
        return { zellen: zellen, blatt: gewaehlt.name };
    }

    function leseText(file) { file.encoding = "UTF-8"; file.open("r"); var t = file.read(); file.close(); return t; }

    function entpacke(file, ziel) {
        var z = file.fsName, d = ziel.fsName;
        if ($.os.indexOf("Windows") >= 0) {
            // Bordmittel: Shell.Application (Windows-eigenes Zip)
            var vbs =
                'Set fso = CreateObject("Scripting.FileSystemObject")\r\n' +
                'Set sh = CreateObject("Shell.Application")\r\n' +
                'Set src = sh.NameSpace(' + vbStr(z) + ')\r\n' +
                'Set dst = sh.NameSpace(' + vbStr(d) + ')\r\n' +
                'dst.CopyHere src.Items, 16\r\n' +
                'WScript.Sleep 1500\r\n';
            app.doScript(vbs, ScriptLanguage.VISUAL_BASIC);
        } else {
            var as = 'do shell script "/usr/bin/unzip -o -q " & quoted form of "' +
                     asEsc(z) + '" & " -d " & quoted form of "' + asEsc(d) + '"';
            app.doScript(as, ScriptLanguage.APPLESCRIPT_LANGUAGE);
        }
        if (!File(d + "/xl/workbook.xml").exists)
            throw "Das Entpacken der .xlsx ist fehlgeschlagen.";
    }
    function asEsc(s) { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
    function vbStr(s) { return '"' + s.replace(/"/g, '""') + '"'; }

    function parseSharedStrings(xml) {
        var res = [], re = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
        while ((m = re.exec(xml)) !== null) {
            var inner = m[1], t = "", tr = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm;
            while ((tm = tr.exec(inner)) !== null) t += tm[1];
            res.push(entDecode(t));
        }
        return res;
    }

    function blattListe(ziel) {
        var wb = leseText(File(ziel.fsName + "/xl/workbook.xml"));
        var rels = File(ziel.fsName + "/xl/_rels/workbook.xml.rels");
        var relMap = {};
        if (rels.exists) {
            var rt = leseText(rels), rr = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g, rm;
            while ((rm = rr.exec(rt)) !== null) relMap[rm[1]] = rm[2];
            // Target kann auch vor Id stehen — zweiter Durchlauf
            rr = /<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"[^>]*\/?>/g;
            while ((rm = rr.exec(rt)) !== null) relMap[rm[2]] = rm[1];
        }
        var out = [], sr = /<sheet\b[^>]*\/?>/g, sm;
        while ((sm = sr.exec(wb)) !== null) {
            var tag = sm[0];
            var nm = /name="([^"]*)"/.exec(tag), rid = /r:id="([^"]*)"/.exec(tag);
            var name = nm ? entDecode(nm[1]) : ("Blatt " + (out.length + 1));
            var target = rid && relMap[rid[1]] ? relMap[rid[1]] : null;
            if (!target) target = "worksheets/sheet" + (out.length + 1) + ".xml";
            target = target.replace(/^\/?xl\//, "").replace(/^\//, "");
            out.push({ name: name, datei: ziel.fsName + "/xl/" + target });
        }
        if (out.length === 0) {
            var wsf = Folder(ziel.fsName + "/xl/worksheets").getFiles("*.xml");
            for (var i = 0; i < wsf.length; i++) out.push({ name: "Blatt " + (i + 1), datei: wsf[i].fsName });
        }
        return out;
    }

    function parseSheet(xml, ss) {
        var zeilen = [], rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g, rm;
        while ((rm = rowRe.exec(xml)) !== null) {
            var inner = rm[1], zelle = [], cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
            while ((cm = cRe.exec(inner)) !== null) {
                var attr = cm[1], body = cm[2] || "";
                var rAttr = /r="([A-Z]+)\d+"/.exec(attr);
                var sp = rAttr ? spalteNr(rAttr[1]) : zelle.length;
                var tAttr = /t="([^"]+)"/.exec(attr);
                var typ = tAttr ? tAttr[1] : "n";
                var wert = "";
                if (typ === "s") {
                    var v = /<v>([\s\S]*?)<\/v>/.exec(body);
                    if (v) { var idx = parseInt(v[1], 10); wert = (ss[idx] != null) ? ss[idx] : ""; }
                } else if (typ === "inlineStr") {
                    var ir = /<t\b[^>]*>([\s\S]*?)<\/t>/g, im, s = "";
                    while ((im = ir.exec(body)) !== null) s += im[1];
                    wert = entDecode(s);
                } else {
                    var vn = /<v>([\s\S]*?)<\/v>/.exec(body);
                    wert = vn ? entDecode(vn[1]) : "";
                }
                while (zelle.length < sp) zelle.push("");
                zelle[sp] = wert;
            }
            zeilen.push(zelle);
        }
        return zeilen;
    }
    function spalteNr(letters) { var n = 0; for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; }

    function entDecode(s) {
        if (s == null) return "";
        return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
                        .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, function (a, h) { return String.fromCharCode(parseInt(h, 16)); })
                        .replace(/&#(\d+);/g, function (a, d) { return String.fromCharCode(parseInt(d, 10)); })
                        .replace(/&amp;/g, "&");
    }

    // ------------------------------------------------- leere Ränder beschneiden
    function beschneide(roh) {
        var zeilen = [];
        for (var r = 0; r < roh.length; r++) {
            var leer = true;
            for (var c = 0; c < roh[r].length; c++) if (String(roh[r][c]) !== "") { leer = false; break; }
            if (!leer) zeilen.push(roh[r]);
        }
        if (zeilen.length === 0) return zeilen;
        var maxC = 0; for (r = 0; r < zeilen.length; r++) if (zeilen[r].length > maxC) maxC = zeilen[r].length;
        // rechte komplett leere Spalten kappen
        var letzte = -1;
        for (c = 0; c < maxC; c++) {
            var benutzt = false;
            for (r = 0; r < zeilen.length; r++) if (zeilen[r][c] != null && String(zeilen[r][c]) !== "") { benutzt = true; break; }
            if (benutzt) letzte = c;
        }
        var out = [];
        for (r = 0; r < zeilen.length; r++) { var z = []; for (c = 0; c <= letzte; c++) z.push(zeilen[r][c] != null ? zeilen[r][c] : ""); out.push(z); }
        return out;
    }

    // ---------------------------------------------------- Zahl aus Zelle lesen
    function zahl(s) {
        if (s == null) return NaN;
        if (typeof s === "number") return s;
        var t = String(s).replace(/\s/g, "").replace(/[€$£%]/g, "").replace(/ /g, "");
        if (t === "") return NaN;
        // deutsches Format 1.234,56  → 1234.56
        if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
        else if (t.indexOf(",") >= 0 && t.indexOf(".") < 0) t = t.replace(",", ".");
        var n = parseFloat(t);
        return isNaN(n) ? NaN : n;
    }

    // ------------------------------------------------- Zahl deutsch formatieren
    //   dez = Nachkommastellen (Standard 0), einheit = Suffix (z. B. " €", " %")
    function fmt(v, dez, einheit) {
        if (v == null || isNaN(v)) return "";
        if (dez == null) dez = 0;
        var f = Math.pow(10, dez);
        var n = Math.round(v * f) / f, neg = n < 0; n = Math.abs(n);
        var teile = String(n).split("."), gz = teile[0], nk = teile.length > 1 ? teile[1] : "";
        if (dez > 0) { while (nk.length < dez) nk += "0"; nk = nk.substring(0, dez); } else nk = "";
        var out = "", cnt = 0;
        for (var i = gz.length - 1; i >= 0; i--) { out = gz.charAt(i) + out; cnt++; if (cnt % 3 === 0 && i > 0) out = "." + out; }
        if (nk.length) out += "," + nk;
        return (neg ? "-" : "") + out + (einheit ? einheit : "");
    }

    // ------------------------------------------------------------ Achsenteilung
    function niceNum(range, round) {
        if (range <= 0) range = 1;
        var exp = Math.floor(Math.log(range) / Math.LN10), f = range / Math.pow(10, exp), nf;
        if (round) nf = (f < 1.5) ? 1 : (f < 3 ? 2 : (f < 7 ? 5 : 10));
        else nf = (f <= 1) ? 1 : (f <= 2 ? 2 : (f <= 5 ? 5 : 10));
        return nf * Math.pow(10, exp);
    }
    function teilung(min, max, maxTicks) {
        if (min === max) { max = min + 1; }
        var range = niceNum(max - min, false);
        var step = niceNum(range / (maxTicks - 1), true);
        var gmin = Math.floor(min / step) * step, gmax = Math.ceil(max / step) * step;
        var ticks = []; for (var v = gmin; v <= gmax + step * 0.5; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
        return { min: gmin, max: gmax, step: step, ticks: ticks };
    }

    // =========================================================================
    //  Dialoge
    // =========================================================================
    function waehleBlatt(namen) {
        var w = new Window("dialog", "Arbeitsblatt wählen");
        w.alignChildren = "fill";
        w.add("statictext", undefined, "Diese Datei hat mehrere Blätter:");
        var dd = w.add("dropdownlist", undefined, namen); dd.selection = 0; dd.preferredSize.width = 260;
        var f = w.add("group"); f.alignment = "right";
        f.add("button", undefined, "Abbrechen", { name: "cancel" });
        f.add("button", undefined, "Weiter", { name: "ok" });
        if (w.show() !== 1) return -1;
        return dd.selection.index;
    }

    function zeigeDialog(roh, swatchNamen, absFormate, blattName, doc) {
        var TYPEN = ["Säulen", "Balken", "Linie", "Fläche", "Kreis", "Ring", "Punkt (XY)"];

        var w = new Window("dialog", "Diagramm aus Daten");
        w.orientation = "row"; w.alignChildren = "fill";

        // ---- linke Spalte
        var links = w.add("group"); links.orientation = "column"; links.alignChildren = "fill";

        var pD = links.add("panel", undefined, "Daten"); pD.alignChildren = "left"; pD.margins = [12, 16, 12, 10];
        pD.add("statictext", undefined, "Datei: " + datei.name + (blattName ? "  ·  Blatt: " + blattName : ""));
        pD.add("statictext", undefined, "Gefunden: " + roh.length + " Zeilen × " + roh[0].length + " Spalten");
        var cbKopf = pD.add("checkbox", undefined, "Erste Zeile = Namen der Datenreihen"); cbKopf.value = true;
        var cbLabel = pD.add("checkbox", undefined, "Erste Spalte = Beschriftungen / X-Werte"); cbLabel.value = true;

        var pT = links.add("panel", undefined, "Diagramm"); pT.alignChildren = "left"; pT.margins = [12, 16, 12, 10];
        var gTyp = pT.add("group"); gTyp.add("statictext", undefined, "Typ").preferredSize.width = 95;
        var ddTyp = gTyp.add("dropdownlist", undefined, TYPEN); ddTyp.selection = 0; ddTyp.preferredSize.width = 150;
        var cbStack = pT.add("checkbox", undefined, "Gestapelt (Säulen / Balken / Fläche)");
        var cbMark = pT.add("checkbox", undefined, "Linie: Punkte markieren"); cbMark.value = true;

        var gAbst = pT.add("group"); gAbst.add("statictext", undefined, "Säulen-/Balkenabstand").preferredSize.width = 140;
        var ddAbst = gAbst.add("dropdownlist", undefined, ["schmal", "mittel", "breit"]); ddAbst.selection = 1; ddAbst.preferredSize.width = 100;
        var gLst = pT.add("group"); gLst.add("statictext", undefined, "Linienstärke").preferredSize.width = 140;
        var ddLst = gLst.add("dropdownlist", undefined, ["dünn", "normal", "dick"]); ddLst.selection = 1; ddLst.preferredSize.width = 100;
        var gSort = pT.add("group"); gSort.add("statictext", undefined, "Sortierung").preferredSize.width = 140;
        var ddSort = gSort.add("dropdownlist", undefined, ["keine", "größte zuerst", "kleinste zuerst"]); ddSort.selection = 0; ddSort.preferredSize.width = 130;

        var gKrB = pT.add("group"); gKrB.add("statictext", undefined, "Kreis/Ring-Beschriftung").preferredSize.width = 140;
        var ddKrB = gKrB.add("dropdownlist", undefined, ["Prozent", "Wert", "Name", "Name + Prozent", "aus"]); ddKrB.selection = 0; ddKrB.preferredSize.width = 130;
        var gRing = pT.add("group"); gRing.add("statictext", undefined, "Ring-Lochgröße (%)").preferredSize.width = 140;
        var etRing = gRing.add("edittext", undefined, "55"); etRing.preferredSize.width = 50;

        var gTi = pT.add("group"); gTi.add("statictext", undefined, "Titel").preferredSize.width = 95;
        var etTitel = gTi.add("edittext", undefined, ""); etTitel.preferredSize.width = 200;

        var pOpt = links.add("panel", undefined, "Anzeigen"); pOpt.orientation = "column"; pOpt.alignChildren = "left"; pOpt.margins = [12, 16, 12, 10];
        var ocR = pOpt.add("group"); ocR.orientation = "row"; ocR.alignChildren = "top";
        var oc1 = ocR.add("group"); oc1.orientation = "column"; oc1.alignChildren = "left";
        var oc2 = ocR.add("group"); oc2.orientation = "column"; oc2.alignChildren = "left";
        var cbLeg = oc1.add("checkbox", undefined, "Legende"); cbLeg.value = true;
        var cbWerte = oc1.add("checkbox", undefined, "Werte");
        var cbAchse = oc2.add("checkbox", undefined, "Achsen"); cbAchse.value = true;
        var cbGrid = oc2.add("checkbox", undefined, "Gitternetz"); cbGrid.value = true;
        var gLegP = pOpt.add("group"); gLegP.add("statictext", undefined, "Legende").preferredSize.width = 95;
        var ddLegP = gLegP.add("dropdownlist", undefined, ["unten", "oben", "rechts"]); ddLegP.selection = 0; ddLegP.preferredSize.width = 100;
        var gBg = pOpt.add("group"); gBg.add("statictext", undefined, "Hintergrund").preferredSize.width = 95;
        var ddBg = gBg.add("dropdownlist", undefined, ["— ohne —"].concat(swatchNamen)); ddBg.selection = 0; ddBg.preferredSize.width = 150;

        var pA = links.add("panel", undefined, "Achsen & Werte"); pA.alignChildren = "left"; pA.margins = [12, 16, 12, 10];
        var gZf = pA.add("group"); gZf.add("statictext", undefined, "Nachkommastellen").preferredSize.width = 115;
        var ddDez = gZf.add("dropdownlist", undefined, ["0", "1", "2"]); ddDez.selection = 0; ddDez.preferredSize.width = 45;
        gZf.add("statictext", undefined, "Einheit"); var etEinh = gZf.add("edittext", undefined, ""); etEinh.preferredSize.width = 55;
        var gYm = pA.add("group"); gYm.add("statictext", undefined, "Y-Achse von").preferredSize.width = 115;
        var etYmin = gYm.add("edittext", undefined, ""); etYmin.preferredSize.width = 50;
        gYm.add("statictext", undefined, "bis"); var etYmax = gYm.add("edittext", undefined, ""); etYmax.preferredSize.width = 50;
        pA.add("statictext", undefined, "(leer = automatisch)");
        var gAx = pA.add("group"); gAx.add("statictext", undefined, "Achsentitel X").preferredSize.width = 115;
        var etAx = gAx.add("edittext", undefined, ""); etAx.preferredSize.width = 150;
        var gAy = pA.add("group"); gAy.add("statictext", undefined, "Achsentitel Y").preferredSize.width = 115;
        var etAy = gAy.add("edittext", undefined, ""); etAy.preferredSize.width = 150;

        var pG = links.add("panel", undefined, "Größe & Lage"); pG.alignChildren = "left"; pG.margins = [12, 16, 12, 10];
        var seite = aktiveSeite(doc);
        var mp = seite.marginPreferences;
        var pw = doc.documentPreferences.pageWidth, ph = doc.documentPreferences.pageHeight;
        var innerW = (pw - mp.left - mp.right), innerH = (ph - mp.top - mp.bottom);
        var defW = Math.round(innerW / MM), defH = Math.round(Math.min(innerH, innerW * 0.62) / MM);
        var gW = pG.add("group"); gW.add("statictext", undefined, "Breite (mm)"); var etW = gW.add("edittext", undefined, String(defW)); etW.preferredSize.width = 60;
        gW.add("statictext", undefined, "Höhe (mm)"); var etH = gW.add("edittext", undefined, String(defH)); etH.preferredSize.width = 60;

        // ---- rechte Spalte: Farben & Schrift
        var rechts = w.add("group"); rechts.orientation = "column"; rechts.alignChildren = "fill";

        var pF = rechts.add("panel", undefined, "Farben (aus den Farbfeldern)"); pF.alignChildren = "fill"; pF.margins = [12, 16, 12, 10];
        pF.add("statictext", undefined, "Palette (Reihenfolge = Datenreihen):");
        var lb = pF.add("listbox", undefined, [], { multiselect: false }); lb.preferredSize = [230, 120];
        var gAdd = pF.add("group");
        var ddSw = gAdd.add("dropdownlist", undefined, swatchNamen); ddSw.selection = 0; ddSw.preferredSize.width = 150;
        var btAdd = gAdd.add("button", undefined, "+ Hinzufügen");
        var gMove = pF.add("group"); gMove.alignment = "left";
        var btUp = gMove.add("button", undefined, "▲"); var btDn = gMove.add("button", undefined, "▼");
        var btDel = gMove.add("button", undefined, "Entfernen"); var btAuto = gMove.add("button", undefined, "Auto");
        btUp.preferredSize.width = btDn.preferredSize.width = 34;

        function addSw(nm) { var it = lb.add("item", nm); lb.selection = it; }
        btAdd.onClick = function () { if (ddSw.selection) { addSw(ddSw.selection.text); refresh(); } };
        btDel.onClick = function () { if (lb.selection) { lb.remove(lb.selection.index); refresh(); } };
        btUp.onClick = function () { var s = lb.selection; if (!s || s.index === 0) return; var i = s.index, t = lb.items[i].text; lb.remove(i); var it = lb.add("item", t, i - 1); lb.selection = it; refresh(); };
        btDn.onClick = function () { var s = lb.selection; if (!s || s.index >= lb.items.length - 1) return; var i = s.index, t = lb.items[i].text; lb.remove(i); var it = lb.add("item", t, i + 1); lb.selection = it; refresh(); };
        btAuto.onClick = function () {
            while (lb.items.length) lb.remove(0);
            var n = Math.min(swatchNamen.length, 12);
            // möglichst „bunte“ Felder zuerst (keine reinen Prozess-Standards doppelt)
            for (var i = 0; i < n; i++) addSw(swatchNamen[i]);
            refresh();
        };
        btAuto.onClick();   // Startvorschlag

        var pS = rechts.add("panel", undefined, "Schrift (aus den Absatzformaten)"); pS.alignChildren = "left"; pS.margins = [12, 16, 12, 10];
        var gL = pS.add("group"); gL.add("statictext", undefined, "Beschriftungen").preferredSize.width = 95;
        var ddLab = gL.add("dropdownlist", undefined, absFormate); ddLab.selection = 0; ddLab.preferredSize.width = 180;
        var gTt = pS.add("group"); gTt.add("statictext", undefined, "Titel").preferredSize.width = 95;
        var ddTit = gTt.add("dropdownlist", undefined, absFormate); ddTit.selection = (absFormate.length > 1 ? 1 : 0); ddTit.preferredSize.width = 180;
        var gSz = pS.add("group"); gSz.add("statictext", undefined, "Größe überschreiben (pt, optional)").preferredSize.width = 200;
        var etSz = gSz.add("edittext", undefined, ""); etSz.preferredSize.width = 50;

        // =====================================================================
        //  Live-Vorschau (dritte Spalte) — zeichnet mit derselben Daten- und
        //  Achsenlogik wie das fertige Diagramm, nur als Bildschirmgrafik.
        // =====================================================================
        var pv = w.add("group"); pv.orientation = "column"; pv.alignChildren = "fill";
        pv.add("statictext", undefined, "Vorschau");
        var CW = 340, CH = 300;
        var preview = pv.add("panel");
        preview.preferredSize = [CW, CH];
        preview.minimumSize = [CW, CH];
        var pvHint = pv.add("statictext", undefined, "Aktualisiert sich bei jeder Einstellung.");
        pvHint.preferredSize.width = CW;

        function refresh() { try { if (preview) preview.notify("onDraw"); } catch (eR) {} }

        function paletteJetzt() { var p = []; for (var i = 0; i < lb.items.length; i++) p.push(lb.items[i].text); if (p.length === 0) p = [swatchNamen[0]]; return p; }
        function abstandWert() { return ddAbst.selection ? ["schmal", "mittel", "breit"][ddAbst.selection.index] : "mittel"; }
        function lstWert() { return ddLst.selection ? ["dünn", "normal", "dick"][ddLst.selection.index] : "normal"; }
        function sortWert() { return ddSort.selection ? ["keine", "absteigend", "aufsteigend"][ddSort.selection.index] : "keine"; }
        function legPosWert() { return ddLegP.selection ? ["unten", "oben", "rechts"][ddLegP.selection.index] : "unten"; }
        function krBWert() { return ddKrB.selection ? ["prozent", "wert", "name", "nameprozent", "aus"][ddKrB.selection.index] : "prozent"; }
        function ringWert() { var r = parseFloat(etRing.text); return isNaN(r) ? 55 : Math.max(0, Math.min(90, r)); }
        function bgWert() { return (ddBg.selection && ddBg.selection.index > 0) ? ddBg.selection.text : ""; }
        function zahlOderNull(s) { if (s == null) return null; s = String(s).replace(/\s/g, ""); if (s === "") return null; var n = zahl(s); return isNaN(n) ? null : n; }
        function aktuelleOpt() {
            return {
                typ: ddTyp.selection ? ddTyp.selection.text : "Säulen",
                stapel: cbStack.value, marker: cbMark.value,
                kopf: cbKopf.value, labelspalte: cbLabel.value,
                palette: paletteJetzt(),
                abstand: abstandWert(), linienStaerke: lstWert(), sort: sortWert(),
                ringLoch: ringWert(), kreisBeschr: krBWert(), plotBg: bgWert(),
                ymin: zahlOderNull(etYmin.text), ymax: zahlOderNull(etYmax.text)
            };
        }

        // ---- Farbfeld → Bildschirm-RGB (nur für die Vorschau)
        function cmyk2rgb(v) { var c = v[0] / 100, m = v[1] / 100, y = v[2] / 100, k = v[3] / 100; return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]; }
        function lab2rgb(v) {
            var L = v[0], A = v[1], B = v[2];
            var fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
            function fi(t) { var t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; }
            var X = 0.95047 * fi(fx), Y = 1.0 * fi(fy), Z = 1.08883 * fi(fz);
            var r = X * 3.2406 - Y * 1.5372 - Z * 0.4986, g2 = -X * 0.9689 + Y * 1.8758 + Z * 0.0415, b = X * 0.0557 - Y * 0.2040 + Z * 1.0570;
            function gam(u) { u = u < 0 ? 0 : (u > 1 ? 1 : u); return u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055; }
            return [gam(r), gam(g2), gam(b)];
        }
        function swatchRGB(name, tint) {
            var rgb = [0.45, 0.45, 0.45];
            try {
                var sw = doc.swatches.itemByName(name);
                if (sw && sw.isValid) {
                    var sp = null, cv = null;
                    try { sp = sw.space; } catch (e1) {}
                    try { cv = sw.colorValue; } catch (e2) {}
                    if (cv && cv.length) {
                        if (sp === ColorSpace.CMYK || cv.length === 4) rgb = cmyk2rgb(cv);
                        else if (sp === ColorSpace.RGB) rgb = [cv[0] / 255, cv[1] / 255, cv[2] / 255];
                        else if (sp === ColorSpace.LAB) rgb = lab2rgb(cv);
                        else if (cv.length === 3) rgb = (cv[0] > 1 || cv[1] > 1 || cv[2] > 1) ? [cv[0] / 255, cv[1] / 255, cv[2] / 255] : cv;
                    }
                }
            } catch (e) {}
            var t = (tint == null ? 100 : tint) / 100;
            return [1 - (1 - rgb[0]) * t, 1 - (1 - rgb[1]) * t, 1 - (1 - rgb[2]) * t];
        }
        function previewFarben(n) {
            var pal = paletteJetzt(), out = [];
            for (var i = 0; i < n; i++) {
                var basis = pal[i % pal.length], runde = Math.floor(i / pal.length);
                var tint = runde === 0 ? 100 : Math.max(25, 100 - runde * 28);
                out.push(swatchRGB(basis, tint));
            }
            return out;
        }

        // ---- ScriptUIGraphics-Zeichenhelfer (nur x/y, kein rect/ellipsePath wegen Reihenfolge-Fallen)
        function pBr(g, rgb) { return g.newBrush(g.BrushType.SOLID_COLOR, rgb); }
        function pPe(g, rgb, w2) { return g.newPen(g.PenType.SOLID_COLOR, rgb, w2); }
        function pRect(g, br, x, y, w2, h2) { g.newPath(); g.moveTo(x, y); g.lineTo(x + w2, y); g.lineTo(x + w2, y + h2); g.lineTo(x, y + h2); g.closePath(); g.fillPath(br); }
        function pRectS(g, pe, x, y, w2, h2) { g.newPath(); g.moveTo(x, y); g.lineTo(x + w2, y); g.lineTo(x + w2, y + h2); g.lineTo(x, y + h2); g.closePath(); g.strokePath(pe); }
        function pLine(g, pe, x1, y1, x2, y2) { g.newPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokePath(pe); }
        function pPolyF(g, br, pts) { g.newPath(); g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fillPath(br); }
        function pPolyS(g, pe, pts, close) { g.newPath(); g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); if (close) g.closePath(); g.strokePath(pe); }
        function pDot(g, br, cx, cy, r) { var pts = [], N = 20; for (var i = 0; i < N; i++) { var a = i / N * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } pPolyF(g, br, pts); }

        preview.onDraw = function () {
            var g = this.graphics;
            var sz = this.size, CWp = sz[0], CHp = sz[1];
            pRect(g, pBr(g, [0.99, 0.985, 0.975]), 0, 0, CWp, CHp);
            pRectS(g, pPe(g, [0.78, 0.76, 0.72], 1), 0.5, 0.5, CWp - 1, CHp - 1);
            try { zeichneVorschau(g, { x: 14, y: 12, w: CWp - 28, h: CHp - 24 }, aktuelleOpt()); } catch (eD) {}
        };

        function zeichneVorschau(g, A, o) {
            var daten = baueDaten(roh, { kopf: o.kopf, labelspalte: o.labelspalte, sort: o.sort });
            var nK = daten.kategorien.length, nS = daten.serien.length;
            if (nK === 0 || nS === 0) return;
            var achs = pPe(g, [0.55, 0.53, 0.5], 1);
            var maxK = Math.min(nK, 9), maxS = Math.min(nS, 8);
            var gf = o.abstand === "schmal" ? 0.55 : (o.abstand === "breit" ? 0.92 : 0.8);
            var lw = o.linienStaerke === "dünn" ? 1 : (o.linienStaerke === "dick" ? 2.6 : 1.6);
            var mkR = o.linienStaerke === "dick" ? 3.2 : (o.linienStaerke === "dünn" ? 2 : 2.4);
            var bgRGB = (o.plotBg && o.plotBg !== "") ? swatchRGB(o.plotBg, 100) : null;

            // ---- Kreis / Ring
            if (o.typ === "Kreis" || o.typ === "Ring") {
                var werte = daten.serien[0], idxs = [], summe = 0;
                for (var i = 0; i < werte.length; i++) { var v = werte[i]; if (!isNaN(v) && v > 0) { idxs.push(i); summe += v; } }
                if (summe <= 0) return;
                var far = previewFarben(idxs.length);
                var R = Math.min(A.w, A.h) / 2 - 2, cx = A.x + A.w / 2, cy = A.y + A.h / 2;
                var inR = (o.typ === "Ring") ? R * Math.max(0, Math.min(0.9, (o.ringLoch == null ? 55 : o.ringLoch) / 100)) : 0, ang = -Math.PI / 2;
                for (i = 0; i < idxs.length; i++) {
                    var dw = werte[idxs[i]] / summe * Math.PI * 2, steps = Math.max(2, Math.ceil(dw / (Math.PI / 60))), pts = [], a, w1;
                    if (inR > 0) {
                        for (a = 0; a <= steps; a++) { w1 = ang + dw * a / steps; pts.push([cx + R * Math.cos(w1), cy + R * Math.sin(w1)]); }
                        for (a = steps; a >= 0; a--) { w1 = ang + dw * a / steps; pts.push([cx + inR * Math.cos(w1), cy + inR * Math.sin(w1)]); }
                    } else {
                        pts.push([cx, cy]);
                        for (a = 0; a <= steps; a++) { w1 = ang + dw * a / steps; pts.push([cx + R * Math.cos(w1), cy + R * Math.sin(w1)]); }
                    }
                    pPolyF(g, pBr(g, far[i]), pts);
                    ang += dw;
                }
                return;
            }

            // ---- Punkt (XY)
            if (o.typ === "Punkt (XY)") {
                var far2 = previewFarben(maxS);
                var xmin = Infinity, xmax = -Infinity, ymn = Infinity, ymx = -Infinity, k, s;
                for (k = 0; k < nK; k++) { var xw = daten.xWerte[k]; if (!isNaN(xw)) { if (xw < xmin) xmin = xw; if (xw > xmax) xmax = xw; } }
                for (s = 0; s < maxS; s++) for (k = 0; k < nK; k++) { var yw = daten.serien[s][k]; if (!isNaN(yw)) { if (yw < ymn) ymn = yw; if (yw > ymx) ymx = yw; } }
                if (!isFinite(xmin)) { xmin = 0; xmax = 1; } if (!isFinite(ymn)) { ymn = 0; ymx = 1; }
                if (o.ymin != null) ymn = o.ymin; if (o.ymax != null) ymx = o.ymax;
                if (xmax === xmin) xmax = xmin + 1; if (ymx <= ymn) ymx = ymn + 1;
                var Px = { x: A.x + 6, y: A.y + 4, w: A.w - 10, h: A.h - 12 };
                if (bgRGB) pRect(g, pBr(g, bgRGB), Px.x, Px.y, Px.w, Px.h);
                pLine(g, achs, Px.x, Px.y, Px.x, Px.y + Px.h); pLine(g, achs, Px.x, Px.y + Px.h, Px.x + Px.w, Px.y + Px.h);
                for (s = 0; s < maxS; s++) for (k = 0; k < nK; k++) {
                    var xv = daten.xWerte[k], yv = daten.serien[s][k]; if (isNaN(xv) || isNaN(yv)) continue;
                    pDot(g, pBr(g, far2[s]), Px.x + Px.w * (xv - xmin) / (xmax - xmin), Px.y + Px.h * (1 - (yv - ymn) / (ymx - ymn)), 3);
                }
                return;
            }

            // ---- Säulen / Balken / Linie / Fläche
            var istBalken = (o.typ === "Balken"), istLinie = (o.typ === "Linie"), istFlaeche = (o.typ === "Fläche");
            var stapel = o.stapel && !istLinie, fr = previewFarben(maxS);
            var wmin = 0, wmax = 0, kk, ss;
            if (stapel) {
                for (kk = 0; kk < maxK; kk++) { var pos = 0, neg = 0; for (ss = 0; ss < maxS; ss++) { var vv = daten.serien[ss][kk]; if (isNaN(vv)) continue; if (vv >= 0) pos += vv; else neg += vv; } if (pos > wmax) wmax = pos; if (neg < wmin) wmin = neg; }
            } else {
                for (ss = 0; ss < maxS; ss++) for (kk = 0; kk < maxK; kk++) { var v2 = daten.serien[ss][kk]; if (isNaN(v2)) continue; if (v2 > wmax) wmax = v2; if (v2 < wmin) wmin = v2; }
            }
            if (!istLinie && !istFlaeche && wmin > 0) wmin = 0;
            if (wmax === wmin) wmax = wmin + 1;
            if (o.ymin != null) wmin = o.ymin; if (o.ymax != null) wmax = o.ymax;
            if (wmax <= wmin) wmax = wmin + 1;
            var P = { x: A.x + 4, y: A.y + 4, w: A.w - 8, h: A.h - 12 };
            if (bgRGB) pRect(g, pBr(g, bgRGB), P.x, P.y, P.w, P.h);
            var zero = Math.max(wmin, Math.min(0, wmax));

            if (istBalken) {
                var zeroX = P.x + P.w * (zero - wmin) / (wmax - wmin);
                var catH = P.h / maxK, k2, s2;
                for (k2 = 0; k2 < maxK; k2++) {
                    var cyk = P.y + k2 * catH;
                    if (stapel) {
                        var aP = 0, aN = 0;
                        for (s2 = 0; s2 < maxS; s2++) { var sv = daten.serien[s2][k2]; if (isNaN(sv)) continue; var von, bis; if (sv >= 0) { von = aP; bis = aP + sv; aP = bis; } else { von = aN; bis = aN + sv; aN = bis; } var bx = P.x + P.w * (von - wmin) / (wmax - wmin), ex = P.x + P.w * (bis - wmin) / (wmax - wmin); pRect(g, pBr(g, fr[s2]), Math.min(bx, ex), cyk + catH * (1 - gf) / 2, Math.abs(ex - bx), catH * gf); }
                    } else {
                        var bh = catH * gf / maxS;
                        for (s2 = 0; s2 < maxS; s2++) { var v3 = daten.serien[s2][k2]; if (isNaN(v3)) continue; var xv2 = P.x + P.w * (v3 - wmin) / (wmax - wmin), top = cyk + catH * (1 - gf) / 2 + s2 * bh; pRect(g, pBr(g, fr[s2]), Math.min(zeroX, xv2), top, Math.abs(xv2 - zeroX), bh * 0.88); }
                    }
                }
                pLine(g, achs, zeroX, P.y, zeroX, P.y + P.h);
            } else {
                var zeroY = P.y + P.h * (1 - (zero - wmin) / (wmax - wmin));
                var catW = P.w / maxK, k3, s3;
                if (istLinie || istFlaeche) {
                    var akk = []; for (k3 = 0; k3 < maxK; k3++) akk.push(0);
                    for (s3 = 0; s3 < maxS; s3++) {
                        var pk = [], unten = [];
                        for (k3 = 0; k3 < maxK; k3++) {
                            var cxp = P.x + (k3 + 0.5) * catW, val = daten.serien[s3][k3]; if (isNaN(val)) val = 0; var yy;
                            if (istFlaeche && stapel) { var ba = akk[k3]; akk[k3] = ba + val; yy = P.y + P.h * (1 - (akk[k3] - wmin) / (wmax - wmin)); unten.push([cxp, P.y + P.h * (1 - (ba - wmin) / (wmax - wmin))]); }
                            else yy = P.y + P.h * (1 - (val - wmin) / (wmax - wmin));
                            pk.push([cxp, yy]);
                        }
                        if (istFlaeche) {
                            var poly = pk.slice(0);
                            if (stapel) { for (var u = unten.length - 1; u >= 0; u--) poly.push(unten[u]); }
                            else { poly.push([P.x + (maxK - 0.5) * catW, zeroY]); poly.push([P.x + 0.5 * catW, zeroY]); }
                            var fc = fr[s3], lite = [1 - (1 - fc[0]) * 0.5, 1 - (1 - fc[1]) * 0.5, 1 - (1 - fc[2]) * 0.5];
                            pPolyF(g, pBr(g, stapel ? fc : lite), poly);
                            pPolyS(g, pPe(g, fc, lw * 0.9), pk, false);
                        } else {
                            pPolyS(g, pPe(g, fr[s3], lw), pk, false);
                            if (o.marker) for (k3 = 0; k3 < maxK; k3++) pDot(g, pBr(g, fr[s3]), pk[k3][0], pk[k3][1], mkR);
                        }
                    }
                    pLine(g, achs, P.x, zeroY, P.x + P.w, zeroY);
                } else {
                    for (k3 = 0; k3 < maxK; k3++) {
                        var cxb = P.x + k3 * catW;
                        if (stapel) {
                            var p2 = 0, n2 = 0;
                            for (s3 = 0; s3 < maxS; s3++) { var sv2 = daten.serien[s3][k3]; if (isNaN(sv2)) continue; var vo, bi; if (sv2 >= 0) { vo = p2; bi = p2 + sv2; p2 = bi; } else { vo = n2; bi = n2 + sv2; n2 = bi; } var y1 = P.y + P.h * (1 - (vo - wmin) / (wmax - wmin)), y2 = P.y + P.h * (1 - (bi - wmin) / (wmax - wmin)); pRect(g, pBr(g, fr[s3]), cxb + catW * (1 - gf) / 2, Math.min(y1, y2), catW * gf, Math.abs(y2 - y1)); }
                        } else {
                            var grW = catW * gf, bw = grW / maxS;
                            for (s3 = 0; s3 < maxS; s3++) { var v5 = daten.serien[s3][k3]; if (isNaN(v5)) continue; var bl = cxb + catW * (1 - gf) / 2 + s3 * bw, yv5 = P.y + P.h * (1 - (v5 - wmin) / (wmax - wmin)); pRect(g, pBr(g, fr[s3]), bl, Math.min(zeroY, yv5), bw * 0.9, Math.abs(yv5 - zeroY)); }
                        }
                    }
                    pLine(g, achs, P.x, zeroY, P.x + P.w, zeroY);
                }
            }
        }

        // ---- Steuerelemente an die Vorschau koppeln
        ddTyp.onChange = function () { refresh(); };
        cbStack.onClick = function () { refresh(); };
        cbMark.onClick = function () { refresh(); };
        cbKopf.onClick = function () { refresh(); };
        cbLabel.onClick = function () { refresh(); };
        ddAbst.onChange = function () { refresh(); };
        ddLst.onChange = function () { refresh(); };
        ddSort.onChange = function () { refresh(); };
        ddLegP.onChange = function () { refresh(); };
        ddBg.onChange = function () { refresh(); };
        ddKrB.onChange = function () { refresh(); };
        etRing.onChange = function () { refresh(); };
        etYmin.onChange = function () { refresh(); };
        etYmax.onChange = function () { refresh(); };

        var fuss = rechts.add("group"); fuss.alignment = "right";
        fuss.add("button", undefined, "Abbrechen", { name: "cancel" });
        fuss.add("button", undefined, "Erzeugen", { name: "ok" });

        if (w.show() !== 1) return null;

        var palette = []; for (var i = 0; i < lb.items.length; i++) palette.push(lb.items[i].text);
        if (palette.length === 0) palette = [swatchNamen[0]];

        return {
            typ: ddTyp.selection.text,
            stapel: cbStack.value,
            marker: cbMark.value,
            titel: etTitel.text,
            kopf: cbKopf.value,
            labelspalte: cbLabel.value,
            legende: cbLeg.value,
            werte: cbWerte.value,
            achsen: cbAchse.value,
            gitter: cbGrid.value,
            breite: Math.max(30, (parseFloat(etW.text) || defW)) * MM,
            hoehe: Math.max(30, (parseFloat(etH.text) || defH)) * MM,
            palette: palette,
            labelFormat: absFormate[ddLab.selection.index],
            titelFormat: absFormate[ddTit.selection.index],
            groesse: (etSz.text !== "" && !isNaN(parseFloat(etSz.text))) ? parseFloat(etSz.text) : null,
            abstand: abstandWert(),
            linienStaerke: lstWert(),
            sort: sortWert(),
            legPos: legPosWert(),
            plotBg: bgWert(),
            ringLoch: ringWert(),
            kreisBeschr: krBWert(),
            dez: ddDez.selection ? ddDez.selection.index : 0,
            einheit: etEinh.text || "",
            ymin: zahlOderNull(etYmin.text),
            ymax: zahlOderNull(etYmax.text),
            achseX: etAx.text || "",
            achseY: etAy.text || ""
        };
    }

    function aktiveSeite(doc) {
        try { return app.activeWindow.activePage; } catch (e) {}
        return doc.pages.item(0);
    }

    // =========================================================================
    //  Zeichnen
    // =========================================================================
    function zeichne(doc, roh, opt, MM) {
        var vp = doc.viewPreferences;
        var altH = vp.horizontalMeasurementUnits, altV = vp.verticalMeasurementUnits, altR = vp.rulerOrigin;
        vp.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        vp.verticalMeasurementUnits = MeasurementUnits.POINTS;
        vp.rulerOrigin = RulerOrigin.PAGE_ORIGIN;

        var made = [];
        try {
            var seite = aktiveSeite(doc);
            var schicht = doc.activeLayer;
            var mp = seite.marginPreferences;
            var x0 = mp.left, y0 = mp.top, W = opt.breite, H = opt.hoehe;

            // Daten aufbereiten
            var daten = baueDaten(roh, opt);
            if (daten.serien.length === 0 || daten.kategorien.length === 0) { alert("Zu wenig auswertbare Zahlen in der Datei."); return; }

            // Schriftgrößen
            var labStyle = holeStil(doc, opt.labelFormat), titStyle = holeStil(doc, opt.titelFormat);
            var labSize = opt.groesse ? opt.groesse : stilGroesse(labStyle, 9);
            var titSize = stilGroesse(titStyle, labSize * 1.6);

            // Palette-Objekte (Swatch + Tönung) für n Serien
            var farben = baueFarben(doc, opt.palette, Math.max(daten.serien.length, (opt.typ === "Kreis" || opt.typ === "Ring") ? daten.kategorien.length : 1));

            var ctx = {
                doc: doc, seite: seite, schicht: schicht, made: made,
                x0: x0, y0: y0, W: W, H: H,
                labStyle: labStyle, titStyle: titStyle, labSize: labSize, titSize: titSize,
                farben: farben, opt: opt, daten: daten
            };

            // Titel oben
            var oben = 0;
            if (opt.titel && opt.titel !== "") {
                var tf = textRahmen(ctx, x0, y0, W, titSize * 1.5, opt.titel, titStyle, null, Justification.CENTER_ALIGN, titSize);
                oben = titSize * 1.9;
            }

            // Legende — Höhe/Breite vorab berechnen (Position: unten / oben / rechts)
            var legPos = opt.legPos || "unten";
            var legNamen = (opt.typ === "Kreis" || opt.typ === "Ring") ? daten.kategorien : daten.serienNamen;
            var legInfo = null, legH = 0, legW = 0, legVert = false;
            if (opt.legende && legNamen.length > 0) {
                if (legPos === "rechts") { legVert = true; legInfo = legendeLayoutV(legNamen, labSize); legW = legInfo.width + 8; }
                else { legInfo = legendeLayout(legNamen, W, labSize); legH = legInfo.height + 4; }
            }
            var obenLeg = (legPos === "oben") ? legH : 0;
            var untenLeg = (legPos === "unten") ? legH : 0;

            var plot = { x: x0, y: y0 + oben + obenLeg, w: W - legW, h: H - oben - obenLeg - untenLeg };

            if (opt.typ === "Kreis" || opt.typ === "Ring")
                zeichneKreis(ctx, plot, opt.typ === "Ring");
            else if (opt.typ === "Punkt (XY)")
                zeichnePunkt(ctx, plot);
            else
                zeichneKartesisch(ctx, plot);   // Säulen, Balken, Linie, Fläche

            if (legInfo) {
                if (legVert) zeichneLegendeV(ctx, legInfo, x0 + W - legW + 2, plot.y, legNamen);
                else { var ly = (legPos === "oben") ? (y0 + oben) : (y0 + H - legH + 4); zeichneLegende(ctx, legInfo, x0, ly, legNamen); }
            }

            // alles gruppieren
            if (made.length > 1) { try { var g = seite.groups.add(made); g.name = "Diagramm"; } catch (eg) {} }
        } finally {
            vp.horizontalMeasurementUnits = altH; vp.verticalMeasurementUnits = altV; vp.rulerOrigin = altR;
        }
    }

    // ---- Rohdaten → { serienNamen[], kategorien[], serien[ [zahlen...] ], xWerte[] }
    function baueDaten(roh, opt) {
        var r0 = opt.kopf ? 1 : 0, c0 = opt.labelspalte ? 1 : 0;
        var nCols = roh[0].length;
        var serienNamen = [];
        for (var c = c0; c < nCols; c++) serienNamen.push(opt.kopf ? String(roh[0][c] || ("Reihe " + (c - c0 + 1))) : ("Reihe " + (c - c0 + 1)));
        var kategorien = [], serien = [], xWerte = [];
        for (var s = 0; s < serienNamen.length; s++) serien.push([]);
        for (var r = r0; r < roh.length; r++) {
            var zeile = roh[r];
            kategorien.push(opt.labelspalte ? String(zeile[0] != null ? zeile[0] : "") : String(kategorien.length + 1));
            xWerte.push(opt.labelspalte ? zahl(zeile[0]) : (kategorien.length));
            for (var sc = 0; sc < serienNamen.length; sc++) serien[sc].push(zahl(zeile[c0 + sc]));
        }
        // Optional: Kategorien nach Summe aller Reihen sortieren
        if (opt.sort && opt.sort !== "keine") {
            var ord = [];
            for (var ii = 0; ii < kategorien.length; ii++) {
                var sum = 0; for (var jj = 0; jj < serien.length; jj++) { var vv = serien[jj][ii]; if (!isNaN(vv)) sum += vv; }
                ord.push({ i: ii, s: sum });
            }
            ord.sort(function (a, b) { return opt.sort === "aufsteigend" ? a.s - b.s : b.s - a.s; });
            var nk2 = [], nx = [], ns = []; for (jj = 0; jj < serien.length; jj++) ns.push([]);
            for (ii = 0; ii < ord.length; ii++) { var src = ord[ii].i; nk2.push(kategorien[src]); nx.push(xWerte[src]); for (jj = 0; jj < serien.length; jj++) ns[jj].push(serien[jj][src]); }
            kategorien = nk2; xWerte = nx; serien = ns;
        }
        return { serienNamen: serienNamen, kategorien: kategorien, serien: serien, xWerte: xWerte };
    }

    function holeStil(doc, name) { try { var st = doc.paragraphStyles.itemByName(name); if (st.isValid) return st; } catch (e) {}
        var alle = doc.allParagraphStyles; for (var i = 0; i < alle.length; i++) if (String(alle[i].name) === name) return alle[i]; return null; }
    function stilGroesse(st, fallback) { try { var s = st.pointSize; if (typeof s === "number" && s > 0) return s; } catch (e) {} return fallback; }

    function swatch(doc, name) { var sw = doc.swatches.itemByName(name); return sw.isValid ? sw : schwarz(doc); }
    function baueFarben(doc, palette, n) {
        var out = [];
        for (var i = 0; i < n; i++) {
            var basis = palette[i % palette.length];
            var runde = Math.floor(i / palette.length);
            var toen = runde === 0 ? 100 : Math.max(25, 100 - runde * 28);
            out.push({ sw: swatch(doc, basis), tint: toen });
        }
        return out;
    }

    // ---- Objekt-Helfer
    // Standard-Farbfelder heißen je nach Umgebung „None/Black“ oder „[Ohne]/[Schwarz]“.
    // Niemals eine ungültige Referenz zuweisen — das lässt InDesign hängen.
    function nrm(s) { return String(s).replace(/[\[\]]/g, "").toLowerCase(); }
    function findeFarbfeld(doc, kandidaten) {
        var set = {}; for (var i = 0; i < kandidaten.length; i++) set[kandidaten[i]] = 1;
        for (i = 0; i < doc.swatches.length; i++) { var sw = doc.swatches[i]; try { if (sw.isValid && set[nrm(sw.name)]) return sw; } catch (e) {} }
        return null;
    }
    function keineFarbe(doc) { var f = findeFarbfeld(doc, ["none", "ohne"]); return f ? f : doc.swatches.item(0); }
    function schwarz(doc) {
        var f = findeFarbfeld(doc, ["black", "schwarz"]);
        if (!f) { for (var i = 0; i < doc.colors.length; i++) { var c = doc.colors[i]; try { if (c.isValid && c.space === ColorSpace.CMYK) { var v = c.colorValue; if (v[0] === 0 && v[1] === 0 && v[2] === 0 && v[3] >= 100) { f = c; break; } } } catch (e) {} } }
        if (!f) { try { f = doc.colors.add(); f.name = "dwb Schwarz"; f.model = ColorModel.PROCESS; f.space = ColorSpace.CMYK; f.colorValue = [0, 0, 0, 100]; } catch (e2) { f = doc.swatches.item(doc.swatches.length - 1); } }
        return f;
    }

    function rechteck(ctx, top, left, breite, hoehe, farbe) {
        if (hoehe < 0) { top += hoehe; hoehe = -hoehe; }
        if (breite < 0) { left += breite; breite = -breite; }
        var r = ctx.seite.rectangles.add(ctx.schicht);
        r.geometricBounds = [top, left, top + hoehe, left + breite];
        r.strokeWeight = 0; r.strokeColor = keineFarbe(ctx.doc);
        if (farbe) { r.fillColor = farbe.sw; try { r.fillTint = farbe.tint; } catch (e) {} } else r.fillColor = keineFarbe(ctx.doc);
        ctx.made.push(r); return r;
    }
    function linie(ctx, punkte, farbe, staerke) {
        var gl = ctx.seite.graphicLines.add(ctx.schicht);
        gl.paths[0].entirePath = punkte;
        gl.fillColor = keineFarbe(ctx.doc);
        gl.strokeColor = farbe ? farbe.sw : schwarz(ctx.doc);
        try { if (farbe) gl.strokeTint = farbe.tint; } catch (e) {}
        gl.strokeWeight = staerke;
        ctx.made.push(gl); return gl;
    }
    function polygonPfad(ctx, punkte, farbe, tintOverride) {
        var p = ctx.seite.polygons.add(ctx.schicht);
        p.paths[0].entirePath = punkte;
        p.strokeWeight = 0; p.strokeColor = keineFarbe(ctx.doc);
        p.fillColor = farbe.sw; try { p.fillTint = (tintOverride != null ? tintOverride : farbe.tint); } catch (e) {}
        ctx.made.push(p); return p;
    }
    function oval(ctx, cx, cy, rad, farbe, rahmen) {
        var o = ctx.seite.ovals.add(ctx.schicht);
        o.geometricBounds = [cy - rad, cx - rad, cy + rad, cx + rad];
        if (rahmen) { o.fillColor = keineFarbe(ctx.doc); o.strokeColor = farbe.sw; try { o.strokeTint = farbe.tint; } catch (e) {} o.strokeWeight = rahmen; }
        else { o.strokeWeight = 0; o.strokeColor = keineFarbe(ctx.doc); o.fillColor = farbe.sw; try { o.fillTint = farbe.tint; } catch (e) {} }
        ctx.made.push(o); return o;
    }

    function textRahmen(ctx, left, top, breite, hoehe, text, stil, farbe, ausricht, groesse, vzent) {
        var tf = ctx.seite.textFrames.add(ctx.schicht);
        tf.geometricBounds = [top, left, top + hoehe, left + breite];
        var tp = tf.textFramePreferences;
        tp.insetSpacing = [0, 0, 0, 0];
        tp.ignoreWrap = true;
        tp.verticalJustification = vzent ? VerticalJustification.CENTER_ALIGN : VerticalJustification.TOP_ALIGN;
        tf.contents = String(text);
        var t = tf.texts[0];
        if (stil) t.appliedParagraphStyle = stil;
        try { if (groesse) t.pointSize = groesse; } catch (e) {}
        if (ausricht) t.justification = ausricht;
        if (farbe) { t.fillColor = farbe.sw; try { t.fillTint = farbe.tint; } catch (e3) {} }
        ctx.made.push(tf); return tf;
    }

    // ---- Legende
    function legendeLayout(namen, availW, size) {
        var rowH = size * 1.6, box = size, items = [], x = 0, row = 0;
        for (var i = 0; i < namen.length; i++) {
            var w = box + 3 + schaetzBreite(namen[i], size) + 14;
            if (x + w > availW && x > 0) { row++; x = 0; }
            items.push({ name: namen[i], x: x, row: row, w: w });
            x += w;
        }
        return { items: items, rows: row + 1, rowH: rowH, box: box, height: (row + 1) * rowH };
    }
    function schaetzBreite(s, size) { return String(s).length * size * 0.56; }

    function zeichneLegende(ctx, info, x0, y0, namen) {
        var size = ctx.labSize, box = info.box;
        for (var i = 0; i < info.items.length; i++) {
            var it = info.items[i];
            var ty = y0 + it.row * info.rowH;
            rechteck(ctx, ty + (info.rowH - box) * 0.3, x0 + it.x, box, box, ctx.farben[i % ctx.farben.length]);
            textRahmen(ctx, x0 + it.x + box + 3, ty, it.w - box - 3, info.rowH, it.name, ctx.labStyle, null, Justification.LEFT_ALIGN, size, true);
        }
    }

    // ---- Legende senkrecht (Position „rechts“)
    function legendeLayoutV(namen, size) {
        var rowH = size * 1.6, box = size, maxW = 0, items = [];
        for (var i = 0; i < namen.length; i++) { var tw = box + 3 + schaetzBreite(namen[i], size); if (tw > maxW) maxW = tw; items.push({ name: namen[i] }); }
        return { items: items, rowH: rowH, box: box, width: maxW + 4, height: namen.length * rowH };
    }
    function zeichneLegendeV(ctx, info, x0, y0, namen) {
        var size = ctx.labSize, box = info.box;
        for (var i = 0; i < info.items.length; i++) {
            var ty = y0 + i * info.rowH;
            rechteck(ctx, ty + (info.rowH - box) * 0.3, x0, box, box, ctx.farben[i % ctx.farben.length]);
            textRahmen(ctx, x0 + box + 3, ty, info.width - box - 3, info.rowH, info.items[i].name, ctx.labStyle, null, Justification.LEFT_ALIGN, size, true);
        }
    }

    // ---- Kartesisch: Säulen / Balken / Linie / Fläche
    function zeichneKartesisch(ctx, plot) {
        var opt = ctx.opt, d = ctx.daten, nS = d.serien.length, nK = d.kategorien.length;
        var istBalken = (opt.typ === "Balken");
        var istLinie = (opt.typ === "Linie");
        var istFlaeche = (opt.typ === "Fläche");
        var stapel = opt.stapel && !istLinie;

        var DZ = (opt.dez == null ? 0 : opt.dez), EH = (opt.einheit == null ? "" : opt.einheit);
        var gf = opt.abstand === "schmal" ? 0.55 : (opt.abstand === "breit" ? 0.92 : 0.8);   // Gruppenbreite-Anteil
        var lw = opt.linienStaerke === "dünn" ? 1 : (opt.linienStaerke === "dick" ? 2.6 : 1.6);
        var mkR = opt.linienStaerke === "dick" ? 3.2 : (opt.linienStaerke === "dünn" ? 2 : 2.4);

        // Wertebereich bestimmen
        var wmin = 0, wmax = 0, hatNeg = false;
        if (stapel) {
            for (var k = 0; k < nK; k++) { var pos = 0, neg = 0; for (var s = 0; s < nS; s++) { var v = d.serien[s][k]; if (isNaN(v)) continue; if (v >= 0) pos += v; else neg += v; } if (pos > wmax) wmax = pos; if (neg < wmin) { wmin = neg; hatNeg = true; } }
        } else {
            for (var s2 = 0; s2 < nS; s2++) for (var k2 = 0; k2 < nK; k2++) { var v2 = d.serien[s2][k2]; if (isNaN(v2)) continue; if (v2 > wmax) wmax = v2; if (v2 < wmin) { wmin = v2; hatNeg = true; } }
        }
        if (!istLinie && !istFlaeche) { if (!hatNeg) wmin = 0; } // Balken/Säulen immer ab 0
        if (wmax === wmin) wmax = wmin + 1;
        // Manuelle Y-Achsengrenzen (leer = automatisch)
        var vonW = (opt.ymin != null) ? opt.ymin : wmin, bisW = (opt.ymax != null) ? opt.ymax : wmax;
        if (bisW <= vonW) bisW = vonW + 1;
        var ax = teilung(vonW, bisW, 6);
        wmin = (opt.ymin != null) ? opt.ymin : ax.min;
        wmax = (opt.ymax != null) ? opt.ymax : Math.max(ax.max, wmin + ax.step);
        var vTicks = []; for (var tz = 0; tz < ax.ticks.length; tz++) { var tv = ax.ticks[tz]; if (tv >= wmin - 1e-9 && tv <= wmax + 1e-9) vTicks.push(tv); }
        if (vTicks.length < 2) vTicks = [wmin, wmax];

        // Platz für Beschriftungen reservieren
        var labSize = ctx.labSize;
        var tickLabels = []; for (var t = 0; t < vTicks.length; t++) tickLabels.push(fmt(vTicks[t], DZ, EH));
        var maxTickW = 0; for (t = 0; t < tickLabels.length; t++) { var bw = schaetzBreite(tickLabels[t], labSize); if (bw > maxTickW) maxTickW = bw; }
        var maxKatW = 0; for (k = 0; k < nK; k++) { var kw = schaetzBreite(d.kategorien[k], labSize); if (kw > maxKatW) maxKatW = kw; }

        var ytW = (opt.achseY && opt.achseY !== "") ? labSize * 1.6 : 0;   // Platz für Y-Achsentitel (gedreht)
        var xtH = (opt.achseX && opt.achseX !== "") ? labSize * 1.6 : 0;   // Platz für X-Achsentitel

        var P;
        if (istBalken) {
            var leftRes = Math.min(plot.w * 0.4, maxKatW + 8) + ytW;
            var botRes = labSize * 1.8 + xtH;
            P = { x: plot.x + leftRes, y: plot.y + 2, w: plot.w - leftRes - 4, h: plot.h - botRes - 2 };
        } else {
            var leftRes2 = Math.min(plot.w * 0.4, maxTickW + 8) + ytW;
            var botRes2 = labSize * 1.8 + xtH;
            P = { x: plot.x + leftRes2, y: plot.y + 2, w: plot.w - leftRes2 - 4, h: plot.h - botRes2 - 2 };
        }
        if (P.w < 20 || P.h < 20) { alert("Die gewählte Größe ist zu klein für die Beschriftungen."); }

        var doc = ctx.doc, gridFarbe = { sw: schwarz(doc), tint: 15 }, achsFarbe = { sw: schwarz(doc), tint: 100 };

        // Plot-Hintergrundfläche (hinter allem)
        if (opt.plotBg && opt.plotBg !== "") { var bgSw = doc.swatches.itemByName(opt.plotBg); if (bgSw.isValid) rechteck(ctx, P.y, P.x, P.w, P.h, { sw: bgSw, tint: 100 }); }

        // Skalenfunktion
        function vWert(v) { return (v - wmin) / (wmax - wmin); }

        if (istBalken) {
            // Werteachse = X (links→rechts), Kategorien = Y (oben→unten)
            function xOf(v) { return P.x + P.w * vWert(v); }
            var nullX = xOf(Math.max(wmin, Math.min(0, wmax)));
            for (t = 0; t < vTicks.length; t++) {
                var gx = xOf(vTicks[t]);
                if (opt.gitter) linie(ctx, [[gx, P.y], [gx, P.y + P.h]], gridFarbe, 0.5);
                if (opt.achsen) textRahmen(ctx, gx - 30, P.y + P.h + 2, 60, labSize * 1.5, tickLabels[t], ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false);
            }
            var catH = P.h / nK;
            for (k = 0; k < nK; k++) {
                var cy = P.y + k * catH;
                if (opt.achsen) textRahmen(ctx, plot.x + ytW, cy, P.x - plot.x - ytW - 4, catH, d.kategorien[k], ctx.labStyle, achsFarbe, Justification.RIGHT_ALIGN, labSize, true);
                if (stapel) {
                    var accP = 0, accN = 0;
                    for (s = 0; s < nS; s++) {
                        var vv = d.serien[s][k]; if (isNaN(vv)) continue;
                        var von, bis;
                        if (vv >= 0) { von = accP; bis = accP + vv; accP = bis; } else { von = accN; bis = accN + vv; accN = bis; }
                        var bx = xOf(von), ex = xOf(bis);
                        rechteck(ctx, cy + catH * (1 - gf) / 2, Math.min(bx, ex), Math.abs(ex - bx), catH * gf, ctx.farben[s]);
                    }
                    if (opt.werte) { var sum = 0, any = false; for (s = 0; s < nS; s++) if (!isNaN(d.serien[s][k])) { sum += d.serien[s][k]; any = true; } if (any) textRahmen(ctx, xOf(Math.max(0, sum)) + 3, cy, 80, catH, fmt(sum, DZ, EH), ctx.labStyle, achsFarbe, Justification.LEFT_ALIGN, labSize, true); }
                } else {
                    var barH = catH * gf / nS;
                    for (s = 0; s < nS; s++) {
                        var v3 = d.serien[s][k]; if (isNaN(v3)) continue;
                        var top = cy + catH * (1 - gf) / 2 + s * barH;
                        var xv = xOf(v3);
                        rechteck(ctx, top, Math.min(nullX, xv), Math.abs(xv - nullX), barH * 0.9, ctx.farben[s]);
                        if (opt.werte) textRahmen(ctx, xv + (v3 >= 0 ? 3 : -63), top - labSize * 0.1, 60, barH, fmt(v3, DZ, EH), ctx.labStyle, achsFarbe, (v3 >= 0 ? Justification.LEFT_ALIGN : Justification.RIGHT_ALIGN), labSize, true);
                    }
                }
            }
            if (opt.achsen) { linie(ctx, [[nullX, P.y], [nullX, P.y + P.h]], achsFarbe, 0.75); linie(ctx, [[P.x, P.y + P.h], [P.x + P.w, P.y + P.h]], achsFarbe, 0.75); }

        } else {
            // Werteachse = Y (unten→oben), Kategorien = X
            function yOf(v) { return P.y + P.h * (1 - vWert(v)); }
            var nullY = yOf(Math.max(wmin, Math.min(0, wmax)));
            for (t = 0; t < vTicks.length; t++) {
                var gy = yOf(vTicks[t]);
                if (opt.gitter) linie(ctx, [[P.x, gy], [P.x + P.w, gy]], gridFarbe, 0.5);
                if (opt.achsen) textRahmen(ctx, plot.x + ytW, gy - labSize * 0.6, P.x - plot.x - ytW - 4, labSize * 1.3, tickLabels[t], ctx.labStyle, achsFarbe, Justification.RIGHT_ALIGN, labSize, true);
            }
            var catW = P.w / nK;
            if (opt.achsen) for (k = 0; k < nK; k++) textRahmen(ctx, P.x + k * catW, P.y + P.h + 2, catW, labSize * 1.6, d.kategorien[k], ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false);

            if (istLinie || istFlaeche) {
                // Flächen / Linien je Serie
                var stapelAkk = []; for (k = 0; k < nK; k++) stapelAkk.push(0);
                for (s = 0; s < nS; s++) {
                    var pkte = [], unten = [];
                    for (k = 0; k < nK; k++) {
                        var cx = P.x + (k + 0.5) * catW;
                        var val = d.serien[s][k]; if (isNaN(val)) val = 0;
                        var yv;
                        if (istFlaeche && stapel) { var basis = stapelAkk[k]; stapelAkk[k] = basis + val; yv = yOf(stapelAkk[k]); unten.push([cx, yOf(basis)]); }
                        else yv = yOf(val);
                        pkte.push([cx, yv]);
                    }
                    if (istFlaeche) {
                        var poly = pkte.slice(0);
                        if (stapel) { for (var u = unten.length - 1; u >= 0; u--) poly.push(unten[u]); }
                        else { poly.push([P.x + (nK - 0.5) * catW, nullY]); poly.push([P.x + 0.5 * catW, nullY]); }
                        polygonPfad(ctx, poly, ctx.farben[s], (stapel ? ctx.farben[s].tint : Math.min(ctx.farben[s].tint, 55)));
                        linie(ctx, pkte, ctx.farben[s], lw * 0.8);
                    } else {
                        linie(ctx, pkte, ctx.farben[s], lw);
                        if (opt.marker) for (k = 0; k < nK; k++) oval(ctx, pkte[k][0], pkte[k][1], mkR, ctx.farben[s], 0);
                    }
                    if (opt.werte) for (k = 0; k < nK; k++) { var vl = d.serien[s][k]; if (isNaN(vl)) continue; textRahmen(ctx, pkte[k][0] - 30, pkte[k][1] - labSize * 1.5, 60, labSize * 1.3, fmt(vl, DZ, EH), ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false); }
                }
            } else {
                // Säulen
                for (k = 0; k < nK; k++) {
                    var cxb = P.x + k * catW;
                    if (stapel) {
                        var aP = 0, aN = 0;
                        for (s = 0; s < nS; s++) {
                            var sv = d.serien[s][k]; if (isNaN(sv)) continue;
                            var vo, bi;
                            if (sv >= 0) { vo = aP; bi = aP + sv; aP = bi; } else { vo = aN; bi = aN + sv; aN = bi; }
                            var yv1 = yOf(vo), yv2 = yOf(bi);
                            rechteck(ctx, Math.min(yv1, yv2), cxb + catW * (1 - gf) / 2, catW * gf, Math.abs(yv2 - yv1), ctx.farben[s]);
                        }
                        if (opt.werte) { var su = 0, an = false; for (s = 0; s < nS; s++) if (!isNaN(d.serien[s][k])) { su += d.serien[s][k]; an = true; } if (an) textRahmen(ctx, cxb, yOf(Math.max(0, su)) - labSize * 1.4, catW, labSize * 1.3, fmt(su, DZ, EH), ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false); }
                    } else {
                        var grW = catW * gf, bw = grW / nS;
                        for (s = 0; s < nS; s++) {
                            var v5 = d.serien[s][k]; if (isNaN(v5)) continue;
                            var bl = cxb + catW * (1 - gf) / 2 + s * bw;
                            var yy = yOf(v5);
                            rechteck(ctx, Math.min(nullY, yy), bl, bw * 0.92, Math.abs(yy - nullY), ctx.farben[s]);
                            if (opt.werte) textRahmen(ctx, bl - 8, (v5 >= 0 ? yy - labSize * 1.35 : yy + 2), bw + 16, labSize * 1.3, fmt(v5, DZ, EH), ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false);
                        }
                    }
                }
            }
            if (opt.achsen) { linie(ctx, [[P.x, P.y], [P.x, P.y + P.h]], achsFarbe, 0.75); linie(ctx, [[P.x, nullY], [P.x + P.w, nullY]], achsFarbe, 0.75); }
        }

        // Achsentitel
        if (xtH > 0) textRahmen(ctx, P.x, plot.y + plot.h - labSize * 1.3, P.w, labSize * 1.3, opt.achseX, ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false);
        if (ytW > 0) { var yt = textRahmen(ctx, plot.x + labSize * 0.75 - P.h / 2, P.y + P.h / 2 - labSize * 0.65, P.h, labSize * 1.3, opt.achseY, ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false); try { yt.rotationAngle = -90; } catch (eRot) {} }
    }

    // ---- Kreis / Ring
    function zeichneKreis(ctx, plot, ring) {
        var d = ctx.daten, werte = d.serien[0], kat = d.kategorien;
        var summe = 0, gueltig = [];
        for (var i = 0; i < werte.length; i++) { var v = werte[i]; if (!isNaN(v) && v > 0) { summe += v; gueltig.push(i); } }
        if (summe <= 0) { alert("Für Kreis/Ring werden positive Werte in der ersten Datenreihe gebraucht."); return; }

        var size = Math.min(plot.w, plot.h);
        var cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2, R = size / 2 - 2;
        var lochAnt = (ctx.opt.ringLoch != null ? ctx.opt.ringLoch : 55) / 100;
        var innenR = ring ? R * Math.max(0, Math.min(0.9, lochAnt)) : 0;
        var winkel = -Math.PI / 2;   // oben beginnen
        var labSize = ctx.labSize;

        for (var g = 0; g < gueltig.length; g++) {
            var idx = gueltig[g], anteil = werte[idx] / summe, dw = anteil * Math.PI * 2;
            var pts = [];
            var schritte = Math.max(2, Math.ceil(dw / (Math.PI / 90)));  // ~2°
            if (ring) {
                for (var a = 0; a <= schritte; a++) { var w1 = winkel + dw * (a / schritte); pts.push([cx + R * Math.cos(w1), cy + R * Math.sin(w1)]); }
                for (a = schritte; a >= 0; a--) { var w2 = winkel + dw * (a / schritte); pts.push([cx + innenR * Math.cos(w2), cy + innenR * Math.sin(w2)]); }
            } else {
                pts.push([cx, cy]);
                for (a = 0; a <= schritte; a++) { var w3 = winkel + dw * (a / schritte); pts.push([cx + R * Math.cos(w3), cy + R * Math.sin(w3)]); }
            }
            polygonPfad(ctx, pts, ctx.farben[g % ctx.farben.length]);

            var modus = ctx.opt.kreisBeschr || (ctx.opt.werte ? "prozent" : "aus");
            if (modus !== "aus") {
                var mitte = winkel + dw / 2, lr = ring ? (R + innenR) / 2 : R * 0.62;
                var lx = cx + lr * Math.cos(mitte), ly = cy + lr * Math.sin(mitte);
                var proz = Math.round(anteil * 1000) / 10;
                var DZ = (ctx.opt.dez == null ? 0 : ctx.opt.dez), EH = (ctx.opt.einheit == null ? "" : ctx.opt.einheit);
                var txt = "";
                if (modus === "prozent") txt = proz + " %";
                else if (modus === "wert") txt = fmt(werte[idx], DZ, EH);
                else if (modus === "name") txt = kat[idx];
                else if (modus === "nameprozent") txt = kat[idx] + "\r" + proz + " %";
                var zwei = (modus === "nameprozent");
                textRahmen(ctx, lx - 35, ly - labSize * (zwei ? 1.1 : 0.7), 70, labSize * (zwei ? 2.4 : 1.4), txt, ctx.labStyle, { sw: schwarz(ctx.doc), tint: 100 }, Justification.CENTER_ALIGN, labSize, true);
            }
            winkel += dw;
        }
    }

    // ---- Punkt (XY)
    function zeichnePunkt(ctx, plot) {
        var d = ctx.daten, nS = d.serien.length, nK = d.kategorien.length, opt = ctx.opt, labSize = ctx.labSize;
        var DZ = (opt.dez == null ? 0 : opt.dez), EH = (opt.einheit == null ? "" : opt.einheit);
        var xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (var k = 0; k < nK; k++) { var xw = d.xWerte[k]; if (isNaN(xw)) continue; if (xw < xmin) xmin = xw; if (xw > xmax) xmax = xw; }
        for (var s = 0; s < nS; s++) for (k = 0; k < nK; k++) { var yw = d.serien[s][k]; if (isNaN(yw)) continue; if (yw < ymin) ymin = yw; if (yw > ymax) ymax = yw; }
        if (!isFinite(xmin)) { xmin = 0; xmax = nK; }
        if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
        if (opt.ymin != null) ymin = opt.ymin; if (opt.ymax != null) ymax = opt.ymax;
        if (ymax <= ymin) ymax = ymin + 1;
        var axX = teilung(xmin, xmax, 6), axY = teilung(ymin, ymax, 6);
        var yLo = (opt.ymin != null) ? opt.ymin : axY.min, yHi = (opt.ymax != null) ? opt.ymax : axY.max;
        if (yHi <= yLo) yHi = yLo + 1;

        var maxYw = 0; for (var t = 0; t < axY.ticks.length; t++) { var bw = schaetzBreite(fmt(axY.ticks[t], DZ, EH), labSize); if (bw > maxYw) maxYw = bw; }
        var ytW = (opt.achseY && opt.achseY !== "") ? labSize * 1.6 : 0, xtH = (opt.achseX && opt.achseX !== "") ? labSize * 1.6 : 0;
        var leftRes = Math.min(plot.w * 0.4, maxYw + 8) + ytW, botRes = labSize * 1.8 + xtH;
        var P = { x: plot.x + leftRes, y: plot.y + 2, w: plot.w - leftRes - 4, h: plot.h - botRes - 2 };
        var doc = ctx.doc, gridFarbe = { sw: schwarz(doc), tint: 15 }, achsFarbe = { sw: schwarz(doc), tint: 100 };

        if (opt.plotBg && opt.plotBg !== "") { var bgSw = doc.swatches.itemByName(opt.plotBg); if (bgSw.isValid) rechteck(ctx, P.y, P.x, P.w, P.h, { sw: bgSw, tint: 100 }); }

        function xOf(v) { return P.x + P.w * (v - axX.min) / (axX.max - axX.min); }
        function yOf(v) { return P.y + P.h * (1 - (v - yLo) / (yHi - yLo)); }

        for (t = 0; t < axY.ticks.length; t++) { if (axY.ticks[t] < yLo - 1e-9 || axY.ticks[t] > yHi + 1e-9) continue; var gy = yOf(axY.ticks[t]); if (opt.gitter) linie(ctx, [[P.x, gy], [P.x + P.w, gy]], gridFarbe, 0.5); if (opt.achsen) textRahmen(ctx, plot.x + ytW, gy - labSize * 0.6, P.x - plot.x - ytW - 4, labSize * 1.3, fmt(axY.ticks[t], DZ, EH), ctx.labStyle, achsFarbe, Justification.RIGHT_ALIGN, labSize, true); }
        for (t = 0; t < axX.ticks.length; t++) { var gx = xOf(axX.ticks[t]); if (opt.gitter) linie(ctx, [[gx, P.y], [gx, P.y + P.h]], gridFarbe, 0.5); if (opt.achsen) textRahmen(ctx, gx - 30, P.y + P.h + 2, 60, labSize * 1.5, fmt(axX.ticks[t], DZ, ""), ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false); }

        for (s = 0; s < nS; s++) for (k = 0; k < nK; k++) {
            var xv = d.xWerte[k], yv = d.serien[s][k]; if (isNaN(xv) || isNaN(yv)) continue;
            oval(ctx, xOf(xv), yOf(yv), 3, ctx.farben[s], 0);
        }
        if (opt.achsen) { linie(ctx, [[P.x, P.y], [P.x, P.y + P.h]], achsFarbe, 0.75); linie(ctx, [[P.x, P.y + P.h], [P.x + P.w, P.y + P.h]], achsFarbe, 0.75); }

        if (xtH > 0) textRahmen(ctx, P.x, plot.y + plot.h - labSize * 1.3, P.w, labSize * 1.3, opt.achseX, ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false);
        if (ytW > 0) { var yt = textRahmen(ctx, plot.x + labSize * 0.75 - P.h / 2, P.y + P.h / 2 - labSize * 0.65, P.h, labSize * 1.3, opt.achseY, ctx.labStyle, achsFarbe, Justification.CENTER_ALIGN, labSize, false); try { yt.rotationAngle = -90; } catch (eRot) {} }
    }

})();
