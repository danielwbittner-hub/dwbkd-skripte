/* ============================================================================
   dwb Acrobat – Anbindung an Acrobat Pro (Folder-Level-Script)
   ----------------------------------------------------------------------------
   Hängt ein Menü „dwb“ ein mit:
     • Anschnitt prüfen …            Seitenboxen, Anschnitt je Seite in mm
     • Farbräume anzeigen …          Farbräume, Sonderfarben, ICC, Output-Intent
     • Schriften in Pfade umwandeln … Preflight-Korrektur, Ergebnis als Kopie
     • Bildauflösung prüfen …        effektive ppi je Platzierung
     • Reinzeichnung prüfen …        Haarlinien, Farbauftrag, Schwarz, Überdrucken, Transparenz …
     • Endformat & Anschnitt setzen … TrimBox/BleedBox aus der MediaBox setzen
     • Druck-Check (alles) …         alle Berichte in einem Fenster
   Der Kern (DWB) steht oberhalb in derselben Datei.
   ============================================================================ */
var dwbA = (function () {
    var A = {};
    A.EINSTELLUNG = {
        anschnittSoll: 3,            // mm, gefordert
        menueEltern: "Edit",         // Menü, unter dem „dwb“ eingehängt wird (interner Name, nicht übersetzt)
        profilSuche: /outline|pfad|kurve|kontur|zeichenweg/i,   // so finden wir die Preflight-Korrektur
        kopieAnhang: "_Pfade",       // Namenszusatz der umgewandelten Kopie
        maxMB: 150                   // größere Dateien nur nach Rückfrage einlesen
    };

    /* ----------------------------------------------------------- Hilfen */
    function dateiname(doc) { var p = String(doc.path || ""), i = p.lastIndexOf("/"); return i >= 0 ? p.substr(i + 1) : p; }
    function meldung(text, titel) { app.alert({ cMsg: text, cTitle: titel || "dwb", nIcon: 3 }); }
    function frage(text, titel) { return app.alert({ cMsg: text, cTitle: titel || "dwb", nIcon: 2, nType: 2 }) === 4; }

    /** Zeigt einen langen Text in einem scrollbaren Fenster (und in der Konsole). */
    A.zeigen = function (titel, text) {
        try { console.println("\n=== " + titel + " ===\n" + text); } catch (e) { }
        var dlg = {
            description: {
                name: titel, align_children: "align_left",
                elements: [{
                    type: "view", align_children: "align_left", elements: [
                        { type: "edit_text", item_id: "txt1", multiline: true, readonly: true, width: 640, height: 440, font: "palette" },
                        { type: "static_text", item_id: "hin1", name: "Der Bericht steht auch in der JavaScript-Konsole (⌘J) – von dort lässt er sich komplett kopieren.", width: 640 },
                        { type: "ok", ok_name: "Schließen" }
                    ]
                }]
            },
            initialize: function (dialog) { dialog.load({ txt1: text }); }
        };
        app.execDialog(dlg);
    };

    /** Liest die gespeicherte Datei des Dokuments als Binär-String (privilegiert). */
    A.dateiLesen = app.trustedFunction(function (doc) {
        app.beginPriv();
        var pfad = doc.path, s, b64;
        if (!pfad) { app.endPriv(); throw new Error("Das Dokument ist noch nicht gespeichert – bitte zuerst sichern."); }
        try {
            s = util.readFileIntoStream(pfad, true);
            b64 = util.stringFromStream(s);
        } catch (e) { app.endPriv(); throw new Error("Datei konnte nicht gelesen werden (" + e.message + "). Liegt sie in einer Cloud, bitte zuerst lokal sichern."); }
        app.endPriv();
        return DWB.base64ZuBinaer(b64);
    });

    /** Voll-Analyse mit Fortschrittsbalken. Gibt das Analyseobjekt zurück oder wirft. */
    A.analyse = function (doc, opt) {
        var th = app.thermometer, bin, a;
        try {
            th.duration = 3; th.begin(); th.text = "dwb: Datei lesen …"; th.value = 1;
            bin = A.dateiLesen(doc);
            if (bin.length > A.EINSTELLUNG.maxMB * 1048576) {
                th.end();
                if (!frage("Die Datei ist " + Math.round(bin.length / 1048576) + " MB groß. Die Analyse kann eine Weile dauern – trotzdem starten?")) throw new Error("Abgebrochen.");
                th.begin();
            }
            th.text = "dwb: Inhalte auswerten …"; th.value = 2;
            a = DWB.analysieren(bin, opt || {});
            th.value = 3;
        } finally { try { th.end(); } catch (e) { } }
        return a;
    };

    /** Notnagel ohne Dateizugriff: Boxen über Acrobats getPageBox. */
    A.boxenAusAcrobat = function (doc) {
        var a = { seiten: [], bytes: 0, objekte: 0, ms: 0, fehler: [] }, i, n = doc.numPages;
        function r(b, p) { var q = doc.getPageBox(b, p); return { x0: Math.min(q[0], q[2]), y0: Math.min(q[1], q[3]), x1: Math.max(q[0], q[2]), y1: Math.max(q[1], q[3]) }; }
        function gleich(u, v) { return Math.abs(u.x0 - v.x0) < 0.01 && Math.abs(u.y0 - v.y0) < 0.01 && Math.abs(u.x1 - v.x1) < 0.01 && Math.abs(u.y1 - v.y1) < 0.01; }
        for (i = 0; i < n; i++) {
            var s = { nr: i + 1, boxen: {}, vorhanden: {}, rotate: 0, annots: 0 };
            s.boxen.Media = r("Media", i); s.boxen.Crop = r("Crop", i); s.boxen.Bleed = r("Bleed", i); s.boxen.Trim = r("Trim", i); s.boxen.Art = r("Art", i);
            s.vorhanden.Media = true; s.vorhanden.Crop = !gleich(s.boxen.Crop, s.boxen.Media);
            s.vorhanden.Bleed = !gleich(s.boxen.Bleed, s.boxen.Crop); s.vorhanden.Trim = !gleich(s.boxen.Trim, s.boxen.Crop); s.vorhanden.Art = !gleich(s.boxen.Art, s.boxen.Crop);
            if (!s.vorhanden.Trim) s.boxen.Trim = null;
            if (!s.vorhanden.Art) s.boxen.Art = null;
            a.seiten.push(s);
        }
        return a;
    };

    function kopf(doc, a) {
        var z = DWB.berichtKopf(a, dateiname(doc));
        if (doc.dirty) z += "\n⚠ Das Dokument hat ungespeicherte Änderungen – geprüft wurde der gespeicherte Stand.";
        return z;
    }

    /* --------------------------------------------------------- Befehle */
    A.anschnitt = function (doc) {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        var a, text;
        try { a = A.analyse(doc, { inhalt: false }); text = kopf(doc, a) + "\n\n" + DWB.berichtAnschnitt(a, A.EINSTELLUNG.anschnittSoll); }
        catch (e) {
            if (/Abgebrochen/.test(e.message)) return;
            a = A.boxenAusAcrobat(doc);
            text = dateiname(doc) + " – Boxen aus Acrobat (Datei nicht direkt lesbar: " + e.message + ")\n\n" + DWB.berichtAnschnitt(a, A.EINSTELLUNG.anschnittSoll);
        }
        A.zeigen("dwb – Anschnitt", text);
    };

    A.farben = function (doc) {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        var a;
        try { a = A.analyse(doc, {}); } catch (e) { if (!/Abgebrochen/.test(e.message)) meldung(e.message); return; }
        A.zeigen("dwb – Farbräume", kopf(doc, a) + "\n\n" + DWB.berichtFarben(a) + "\n" + DWB.berichtSchriften(a));
    };

    A.alles = function (doc) {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        var a;
        try { a = A.analyse(doc, {}); } catch (e) { if (!/Abgebrochen/.test(e.message)) meldung(e.message); return; }
        A.zeigen("dwb – Druck-Check", kopf(doc, a) + "\n\n" + DWB.berichtAnschnitt(a, A.EINSTELLUNG.anschnittSoll) + "\n" + DWB.berichtReinzeichnung(a) + "\n" + DWB.berichtFarben(a) + "\n" + DWB.berichtBilder(a) + "\n\n" + DWB.berichtSchriften(a));
    };

    A.bilder = function (doc) {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        var a;
        try { a = A.analyse(doc, {}); } catch (e) { if (!/Abgebrochen/.test(e.message)) meldung(e.message); return; }
        A.zeigen("dwb – Bildauflösung", kopf(doc, a) + "\n\n" + DWB.berichtBilder(a));
    };

    A.reinzeichnung = function (doc) {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        var a;
        try { a = A.analyse(doc, {}); } catch (e) { if (!/Abgebrochen/.test(e.message)) meldung(e.message); return; }
        A.zeigen("dwb – Reinzeichnung", kopf(doc, a) + "\n\n" + DWB.berichtReinzeichnung(a));
    };

    /* ------------------------------------------ Endformat & Anschnitt setzen */
    function zahl(s, standard) { var v = parseFloat(String(s).replace(",", ".")); return isNaN(v) ? standard : v; }
    A.boxenSetzen = app.trustedFunction(function (doc) {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        var werte = null, aktuell = doc.pageNum, n = doc.numPages;
        var dlg = {
            description: {
                name: "Endformat & Anschnitt setzen", align_children: "align_left",
                elements: [{
                    type: "view", align_children: "align_left", elements: [
                        { type: "static_text", name: "Setzt TrimBox (Endformat) und BleedBox (Anschnitt) aus dem Seitenformat (MediaBox):", width: 420 },
                        { type: "static_text", name: "   Endformat = Seite minus Markenrand minus Anschnitt · Anschnittrahmen = Seite minus Markenrand", width: 420 },
                        { type: "view", align_children: "align_row", elements: [
                            { type: "static_text", name: "Anschnitt rundum (mm):", width: 200 },
                            { type: "edit_text", item_id: "ansc", width: 60 }
                        ] },
                        { type: "view", align_children: "align_row", elements: [
                            { type: "static_text", name: "Markenrand außerhalb (mm):", width: 200 },
                            { type: "edit_text", item_id: "mark", width: 60 }
                        ] },
                        { type: "check_box", item_id: "nura", name: "Nur die aktuelle Seite (" + (aktuell + 1) + " von " + n + ")" },
                        { type: "check_box", item_id: "crop", name: "Anzeige (CropBox) auf den Anschnittrahmen setzen" },
                        { type: "ok_cancel", ok_name: "Setzen", cancel_name: "Abbrechen" }
                    ]
                }]
            },
            initialize: function (dialog) { dialog.load({ ansc: String(A.EINSTELLUNG.anschnittSoll).replace(".", ","), mark: "0", nura: false, crop: false }); },
            commit: function (dialog) { werte = dialog.store(); }
        };
        if (app.execDialog(dlg) !== "ok" || !werte) return;
        var anschnitt = zahl(werte.ansc, A.EINSTELLUNG.anschnittSoll) * 72 / 25.4, marken = zahl(werte.mark, 0) * 72 / 25.4;
        if (anschnitt < 0 || marken < 0) return meldung("Bitte keine negativen Werte.");
        var von = werte.nura ? aktuell : 0, bis = werte.nura ? aktuell : n - 1;
        var text = A.boxenAnwenden(doc, anschnitt, marken, von, bis, !!werte.crop);
        if (text) A.zeigen("dwb – Endformat & Anschnitt", text);
    });

    /** Dialogfreier Kern: setzt Bleed/Trim/Art (und ggf. Crop) auf den Seiten von..bis. Werte in pt. */
    A.boxenAnwenden = app.trustedFunction(function (doc, anschnitt, marken, von, bis, crop) {
        var i, gesetzt = 0, zuKlein = 0;
        app.beginPriv();
        try {
            for (i = von; i <= bis; i++) {
                var m = doc.getPageBox("Media", i);   // [links, oben, rechts, unten] in gedrehtem Nutzerraum
                var links = Math.min(m[0], m[2]), rechts = Math.max(m[0], m[2]), oben = Math.max(m[1], m[3]), unten = Math.min(m[1], m[3]);
                var t = anschnitt + marken;
                if (rechts - links <= 2 * t || oben - unten <= 2 * t) { zuKlein++; continue; }
                doc.setPageBoxes({ cBox: "Bleed", nStart: i, nEnd: i, rBox: [links + marken, oben - marken, rechts - marken, unten + marken] });
                doc.setPageBoxes({ cBox: "Trim", nStart: i, nEnd: i, rBox: [links + t, oben - t, rechts - t, unten + t] });
                doc.setPageBoxes({ cBox: "Art", nStart: i, nEnd: i, rBox: [links + t, oben - t, rechts - t, unten + t] });
                if (crop) doc.setPageBoxes({ cBox: "Crop", nStart: i, nEnd: i, rBox: [links + marken, oben - marken, rechts - marken, unten + marken] });
                gesetzt++;
            }
        } catch (e) { app.endPriv(); meldung("Boxen konnten nicht gesetzt werden: " + e.message); return null; }
        app.endPriv();
        var a = A.boxenAusAcrobat(doc);
        return "Gesetzt auf " + gesetzt + " von " + (bis - von + 1) + " Seiten: Anschnitt " + DWB.fmtMm(anschnitt) + " mm" + (marken ? ", Markenrand " + DWB.fmtMm(marken) + " mm" : "") + (crop ? ", Anzeige auf Anschnittrahmen" : "") + ".\n" + (zuKlein ? "⚠ " + zuKlein + " Seiten übersprungen – zu klein für diese Werte.\n" : "") + "Die Änderung ist noch nicht gesichert (⌘S).\n\n" + DWB.berichtAnschnitt(a, A.EINSTELLUNG.anschnittSoll);
    });

    /* ---------------------------------------- Schriften → Pfade (Preflight) */
    A.profilWaehlen = app.trustedFunction(function () {
        app.beginPriv();
        var n = Preflight.getNumProfiles(), i, p, alle = [], treffer = [], wahl, gemerkt = global.dwbPfadProfil;
        for (i = 0; i < n; i++) { p = Preflight.getNthProfile(i); if (p && p.name) { alle.push(p.name); if (A.EINSTELLUNG.profilSuche.test(p.name)) treffer.push(p.name); } }
        app.endPriv();
        alle.sort();
        if (gemerkt && alle.indexOf(gemerkt) >= 0) {
            wahl = app.popUpMenu("Zuletzt: " + gemerkt, "-", "Anderes Profil wählen …", "Abbrechen");
            if (wahl === null || wahl === "Abbrechen") return null;
            if (wahl !== "Anderes Profil wählen …") return gemerkt;
        }
        if (treffer.length) {
            treffer.push("-", "Alle Profile zeigen …", "Abbrechen");
            wahl = app.popUpMenu.apply(app, treffer);
            if (wahl === null || wahl === "Abbrechen") return null;
            if (wahl !== "Alle Profile zeigen …") return wahl;
        } else meldung("Kein Preflight-Profil mit „Pfade/Outlines/Kurven“ im Namen gefunden. Es folgt die Liste aller Profile – bitte die Korrektur „Schriften in Pfade umwandeln“ heraussuchen (in Acrobat: Preflight ▸ Korrekturen).");
        // alle Profile, in Gruppen zu 20, damit das Menü lesbar bleibt
        var gruppen = [], g;
        for (i = 0; i < alle.length; i += 20) { g = alle.slice(i, i + 20); gruppen.push([g[0].substr(0, 18) + " … " + g[g.length - 1].substr(0, 18)].concat(g)); }
        gruppen.push("Abbrechen");
        wahl = app.popUpMenuEx.apply(app, gruppen.map(function (x) { return typeof x === "string" ? { cName: x } : { cName: x[0], oSubMenu: x.slice(1).map(function (y) { return { cName: y }; }) }; }));
        if (!wahl || wahl === "Abbrechen") return null;
        return wahl;
    });

    A.pfade = app.trustedFunction(function (doc) {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        if (typeof Preflight === "undefined") return meldung("Die Preflight-Schnittstelle fehlt – die Umwandlung in Pfade braucht Acrobat Pro.");
        if (!doc.path) return meldung("Bitte das Dokument zuerst sichern.");
        var profilName = A.profilWaehlen();
        if (!profilName) return;
        app.beginPriv();
        global.dwbPfadProfil = profilName; global.setPersistent("dwbPfadProfil", true);
        app.endPriv();
        // Vorher-Stand für den Vergleich
        var vorher = null;
        try { vorher = A.analyse(doc, {}); } catch (e) { }
        var neuerPfad = String(doc.path).replace(/(\.pdf)?$/i, "") + A.EINSTELLUNG.kopieAnhang + ".pdf";
        app.beginPriv();
        try { util.readFileIntoStream(neuerPfad, true); neuerPfad = neuerPfad.replace(/\.pdf$/i, "") + " " + util.printd("yyyy-mm-dd HHMMss", new Date()) + ".pdf"; } catch (e) { /* gibt es noch nicht – gut */ }
        app.endPriv();
        var hinweis = "Profil: " + profilName + "\n\nDas Original bleibt unverändert; das Ergebnis wird gesichert als\n" + neuerPfad.substr(neuerPfad.lastIndexOf("/") + 1);
        if (vorher) hinweis += "\n\nVorher: " + (function () { var k, n = 0; for (k in vorher.fonts) if (vorher.fonts.hasOwnProperty(k)) n++; return n; })() + " Schriften, " + vorher.gesamt.text + " Textobjekte" + (vorher.gesamt.unsichtbar ? " (davon " + vorher.gesamt.unsichtbar + " unsichtbar)" : "");
        if (!frage("Schriften in Pfade umwandeln?\n\n" + hinweis)) return;
        var text = A.pfadeAusfuehren(doc, profilName, neuerPfad);
        if (text) A.zeigen("dwb – Schriften in Pfade", text);
    });

    /**
     * Dialogfreier Kern der Umwandlung: Preflight-Korrektur laufen lassen, als Kopie
     * sichern, Ergebnis nachprüfen. Gibt den Berichtstext zurück (oder zeigt eine Meldung).
     */
    A.pfadeAusfuehren = app.trustedFunction(function (doc, profilName, neuerPfad) {
        var erg;
        app.beginPriv();
        try {
            var profil = Preflight.getProfileByName(profilName);
            if (!profil) throw new Error("Profil „" + profilName + "“ nicht gefunden.");
            erg = doc.preflight(profil, false);   // false: mit Fortschrittsanzeige kam die Korrektur beim sofortigen Sichern nicht mit
            doc.saveAs({ cPath: neuerPfad });
        } catch (e) { app.endPriv(); meldung("Umwandlung fehlgeschlagen: " + e.message); return null; }
        app.endPriv();
        var text = "Umgewandelt mit Preflight-Profil „" + profilName + "“\nGesichert als: " + neuerPfad + "\n";
        var namen = ["numFixed", "numNotFixed", "numErrors", "numWarnings", "numInfos"], i, teile = [];
        for (i = 0; i < namen.length; i++) { try { if (erg && typeof erg[namen[i]] === "number") teile.push(namen[i].replace(/^num/, "") + " " + erg[namen[i]]); } catch (e) { } }
        if (teile.length) text += "Preflight meldet: " + teile.join(", ") + "\n";
        try {
            var nachher = A.analyse(doc, {});
            text += "\n" + DWB.berichtSchriften(nachher);
            var k, n = 0; for (k in nachher.fonts) if (nachher.fonts.hasOwnProperty(k)) n++;
            if (n === 0 && nachher.gesamt.text === 0) text += "\n\n✔ Ergebnis: keine Schriften mehr im Dokument – alles Pfade.";
            else text += "\n\n⚠ Es sind noch Schriften/Textobjekte vorhanden. Entweder ist das gewählte Profil keine Korrektur (nur eine Prüfung), oder Acrobat konnte einzelne Schriften nicht umwandeln (unsichtbarer Text, Formularfelder, Anmerkungen).";
        } catch (e) { text += "\n(Nachkontrolle nicht möglich: " + e.message + ")"; }
        return text;
    });

    /* ============================== Hintergrund einfärben (CMYK / Sonderfarbe) */
    /** Ordner der gespeicherten Datei (device-unabhängiger Pfad). */
    function ordnerVon(doc) { var p = String(doc.path || ""), i = p.lastIndexOf("/"); return i >= 0 ? p.substr(0, i) : ""; }

    /** Separationsname → Dateiname des Helfer-PDFs (muss zu spot-helfer-bauen.py passen). */
    function spotDatei(colorant) { return String(colorant).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") + ".pdf"; }

    /** Ordner mit den vorgebauten Separation-Helfer-PDFs (einmal auflösen, dann merken). */
    A.spotBasis = function () {
        if (A._spotBasis !== undefined) return A._spotBasis;
        var p = null;
        try { app.beginPriv(); p = app.getPath("user", "javascript"); app.endPriv(); }
        catch (e) { try { app.endPriv(); } catch (e2) { } p = null; }
        if (p) { p = String(p).replace(/\/+$/, "") + "/dwb-spot"; }
        A._spotBasis = p || null;
        return A._spotBasis;
    };

    /** Eigene Farben aus persistentem global lesen. Format je Zeile: name \t c \t m \t y \t k */
    A.spotEigeneLesen = function () {
        var roh = "", liste = [];
        try { app.beginPriv(); roh = global.dwbSpotEigene; app.endPriv(); } catch (e) { try { app.endPriv(); } catch (e2) { } roh = ""; }
        if (!roh) return liste;
        var zeilen = String(roh).split("\n"), i, t;
        for (i = 0; i < zeilen.length; i++) {
            if (!zeilen[i]) continue;
            t = zeilen[i].split("\t");
            if (t.length >= 5) liste.push({ nm: t[0], cmyk: [zahl(t[1], 0), zahl(t[2], 0), zahl(t[3], 0), zahl(t[4], 0)] });
        }
        return liste;
    };

    /** Eigene Farben zurückschreiben (persistent). */
    A.spotEigeneSchreiben = function (liste) {
        var zeilen = [], i, f;
        for (i = 0; i < liste.length; i++) { f = liste[i]; zeilen.push(f.nm + "\t" + f.cmyk[0] + "\t" + f.cmyk[1] + "\t" + f.cmyk[2] + "\t" + f.cmyk[3]); }
        try { app.beginPriv(); global.dwbSpotEigene = zeilen.join("\n"); global.setPersistent("dwbSpotEigene", true); app.endPriv(); }
        catch (e) { try { app.endPriv(); } catch (e2) { } }
    };

    /**
     * Farbwahl über ein hierarchisches Aufklappmenü (robuster als ein langes Dropdown im Dialog).
     * Liefert ein Beschreibungsobjekt { art, nm, cmyk, colorant, quelle, sepMoeglich } oder null.
     *   art: "cmyk" = direkt eingeben · "spot" = Sonderfarbe · "neu" = neue eigene anlegen
     */
    A.spotFarbwahl = function (doc) {
        var map = {}, i, g, leaf, gruppe, chunk;
        var cmykLabel = "CMYK direkt eingeben …", neuLabel = "Neue eigene Farbe anlegen …";
        map[cmykLabel] = { art: "cmyk" };
        map[neuLabel] = { art: "neu" };
        var basis = A.spotBasis();

        function teile(arr, n) { var out = [], k; for (k = 0; k < arr.length; k += n) out.push(arr.slice(k, k + n)); return out; }

        // HKS (Kunstdruck K / Naturpapier N)
        function hksMenue(papier) {
            var gruppen = teile(DWBSPOT.hks, 24), untermenues = [], gi;
            for (gi = 0; gi < gruppen.length; gi++) {
                var teil = gruppen[gi], items = [], ti;
                for (ti = 0; ti < teil.length; ti++) {
                    var e = teil[ti], werte = papier === "K" ? e.K : e.N;
                    if (!werte) continue;
                    var cName = "HKS " + e.nr + " " + papier;
                    items.push(cName);
                    map[cName] = { art: "spot", nm: cName, colorant: cName, cmyk: werte, quelle: "hks", sepMoeglich: !!basis };
                }
                untermenues.push([("HKS " + teil[0].nr + "–" + teil[teil.length - 1].nr)].concat(items));
            }
            return [papier === "K" ? "HKS K  (Kunstdruck)" : "HKS N  (Naturpapier)"].concat(untermenues);
        }

        // Pantone
        var pItems = [];
        for (i = 0; i < DWBSPOT.pantone.length; i++) {
            var p = DWBSPOT.pantone[i], cn = p.nm + " " + p.paper;
            pItems.push(cn);
            map[cn] = { art: "spot", nm: p.nm, colorant: cn, cmyk: p.cmyk, quelle: "pantone", sepMoeglich: !!basis };
        }
        var pGruppen = teile(pItems, 24), pUnter = [], pgi;
        if (pGruppen.length > 1) { for (pgi = 0; pgi < pGruppen.length; pgi++) pUnter.push([("Pantone " + (pgi + 1))].concat(pGruppen[pgi])); }
        var pantoneMenue = ["Pantone (Solid Coated)"].concat(pGruppen.length > 1 ? pUnter : pItems);

        // Eigene Farben
        var eigene = A.spotEigeneLesen(), eItems = [];
        for (i = 0; i < eigene.length; i++) {
            eItems.push(eigene[i].nm);
            map[eigene[i].nm] = { art: "spot", nm: eigene[i].nm, colorant: eigene[i].nm, cmyk: eigene[i].cmyk, quelle: "eigen", sepMoeglich: false };
        }
        var eigenMenue = ["Eigene Farben"].concat(eItems.length ? eItems.concat(["-", neuLabel]) : [neuLabel]);

        var args = [cmykLabel, "-", hksMenue("K"), hksMenue("N"), pantoneMenue, "-", eigenMenue];
        var gewaehlt = app.popUpMenu.apply(app, args);
        if (!gewaehlt) return null;
        return map[gewaehlt] || null;
    };

    /** Dialog: neue eigene Sonderfarbe anlegen (Name + CMYK), persistent merken. Liefert Beschreibung oder null. */
    A.spotNeu = function (doc) {
        var werte = null;
        var dlg = {
            description: {
                name: "Neue eigene Sonderfarbe", align_children: "align_left",
                elements: [{ type: "view", align_children: "align_left", elements: [
                    { type: "static_text", name: "Name der Sonderfarbe (z. B. „Hausfarbe Blau“):", width: 440 },
                    { type: "edit_text", item_id: "enam", width: 300 },
                    { type: "static_text", name: "CMYK-Ersatzwert in %:", width: 440 },
                    { type: "view", align_children: "align_row", elements: [
                        { type: "static_text", name: "Cyan:", width: 90 }, { type: "edit_text", item_id: "cyan", width: 60 },
                        { type: "static_text", name: "   Magenta:", width: 90 }, { type: "edit_text", item_id: "mage", width: 60 }
                    ] },
                    { type: "view", align_children: "align_row", elements: [
                        { type: "static_text", name: "Yellow:", width: 90 }, { type: "edit_text", item_id: "gelb", width: 60 },
                        { type: "static_text", name: "   Key/Schwarz:", width: 90 }, { type: "edit_text", item_id: "schw", width: 60 }
                    ] },
                    { type: "static_text", name: "Hinweis: Für eigene Farben ist nur die CMYK-Annäherung möglich – eine echte Separationsplatte gibt es nur für die mitgelieferten HKS-/Pantone-Farben.", width: 440 },
                    { type: "ok_cancel", ok_name: "Anlegen", cancel_name: "Abbrechen" }
                ] }]
            },
            initialize: function (dialog) { dialog.load({ cyan: "0", mage: "0", gelb: "0", schw: "0" }); },
            commit: function (dialog) { werte = dialog.store(); }
        };
        if (app.execDialog(dlg) !== "ok" || !werte) return null;
        var nm = (werte.enam || "").replace(/[\t\n\r]/g, " ").replace(/^\s+|\s+$/g, "");
        if (!nm) { meldung("Bitte einen Namen für die Sonderfarbe angeben."); return null; }
        var cmyk = [zahl(werte.cyan, 0), zahl(werte.mage, 0), zahl(werte.gelb, 0), zahl(werte.schw, 0)];
        var i; for (i = 0; i < 4; i++) { if (cmyk[i] < 0 || cmyk[i] > 100) { meldung("Bitte CMYK-Werte zwischen 0 und 100 angeben."); return null; } }
        var liste = A.spotEigeneLesen(), gefunden = false;
        for (i = 0; i < liste.length; i++) { if (liste[i].nm === nm) { liste[i].cmyk = cmyk; gefunden = true; break; } }
        if (!gefunden) liste.push({ nm: nm, cmyk: cmyk });
        A.spotEigeneSchreiben(liste);
        return { art: "spot", nm: nm, colorant: nm, cmyk: cmyk, quelle: "eigen", sepMoeglich: false };
    };

    /** Einstieg „Hintergrund einfärben“: erst Farbe wählen, dann je nach Art der passende Dialog. */
    A.hintergrund = app.trustedFunction(function (doc) {
        try {
            if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
            if (!doc.path) return meldung("Bitte das Dokument zuerst sichern – der Hintergrund wird über die gespeicherte Datei gelegt.");
            if (/dwb-hintergrund-temp\.pdf$/i.test(String(doc.path))) return meldung("Das ist die Hilfsdatei des Werkzeugs (dwb-hintergrund-temp.pdf). Bitte wechsle zum eigentlichen Dokument.");
            var wahl = A.spotFarbwahl(doc);
            if (!wahl) return;
            if (wahl.art === "neu") { wahl = A.spotNeu(doc); if (!wahl) return; }
            if (wahl.art === "cmyk") return A.hintergrundCMYK(doc);
            return A.spotDialog(doc, wahl);
        } catch (e) {
            meldung("Beim Einfärben ist ein Fehler aufgetreten:\n" + e + (e && e.lineNumber ? "\n(Zeile " + e.lineNumber + ")" : ""), "dwb – Hintergrund");
        }
    });

    A.hintergrundCMYK = app.trustedFunction(function (doc) {
      try {
        if (!doc) return meldung("Bitte zuerst ein PDF öffnen.");
        if (!doc.path) return meldung("Bitte das Dokument zuerst sichern – der Hintergrund wird über die gespeicherte Datei gelegt.");
        if (/dwb-hintergrund-temp\.pdf$/i.test(String(doc.path))) return meldung("Das ist die Hilfsdatei des Werkzeugs (dwb-hintergrund-temp.pdf). Bitte wechsle zum eigentlichen Dokument und rufe „Hintergrund einfärben“ dort erneut auf.");
        var werte = null, aktuell = doc.pageNum, n = doc.numPages, g = {};
        // Zugriff auf PERSISTENTE global-Variablen braucht im Menü-Kontext Privileg (sonst NotAllowedError) – lesen wie schreiben.
        app.beginPriv();
        try { g = { c: global.dwbHintergrundC, m: global.dwbHintergrundM, y: global.dwbHintergrundY, k: global.dwbHintergrundK }; } catch (eRead) { g = {}; }
        app.endPriv();
        var dlg = {
            description: {
                name: "Hintergrund einfärben", align_children: "align_left",
                elements: [{
                    type: "view", align_children: "align_left", elements: [
                        { type: "static_text", name: "Legt eine Vollton-CMYK-Fläche hinter den Seiteninhalt.", width: 440 },
                        { type: "view", align_children: "align_row", elements: [
                            { type: "static_text", name: "Cyan (%):", width: 150 }, { type: "edit_text", item_id: "cyan", width: 60 },
                            { type: "static_text", name: "   Magenta (%):", width: 120 }, { type: "edit_text", item_id: "mage", width: 60 }
                        ] },
                        { type: "view", align_children: "align_row", elements: [
                            { type: "static_text", name: "Yellow (%):", width: 150 }, { type: "edit_text", item_id: "gelb", width: 60 },
                            { type: "static_text", name: "   Key/Schwarz (%):", width: 120 }, { type: "edit_text", item_id: "schw", width: 60 }
                        ] },
                        { type: "static_text", name: "Für welche Seiten:", width: 440 },
                        { type: "radio", item_id: "sAll", group_id: "seit", name: "Alle " + n + " Seiten" },
                        { type: "radio", item_id: "sU13", group_id: "seit", name: "Jede zweite Seite – ab Seite 1 (1, 3, 5 …)" },
                        { type: "radio", item_id: "sU24", group_id: "seit", name: "Jede zweite Seite – ab Seite 2 (2, 4, 6 …)" },
                        { type: "radio", item_id: "sAkt", group_id: "seit", name: "Nur die aktuelle Seite (" + (aktuell + 1) + " von " + n + ")" },
                        { type: "check_box", item_id: "hint", name: "Hinter den Inhalt legen (ausgeschaltet: über den Inhalt)" },
                        { type: "ok_cancel", ok_name: "Einfärben", cancel_name: "Abbrechen" }
                    ]
                }]
            },
            initialize: function (dialog) {
                dialog.load({
                    cyan: g.c != null ? g.c : "0", mage: g.m != null ? g.m : "0",
                    gelb: g.y != null ? g.y : "0", schw: g.k != null ? g.k : "10",
                    sAll: true, hint: true
                });
            },
            commit: function (dialog) { werte = dialog.store(); }
        };
        if (app.execDialog(dlg) !== "ok" || !werte) return;

        var c = zahl(werte.cyan, 0), m = zahl(werte.mage, 0), y = zahl(werte.gelb, 0), k = zahl(werte.schw, 0);
        if ([c, m, y, k].join().match(/-/) || Math.max(c, m, y, k) > 100) return meldung("Bitte CMYK-Werte zwischen 0 und 100 angeben.");
        app.beginPriv();
        global.dwbHintergrundC = String(werte.cyan); global.dwbHintergrundM = String(werte.mage);
        global.dwbHintergrundY = String(werte.gelb); global.dwbHintergrundK = String(werte.schw);
        global.setPersistent("dwbHintergrundC", true); global.setPersistent("dwbHintergrundM", true);
        global.setPersistent("dwbHintergrundY", true); global.setPersistent("dwbHintergrundK", true);
        try { global.setPersistent("dwbHintergrund", false); global.dwbHintergrund = null; } catch (ePers) { } // alte, fehlerhafte Objekt-Variable entsorgen
        app.endPriv();

        var seiten = [], i;
        if (werte.sAkt) seiten.push(aktuell);
        else if (werte.sU13) { for (i = 0; i < n; i += 2) seiten.push(i); }
        else if (werte.sU24) { for (i = 1; i < n; i += 2) seiten.push(i); }
        else { for (i = 0; i < n; i++) seiten.push(i); }
        if (!seiten.length) return meldung("Keine Seite ausgewählt.");

        var text = A.hintergrundAnwenden(doc, c / 100, m / 100, y / 100, k / 100, seiten, !!werte.hint);
        if (text) A.zeigen("dwb – Hintergrund einfärben", text);
      } catch (e) {
        meldung("Beim Einfärben ist ein Fehler aufgetreten:\n" + e + (e && e.lineNumber ? "\n(Zeile " + e.lineNumber + ")" : ""), "dwb – Hintergrund");
      }
    });

    /** Dialog für eine gewählte Sonderfarbe: echte Separation (Vollton) oder CMYK-Annäherung (mit Tonwert). */
    A.spotDialog = app.trustedFunction(function (doc, wahl) {
        var werte = null, aktuell = doc.pageNum, n = doc.numPages;
        var sep = !!wahl.sepMoeglich;
        var g = {};
        try { app.beginPriv(); g = { art: global.dwbSpotArt, tint: global.dwbSpotTint }; app.endPriv(); } catch (e) { try { app.endPriv(); } catch (e2) { } g = {}; }
        var artVor = sep ? (g.art === "app" ? false : true) : false;   // Standard: echte Separation, wenn möglich
        var tintVor = g.tint != null ? String(g.tint) : "100";
        var ersatz = "CMYK-Ersatz: C " + wahl.cmyk[0] + " · M " + wahl.cmyk[1] + " · Y " + wahl.cmyk[2] + " · K " + wahl.cmyk[3];

        var artZeilen = [];
        if (sep) {
            artZeilen.push({ type: "radio", item_id: "sep_", group_id: "sart", name: "Echte Sonderfarbe (Separation, Vollton 100 %) – eigene Druckplatte „" + wahl.colorant + "“" });
            artZeilen.push({ type: "radio", item_id: "app_", group_id: "sart", name: "CMYK-Annäherung (mit Tonwert unten)" });
        } else {
            artZeilen.push({ type: "static_text", name: "Diese Farbe wird als CMYK-Annäherung gefüllt (echte Separation nur für mitgelieferte HKS-/Pantone-Farben).", width: 460 });
        }

        var dlg = {
            description: {
                name: "Hintergrund einfärben – Sonderfarbe", align_children: "align_left",
                elements: [{ type: "view", align_children: "align_left", elements: [
                    { type: "static_text", name: "Farbe: " + wahl.nm, width: 460 },
                    { type: "static_text", name: ersatz, width: 460 }
                ].concat(artZeilen).concat([
                    { type: "view", align_children: "align_row", elements: [
                        { type: "static_text", name: "Tonwert für die CMYK-Annäherung (%):", width: 300 }, { type: "edit_text", item_id: "tint", width: 60 }
                    ] },
                    { type: "static_text", name: "Für welche Seiten:", width: 460 },
                    { type: "radio", item_id: "sAll", group_id: "seit", name: "Alle " + n + " Seiten" },
                    { type: "radio", item_id: "sU13", group_id: "seit", name: "Jede zweite Seite – ab Seite 1 (1, 3, 5 …)" },
                    { type: "radio", item_id: "sU24", group_id: "seit", name: "Jede zweite Seite – ab Seite 2 (2, 4, 6 …)" },
                    { type: "radio", item_id: "sAkt", group_id: "seit", name: "Nur die aktuelle Seite (" + (aktuell + 1) + " von " + n + ")" },
                    { type: "check_box", item_id: "hint", name: "Hinter den Inhalt legen (ausgeschaltet: über den Inhalt)" },
                    { type: "ok_cancel", ok_name: "Einfärben", cancel_name: "Abbrechen" }
                ]) }]
            },
            initialize: function (dialog) {
                var l = { tint: tintVor, sAll: true, hint: true };
                if (sep) { l.sep_ = artVor; l.app_ = !artVor; }
                dialog.load(l);
            },
            commit: function (dialog) { werte = dialog.store(); }
        };
        if (app.execDialog(dlg) !== "ok" || !werte) return;

        var echteSep = sep && !!werte.sep_;
        var seiten = [], i;
        if (werte.sAkt) seiten.push(aktuell);
        else if (werte.sU13) { for (i = 0; i < n; i += 2) seiten.push(i); }
        else if (werte.sU24) { for (i = 1; i < n; i += 2) seiten.push(i); }
        else { for (i = 0; i < n; i++) seiten.push(i); }
        if (!seiten.length) return meldung("Keine Seite ausgewählt.");

        // Einstellungen merken
        try { app.beginPriv(); global.dwbSpotArt = echteSep ? "sep" : "app"; global.dwbSpotTint = String(zahl(werte.tint, 100)); global.setPersistent("dwbSpotArt", true); global.setPersistent("dwbSpotTint", true); app.endPriv(); } catch (eP) { try { app.endPriv(); } catch (e2) { } }

        if (echteSep) {
            var gesetzt = A.hintergrundSeparation(doc, wahl.colorant, seiten, hinterWert(werte));
            if (gesetzt != null) A.zeigen("dwb – Hintergrund einfärben", "Echte Sonderfarbe aufgelegt (Vollton 100 %).\nFarbe/Platte: " + wahl.colorant + "\nSeiten: " + gesetzt + " von " + doc.numPages + "\n\n" +
                "Die Änderung ist noch nicht gesichert (⌘S). Rückgängig mit ⌘Z.\n" +
                "Prüfen lässt sich die Sonderfarbe unter „dwb ▸ Farbräume anzeigen“ oder in Acrobats Ausgabevorschau (Separationen).");
        } else {
            var t = zahl(werte.tint, 100); if (t < 0) t = 0; if (t > 100) t = 100;
            var f = t / 100;
            var text = A.hintergrundAnwenden(doc, wahl.cmyk[0] / 100 * f, wahl.cmyk[1] / 100 * f, wahl.cmyk[2] / 100 * f, wahl.cmyk[3] / 100 * f, seiten, hinterWert(werte));
            if (text) A.zeigen("dwb – Hintergrund einfärben", "CMYK-Annäherung für „" + wahl.nm + "“, Tonwert " + Math.round(t) + " %.\n\n" + text);
        }
    });

    function hinterWert(werte) { return !!werte.hint; }

    /**
     * Legt eine vorgebaute Sonderfarb-Helfer-PDF (echte /Separation, Vollton) je Seite als
     * Wasserzeichen auf. colorant = Separationsname, z. B. „HKS 43 K“. Liefert die Seitenzahl oder null.
     */
    A.hintergrundSeparation = app.trustedFunction(function (doc, colorant, seiten, hinter) {
        var basis = A.spotBasis();
        if (!basis) { meldung("Der Ordner mit den Sonderfarb-Helfern wurde nicht gefunden.\nBitte „installieren.command“ erneut ausführen und Acrobat neu starten."); return null; }
        var datei = basis + "/" + spotDatei(colorant), S = 1000, gesetzt = 0, i, p;
        app.beginPriv();
        try {
            for (i = 0; i < seiten.length; i++) {
                p = seiten[i];
                var b = doc.getPageBox("Media", p);
                var breite = Math.abs(b[2] - b[0]), hoehe = Math.abs(b[1] - b[3]);
                var skala = Math.max(breite, hoehe) / S * 1.02;
                doc.addWatermarkFromFile({
                    cDIPath: datei, nSourcePage: 0, nStart: p, nEnd: p,
                    bOnTop: !hinter, bOnScreen: true, bOnPrint: true,
                    nScale: skala, bPercentage: false, nOpacity: 1.0, nRotation: 0
                });
                gesetzt++;
            }
            // Helfer nicht als Tab offen lassen
            try { for (var j = app.activeDocs.length - 1; j >= 0; j--) { var ad = app.activeDocs[j]; if (ad !== doc && /\/dwb-spot\//.test(String(ad.path))) ad.closeDoc(true); } } catch (eClose) { }
        } catch (e) {
            app.endPriv();
            meldung("Die Sonderfarbe konnte nicht aufgelegt werden: " + e.message + "\n\nErwartete Helfer-Datei:\n" + datei + "\n\nFehlt sie, bitte „installieren.command“ erneut ausführen und Acrobat neu starten.");
            return null;
        }
        app.endPriv();
        return gesetzt;
    });

    /**
     * Dialogfreier Kern: schreibt eine Mini-CMYK-PDF als temporäre Datei neben das
     * Dokument und legt sie je Seite (skaliert, zentriert) als Wasserzeichen an.
     * seiten: Array von 0-basierten Seitennummern. hinter: true = hinter den Inhalt.
     */
    A.hintergrundAnwenden = app.trustedFunction(function (doc, c, m, y, k, seiten, hinter) {
        var S = 1000, tmp = ordnerVon(doc) + "/dwb-hintergrund-temp.pdf", gesetzt = 0, i, p, src = null;
        app.beginPriv();
        try {
            // Quell-Hintergrund bauen: leeres Dokument, ein CMYK-Rechteck über die ganze Seite,
            // flachrechnen (macht es zu echtem, deckendem Seiteninhalt), als Temp-Datei sichern.
            // (createDataObject/exportDataObject bzw. openDataObject sind in Acrobat 26 blockiert;
            //  newDoc + Rechteck-Annot + saveAs kommen ohne gesperrte Methoden aus.)
            src = app.newDoc(S, S);
            var a = src.addAnnot({ page: 0, type: "Square", rect: [0, 0, S, S] });
            a.fillColor = ["CMYK", Math.max(0, Math.min(1, c)), Math.max(0, Math.min(1, m)), Math.max(0, Math.min(1, y)), Math.max(0, Math.min(1, k))];
            try { a.strokeColor = color.transparent; } catch (e) { }
            src.flattenPages(0, 0);
            src.saveAs({ cPath: tmp });
            src.closeDoc(true); src = null;
            for (i = 0; i < seiten.length; i++) {
                p = seiten[i];
                var b = doc.getPageBox("Media", p);
                var breite = Math.abs(b[2] - b[0]), hoehe = Math.abs(b[1] - b[3]);
                var skala = Math.max(breite, hoehe) / S * 1.02;   // Quadrat deckt das Rechteck sicher ab
                doc.addWatermarkFromFile({
                    cDIPath: tmp, nSourcePage: 0, nStart: p, nEnd: p,
                    bOnTop: !hinter, bOnScreen: true, bOnPrint: true,
                    nScale: skala, bPercentage: false, nOpacity: 1.0, nRotation: 0
                });
                gesetzt++;
            }
            // Hilfsdatei nicht als Tab offen lassen – addWatermarkFromFile öffnet sie in manchen Acrobat-Versionen;
            // bliebe sie offen, scheiterte der nächste Lauf beim Überschreiben („interner Fehler“).
            try { for (var j = app.activeDocs.length - 1; j >= 0; j--) { var ad = app.activeDocs[j]; if (ad !== doc && /dwb-hintergrund-temp\.pdf$/i.test(String(ad.path))) ad.closeDoc(true); } } catch (eClose) { }
        } catch (e) { try { if (src) src.closeDoc(true); } catch (e2) { } app.endPriv(); meldung("Hintergrund konnte nicht gesetzt werden: " + e.message); return null; }
        app.endPriv();
        var farbe = "C " + Math.round(c * 100) + " · M " + Math.round(m * 100) + " · Y " + Math.round(y * 100) + " · K " + Math.round(k * 100);
        return "Hintergrund " + (hinter ? "hinter" : "über") + " den Inhalt gelegt.\nFarbe (CMYK %): " + farbe + "\nSeiten: " + gesetzt + " von " + doc.numPages + "\n\n" +
            "Die Änderung ist noch nicht gesichert (⌘S). Rückgängig mit ⌘Z.\n" +
            "Technischer Hinweis: eine kleine Hilfsdatei „dwb-hintergrund-temp.pdf“ liegt neben dem Dokument; sie wird bei jedem Lauf überschrieben und kann gelöscht werden.";
    });

    /* ------------------------------------------------------------- Menü */
    A.menue = function () {
        var eltern = A.EINSTELLUNG.menueEltern;
        try { app.addSubMenu({ cName: "dwbMenu", cUser: "dwb", cParent: eltern }); }
        catch (e) { eltern = "File"; app.addSubMenu({ cName: "dwbMenu", cUser: "dwb", cParent: eltern }); }
        var an = "event.rc = (event.target != null);";
        app.addMenuItem({ cName: "dwbAnschnitt", cUser: "Anschnitt prüfen …", cParent: "dwbMenu", cExec: "dwbA.anschnitt(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbFarben", cUser: "Farbräume anzeigen …", cParent: "dwbMenu", cExec: "dwbA.farben(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbPfade", cUser: "Schriften in Pfade umwandeln …", cParent: "dwbMenu", cExec: "dwbA.pfade(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbBilder", cUser: "Bildauflösung prüfen …", cParent: "dwbMenu", cExec: "dwbA.bilder(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbRein", cUser: "Reinzeichnung prüfen …", cParent: "dwbMenu", cExec: "dwbA.reinzeichnung(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbTrenner", cUser: "-", cParent: "dwbMenu", cExec: "void 0;" });
        app.addMenuItem({ cName: "dwbBoxen", cUser: "Endformat & Anschnitt setzen …", cParent: "dwbMenu", cExec: "dwbA.boxenSetzen(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbHintergrund", cUser: "Hintergrund einfärben (CMYK / Sonderfarbe) …", cParent: "dwbMenu", cExec: "dwbA.hintergrund(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbTrenner2", cUser: "-", cParent: "dwbMenu", cExec: "void 0;" });
        app.addMenuItem({ cName: "dwbAlles", cUser: "Druck-Check (alles) …", cParent: "dwbMenu", cExec: "dwbA.alles(event.target);", cEnable: an });
        app.addMenuItem({ cName: "dwbInfo", cUser: "Über dwb Druck-Werkzeuge", cParent: "dwbMenu", cExec: "app.alert({cMsg:'dwb Druck-Werkzeuge ' + DWB.version + '\\n\\nAnschnitt, Farbräume, Bildauflösung, Reinzeichnung und Schriften aus der PDF-Datei selbst gelesen; Umwandlung in Pfade über Acrobats Preflight; Endformat/Anschnitt setzen über die Seitenboxen.\\nSkript: ~/Library/Application Support/Adobe/Acrobat/DC/JavaScripts/dwb_acrobat.js', cTitle:'dwb', nIcon:3});" });
    };

    try { A.menue(); } catch (e) { try { console.println("dwb: Menü konnte nicht angelegt werden: " + e.message); } catch (e2) { } }
    return A;
})();
