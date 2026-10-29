// ============================================================================
// Bilder-in-Rahmen.jsx  —  Adobe InDesign                       Version 1.5.1
// ----------------------------------------------------------------------------
// Füllt einen markierten Bildrahmen der Reihe nach mit Bildern — eine Seite
// je Bild:
//
//   1. Rahmen auf einer Seite auswählen, Script starten.
//   2. Im Dateidialog beliebig viele Bilder, PDFs oder AI-Dateien wählen.
//   3. Übersicht: Vorschaubilder mit Ausschnitt; Reihenfolge per Ziehen,
//      ▲/▼ oder Tasten; Bilder entfernen, Dateien oder ganze Ordner
//      hinzufügen, Doppelte erkennen; bei mehrseitigen PDFs die Seiten wählen
//      („1-3, 7“ oder „alle“); Einpassung für alle, Ausrichtung je Bild;
//      effektive Auflösung ablesen; Texte aus den Metadaten ändern.
//   4. Das Script legt die Seiten an — direkt dahinter, am Dokumentende oder
//      in vorhandenen Folgeseiten —, kopiert alles von der Originalseite exakt
//      an dieselbe Stelle und lädt in jeden Rahmen ein Bild.
//
// Einpassung ab Werk: in der HÖHE passend skaliert, mittig (was übersteht,
// schneidet der Rahmen ab); wahlweise „Rahmen füllen“ oder „ganz einpassen“.
// Alles zusammen ist EIN Rückgängig-Schritt.
//
// 1.1: Seiten werden leer angelegt und die Objekte einzeln positionsgenau
//      kopiert — InDesigns „Seite duplizieren“ verschiebt Objekte, die über
//      die Seitenkante ragen, um eine Seitenbreite.
// 1.2: PDF-/AI-Seitenauswahl; Vorschau auf dem Mac über ein kleines
//      JXA-Hilfsprogramm (EXIF-Drehung, gedrehte PDF-Seiten, Pixelmaße);
//      effektive ppi; Musterobjekte wie auf der Quellseite; Anschnitt-Objekte
//      bei Doppelseiten gespiegelt; altes Bild wird vor dem Platzieren
//      entfernt; Fortschrittsanzeige (Esc hält an).
// 1.3: Titel/Stadt/Copyright/Bildunterschrift aus den Bild-Metadaten (XMP, nur
//      lesen) in gleichnamige Textrahmen der Seite oder Musterseite, vorher in
//      der Übersicht änderbar; Ausrichtung je Bild über einen 3×3-Bezugspunkt, nach
//      Sicht auch in gedrehten/gespiegelten Rahmen; Ziel der neuen Seiten
//      (dahinter, Dokumentende, leere Folgeseiten füllen, Folgeseiten
//      ersetzen); Ordner einlesen (Mac über find); Doppelte per Prüfsumme und
//      schon Platzierte erkennen; Tastenkürzel (H blendet sie ein);
//      intelligenter Textumfluss während des Laufs angehalten.
// 1.4: Copyright-Rahmen = Präfix (ab Werk „Foto: “, gemerkt) + Autor aus IPTC
//      „Ersteller“ (dc:creator). Steht in einem Textrahmen schon Text, den das
//      Script nicht selbst unverändert eingesetzt hat, und würde der Lauf ihn
//      ersetzen, fragt „Platzieren“ einmal: stehen lassen · überschreiben · zurück.
// 1.5: Ist ein Text bei allen Bildern gleich, kommt er einmal in den Rahmen der
//      Musterseite (Schalter „Gleiche Texte auf die Musterseite“, gemerkt) —
//      Schrift und Lage dann nur dort anpassen. Gelöste Rahmen, deren Text vom
//      Script stammt, werden dafür zur Musterseite zurückgesetzt — nicht, wenn sie
//      auf der Seite von Hand verschoben, umformatiert oder geleert wurden. Steht im
//      Musterrahmen ein Platzhalter oder zeigen ihn auch Seiten außerhalb der
//      Bildstrecke, fragt „Platzieren“; „Stehen lassen“ lässt den Platzhalter stehen
//      bzw. setzt die Texte dieser Bildstrecke je Seite.
// 1.5.1: Verschiedene Texte je Bild: die gelösten Rahmen stehen auf den neuen
//      Seiten wieder dort, wo die Seite den Musterrahmen zeigt. Wurde das
//      Seitenformat nach dem Anlegen des Dokuments geändert, rutschten sie ab
//      Seite 2 seitlich weg (InDesign übergeht dort beim Lösen die Verschiebung
//      der Musterseite, auch über Basis-Musterseiten hinweg). Neue Seiten zeigen
//      die Musterseite mit demselben Versatz wie die Quellseite (auch wenn nur sie
//      mittig vergrößert wurde). So versetzte Rahmen früherer Läufe rückt das
//      Script auf der Quelle und den befüllten Seiten zurecht (Bericht).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de
// ============================================================================

#target indesign

(function () {

    var TITEL = "Bilder in Rahmen";
    var KENNUNG = "dwb_bilder_in_rahmen";          // Markierung des Zielrahmens
    var LAUF = "ziel_" + new Date().getTime();      // Wert je Lauf — alte Reste zählen nicht
    var MERKER_ORDNER = "dwb_bilder_in_rahmen_ordner";
    var MERKER_AUFGERAEUMT = "dwb_bilder_in_rahmen_aufgeraeumt";
    var MERKER_WAHL = "dwb_bilder_in_rahmen_wahl";
    var VORSCHAU_PX = 240;                          // Kantenlänge der Vorschaubilder
    var PRAEFIX_VORGABE = "Foto: ";                 // vor dem Autor im Copyright-Rahmen — das Leerzeichen gehört dazu
    var FELD_B = 440, FELD_H = 400;                 // Vorschaufläche im Fenster
    var PPI_WARNUNG = 250;                          // darunter ⚠ in der Liste
    var PUNKT = 8;                                  // Zelle des 3×3-Bezugspunkts (24 px = Zeilenhöhe)
    var PFEILE = ["↖", "↑", "↗", "←", "", "→", "↙", "↓", "↘"];
    var LAGEN = ["oben links", "oben", "oben rechts", "links", "mittig", "rechts", "unten links", "unten", "unten rechts"];

    // Testzugang: ein Testskript legt $.global.dwbBilderInRahmenTest an
    // ({ dateien:[File] oder eintraege:[{datei, seite}], reihenfolge, einpassung,
    //    meldungen:[], dialog:true für die Übersicht, ohneAnzeige:true = Übersicht
    //    ohne show() durchlaufen, "abbrechen" = danach Ende; seit 1.3 auch ordner:Folder,
    //    unterordner, antworten:[…] für Rückfragen, ziel, pruefBytes, dialogAbfrage(w, api); seit 1.4
    //    praefix (fehlt = ""), textVorhanden "lassen"|"ersetzen"|"fragen" (fehlt = ersetzen ohne Frage;
    //    anders als vor 1.4 leert das auf neuen Seiten auch kopierten fremden Text ohne neuen Wert),
    //    textAntwort "lassen"|"ersetzen"|"zurueck" fürs Rückfragefenster; zurück: textKonflikte,
    //    textFrageTeile, textFrageText, platzierenOk; seit 1.5 musterTexte (fehlt = aus) }) — dann entfallen
    // Dateidialog, Übersicht (außer mit dialog:true) und alert().
    var TEST = $.global.dwbBilderInRahmenTest || null;

    function melden(text) {
        if (TEST) { TEST.meldungen.push(text); } else { alert(text, TITEL); }
    }

    var BILDENDUNGEN = /\.(jpe?g|tiff?|psd|png|pdf|ai|eps|gif|bmp|heic|webp|indd)$/i;
    var MEHRSEITIG = /\.(pdf|ai)$/i;                // Seitenwahl mit bekannter Seitenzahl
    var INDD = /\.indd$/i;                          // Seitenwahl ohne Seitenzahl
    var LESBAR = /\.(jpe?g|tiff?|psd|png|pdf|gif|bmp|heic|webp)$/i;   // müsste eine Vorschau haben
    var MAC = $.os.indexOf("Mac") === 0;

    var REIHENFOLGEN = [
        "Dateiname (Bild 2 vor Bild 10)",
        "Dateiname rückwärts",
        "Änderungsdatum, älteste zuerst",
        "Änderungsdatum, neueste zuerst",
        "Ordner, dann Dateiname"
    ];
    var ORDNER_SORT = 4;
    var zerlegt = {};                               // Merker für textNatuerlich — oben, weil Teile schon beim Start laufen
    // Zerlegte Zeichen (NFD, Finder-Listen) → zusammengesetzt (NFC, InDesign-Links)
    var KOMBI = {
        "̈": { a: "ä", o: "ö", u: "ü", e: "ë", i: "ï", y: "ÿ", A: "Ä", O: "Ö", U: "Ü", E: "Ë", I: "Ï" },
        "́": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" },
        "̀": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
        "̂": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
        "̃": { a: "ã", o: "õ", n: "ñ", A: "Ã", O: "Õ", N: "Ñ" },
        "̧": { c: "ç", C: "Ç" },
        "̊": { a: "å", A: "Å" }
    };
    var PAKETE = /\.(app|bundle|framework|plugin|photoslibrary|photolibrary|aplibrary|migratedphotolibrary|imovielibrary|fcpbundle|lrdata|lrlibrary|cocatalog|cosessiondb|sparsebundle|pages|numbers|key|rtfd|xcassets|logicx|musiclibrary|tvlibrary)$/i;
    var ORDNER_WEG = /^(__MACOSX|\$RECYCLE\.BIN|System Volume Information)$/i;
    var SEITENZIELE = [
        "direkt dahinter",
        "am Dokumentende",
        "leere Folgeseiten füllen",
        "Folgeseiten füllen (ersetzen)"
    ];
    var ZIEL_DAHINTER = 0, ZIEL_ENDE = 1, ZIEL_LEERE = 2, ZIEL_ERSETZEN = 3;
    var TOLERANZ = 2;                               // pt: Größe und Lage beim Rahmenvergleich
    var EINPASSUNGEN = [                            // die Ausrichtung steht je Bild daneben
        "Höhe einpassen",
        "Rahmen füllen",
        "Ganz einpassen"
    ];

    // ------------------------------------------------------------------------
    // Rahmen aus der Auswahl
    // ------------------------------------------------------------------------

    if (app.documents.length === 0) {
        melden("Kein Dokument geöffnet.");
        return;
    }
    var doc = app.activeDocument;

    function istRahmen(obj) {
        var art = obj.constructor.name;
        return art === "Rectangle" || art === "Oval" || art === "Polygon";
    }

    function rahmenAusAuswahl() {
        if (app.selection.length !== 1) return null;
        var obj = app.selection[0];
        // Mit dem Direktauswahl-Werkzeug ist das Bild markiert, nicht der Rahmen.
        if (!istRahmen(obj) && obj.parent && istRahmen(obj.parent)) obj = obj.parent;
        return istRahmen(obj) ? obj : null;
    }

    var rahmen = rahmenAusAuswahl();
    if (!rahmen) {
        melden("Bitte genau einen Bildrahmen auswählen.\n\n" +
               "Rechteck-, Ellipsen- oder Polygonrahmen — Textrahmen und " +
               "Gruppen gehen nicht.");
        return;
    }
    var quellSeite = rahmen.parentPage;
    if (!quellSeite) {
        melden("Der Rahmen liegt nicht auf einer Seite (Montagefläche?).\n" +
               "Bitte einen Rahmen auf einer Dokumentseite auswählen.");
        return;
    }
    if (quellSeite.parent.constructor.name === "MasterSpread") {
        melden("Der Rahmen liegt auf einer Musterseite.\n" +
               "Bitte einen Rahmen auf einer normalen Dokumentseite auswählen.");
        return;
    }
    if (rahmen.locked || rahmen.itemLayer.locked) {
        melden("Der Rahmen oder seine Ebene ist gesperrt.");
        return;
    }

    // Breite/Höhe entlang der EIGENEN Achsen, gemessen in Montageflächen-Punkt:
    // stimmt bei gedrehten Rahmen (geometricBounds wären nur der Umkasten) und
    // enthält eine Skalierung des Rahmens (die inneren Pfadmaße täten das nicht).
    function eigeneMasse(obj) {
        try {
            var G = BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS, I = CoordinateSpaces.INNER_COORDINATES,
                P = CoordinateSpaces.PASTEBOARD_COORDINATES;
            var a = obj.resolve([[0, 0], G, I], P)[0];
            var c = obj.resolve([[1, 0], G, I], P)[0];
            var d = obj.resolve([[0, 1], G, I], P)[0];
            var b = Math.sqrt(Math.pow(c[0] - a[0], 2) + Math.pow(c[1] - a[1], 2));
            var h = Math.sqrt(Math.pow(d[0] - a[0], 2) + Math.pow(d[1] - a[1], 2));
            if (b > 0 && h > 0) return [b, h];
        } catch (e) {}
        var alt = app.scriptPreferences.measurementUnit;
        app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
        var gb = obj.geometricBounds;               // Rückfall: [y1, x1, y2, x2]
        app.scriptPreferences.measurementUnit = alt;
        return [gb[3] - gb[1], gb[2] - gb[0]];
    }
    var RAHMEN_MASS = eigeneMasse(rahmen);

    // Werte, die schon die Übersicht braucht (Zuweisungen werden in ES3 nicht
    // hochgezogen — nur Funktionsdeklarationen).
    var PB = CoordinateSpaces.PASTEBOARD_COORDINATES;
    var matrizen = {}, musterVermessen = {};
    var bericht = { platziert: 0, fehler: [], seiten: [], abbruch: null, angehalten: false,
                    musterHinweis: [], bogenHinweis: [], uebersatz: [], stehen: {}, ohneAutor: [],
                    musterEingesetzt: [], musterGeloest: [], stehenMuster: {}, musterZurueck: {}, musterJeSeite: {},
                    ohneTextrahmen: {}, versatzBehoben: [] };

    // ------------------------------------------------------------------------
    // Metadaten (XMP) → Textrahmen
    // ------------------------------------------------------------------------

    // Welche Metadaten in welchen Textrahmen kommen (nur fürs Layout — die
    // Bilddateien werden nie verändert). Gefunden wird der
    // Textrahmen über seinen Namen im Ebenen-Bedienfeld (Groß/klein egal) —
    // auf der Seite selbst oder auf ihrer Musterseite. Lightroom/Photoshop:
    // Titel = dc:title, Bildunterschrift = dc:description, Copyright =
    // dc:rights, Stadt = photoshop:City.
    // copyright: Autor aus IPTC „Ersteller“ (dc:creator, geordnete Liste); in den Rahmen kommt Präfix + Autor.
    var FELDER = [
        { id: "titel",        text: "Titel",            rahmen: /^(titel|title)$/i,                                   ns: "dc",        name: "title",       sprache: true },
        { id: "unterschrift", text: "Bildunterschrift", rahmen: /^(bilde?r?unterschrift|caption|beschreibung)$/i,     ns: "dc",        name: "description", sprache: true },
        { id: "copyright",    text: "Copyright",        rahmen: /^(copyright|©|rechte)$/i,                            ns: "dc",        name: "creator",     sprache: false, liste: true, praefix: true },
        { id: "stadt",        text: "Stadt",            rahmen: /^(stadt|ort|city)$/i,                                ns: "photoshop", name: "City",        sprache: false }
    ];

    var xmpDa = null;
    function xmpBereit() {
        if (xmpDa !== null) return xmpDa;
        try {
            if (!ExternalObject.AdobeXMPScript) ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
            xmpDa = typeof XMPFile !== "undefined";
        } catch (e) { xmpDa = false; }
        return xmpDa;
    }
    function xmpNs(kurz) { return kurz === "dc" ? XMPConst.NS_DC : XMPConst.NS_PHOTOSHOP; }
    function leereWerte() {
        var w = {};
        for (var k = 0; k < FELDER.length; k++) w[FELDER[k].id] = "";
        return w;
    }
    function werteKopie(w) {
        var n = {};
        for (var k = 0; k < FELDER.length; k++) n[FELDER[k].id] = (w && w[FELDER[k].id]) || "";
        return n;
    }
    // Texte vergleichen: Umbrüche vereinheitlicht, Leerraum am Ende egal (InDesign macht aus \n ein \r).
    function textNorm(t) {
        return String(t === undefined || t === null ? "" : t).replace(/\r\n|\n|\r/g, "\r").replace(/[\s\u00a0]+$/, "");
    }
    function textGleich(a, b) { return textNorm(a) === textNorm(b); }
    function istLeer(t) {
        return String(t === undefined || t === null ? "" : t).replace(/[\s\u00a0\u2000-\u200b\u2028\u2029\u202f\u3000\ufeff]+/g, "") === "";
    }
    function autorNorm(a) { return String(a || "").replace(/[\r\n]+/g, " ").replace(/^\s+|\s+$/g, ""); }
    // Präfix + Autor. Ohne Autor nichts (nie ein einsames „Foto: “). Steht das Präfix
    // (ohne Leerraum am Ende, groß/klein egal) schon vorn — an einer Wortgrenze oder
    // mit Satzzeichen am Ende —, bleibt der Autor. Nichts wird ergänzt.
    function mitPraefix(p, autor) {
        p = String(p || "").replace(/[\r\n]+/g, "");
        autor = autorNorm(autor);
        if (autor === "") return "";
        var kern = p.replace(/\s+$/, "").toLowerCase();
        if (kern !== "" && autor.toLowerCase().indexOf(kern) === 0) {
            var rest = autor.substring(kern.length);
            if (rest === "" || /^\s/.test(rest) || /[^a-z0-9äöüß]$/.test(kern)) return autor;
        }
        return p + autor;
    }
    function metaWert(werte, f, p) {
        var w = (werte && werte[f.id]) || "";
        return f.praefix ? mitPraefix(p, w) : w;
    }
    // Geordnete XMP-Liste (dc:creator) — gemessen: getProperty liefert bei Listen "",
    // XMPUtils.catenateArrayItems wirft beim Trenner ", " → einzeln ab 1 lesen.
    function listeLesen(x, ns, name) {
        var teile = [], n = 0, k, it, s;
        try { n = x.countArrayItems(ns, name); } catch (e) { n = 0; }
        for (k = 1; k <= n; k++) {
            try { it = x.getArrayItem(ns, name, k); s = it ? autorNorm(it.value) : ""; if (s !== "") teile.push(s); } catch (e2) {}
        }
        if (!n) {                                   // fehlerhaft als einfacher Wert gespeichert
            try { it = x.getProperty(ns, name); s = it ? autorNorm(it.value) : ""; if (s !== "") teile.push(s); } catch (e3) {}
        }
        return teile.join(", ");
    }

    // Liest die vier Felder; fehlende Felder/Dateien ergeben "". Achtung
    // (gemessen): getLocalizedText WIRFT, wenn das Feld nicht existiert.
    var metaSpeicher = {}, rechteSpeicher = {};      // rechte: dc:rights, nur als Hinweis am leeren Autorfeld
    function metaLesen(datei) {
        var sch = datei.fsName;
        if (metaSpeicher[sch]) return werteKopie(metaSpeicher[sch]);
        var werte = leereWerte();
        rechteSpeicher[sch] = "";
        if (xmpBereit() && datei.exists) {
            var x = null;
            function lesen(modus) {                         // nur lesen; die Datei wird immer geschlossen
                var xf = new XMPFile(datei.fsName, XMPConst.UNKNOWN, modus);
                try { return xf.getXMP(); } finally { try { xf.closeFile(); } catch (e0) {} }
            }
            try { x = lesen(XMPConst.OPEN_FOR_READ | XMPConst.OPEN_USE_SMART_HANDLER); }
            catch (e) { try { x = lesen(XMPConst.OPEN_FOR_READ); } catch (e2) { x = null; } }
            if (x) {
                for (var k = 0; k < FELDER.length; k++) {
                    var f = FELDER[k], ns = xmpNs(f.ns);
                    try {
                        if (!x.doesPropertyExist(ns, f.name)) continue;
                        if (f.liste) { werte[f.id] = listeLesen(x, ns, f.name); continue; }
                        var v = f.sprache ? x.getLocalizedText(ns, f.name, "", "x-default") : x.getProperty(ns, f.name);
                        if (v) werte[f.id] = String(v.toString());
                    } catch (e3) {}
                }
                try {                                   // getLocalizedText wirft bei fehlendem Feld (gemessen)
                    if (x.doesPropertyExist(XMPConst.NS_DC, "rights")) rechteSpeicher[sch] = autorNorm(x.getLocalizedText(XMPConst.NS_DC, "rights", "", "x-default"));
                } catch (e4) {}
            }
        }
        metaSpeicher[sch] = werte;
        return werteKopie(werte);
    }

    // Die Metadaten-Textrahmen einer Seite: eigene Objekte zuerst, sonst die
    // Musterobjekte (ganze Kette). { feldId: { rahmen, muster: bool } }
    function metaRahmenAufSeite(seite) {
        var treffer = {}, k, j;
        function merken(obj, muster) {
            for (j = 0; j < FELDER.length; j++) {
                if (!FELDER[j].rahmen.test(obj.name)) continue;
                var da = treffer[FELDER[j].id];
                if (!da) treffer[FELDER[j].id] = { rahmen: obj, muster: muster, mehrdeutig: false };
                else if (da.muster === muster) da.mehrdeutig = true;   // zwei gleichnamige: nicht raten
            }
        }
        var ap = seite.allPageItems;
        for (k = 0; k < ap.length; k++) {
            try {
                if (ap[k].constructor.name !== "TextFrame") continue;
                var pp = elternSeite(ap[k]);
                if (pp && pp.id !== seite.id) continue;
                merken(ap[k], false);
            } catch (e) {}
        }
        try {
            var mp = seite.masterPageItems;
            for (k = 0; k < mp.length; k++) {
                if (mp[k].constructor.name === "TextFrame") merken(mp[k], true);
            }
        } catch (e) {}
        return treffer;
    }

    // Befüllt die Textrahmen einer Seite. Text, den das Script selbst gesetzt hat und der
    // seitdem unverändert ist (Kennung + Wert-Label, auch im Musterrahmen), wird still
    // ersetzt oder geleert. Anderer Text („fremd“: von Hand getippt, nachträglich
    // geändert, Platzhalter im Musterrahmen) wird nur bei wahl.textVorhanden === "ersetzen"
    // überschrieben, sonst bleibt er (Bericht). Ein leerer Wert leert fremden Text nie —
    // außer auf neuen Seiten (Kopie der Quellseite) bei „ersetzen“. Je Seite wird ein
    // Musterrahmen gelöst, wenn er Text bekommt oder Script-Text geleert werden muss.
    // Felder mit gleichem Text für alle Bilder: siehe „Gleiche Texte auf die Musterseite“.
    var META_KENNUNG = "dwb_bilder_in_rahmen_text";
    var META_WERT = "dwb_bilder_in_rahmen_wert";            // zuletzt vom Script geschriebener Text
    var META_LAGE = "dwb_bilder_in_rahmen_lage";            // Lage eines Rahmens, als das Script ihn löste/beschrieb
    var META_FORMAT = "dwb_bilder_in_rahmen_format";        // Formatierung dazu (Schrift, Formate, Fläche, Kontur)
    var META_SPUR = "dwb_bilder_in_rahmen_spur";            // "seite": Script hat gelöst · "muster": am Musterrahmen (von Hand gelöste Rahmen erben sie)
    function rahmenText(tf) {
        var t;
        try { t = tf.parentStory.contents; } catch (e) { try { t = tf.contents; } catch (e2) { return ""; } }
        return typeof t === "string" ? t : "\ufffc";          // nur ein Sonderzeichen (Seitenzahl …) zählt als Text
    }
    function vomSkript(tf, alt) {
        try {
            if (tf.extractLabel(META_KENNUNG) !== "1") return false;
            var w = tf.extractLabel(META_WERT);
            return w === "" || textGleich(w, alt);            // "" = Rahmen aus einem 1.3-Lauf (ohne Wert-Label)
        } catch (e) { return false; }
    }
    // seite: Page oder Name (Text)
    function stehenMerken(f, seite) {
        if (!bericht.stehen[f.id]) bericht.stehen[f.id] = [];
        bericht.stehen[f.id].push(typeof seite === "string" ? seite : seite.name);
    }
    function namenMerken(tabelle, f, name) {               // je Feld, ohne Doppelte
        if (!tabelle[f.id]) tabelle[f.id] = [];
        for (var i = 0; i < tabelle[f.id].length; i++) if (tabelle[f.id][i] === name) return;
        tabelle[f.id].push(name);
    }
    function uebersatzMerken(r, seite, f) {
        try {
            if (!r.overflows) return;
            var z = (typeof seite === "string" ? "„" + seite + "“" : "Seite " + seite.name) + ": " + f.text;
            for (var i = 0; i < bericht.uebersatz.length; i++) if (bericht.uebersatz[i] === z) return;
            bericht.uebersatz.push(z);
        } catch (e) {}
    }

    // ---- Gleiche Texte auf die Musterseite (1.5) ----------------------------
    // Gemessen (InDesign 21.5): ein auf der Seite gelöster Musterrahmen folgt Text-
    // UND Formatänderungen der Musterseite nicht mehr — auch ohne eigene Änderung.
    // removeOverride() stellt den Musterrahmen wieder her; overriddenMasterPageItem
    // liefert beim gelösten Rahmen das Musterobjekt, sonst null; Kopien gelöster
    // Rahmen haben keinen Bezug mehr; override() übernimmt die Script-Labels des
    // Musterrahmens. Text in gesperrten Musterrahmen/Ebenen lässt sich setzen;
    // Rückgängig nimmt ihn zurück.
    // Regeln: Ein Musterrahmen wird nur beschrieben, wenn sich dadurch nichts
    // Ungefragtes ändert — kein fremder Text darin und keine Seite außerhalb der
    // Bildstrecke, die ihn zeigt —, sonst nach „Überschreiben“. Andernfalls kommen die
    // Texte je Seite. Gelöste Seitenrahmen werden nur zurückgesetzt, wenn ihr Text leer,
    // gleich oder vom Script ist, sie nicht verschoben, umformatiert oder geleert wurden
    // (Vergleich mit der Spur beim Lösen, sonst mit dem Musterrahmen) und die Seite
    // Musterobjekte zeigt.
    var musterWerte = {}, musterZiele = {}, musterErledigt = {}, musterBewertung = {}, seitenKarteSpeicher = null;
    function musterVon(obj) {
        try { var m = obj.overriddenMasterPageItem; return (m && m.isValid) ? m : null; } catch (e) { return null; }
    }
    function musterName(m) {
        try { return m.parentPage.parent.name; } catch (e) { return "Musterseite"; }
    }
    // Zeigt die Seite dieses Musterobjekt? Musterobjekte am Druckbogen nicht ausgeblendet,
    // und das Objekt gehört zu ihrer Musterseite oder deren Basis-Musterseiten.
    function zeigtMuster(seite, m) {
        try {
            if (seite.parent.showMasterItems === false) return false;
            var ziel = m.parentPage.parent.id, am = seite.appliedMaster;
            for (var tiefe = 0; am && tiefe < 20; tiefe++) {
                if (am.id === ziel) return true;
                am = am.appliedMaster;
            }
        } catch (e) {}
        return false;
    }
    // Musterobjekt auf einer Seite lösen — an der Stelle, an der die Seite es zeigt.
    // Gemessen (Daniels Kachel-Vorlage, InDesign 21.5): Wurde das Seitenformat nach dem
    // Anlegen des Dokuments geändert, liegt der Innenraum der Musterseite und der alten
    // Seiten verschoben (innen 100–700 statt 0–600). Neue Seiten bekommen dann einen
    // masterPageTransform (−100/0), mit dem InDesign die Musterobjekte richtig ANZEIGT —
    // override() übergeht ihn, der gelöste Rahmen landet genau um diese Verschiebung
    // daneben. Deshalb danach an die angezeigte Stelle schieben: Mitte im Innenraum der
    // Musterseite → masterPageTransform → Innenraum der Seite → Druckbogen.
    function matrixMal(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
    function matrixUmgekehrt(m) {
        var det = m[0] * m[3] - m[1] * m[2], a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
        return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
    }
    function innenNachBogen(obj) { return obj.transformValuesOf(CoordinateSpaces.SPREAD_COORDINATES)[0].matrixValues; }
    function matrixProdukt(a, b) {                          // erst b, dann a
        return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
                a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    }
    // masterPageTransform vom Musterobjekt bis zur Seite, über Basis-Musterseiten hinweg — gemessen:
    // „B basiert auf A“ nach einer Formatänderung angelegt trägt selbst −100/0, und override()
    // übergeht auch den. null, wenn die Kette das Objekt nicht erreicht.
    function musterMatrix(m, seite) {
        var acc = seite.masterPageTransform.matrixValues, ziel = m.parentPage.parent.id, am = seite.appliedMaster;
        for (var tiefe = 0; am && tiefe < 20; tiefe++) {
            if (am.id === ziel) return acc;
            var mp = musterSeiteFuer(am, seite.side);
            if (!mp) return null;
            acc = matrixProdukt(acc, mp.masterPageTransform.matrixValues);
            am = am.appliedMaster;
        }
        return null;
    }
    // Mitte des Musterobjekts auf der Seite (Druckbogen): dort, wo die Seite es zeigt — oder mit
    // ablage=true dort, wo override() es ablegt (alle masterPageTransform übergangen, gemessen).
    // Objekte über den Bund legt override() relativ zu ihrer eigenen Musterseite ab; die Formel
    // rechnet ebenso (gemessen), dort bleibt es wie in 1.5.
    function musterMitteAufSeite(m, seite, ablage) {
        var M = ablage ? [1, 0, 0, 1, 0, 0] : musterMatrix(m, seite);
        if (!M) return null;
        var mitteM = m.resolve(AnchorPoint.CENTER_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES)[0];
        var innen = matrixMal(matrixUmgekehrt(innenNachBogen(m.parentPage)), mitteM);
        return matrixMal(innenNachBogen(seite), matrixMal(M, innen));
    }
    // Lage des Musterrahmens so, wie die Seite ihn zeigt (Format wie lageText), sonst null
    function musterLageAufSeite(m, seite) {
        try {
            var soll = musterMitteAufSeite(m, seite);
            if (!soll) return null;
            var l = lageText(m).split(";"), ecke = seite.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES)[0];
            var dx = (soll[0] - ecke[0]) - (parseFloat(l[1]) + parseFloat(l[3])) / 2, dy = (soll[1] - ecke[1]) - (parseFloat(l[0]) + parseFloat(l[2])) / 2;
            return [(parseFloat(l[0]) + dy).toFixed(2), (parseFloat(l[1]) + dx).toFixed(2), (parseFloat(l[2]) + dy).toFixed(2), (parseFloat(l[3]) + dx).toFixed(2), l[4]].join(";");
        } catch (e) { return null; }
    }
    // Versatz, mit dem eine Seite ihre Musterseite zeigt (Innenraum): gemessen — wird nur
    // eine Seite mittig vergrößert, bleibt ihr masterPageTransform Einheit, ihr Innenraum
    // verschiebt sich, die Musterobjekte stehen dort um die halbe Änderung versetzt.
    // [x, y] oder null (masterPageTransform mit Drehung/Skalierung, nicht lesbar).
    function innenEcke(obj) { return matrixMal(matrixUmgekehrt(innenNachBogen(obj)), obj.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES)[0]); }
    function musterVersatz(seite, mseite) {
        try {
            var m = seite.masterPageTransform.matrixValues;
            if (Math.abs(m[0] - 1) > 1e-6 || Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6 || Math.abs(m[3] - 1) > 1e-6) return null;
            var a = matrixMal(m, innenEcke(mseite)), b = innenEcke(seite);
            return [a[0] - b[0], a[1] - b[1]];
        } catch (e) { return null; }
    }
    function rahmenRuecken(r, dx, dy) {
        var gesperrt = r.locked;
        if (gesperrt) r.locked = false;
        r.transform(CoordinateSpaces.SPREAD_COORDINATES, AnchorPoint.CENTER_ANCHOR, verschiebung(dx, dy));
        if (gesperrt) r.locked = true;
    }
    function loesen(m, seite) {
        var r = m.override(seite);
        try {
            var soll = musterMitteAufSeite(m, seite), ist = r.resolve(AnchorPoint.CENTER_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES)[0];
            if (soll && (Math.abs(soll[0] - ist[0]) > 0.01 || Math.abs(soll[1] - ist[1]) > 0.01)) rahmenRuecken(r, soll[0] - ist[0], soll[1] - ist[1]);
        } catch (e) {}
        return r;
    }
    function feldText(r) {
        for (var i = 0; i < FELDER.length; i++) if (FELDER[i].rahmen.test(r.name)) return FELDER[i].text;
        return null;
    }
    // Von 1.4/1.5 versetzt gelöste Textrahmen: liegen genau dort, wo override() ablegt, statt
    // dort, wo die Seite den Musterrahmen zeigt, und sind seitdem nicht bewegt (Spur "seite"
    // unverändert oder 1.4-Kennung ohne Spur) — an die angezeigte Stelle rücken. Auch auf die
    // Montagefläche gerutschte (parentPage null; im Test das gedrehte Copyright).
    function altVersatzBeheben(seite) {
        var el;
        try { el = seite.parent.pageItems.everyItem().getElements(); } catch (e) { return; }
        for (var k = 0; k < el.length; k++) {
            try {
                var r = el[k], m = musterVon(r), pp = elternSeite(r), feld = feldText(r);
                if (!m || !feld || (pp && pp.id !== seite.id) || r.extractLabel(META_KENNUNG) !== "1") continue;
                var lage = r.extractLabel(META_LAGE);
                if (lage && (!pp || r.extractLabel(META_SPUR) !== "seite" || !lageGleich(lage, lageText(r), lageStellen(r)))) continue;
                var ablage = musterMitteAufSeite(m, seite, true), soll = musterMitteAufSeite(m, seite);
                if (!ablage || !soll) continue;
                var ist = r.resolve(AnchorPoint.CENTER_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES)[0];
                if (Math.abs(ist[0] - ablage[0]) > 0.05 || Math.abs(ist[1] - ablage[1]) > 0.05) continue;
                if (Math.abs(soll[0] - ist[0]) <= 0.05 && Math.abs(soll[1] - ist[1]) <= 0.05) continue;
                rahmenRuecken(r, soll[0] - ist[0], soll[1] - ist[1]);
                if (lage) r.insertLabel(META_LAGE, lageText(r));
                bericht.versatzBehoben.push(seite.name + " (" + feld + ")");
            } catch (e) {}
        }
    }
    // { feldId: Text } für Felder, deren Text bei allen (mindestens zwei) Bildern gleich
    // und nicht leer ist und deren Rahmen die Quellseite von der Musterseite zeigt.
    function musterFeldWerte(eintr, praefix, aktiv) {
        var erg = {}, mit = [], j, k;
        if (!aktiv || !META_AKTIV) return erg;
        for (k = 0; k < eintr.length; k++) if (eintr[k] && eintr[k].meta) mit.push(eintr[k]);
        if (mit.length < 2) return erg;
        for (j = 0; j < FELDER.length; j++) {
            var f = FELDER[j], tr = META_RAHMEN[f.id];
            if (!tr || tr.mehrdeutig) continue;
            var qm = tr.muster ? tr.rahmen : musterVon(tr.rahmen);
            if (!qm || !zeigtMuster(quellSeite, qm)) continue;
            var w = metaWert(mit[0].meta, f, praefix), gleich = !istLeer(w);
            for (k = 1; gleich && k < mit.length; k++) if (!textGleich(metaWert(mit[k].meta, f, praefix), w)) gleich = false;
            if (gleich) erg[f.id] = w;
        }
        return erg;
    }
    // Lage eines Rahmens relativ zu seiner Seite: „oben;links;unten;rechts;Drehung“, und
    // seine Formatierung. Gemerkt statt mit dem Musterrahmen verglichen — auf Seiten mit
    // masterPageTransform (Seitenformat nach dem Anlegen des Dokuments geändert) liegt ein
    // von Hand gelöster Rahmen versetzt (loesen() rückt nur die eigenen zurecht), und wer
    // den Musterrahmen ändert, soll die alten Seitenrahmen trotzdem zurückbekommen.
    function lageText(r) {
        return mitPunkt(function () {
            var g = r.geometricBounds, pb = r.parentPage.bounds;
            return [(g[0] - pb[0]).toFixed(2), (g[1] - pb[1]).toFixed(2), (g[2] - pb[0]).toFixed(2), (g[3] - pb[1]).toFixed(2), (r.rotationAngle || 0).toFixed(2)].join(";");
        });
    }
    // Formatierung als Text: Absatz-/Zeichenformat, Zeichen- und Absatzwerte nur dort, wo
    // sie vom Absatzformat abweichen (eine geänderte Formatdefinition ist keine Handänderung),
    // Teilformatierung, Fläche/Kontur und Textrahmenoptionen.
    function formatText(r) {
        var t = [], ip = null, ps = null, k;
        function txt(v) {
            if (v === null || v === undefined) return "-";
            var art = typeof v;
            if (art === "number" || art === "string" || art === "boolean") return String(v);
            try {
                if (v instanceof Array) {
                    var z = [];
                    for (var i = 0; i < v.length; i++) z.push(txt(v[i]));
                    return "[" + z.join(",") + "]";
                }
            } catch (e0) {}
            try { var n = v.name; if (typeof n === "string") return n; } catch (e1) {}
            try { return String(v); } catch (e2) { return "?"; }
        }
        function lies(fn) { try { return txt(fn()); } catch (e) { return "?"; } }
        try { ip = r.insertionPoints[0]; } catch (e) {}
        try { ps = ip.appliedParagraphStyle; } catch (e) {}
        t.push(lies(function () { return ps; }), lies(function () { return ip.appliedCharacterStyle; }));
        var namen = ["appliedFont", "fontStyle", "pointSize", "leading", "tracking", "capitalization", "baselineShift", "fillColor", "justification"];
        for (k = 0; k < namen.length; k++) {
            var n0 = namen[k];
            var ist = lies(function () { return ip[n0]; }), soll = lies(function () { return ps[n0]; });
            if (n0 === "appliedFont") { ist = ist.split("\t")[0]; soll = soll.split("\t")[0]; }
            t.push(ist === soll ? "=" : ist);
        }
        t.push(lies(function () { return Math.max(1, r.texts[0].textStyleRanges.length); }));   // leere Story meldet 0 Bereiche
        t.push(lies(function () { return r.fillColor; }), lies(function () { return r.strokeColor; }), lies(function () { return r.strokeWeight; }));
        t.push(lies(function () { return r.textFramePreferences.insetSpacing; }),
               lies(function () { return r.textFramePreferences.verticalJustification; }),
               lies(function () { return r.textFramePreferences.autoSizingType; }));
        return t.join("|");
    }
    function spurMerken(r, quelle) {
        try { r.insertLabel(META_LAGE, lageText(r)); r.insertLabel(META_FORMAT, formatText(r)); r.insertLabel(META_SPUR, quelle); } catch (e) {}
    }
    // Welche Lagewerte zählen? Mit automatischer Größenanpassung ändert neuer Text Höhe bzw.
    // Breite — dann nur die feste Richtung und die Drehung vergleichen.
    function lageStellen(r) {
        try {
            var art = r.textFramePreferences.autoSizingType;
            if (art === AutoSizingTypeEnum.OFF) return [0, 1, 2, 3, 4];
            if (art === AutoSizingTypeEnum.HEIGHT_ONLY) return [1, 3, 4];
            if (art === AutoSizingTypeEnum.WIDTH_ONLY) return [0, 2, 4];
            return [4];
        } catch (e) { return [0, 1, 2, 3, 4]; }
    }
    function lageGleich(a, b, stellen) {
        var x = String(a).split(";"), y = String(b).split(";");
        if (x.length < 5 || y.length < 5) return false;
        for (var i = 0; i < stellen.length; i++) if (!(Math.abs(parseFloat(x[stellen[i]]) - parseFloat(y[stellen[i]])) <= 0.5)) return false;
        return true;
    }
    // true, wenn ein gelöster Rahmen von Hand verschoben, gedreht, skaliert oder umformatiert
    // wurde. Verglichen wird mit der Spur, die das Script beim Lösen setzte ("seite"; liegt er
    // stattdessen genau an der Musteranzeige, zählt er als unverändert); sonst
    // (von Hand gelöst: geerbte Musterspur oder gar keine) mit dem Musterrahmen, wie er jetzt
    // ist und wie die Seite ihn zeigt (musterLageAufSeite) — ein von Hand gelöster Rahmen, den
    // InDesign auf Seiten mit masterPageTransform versetzt ablegt, gilt vorsichtshalber als geändert. Script-Rahmen aus 1.4 (Kennung ohne Spur): nicht
    // bekannt → false. Fehler beim Lesen → true (lieber gelöst lassen).
    function vonHandGeaendert(r, muster) {
        try {
            var lage = r.extractLabel(META_LAGE), ist = lageText(r), stellen = lageStellen(r);
            if (lage && r.extractLabel(META_SPUR) === "seite") {
                var formatGleich = r.extractLabel(META_FORMAT) === formatText(r);
                if (lageGleich(lage, ist, stellen)) return !formatGleich;
                // genau an die Stelle geschoben, an der die Seite den Musterrahmen zeigt (etwa ein von 1.5 versetzter Rahmen)
                var anzeige = muster ? musterLageAufSeite(muster, r.parentPage) : null;
                return !(anzeige && lageGleich(anzeige, ist, stellen) && formatGleich);
            }
            if (!lage && r.extractLabel(META_KENNUNG) === "1") return false;
            if (!muster) return true;
            return !lageGleich(musterLageAufSeite(muster, r.parentPage) || lageText(muster), ist, stellen) || formatText(muster) !== formatText(r);
        } catch (e) { return true; }
    }
    // Von Hand geleert: trägt die Script-Kennung (auch vom Muster geerbt), aber keinen Text mehr
    function vonHandGeleert(r, alt) {
        try { return istLeer(alt) && r.extractLabel(META_KENNUNG) === "1" && r.extractLabel(META_WERT) !== ""; } catch (e) { return false; }
    }
    function bleibtGeloest(lokal, muster, seite) {
        return !zeigtMuster(seite, muster) || vonHandGeleert(lokal, rahmenText(lokal)) || vonHandGeaendert(lokal, muster);
    }
    // Welche Seiten zeigen welchen Musterrahmen? "~ID" → [{ offset, name }], Stand vor dem Lauf.
    function seitenKarte() {
        if (seitenKarteSpeicher) return seitenKarteSpeicher;
        var karte = {};
        try {
            var alle = doc.pages.everyItem().getElements();
            for (var p = 0; p < alle.length; p++) {
                var mp = alle[p].masterPageItems;
                for (var i = 0; i < mp.length; i++) {
                    var sch = "~" + mp[i].id;
                    if (!karte[sch]) karte[sch] = [];
                    karte[sch].push({ offset: p, name: alle[p].name });
                }
            }
        } catch (e) {}
        seitenKarteSpeicher = karte;
        return karte;
    }
    // Würde sich der Text eines Musterrahmens ändern — und sehen das auch Seiten außerhalb
    // der Bildstrecke? ziele wie zielePlanen (Quelle und vorhandene Seiten gehören dazu).
    function musterBewerten(m, f, w, ziele) {
        var eigen = {}, aussen = [], aussenOff = [], s = seitenKarte()["~" + m.id] || [], k;
        for (k = 0; k < ziele.length; k++) if (ziele[k].art !== "neu") eigen["~" + ziele[k].offset] = true;
        for (k = 0; k < s.length; k++) if (!eigen["~" + s[k].offset]) { aussen.push(s[k].name); aussenOff.push(s[k].offset); }
        var alt = rahmenText(m), gleich = textGleich(alt, w), fremd = !istLeer(alt) && !vomSkript(m, alt);
        if (gleich) { aussen = []; aussenOff = []; }
        return { m: m, feld: f, wert: w, alt: alt, name: musterName(m), aussen: aussen, aussenOff: aussenOff, fremd: fremd, frage: !gleich && (fremd || aussen.length > 0) };
    }
    // Im Lauf: "schreiben" (Text kommt auf die Musterseite) oder "jeSeite".
    function musterEntscheidFuer(m, f, w) {
        var sch = "~" + m.id;
        if (!musterBewertung[sch]) musterBewertung[sch] = musterBewerten(m, f, w, plan.ziele);
        var b = musterBewertung[sch];
        if (!b.frage || wahl.textVorhanden === "ersetzen") return "schreiben";
        if (!b.fremd) namenMerken(bericht.musterJeSeite, f, b.name);
        return "jeSeite";
    }
    // Musterseiten, die die neuen Seiten eines Plans zeigen werden: Lage aus der Seite davor
    // (Quelle bzw. letzte Seite) abgeleitet, abwechselnd — vor dem Anlegen gelesen.
    function neueMusterseiten(ziele) {
        var am = quellSeite.appliedMaster, erg = [], gesehen = {}, erste = -1, k;
        if (!am) return erg;
        var alle = am.pages.everyItem().getElements();
        if (alle.length < 2 || !doppelseitig(quellSeite)) return alle;
        for (k = 0; k < ziele.length; k++) if (ziele[k].art === "neu" && (erste < 0 || ziele[k].offset < erste)) erste = ziele[k].offset;
        if (erste < 1 || erste - 1 >= doc.pages.length) return alle;
        var lage = doc.pages[erste - 1].side;
        for (k = 0; k < ziele.length; k++) {
            if (ziele[k].art !== "neu") continue;
            var l = lage;
            if ((ziele[k].offset - erste + 1) % 2 === 1) l = lage === PageSideOptions.LEFT_HAND ? PageSideOptions.RIGHT_HAND : PageSideOptions.LEFT_HAND;
            var mp = musterSeiteFuer(am, l);
            if (mp && !gesehen["~" + mp.id]) { gesehen["~" + mp.id] = true; erg.push(mp); }
        }
        return erg.length ? erg : alle;
    }
    // Musterrahmen, die ein Lauf beschreiben würde: auf der Quellseite (für neue Seiten auf
    // allen Musterseiten ihres Druckbogens) und auf den vorhandenen Zielseiten. Liest nur.
    function musterRahmenSammeln(ziele, eintr, musterW) {
        var erg = [], gesehen = {}, quelleT = null, mitNeu = false, k, j;
        function dazu(m, f) {
            var sch = "~" + m.id;
            if (gesehen[sch]) return;
            gesehen[sch] = true;
            erg.push({ m: m, feld: f, wert: musterW[f.id] });
        }
        function ausSeite(t, seite) {
            for (var i = 0; i < FELDER.length; i++) {
                var f = FELDER[i], tr = t[f.id];
                if (musterW[f.id] === undefined || !tr || tr.mehrdeutig) continue;
                try {
                    if (tr.muster) { dazu(tr.rahmen, f); continue; }
                    var mv = musterVon(tr.rahmen);
                    if (mv && !bleibtGeloest(tr.rahmen, mv, seite)) dazu(mv, f);
                } catch (x) {}
            }
        }
        for (k = 0; k < ziele.length && k < eintr.length; k++) {
            var z = ziele[k], e = eintr[k];
            try {
                if (!e || !e.meta || !e.datei.exists) continue;
                if (z.art === "neu") { mitNeu = true; continue; }
                if (z.art === "vorhanden") ausSeite(metaRahmenAufSeite(doc.pages[z.offset]), doc.pages[z.offset]);
                else ausSeite(quelleT || (quelleT = metaRahmenAufSeite(quellSeite)), quellSeite);
            } catch (x2) {}
        }
        if (mitNeu) {
            try {
                if (!quelleT) quelleT = metaRahmenAufSeite(quellSeite);
                var mseiten = neueMusterseiten(ziele);
                for (k = 0; k < mseiten.length; k++) {
                    var tm = metaRahmenAufSeite(mseiten[k]);
                    for (j = 0; j < FELDER.length; j++) {
                        var fm = FELDER[j], trm = tm[fm.id], tq = quelleT[fm.id];
                        if (musterW[fm.id] === undefined || !trm || trm.mehrdeutig || !tq || tq.mehrdeutig) continue;
                        var qm = tq.muster ? tq.rahmen : musterVon(tq.rahmen);
                        if (!qm || (!tq.muster && bleibtGeloest(tq.rahmen, qm, quellSeite))) continue;
                        dazu(trm.rahmen, fm);
                    }
                }
            } catch (x3) {}
        }
        return erg;
    }
    // Gelösten Rahmen einer Seite zur Musterseite zurückführen — nur aufgerufen, wenn der
    // Musterrahmen in diesem Lauf beschrieben wird. true = die Seite zeigt jetzt den
    // Musterrahmen, der Text kommt einmal dort hinein.
    function musterAufloesen(lokal, muster, f, seite, w) {
        var alt = rahmenText(lokal), geleert = vonHandGeleert(lokal, alt);
        var eigen = !geleert && (istLeer(alt) || textGleich(alt, w) || vomSkript(lokal, alt));
        if (!eigen && !geleert && wahl.textVorhanden !== "ersetzen") {    // fremder Text bleibt („stehen lassen“)
            stehenMerken(f, seite);
            uebersatzMerken(lokal, seite, f);
            return false;
        }
        if (geleert || !zeigtMuster(seite, muster) || vonHandGeaendert(lokal, muster)) {
            // Lage, Formatierung oder Leere der Seite bleibt: Rahmen gelöst lassen, Text je Seite
            if (!textGleich(alt, w)) {
                lokal.contents = w;
                lokal.insertLabel(META_KENNUNG, "1");
                lokal.insertLabel(META_WERT, rahmenText(lokal));
            }
            uebersatzMerken(lokal, seite, f);
            bericht.musterGeloest.push(seite.name + " (" + f.text + ")");
            return false;
        }
        lokal.removeOverride();
        namenMerken(bericht.musterZurueck, f, seite.name);
        return true;
    }
    function musterZielMerken(m, f, w) {
        var sch = "~" + m.id;
        if (!musterZiele[sch]) musterZiele[sch] = { rahmen: m, feld: f, wert: w };
    }
    // Quellseite VOR dem Kopieren: gelöste Rahmen zurückführen, damit die neuen Seiten
    // den Musterrahmen zeigen statt einer Kopie ohne Musterbezug.
    function musterQuelleVorbereiten() {
        var t = metaRahmenAufSeite(quellSeite);
        for (var j = 0; j < FELDER.length; j++) {
            var f = FELDER[j], tr = t[f.id], w = musterWerte[f.id];
            if (w === undefined || !tr || tr.mehrdeutig || tr.muster) continue;
            var m = musterVon(tr.rahmen);
            if (!m) continue;
            try {
                if (musterEntscheidFuer(m, f, w) !== "schreiben") continue;     // diesmal je Seite: Rahmen bleibt
                musterErledigt["~" + quellSeite.id + "|" + f.id] = true;
                if (musterAufloesen(tr.rahmen, m, f, quellSeite, w)) musterZielMerken(m, f, w);
            } catch (e) {
                bericht.fehler.push("Seite " + quellSeite.name + ": Textrahmen „" + tr.rahmen.name + "“ ließ sich nicht zur Musterseite zurücksetzen (" + e.message + ")");
            }
        }
    }
    // Zum Schluss: die gesammelten Musterrahmen einmal befüllen (und ihre Spur merken, damit
    // später von Hand gelöste Rahmen als verändert erkannt werden).
    function musterZieleSchreiben() {
        for (var sch in musterZiele) {
            if (!musterZiele.hasOwnProperty(sch)) continue;
            var z = musterZiele[sch], m = z.rahmen, f = z.feld, w = z.wert, ort = musterName(m);
            try {
                if (!m.isValid) continue;
                var alt = rahmenText(m);
                if (!textGleich(alt, w)) {
                    if (!istLeer(alt) && !vomSkript(m, alt) && wahl.textVorhanden !== "ersetzen") { namenMerken(bericht.stehenMuster, f, ort); continue; }
                    m.contents = w;
                    m.insertLabel(META_KENNUNG, "1");
                    m.insertLabel(META_WERT, rahmenText(m));
                }
                spurMerken(m, "muster");
                uebersatzMerken(m, ort, f);
                bericht.musterEingesetzt.push({ ort: ort, feld: f });
            } catch (e) {
                bericht.fehler.push("„" + ort + "“: Textrahmen „" + m.name + "“ ließ sich nicht befüllen (" + e.message + ")");
            }
        }
    }
    function metaFuellen(seite, werte, neu) {
        var t = metaRahmenAufSeite(seite);
        for (var k = 0; k < FELDER.length; k++) {
            var f = FELDER[k], tr = t[f.id];
            if (!META_RAHMEN[f.id]) continue;                     // nur Felder, die die Übersicht angeboten hat
            if (!tr) {                                            // Seite ohne diesen Rahmen: nicht still übergehen
                if (metaWert(werte, f, wahl.praefix) !== "") namenMerken(bericht.ohneTextrahmen, f, seite.name);
                continue;
            }
            if (tr.mehrdeutig) {
                bericht.fehler.push("Seite " + seite.name + ": mehrere Textrahmen „" + tr.rahmen.name + "“ — " + f.text + " nicht eingesetzt");
                continue;
            }
            var wert = metaWert(werte, f, wahl.praefix), imMuster = musterWerte[f.id] !== undefined;
            if (imMuster) {                                       // gleicher Text für alle Bilder
                try {
                    var mv = tr.muster ? tr.rahmen : musterVon(tr.rahmen);
                    if (mv && musterEntscheidFuer(mv, f, musterWerte[f.id]) === "schreiben") {
                        if (tr.muster) { musterZielMerken(tr.rahmen, f, musterWerte[f.id]); continue; }
                        var erl = "~" + seite.id + "|" + f.id;
                        if (!musterErledigt[erl]) {
                            musterErledigt[erl] = true;
                            if (musterAufloesen(tr.rahmen, mv, f, seite, musterWerte[f.id])) musterZielMerken(mv, f, musterWerte[f.id]);
                        }
                        continue;
                    }
                    // Kopie eines gelöst gebliebenen Quellrahmens: folgt der Musterseite ebenfalls nicht
                    if (!mv && neu) bericht.musterGeloest.push(seite.name + " (" + f.text + ")");
                } catch (em) {
                    bericht.fehler.push("Seite " + seite.name + ": Textrahmen „" + tr.rahmen.name + "“ ließ sich nicht zur Musterseite zurücksetzen (" + em.message + ")");
                    continue;
                }
                // sonst: je Seite wie bisher
            }
            if (f.praefix && wert === "" && xmpBereit()) bericht.ohneAutor.push(seite.name);
            var rahmenObj = tr.rahmen, neuGeloest = false;
            try {
                var alt = rahmenText(rahmenObj), leer = istLeer(alt);
                if (tr.muster) {
                    var mEigen = !leer && vomSkript(rahmenObj, alt);  // Script-Text auf der Musterseite (früherer Lauf)
                    if (wert === "" ? (leer || !mEigen) : (!leer && textGleich(alt, wert))) continue;
                    if (!leer && !mEigen && wahl.textVorhanden !== "ersetzen") {       // Mustertext bleibt sichtbar
                        if (imMuster) namenMerken(bericht.stehenMuster, f, musterName(rahmenObj));
                        else stehenMerken(f, seite);
                        continue;
                    }
                    rahmenObj = loesen(tr.rahmen, seite);
                    neuGeloest = true;
                } else if (leer) {
                    if (wert === "") continue;
                } else if (wert !== "" && textGleich(alt, wert)) {
                    uebersatzMerken(rahmenObj, seite, f);
                    continue;                                    // steht schon so da: Format und Kennung bleiben
                } else if (!vomSkript(rahmenObj, alt)) {
                    if (wert === "" && !neu) continue;           // Quelle/vorhandene Seite: fremden Text nie leeren
                    if (wahl.textVorhanden !== "ersetzen") {
                        stehenMerken(f, seite);
                        uebersatzMerken(rahmenObj, seite, f);
                        continue;
                    }
                }
                // Spur beim Lösen setzen und erneuern, solange der Rahmen unverändert ist (neuer Text kann die
                // Höhe ändern); nach einer Handänderung bleibt die alte — sonst würde sie zur neuen Referenz
                var mvSpur = neuGeloest ? null : musterVon(rahmenObj);
                var spurNeu = neuGeloest || (!!mvSpur && !vonHandGeaendert(rahmenObj, mvSpur));
                rahmenObj.contents = wert;
                rahmenObj.insertLabel(META_KENNUNG, wert === "" ? "" : "1");
                rahmenObj.insertLabel(META_WERT, wert === "" ? "" : rahmenText(rahmenObj));   // zurückgelesen: InDesign wandelt Umbrüche
                if (spurNeu) spurMerken(rahmenObj, "seite");
                if (wert !== "") uebersatzMerken(rahmenObj, seite, f);
            } catch (e) {
                bericht.fehler.push("Seite " + seite.name + ": Textrahmen „" + tr.rahmen.name + "“ ließ sich nicht befüllen (" + e.message + ")");
            }
        }
    }

    // Liest nur: Stellen, deren Text der Lauf ersetzen würde, obwohl ihn nicht das Script
    // unverändert eingesetzt hat, und Musterrahmen, deren neuer Text auch Seiten außerhalb
    // der Bildstrecke ändern würde. ziele[i] ↔ eintr[i]. Neue Seiten sind Kopien der
    // Quellseite VOR dem Lauf (arbeiten: erst kopieren, dann befüllen) — ihr Text ist der
    // Text der Quelle. Musterrahmen werden einmal je Rahmen geprüft (musterRahmenSammeln).
    function textKonflikte(ziele, eintr, praefix, musterW) {
        var konf = [], stand = {}, quelleT = null, k, j;
        musterW = musterW || {};
        function standVon(r) {
            var sch = "~" + r.id, st = stand[sch];
            if (!st) {
                var a = rahmenText(r);
                st = stand[sch] = { alt: a, fremd: !istLeer(a) && !vomSkript(r, a) };
            }
            return st;
        }
        for (k = 0; k < ziele.length && k < eintr.length; k++) {
            var z = ziele[k], e = eintr[k], t = null, seite = null;
            try {
                if (!e || !e.meta || !e.datei.exists) continue;
                seite = z.art === "vorhanden" ? doc.pages[z.offset] : quellSeite;
                t = z.art === "vorhanden" ? metaRahmenAufSeite(seite) : (quelleT || (quelleT = metaRahmenAufSeite(quellSeite)));
            } catch (x) { continue; }
            for (j = 0; j < FELDER.length; j++) {
                var f = FELDER[j], tr = t[f.id];
                if (!tr || tr.mehrdeutig || !META_RAHMEN[f.id]) continue;
                try {
                    var st = standVon(tr.rahmen), mw = musterW[f.id];
                    if (mw !== undefined) {                        // gleicher Text → Musterseite
                        if (tr.muster) continue;                   // Musterrahmen: unten, einmal je Rahmen
                        var mv = musterVon(tr.rahmen);
                        if (mv && !bleibtGeloest(tr.rahmen, mv, seite)) {
                            if (st.fremd && !textGleich(st.alt, mw)) {
                                konf.push({ feld: f, seite: z.name, alt: st.alt, neu: mw, kopie: z.art === "neu", muster: false });
                            }
                            continue;
                        }
                        // bleibt gelöst oder ohne Musterbezug: je Seite wie unten
                    }
                    if (!st.fremd) continue;
                    var neuWert = metaWert(e.meta, f, praefix), kopie = z.art === "neu" && !tr.muster;
                    if (neuWert === "" ? !kopie : textGleich(st.alt, neuWert)) continue;
                    konf.push({ feld: f, seite: z.name, alt: st.alt, neu: neuWert, kopie: kopie, muster: !!tr.muster });
                } catch (x2) {}
            }
        }
        var mr = musterRahmenSammeln(ziele, eintr, musterW);
        for (k = 0; k < mr.length; k++) {
            try {
                var b = musterBewerten(mr[k].m, mr[k].feld, mr[k].wert, ziele);
                if (b.frage) konf.push({ feld: b.feld, seite: b.name, alt: b.alt, neu: b.wert, kopie: false, muster: true, musterseite: true, fremd: b.fremd, aussen: b.aussen, aussenOff: b.aussenOff });
            } catch (x3) {}
        }
        return konf;
    }
    function textKurz(t) {
        t = String(t).replace(/\r\n|\n|\r/g, " / ").replace(/\ufffc/g, "[Objekt]").replace(/[\u0000-\u001f]/g, "\u25a2");
        return t.length > 40 ? t.substring(0, 40) + "…" : t;
    }
    // { kopf, bloecke:[{feld, beispiel}] (Reihenfolge wie FELDER), hinweise:[…] }
    function textFrageTeile(konf) {
        var je = {}, k, g, i, leerKopie = false, kopie = false, muster = false, musterFremd = false, aussen = [], aussenGesehen = {};
        var fremdFelder = {}, aussenFelder = {};
        function feldListe(tab) {
            var z = [];
            for (var q = 0; q < FELDER.length; q++) if (tab[FELDER[q].id]) z.push(FELDER[q].text);
            return z.join(", ");
        }
        for (k = 0; k < konf.length; k++) {
            var c = konf[k];
            if (!je[c.feld.id]) je[c.feld.id] = { seiten: [], musterseiten: [], bsp: c, mehr: false };
            else je[c.feld.id].mehr = true;
            if (c.musterseite) {
                var nm = "„" + c.seite + "“", da = false;
                for (i = 0; i < je[c.feld.id].musterseiten.length; i++) if (je[c.feld.id].musterseiten[i] === nm) da = true;
                if (!da) je[c.feld.id].musterseiten.push(nm);
                if (c.fremd) { musterFremd = true; fremdFelder[c.feld.id] = true; }   // Platzhalter: eigener Hinweis unten
                else for (i = 0; c.aussen && i < c.aussen.length; i++) {
                    aussenFelder[c.feld.id] = true;
                    if (!aussenGesehen["~" + c.aussen[i]]) { aussenGesehen["~" + c.aussen[i]] = true; aussen.push({ name: c.aussen[i], off: c.aussenOff ? c.aussenOff[i] : i }); }
                }
            } else {
                je[c.feld.id].seiten.push(c.seite);
                if (c.muster) muster = true;
            }
            if (c.kopie) { kopie = true; if (c.neu === "") leerKopie = true; }
        }
        var teile = { kopf: aussen.length
                            ? (konf.length === 1 ? "Eine Stelle braucht eine Entscheidung:" : konf.length + " Stellen brauchen eine Entscheidung:")
                            : (konf.length === 1 ? "An einer Stelle steht" : "An " + konf.length + " Stellen steht") + " schon Text, der ersetzt würde (nicht vom Script eingesetzt):",
                      bloecke: [], hinweise: [] };
        for (k = 0; k < FELDER.length; k++) {
            g = je[FELDER[k].id];
            if (!g) continue;
            var wo = [];
            if (g.seiten.length) wo.push("S. " + seitenAufzaehlung(g.seiten));
            if (g.musterseiten.length) wo.push("Musterseite " + g.musterseiten.join(", "));
            teile.bloecke.push({ feld: FELDER[k].text + " · " + wo.join(" · "),
                beispiel: (istLeer(g.bsp.alt) ? "leer" : "„" + textKurz(g.bsp.alt) + "“") + " → " + (g.bsp.neu === "" ? "leer" : "„" + textKurz(g.bsp.neu) + "“") + (g.mehr ? "  (Beispiel)" : "") });
        }
        if (kopie) teile.hinweise.push("Die neuen Seiten sind Kopien von Seite " + quellSeite.name + " und tragen deren Text." +
                                       (leerKopie ? " „Überschreiben“ leert ihn dort, wo das Bild keinen Text hat." : ""));
        if (muster) teile.hinweise.push("Text aus der Musterseite bleibt bei „Stehen lassen“ auf diesen Seiten sichtbar.");
        if (musterFremd) teile.hinweise.push("Platzhalter im Musterrahmen (" + feldListe(fremdFelder) + "): „Überschreiben“ ändert den Text auf der Musterseite — für alle Seiten mit dieser Musterseite; „Stehen lassen“ lässt ihn stehen, auch auf den Seiten dieser Bildstrecke.");
        if (aussen.length) {
            aussen.sort(function (a, b) { return a.off - b.off; });
            var aussenNamen = [];
            for (i = 0; i < aussen.length; i++) aussenNamen.push(aussen[i].name);
            teile.hinweise.push(feldListe(aussenFelder) + ": Die Musterseite gilt auch für S. " + seitenAufzaehlung(aussenNamen) + " außerhalb dieser Bildstrecke: „Überschreiben“ ändert den Text dort mit, „Stehen lassen“ setzt die Texte dieser Bildstrecke auf den einzelnen Seiten ein.");
        }
        return teile;
    }
    function textFrageText(konf) {                         // confirm im Hauptablauf: Ja = stehen lassen
        var t = textFrageTeile(konf), z = [t.kopf], k;
        for (k = 0; k < t.bloecke.length; k++) z.push(t.bloecke[k].feld + ":  " + t.bloecke[k].beispiel);
        for (k = 0; k < t.hinweise.length; k++) { if (k === 0) z.push(""); z.push(t.hinweise[k]); }
        z.push(""); z.push("Soll der vorhandene Text stehen bleiben?"); z.push("");
        z.push("Ja: Er bleibt stehen; leere und vom Script gefüllte Rahmen bekommen die neuen Texte.");
        z.push("Nein: Die Texte aus der Übersicht ersetzen ihn.");
        return z.join("\n");
    }

    var META_RAHMEN = metaRahmenAufSeite(quellSeite);
    var META_AKTIV = false;
    for (var mf0 = 0; mf0 < FELDER.length; mf0++) if (META_RAHMEN[FELDER[mf0].id]) META_AKTIV = true;

    // Sichtbare Ausrichtung → Innenachsen des gewählten Rahmens, wie beim Platzieren:
    // in 90°/180°/gespiegelten Rahmen liegt „oben“ innen woanders (Kachel, Bezugspunkt).
    var RAHMEN_INNEN = { h: sichtbarNachInnen(rahmen, 1, 0), v: sichtbarNachInnen(rahmen, 0, 1) };
    function innenLage(ah, av) {
        return [ah * RAHMEN_INNEN.h[0] + av * RAHMEN_INNEN.v[0], ah * RAHMEN_INNEN.h[1] + av * RAHMEN_INNEN.v[1]];
    }

    // ------------------------------------------------------------------------
    // Gemerkte Wahl: „r|e|s|name=wert|…“ — die ersten drei Felder wie in 1.2,
    // dahinter benannte Felder (ältere Fassungen lesen nur die ersten drei).
    // ------------------------------------------------------------------------

    function achse(w) { w = parseInt(w, 10); return w < 0 ? -1 : (w > 0 ? 1 : 0); }
    var wahl = { reihenfolge: 0, einpassung: 0, spiegeln: true, ah: 0, av: 0, ziel: 0,
                 praefix: PRAEFIX_VORGABE, textVorhanden: null, musterTexte: true };   // textVorhanden: "lassen"|"ersetzen"|null (nicht gefragt) — nie gemerkt
    try {
        var gemerkt = app.extractLabel(MERKER_WAHL).split("|");
        if (gemerkt.length >= 2) {
            var r0 = parseInt(gemerkt[0], 10), e0 = parseInt(gemerkt[1], 10);
            if (r0 >= 0 && r0 < REIHENFOLGEN.length) wahl.reihenfolge = r0;
            if (e0 >= 0 && e0 < EINPASSUNGEN.length) wahl.einpassung = e0;
            if (gemerkt.length >= 3) wahl.spiegeln = gemerkt[2] !== "0";
            for (var mk = 3; mk < gemerkt.length; mk++) {
                var paar = gemerkt[mk].split("=");
                if (paar.length !== 2) continue;
                if (paar[0] === "aus") {
                    var hv = paar[1].split(",");
                    wahl.ah = achse(hv[0]);
                    wahl.av = achse(hv[1]);
                } else if (paar[0] === "ziel") {
                    var z0 = parseInt(paar[1], 10);
                    if (z0 >= 0 && z0 <= 2) wahl.ziel = z0;
                } else if (paar[0] === "praefix") {                     // URI-kodiert: | = % und Leerzeichen sicher
                    try { wahl.praefix = decodeURIComponent(paar[1]); } catch (e1) { wahl.praefix = PRAEFIX_VORGABE; }
                } else if (paar[0] === "muster") {
                    wahl.musterTexte = paar[1] !== "0";
                }
            }
        }
    } catch (e) {}
    if (TEST) {
        wahl.reihenfolge = TEST.reihenfolge || 0;
        wahl.einpassung = TEST.einpassung || 0;
        wahl.spiegeln = TEST.spiegeln !== false;
        wahl.ah = achse(TEST.ah);
        wahl.av = achse(TEST.av);
        wahl.ziel = TEST.ziel || 0;
        wahl.praefix = TEST.praefix !== undefined ? String(TEST.praefix) : "";
        wahl.textVorhanden = (TEST.textVorhanden === "lassen" || TEST.textVorhanden === "ersetzen") ? TEST.textVorhanden
                           : (TEST.textVorhanden === "fragen" ? null : "ersetzen");
        wahl.musterTexte = TEST.musterTexte === true;
    }
    function merkerSchreiben() {
        if (TEST) return;
        try {
            app.insertLabel(MERKER_WAHL, wahl.reihenfolge + "|" + wahl.einpassung + "|" + (wahl.spiegeln ? 1 : 0) +
                                         "|aus=" + wahl.ah + "," + wahl.av + "|ziel=" + Math.min(wahl.ziel, 2) +
                                         "|praefix=" + encodeURIComponent(wahl.praefix) + "|muster=" + (wahl.musterTexte ? 1 : 0));
        } catch (e) {}
    }

    // ------------------------------------------------------------------------
    // Einträge: eine Datei oder eine Seite daraus
    // ------------------------------------------------------------------------

    // { datei: File, seite: 0 (Bild) | n (PDF/AI/INDD), anzahl: Seiten (0 = unbekannt),
    //   geteilt, ah/av: Ausrichtung -1|0|1 (links|mitte|rechts, oben|mitte|unten),
    //   rel: Unterordner, meta: { titel, unterschrift, copyright (= reiner Autor, ohne Präfix), stadt } }
    // „vorlage“ liefert Ausrichtung, Unterordner und Texte (z. B. beim Aufteilen).
    function eintrag(datei, seite, vorlage) {
        var mehr = MEHRSEITIG.test(datei.name) || INDD.test(datei.name);
        var e = { datei: datei, seite: mehr ? (seite || 1) : 0, anzahl: 0, geteilt: false,
                  ah: vorlage ? achse(vorlage.ah) : 0, av: vorlage ? achse(vorlage.av) : 0,
                  rel: (vorlage && vorlage.rel) ? vorlage.rel : "", meta: null };
        if (META_AKTIV) e.meta = (vorlage && vorlage.meta) ? werteKopie(vorlage.meta) : metaLesen(datei);
        return e;
    }
    function schluessel(e) { return e.datei.fsName + "#" + (e.seite || 0); }
    // Seite zeigen/wählbar: mehrseitige PDF/AI, INDD, und unter Windows jede
    // PDF/AI (dort ist die Seitenzahl unbekannt).
    function seiteZeigen(e) {
        return !!e.seite && (e.anzahl > 1 || INDD.test(e.datei.name) || (!MAC && MEHRSEITIG.test(e.datei.name)));
    }
    function anzeigeName(e) {
        var t = (e.rel ? e.rel + "/" : "") + e.datei.displayName;
        if (seiteZeigen(e)) {
            t += " · S. " + e.seite + (e.anzahl > 1 ? "/" + e.anzahl : "");
        }
        return t;
    }

    function dateienWaehlen() {
        var startOrdner = Folder(app.extractLabel(MERKER_ORDNER));
        if (!startOrdner.exists) startOrdner = Folder.desktop;
        var filter = function (f) {
            return (f instanceof Folder) || BILDENDUNGEN.test(f.name);
        };
        if (!MAC) {
            filter = "Bilder und PDF:*.jpg;*.jpeg;*.tif;*.tiff;*.psd;*.png;*.pdf;*.ai;*.eps;*.gif;*.bmp;*.indd,Alle Dateien:*.*";
        }
        var gewaehlt = startOrdner.openDlg("Bilder für den Rahmen wählen (Mehrfachauswahl)", filter, true);
        if (!gewaehlt) return [];
        if (!(gewaehlt instanceof Array)) gewaehlt = [gewaehlt];
        var gut = [];
        for (var k = 0; k < gewaehlt.length; k++) {
            // Unter Windows lässt „Alle Dateien“ auch Fremdes durch.
            if (gewaehlt[k] instanceof File && gewaehlt[k].exists && BILDENDUNGEN.test(gewaehlt[k].name)) gut.push(gewaehlt[k]);
        }
        if (gut.length) {
            try { app.insertLabel(MERKER_ORDNER, gut[0].parent.fsName); } catch (e) {}
        }
        return gut;
    }

    var eintraege = [];
    if (TEST && TEST.eintraege) {
        for (var t0 = 0; t0 < TEST.eintraege.length; t0++) {
            var te = TEST.eintraege[t0];
            var neuT = eintrag(te.datei, te.seite, te.ah !== undefined ? te : wahl);
            if (te.meta && neuT.meta) {
                for (var tm = 0; tm < FELDER.length; tm++) {
                    if (te.meta[FELDER[tm].id] !== undefined) neuT.meta[FELDER[tm].id] = te.meta[FELDER[tm].id];
                }
            }
            eintraege.push(neuT);
        }
    } else if (TEST && TEST.ordner) {
        var ogT = ordnerEinlesen(TEST.ordner, wahl);
        if (ogT) eintraege = ogT.eintraege;
        if (ogT && ogT.mehrereOrdner && wahl.reihenfolge === 0) wahl.reihenfolge = ORDNER_SORT;
    } else {
        var gewaehlteDateien = TEST ? TEST.dateien.slice(0) : dateienWaehlen();
        for (var t1 = 0; t1 < gewaehlteDateien.length; t1++) eintraege.push(eintrag(gewaehlteDateien[t1], 1, wahl));
    }
    if (eintraege.length === 0) {
        if (TEST) melden("Keine Bilddatei gewählt.");
        return;                                     // abgebrochen oder leer
    }

    // ------------------------------------------------------------------------
    // Sortieren — Seiten einer Datei bleiben immer aufsteigend zusammen
    // ------------------------------------------------------------------------

    // Natürliche Sortierung: „Bild 2“ vor „Bild 10“, Groß/klein egal. Zerlegte
    // Namen werden gemerkt — bei 600 Bildern laufen rund 9000 Vergleiche.
    function zerlegen(text) {
        var sch = "~" + text, t = zerlegt[sch];
        if (!t) t = zerlegt[sch] = String(text).toLowerCase().match(/(\d+|\D+)/g) || [];
        return t;
    }
    function textNatuerlich(sx, sy) {
        var x = zerlegen(sx), y = zerlegen(sy);
        for (var k = 0; k < x.length && k < y.length; k++) {
            if (x[k] === y[k]) continue;
            if (/^\d/.test(x[k]) && /^\d/.test(y[k])) {
                // Ziffernblöcke als Text vergleichen: parseInt rundet ab 17 Stellen,
                // gleich gerundete Nachbarn machten die Sortierung widersprüchlich
                var a = x[k].replace(/^0+/, "") || "0", b = y[k].replace(/^0+/, "") || "0";
                if (a.length !== b.length) return a.length - b.length;
                if (a !== b) return a < b ? -1 : 1;
                return x[k].length - y[k].length;  // „02“ nach „2“
            }
            return x[k] < y[k] ? -1 : 1;
        }
        return x.length - y.length;
    }
    // Die Vergleiche arbeiten auf vorab gelesenen Schlüsseln (name, fs, zeit,
    // teile): jeder Zugriff auf eine Dateieigenschaft kostet in ExtendScript
    // Zeit — 600 Bilder „Ordner, dann Dateiname“ brauchten so 17,6 s (gemessen).
    function natuerlich(a, b) {
        var d = textNatuerlich(a.name, b.name);
        return d !== 0 ? d : (a.fs < b.fs ? -1 : (a.fs > b.fs ? 1 : 0));
    }
    // „Ordner, dann Dateiname“: Ordner natürlich sortiert, Dateien vor Unterordnern.
    function nachOrdner(a, b) {
        var x = a.teile, y = b.teile, n = Math.min(x.length, y.length) - 1;
        for (var k = 0; k < n; k++) {
            if (x[k] === y[k]) continue;
            var d = textNatuerlich(x[k], y[k]);
            return d !== 0 ? d : (x[k] < y[k] ? -1 : 1);
        }
        if (x.length !== y.length) return x.length - y.length;
        return natuerlich(a, b);
    }
    function nachDatum(a, b) {
        var abstand = a.zeit - b.zeit;
        return abstand !== 0 ? abstand : natuerlich(a, b);
    }
    function sortiert(liste, art) {
        var vergleich = (art === 2 || art === 3) ? nachDatum : (art === ORDNER_SORT ? nachOrdner : natuerlich);
        var richtung = (art === 1 || art === 3) ? -1 : 1, mitDatum = art === 2 || art === 3, deko = [], k;
        for (k = 0; k < liste.length; k++) {
            var d = liste[k].datei, fs = d.fsName, zeit = 0;
            if (mitDatum) { try { zeit = d.modified ? d.modified.getTime() : 0; } catch (x) { zeit = 0; } }
            deko.push({ e: liste[k], i: k, fs: fs, name: d.displayName, zeit: zeit, teile: art === ORDNER_SORT ? fs.split(/[\/\\]/) : null });
        }
        deko.sort(function (a, b) {
            var d = richtung * vergleich(a, b);
            if (d !== 0) return d;
            d = (a.e.seite || 0) - (b.e.seite || 0);
            return d !== 0 ? d : a.i - b.i;
        });
        var kopie = [];
        for (k = 0; k < deko.length; k++) kopie.push(deko[k].e);
        return kopie;
    }

    // „1-3, 7“ | „alle“ -> [1,2,3,7]; null = Eingabefehler. max 0 = unbekannt.
    function seitenLesen(text, max) {
        var t = String(text).toLowerCase().replace(/\s+/g, ""), aus = [], da = {}, k, a, b, s;
        if (t === "" || t === "alle") {
            if (!max) return null;
            for (k = 1; k <= max; k++) aus.push(k);
            return aus;
        }
        var teile = t.split(/[,;]/);
        for (k = 0; k < teile.length; k++) {
            if (teile[k] === "") continue;
            var m = teile[k].match(/^(\d{1,6})(?:-(\d{0,6}))?$/);
            if (!m) return null;
            a = parseInt(m[1], 10);
            var offen = teile[k].indexOf("-") > 0 && (m[2] === undefined || m[2] === "");
            if (offen && !max) return null;
            b = offen ? max : ((m[2] === undefined || m[2] === "") ? a : parseInt(m[2], 10));
            if (!max && Math.abs(b - a) > 999) return null;
            if (max) {
                if (a > max && b > max) continue;
                a = Math.min(a, max);
                b = Math.min(b, max);
            }
            var schritt = a <= b ? 1 : -1;
            for (s = a; schritt > 0 ? s <= b : s >= b; s += schritt) {
                if (s >= 1 && (!max || s <= max) && !da[s]) { da[s] = true; aus.push(s); }
            }
        }
        return aus.length ? aus : null;
    }

    // ------------------------------------------------------------------------
    // Vorschaubilder und Seitenzahlen
    // ------------------------------------------------------------------------

    // Auf dem Mac erledigt ein kleines JXA-Programm (osascript, in jedem macOS
    // enthalten) alles in einem Rutsch: Bilder über ImageIO (beachtet die
    // EXIF-Drehung von Kamera-/Handyfotos, liefert die Pixelmaße), PDF/AI über
    // CoreGraphics (Seitenwahl, /Rotate, Beschnittrahmen) und Seitenzahlen.
    // Ergebnisse landen als PNG + Maße in Folder.temp und bleiben dort liegen.
    var VORSCHAU_JXA = [
        "// dwb_vorschau.js - Helfer fuer Bilder-in-Rahmen.jsx (nur macOS, JXA)",
        "// Aufruf:  /usr/bin/osascript -l JavaScript dwb_vorschau.js AUFTRAG ERGEBNIS",
        "// AUFTRAG (UTF-8, eine Aufgabe je Zeile, Felder durch TAB getrennt):",
        "//   Z <TAB> pfad                                          Seitenzahl (PDF/AI)",
        "//   V <TAB> pfad <TAB> seite <TAB> png <TAB> kante <TAB> box   Vorschau-PNG",
        "//        Bilder ueber ImageIO (EXIF-Drehung beachtet), PDF/AI ueber CGPDF",
        "//        seite ab 1 (nur PDF/AI), box = media|crop|bleed|trim|art (nur PDF/AI)",
        "// ERGEBNIS (UTF-8, eine Zeile je Aufgabe):",
        "//   Z <TAB> pfad <TAB> anzahl <TAB> fehler",
        "//   V <TAB> pfad <TAB> seite <TAB> png <TAB> breite <TAB> hoehe <TAB> origB <TAB> origH <TAB> fehler",
        "// Neben jedes PNG kommt eine .txt mit \"breite hoehe origB origH\" (Cache).",
        "// Datei bewusst nur ASCII.",
        "ObjC.import('Foundation');",
        "ObjC.import('AppKit');",
        "ObjC.import('Quartz');",
        "ObjC.import('ImageIO');",
        "",
        "var BOXEN = { media: 0, crop: 1, bleed: 2, trim: 3, art: 4 };",
        "",
        "function istPdf(pfad) { return /\\.(pdf|ai)$/i.test(pfad); }",
        "",
        "function oeffnen(cache, pfad) {",
        "    if (cache.hasOwnProperty(pfad)) return cache[pfad];",
        "    var e = { doc: null, fehler: '' };",
        "    if (!$.NSFileManager.defaultManager.fileExistsAtPath(pfad)) {",
        "        e.fehler = 'fehlt';",
        "    } else {",
        "        var d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pfad));",
        "        if (!d || d.isNil()) e.fehler = 'kein PDF';",
        "        else if (d.isLocked) e.fehler = 'kennwortgeschuetzt';",
        "        else if (d.pageCount < 1) e.fehler = 'keine Seiten';",
        "        else e.doc = d;",
        "    }",
        "    cache[pfad] = e;",
        "    return e;",
        "}",
        "",
        "function pngSchreiben(rep, ziel, mass) {",
        "    var daten = rep.representationUsingTypeProperties(4, $());      // 4 = PNG",
        "    if (!daten || daten.isNil() || !daten.writeToFileAtomically(ziel, true)) throw new Error('PNG nicht geschrieben');",
        "    $.NSString.alloc.initWithUTF8String(mass.join(' ') + '\\n')",
        "        .writeToFileAtomicallyEncodingError(ziel.replace(/\\.png$/i, '') + '.txt', true, $.NSUTF8StringEncoding, null);",
        "}",
        "",
        "function pdfVorschau(doc, index, ziel, kante, box) {",
        "    var p = doc.pageAtIndex(index);",
        "    var ref = p.pageRef;",
        "    var b = $.CGPDFPageGetBoxRect(ref, box);",
        "    var bx = b.origin.x, by = b.origin.y, bw = b.size.width, bh = b.size.height;",
        "    var rot = (($.CGPDFPageGetRotationAngle(ref) % 360) + 360) % 360;",
        "    var w = bw, h = bh;",
        "    if (rot === 90 || rot === 270) { w = bh; h = bw; }",
        "    if (!(w > 0 && h > 0)) throw new Error('Seite ohne Flaeche');",
        "    var s = kante / Math.max(w, h);",
        "    var pw = Math.max(1, Math.round(w * s)), ph = Math.max(1, Math.round(h * s));",
        "    var rep = $.NSBitmapImageRep.alloc",
        "        .initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(",
        "            null, pw, ph, 8, 4, true, false, 'NSDeviceRGBColorSpace', 0, 0);",
        "    var ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);",
        "    var cg = ctx.CGContext;",
        "    $.CGContextSetRGBFillColor(cg, 1, 1, 1, 1);",
        "    $.CGContextFillRect(cg, $.CGRectMake(0, 0, pw, ph));",
        "    $.CGContextScaleCTM(cg, pw / w, ph / h);",
        "    $.CGContextClipToRect(cg, $.CGRectMake(0, 0, w, h));",
        "    if (rot === 90)       { $.CGContextTranslateCTM(cg, 0, bw);  $.CGContextRotateCTM(cg, -Math.PI / 2); }",
        "    else if (rot === 180) { $.CGContextTranslateCTM(cg, bw, bh); $.CGContextRotateCTM(cg, Math.PI); }",
        "    else if (rot === 270) { $.CGContextTranslateCTM(cg, bh, 0);  $.CGContextRotateCTM(cg, Math.PI / 2); }",
        "    $.CGContextTranslateCTM(cg, -bx, -by);",
        "    $.CGContextDrawPDFPage(cg, ref);",
        "    ctx.flushGraphics;",
        "    var mass = [pw, ph, Math.round(w), Math.round(h)];            // Original in pt",
        "    pngSchreiben(rep, ziel, mass);",
        "    return mass;",
        "}",
        "",
        "function zahl(d, k) {",
        "    var v = d.objectForKey(k);",
        "    return (v && !v.isNil()) ? Number(v.js) : 0;",
        "}",
        "",
        "function bildVorschau(pfad, ziel, kante) {",
        "    if (!$.NSFileManager.defaultManager.fileExistsAtPath(pfad)) throw new Error('fehlt');",
        "    var src = $.CGImageSourceCreateWithURL($.NSURL.fileURLWithPath(pfad), $());",
        "    if (!src) throw new Error('nicht lesbar');",
        "    var roh = $.CGImageSourceCopyPropertiesAtIndex(src, 0, $());",
        "    if (!roh) throw new Error('nicht lesbar');",
        "    var props = ObjC.castRefToObject(roh);",
        "    if (!props || typeof props.objectForKey !== 'function') throw new Error('nicht lesbar');",
        "    var ow = zahl(props, 'PixelWidth'), oh = zahl(props, 'PixelHeight'), ori = zahl(props, 'Orientation');",
        "    if (ori >= 5 && ori <= 8) { var t = ow; ow = oh; oh = t; }        // angezeigte Lage",
        "    var opt = $.NSMutableDictionary.dictionary;",
        "    opt.setObjectForKey($.NSNumber.numberWithBool(true), 'kCGImageSourceCreateThumbnailFromImageAlways');",
        "    opt.setObjectForKey($.NSNumber.numberWithBool(true), 'kCGImageSourceCreateThumbnailWithTransform');",
        "    opt.setObjectForKey($.NSNumber.numberWithInt(kante), 'kCGImageSourceThumbnailMaxPixelSize');",
        "    var img = $.CGImageSourceCreateThumbnailAtIndex(src, 0, opt);",
        "    if (!img) throw new Error('nicht lesbar');",
        "    var rep = $.NSBitmapImageRep.alloc.initWithCGImage(img);",
        "    if (!rep || rep.isNil()) throw new Error('nicht lesbar');",
        "    var mass = [Number($.CGImageGetWidth(img)), Number($.CGImageGetHeight(img)), ow, oh];",
        "    pngSchreiben(rep, ziel, mass);",
        "    return mass;",
        "}",
        "",
        "function run(argv) {",
        "    var cache = {}, aus = [];",
        "    var roh = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);",
        "    var zeilen = (roh && !roh.isNil()) ? roh.js.replace(new RegExp('^' + String.fromCharCode(0xFEFF)), '').split(/\\r\\n|\\r|\\n/) : [];",
        "    for (var i = 0; i < zeilen.length; i++) {",
        "        var f = zeilen[i].split('\\t');",
        "        if (f.length < 2 || !f[1]) continue;",
        "        if (f[0] === 'Z') {",
        "            var e = oeffnen(cache, f[1]);",
        "            aus.push(['Z', f[1], e.doc ? e.doc.pageCount : 0, e.fehler].join('\\t'));",
        "        } else if (f[0] === 'V') {",
        "            var seite = parseInt(f[2], 10) || 1, kante = parseInt(f[4], 10) || 240;",
        "            var mass = [0, 0, 0, 0], fehler = '';",
        "            try {",
        "                if (istPdf(f[1])) {",
        "                    var d = oeffnen(cache, f[1]);",
        "                    if (d.fehler) throw new Error(d.fehler);",
        "                    if (!(seite >= 1 && seite <= d.doc.pageCount)) throw new Error('Seite fehlt');",
        "                    mass = pdfVorschau(d.doc, seite - 1, f[3], kante, BOXEN.hasOwnProperty(f[5]) ? BOXEN[f[5]] : 1);",
        "                } else {",
        "                    mass = bildVorschau(f[1], f[3], kante);",
        "                }",
        "            } catch (x) { fehler = String(x.message || x); }",
        "            aus.push(['V', f[1], f[2], f[3], mass[0], mass[1], mass[2], mass[3], fehler].join('\\t'));",
        "        }",
        "    }",
        "    $.NSString.alloc.initWithUTF8String(aus.join('\\n') + '\\n')",
        "        .writeToFileAtomicallyEncodingError(argv[1], true, $.NSUTF8StringEncoding, null);",
        "}"
    ];

    function kennzahl(text) {
        var h = 5381;
        for (var k = 0; k < text.length; k++) h = (((h << 5) + h) ^ text.charCodeAt(k)) >>> 0;
        return h.toString(16);
    }
    function alsAppleScriptText(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
    function textSchreiben(f, text) {
        f.encoding = "UTF-8";
        f.lineFeed = "Unix";
        if (!f.open("w")) return false;
        f.write(text);
        f.close();
        return true;
    }
    function textLesen(f) {
        f.encoding = "UTF-8";
        if (!f.exists || !f.open("r")) return null;
        var t = f.read();
        f.close();
        return t;
    }

    var hilfsOrdner = null, hilfsProgramm = null;
    function hilfsOrdnerHolen() {
        if (hilfsOrdner) return hilfsOrdner;
        var o = Folder(Folder.temp.fsName + "/dwb_bilder_in_rahmen");
        if (!o.exists) o.create();
        hilfsOrdner = o;
        // Vorschauen älter als 30 Tage fliegen raus — höchstens einmal am Tag:
        // getFiles() brauchte für 1300 Vorschauen 4,5 s bei jedem Start (gemessen).
        try {
            var heute = String(Math.floor(new Date().getTime() / 86400000));
            if (app.extractLabel(MERKER_AUFGERAEUMT) !== heute) {
                app.insertLabel(MERKER_AUFGERAEUMT, heute);
                if (MAC) {
                    app.doScript("do shell script " + alsAppleScriptText("/usr/bin/find " + shellText(o.fsName) +
                                 " -maxdepth 1 -name 'v_*' -mtime +30 -delete 2>/dev/null; exit 0"), ScriptLanguage.APPLESCRIPT_LANGUAGE);
                } else {
                    var vorhanden = o.getFiles("v_*"), grenze = new Date().getTime() - 30 * 24 * 3600 * 1000;
                    for (var k = 0; k < vorhanden.length; k++) {
                        if (vorhanden[k].modified.getTime() < grenze) vorhanden[k].remove();
                    }
                }
            }
        } catch (e) {}
        return o;
    }

    // Aufträge (Zeilen „Z\tpfad“ / „V\tpfad\tseite\tpng\tkante\tbox“) an das
    // Hilfsprogramm; zurück kommen die Ergebniszeilen als Arrays.
    function hilfeAufrufen(zeilen) {
        var aus = [];
        if (!MAC || !zeilen.length) return aus;
        var o = hilfsOrdnerHolen();
        if (!hilfsProgramm) {
            hilfsProgramm = File(o.fsName + "/dwb_vorschau_12.js");
            if (!textSchreiben(hilfsProgramm, VORSCHAU_JXA.join("\n") + "\n")) { hilfsProgramm = null; return aus; }
        }
        var stempel = new Date().getTime() + "_" + Math.floor(Math.random() * 1000000);
        var auftrag = File(o.fsName + "/auftrag_" + stempel + ".txt");
        var ergebnis = File(o.fsName + "/ergebnis_" + stempel + ".txt");
        if (!textSchreiben(auftrag, zeilen.join("\n") + "\n")) return aus;
        try {
            app.doScript('do shell script "/usr/bin/osascript -l JavaScript " & quoted form of ' + alsAppleScriptText(hilfsProgramm.fsName) +
                         ' & " " & quoted form of ' + alsAppleScriptText(auftrag.fsName) +
                         ' & " " & quoted form of ' + alsAppleScriptText(ergebnis.fsName) + ' & " 2>/dev/null"',
                         ScriptLanguage.APPLESCRIPT_LANGUAGE);
        } catch (e) {}
        var roh = textLesen(ergebnis);
        if (roh) {
            var z = roh.split("\n");
            for (var k = 0; k < z.length; k++) if (z[k]) aus.push(z[k].split("\t"));
        }
        try { auftrag.remove(); } catch (e) {}
        try { ergebnis.remove(); } catch (e) {}
        return aus;
    }

    // Welche PDF-Box die Vorschau zeigt — dieselbe, mit der InDesign platziert.
    function vorschauBox() {
        try {
            var c = app.pdfPlacePreferences.pdfCrop;
            if (c === PDFCrop.CROP_MEDIA) return "media";
            if (c === PDFCrop.CROP_TRIM) return "trim";
            if (c === PDFCrop.CROP_BLEED) return "bleed";
            if (c === PDFCrop.CROP_ART) return "art";
        } catch (e) {}
        return "crop";
    }

    var seitenzahlen = {};                          // fsName -> Seiten (0 = unbekannt/kein PDF)

    function vorschauenLaden(liste, speicher) {
        var box = vorschauBox();
        var auftraege = [], zaehlen = {}, offen = [], k, e, anzahlV = 0;
        for (k = 0; k < liste.length; k++) {
            e = liste[k];
            var pfad = e.datei.fsName;
            var ungeeignet = /[\t\r\n]/.test(pfad);
            if (MAC && !ungeeignet && MEHRSEITIG.test(e.datei.name) &&
                seitenzahlen[pfad] === undefined && !zaehlen[pfad]) {
                auftraege.push("Z\t" + pfad);
                zaehlen[pfad] = true;
            }
            var sch = schluessel(e);
            if (speicher[sch]) continue;
            if (!MAC) {
                var w = { bild: null, b: 0, h: 0, ob: 0, oh: 0, fehler: "" };
                if (/\.(png|jpe?g)$/i.test(e.datei.name)) {
                    try {
                        w.bild = ScriptUI.newImage(e.datei);
                        w.b = w.ob = w.bild.size[0];
                        w.h = w.oh = w.bild.size[1];
                    } catch (x) { w.bild = null; w.fehler = "nicht lesbar"; }
                } else {
                    w.fehler = "keine Vorschau";
                }
                speicher[sch] = w;
                continue;
            }
            if (ungeeignet || !LESBAR.test(e.datei.name) && !MEHRSEITIG.test(e.datei.name)) {
                speicher[sch] = { bild: null, b: 0, h: 0, ob: 0, oh: 0, fehler: "keine Vorschau" };
                continue;
            }
            var geaendert = e.datei.exists ? e.datei.modified : null;
            if (!geaendert) {
                speicher[sch] = { bild: null, b: 0, h: 0, ob: 0, oh: 0, fehler: "fehlt" };
                continue;
            }
            var mehr = MEHRSEITIG.test(e.datei.name);
            var basis = hilfsOrdnerHolen().fsName + "/v_" +
                        kennzahl(pfad + "|" + geaendert.getTime() + "|" + e.datei.length) + "_" + VORSCHAU_PX +
                        (mehr ? "_s" + e.seite + "_" + box : "_b");
            var png = File(basis + ".png"), mass = File(basis + ".txt");
            if (!png.exists || !mass.exists) {
                auftraege.push(["V", pfad, e.seite || 1, png.fsName, VORSCHAU_PX, box].join("\t"));
                anzahlV++;
            }
            offen.push({ sch: sch, png: png, mass: mass });
        }

        var fehlerJePng = {};
        if (auftraege.length) {
            var BLOCK = 24, fenster = null, zeile = null, balken = null;
            if (anzahlV > BLOCK && !TEST) {
                try {
                    fenster = new Window("palette", TITEL);
                    fenster.alignChildren = "fill";
                    zeile = fenster.add("statictext", undefined, "Vorschaubilder 0 von " + auftraege.length);
                    zeile.characters = 34;
                    balken = fenster.add("progressbar", undefined, 0, auftraege.length);
                    balken.preferredSize.width = 300;
                    fenster.show();
                    fenster.update();
                } catch (x) { fenster = null; }
            }
            for (var b = 0; b < auftraege.length; b += BLOCK) {
                var ergebnisse = hilfeAufrufen(auftraege.slice(b, b + BLOCK));
                for (var r = 0; r < ergebnisse.length; r++) {
                    var z = ergebnisse[r];
                    if (z[0] === "Z") seitenzahlen[z[1]] = parseInt(z[2], 10) || 0;
                    else if (z[0] === "V") fehlerJePng[z[3]] = z[8] || "";
                }
                if (fenster) {
                    var fertig = Math.min(b + BLOCK, auftraege.length);
                    balken.value = fertig;
                    zeile.text = "Vorschaubilder " + fertig + " von " + auftraege.length;
                    fenster.update();
                }
            }
            if (fenster) fenster.close();
        }

        for (k = 0; k < offen.length; k++) {
            var o = offen[k], neu = { bild: null, b: 0, h: 0, ob: 0, oh: 0, fehler: "" };
            try {
                var txt = o.png.exists ? textLesen(o.mass) : null;
                if (txt) {
                    var zahlen = txt.replace(/\s+$/, "").split(" ");
                    neu.b = parseFloat(zahlen[0]) || 0;
                    neu.h = parseFloat(zahlen[1]) || 0;
                    neu.ob = parseFloat(zahlen[2]) || 0;
                    neu.oh = parseFloat(zahlen[3]) || 0;
                    neu.bild = ScriptUI.newImage(o.png);
                } else {
                    neu.fehler = fehlerJePng[o.png.fsName] || "keine Vorschau";
                }
            } catch (x) { neu.bild = null; neu.fehler = "keine Vorschau"; }
            speicher[o.sch] = neu;
        }
        anzahlenEintragen(liste);
    }

    function anzahlenEintragen(liste) {
        for (var k = 0; k < liste.length; k++) {
            var n = seitenzahlen[liste[k].datei.fsName];
            if (liste[k].seite && n !== undefined) liste[k].anzahl = n;
        }
    }

    // Eine Datei, die eigentlich lesbar sein müsste, liefert keine Vorschau.
    function istDefekt(e, v) {
        if (!v || !v.fehler || v.fehler === "keine Vorschau") return false;
        if (v.fehler === "fehlt") return true;
        return LESBAR.test(e.datei.name);
    }

    // Skalierung Bild → Rahmen je Einpassung.
    function massstab(rb, rh, ob, oh, art) {
        if (art === 1) return Math.max(rb / ob, rh / oh);
        if (art === 2) return Math.min(rb / ob, rh / oh);
        return rh / oh;                             // Höhe einpassen: Höhe passt immer
    }

    // Effektive Auflösung bei der gewählten Einpassung (nur Pixelbilder).
    function ppiText(e, v, art) {
        if (!v || !v.ob || !v.oh || e.seite) return "";
        var s = massstab(RAHMEN_MASS[0], RAHMEN_MASS[1], v.ob, v.oh, art);
        if (!(s > 0)) return "";
        var ppi = Math.round(72 / s);
        return (ppi < PPI_WARNUNG ? "⚠ " : "") + ppi;
    }

    function lageIndex(e) { return (e.av + 1) * 3 + (e.ah + 1); }
    // Mac-Schreibweise der Tastenkürzel; unter Windows „Strg+“ usw.
    function kuerzel(t) {
        return MAC ? t : t.replace(/⇧⌘/g, "Strg+Umschalt+").replace(/⌘/g, "Strg+").replace(/⇧/g, "Umschalt+").replace(/⌥ \+ /g, "Alt + ").replace(/⌥/g, "Alt+").replace(/⌫/g, "Rücktaste");
    }
    var TASTENHILFE = [
        ["1 2 3 · 4 5 6 · 7 8 9", "Ausrichtung: 1 2 3 oben, 7 8 9 unten"],
        ["⌥ + Ziffer", "Ausrichtung für alle Bilder"],
        ["0", "Ausrichtung auf alle übertragen"],
        ["↑ ↓", "Bild markieren"],
        ["⌘↑ ⌘↓", "eine Seite nach vorn/hinten"],
        ["⇧⌘↑ ⇧⌘↓", "ganz nach vorn/hinten"],
        ["⌫", "aus der Liste nehmen"],
        ["E · ⇧E", "Einpassung wechseln"],
        ["⌘O · ⇧⌘O", "Dateien · Ordner hinzufügen"],
        ["⇧⌘D", "Doppelte entfernen"],
        ["⌘J", "zum Feld „PDF-Seiten“"],
        ["H", "Tastenkürzel ein/aus"]
    ];

    // Rückfrage — im Testzugang aus TEST.antworten (sonst die Vorgabe).
    function frage(text, vorgabeNein) {
        if (TEST) return (TEST.antworten && TEST.antworten.length) ? !!TEST.antworten.shift() : !vorgabeNein;
        return confirm(text, !!vorgabeNein, TITEL);
    }
    // Rückfrage „vorhandener Text“: "lassen" | "ersetzen" | "zurueck". Eigenes Fenster,
    // weil confirm kein Zurück kennt. Testzugang: TEST.textAntwort (Vorgabe "lassen").
    function textFrageFenster(konf) {
        var teile = textFrageTeile(konf), k, fett = null, geoeffnet = 0;
        if (TEST && !TEST.textFrageEcht) { TEST.textFrageTeile = teile; return TEST.textAntwort || "lassen"; }   // textFrageEcht: Sichtprüfung
        var d = new Window("dialog", TITEL);
        d.orientation = "column";
        d.alignChildren = "fill";
        d.margins = 16;
        d.spacing = 10;
        try { fett = ScriptUI.newFont("dialog", "BOLD", 13); } catch (x) {}
        d.add("statictext", undefined, teile.kopf);
        for (k = 0; k < teile.bloecke.length; k++) {
            var g = d.add("group");
            g.orientation = "column";
            g.alignChildren = "left";
            g.spacing = 2;
            var s1 = g.add("statictext", undefined, teile.bloecke[k].feld);
            if (fett) { try { s1.graphics.font = fett; } catch (x2) {} }
            g.add("statictext", undefined, teile.bloecke[k].beispiel);
        }
        for (k = 0; k < teile.hinweise.length; k++) d.add("statictext", undefined, teile.hinweise[k]);
        d.add("statictext", undefined, "Soll der vorhandene Text stehen bleiben?");
        var gk = d.add("group");
        gk.alignment = "right";
        var bZ = gk.add("button", undefined, "Zurück", { name: "cancel" });
        var bE = gk.add("button", undefined, "Überschreiben");
        var bL = gk.add("button", undefined, "Stehen lassen", { name: "ok" });
        bZ.helpTip = "Nichts platzieren — die Übersicht bleibt mit allen Änderungen offen (Esc)";
        bE.helpTip = "Die Texte aus der Übersicht kommen hinein, auch in Musterrahmen; auf neuen Seiten werden kopierte Texte ohne neuen Wert geleert";
        bL.helpTip = "Vorhandener Text und andere Seiten bleiben, wie sie sind; die Texte dieser Bildstrecke kommen in leere und vom Script gefüllte Rahmen (Eingabetaste)";
        bZ.onClick = function () { d.close(2); };
        bE.onClick = function () { d.close(3); };
        // Die Eingabetaste, die „Platzieren“ auslöste, kann am Mac doppelt ankommen — nicht gleich wieder schließen
        bL.onClick = function () { if (new Date().getTime() - geoeffnet < 350) return; d.close(1); };
        d.onShow = function () { geoeffnet = new Date().getTime(); try { d.active = true; } catch (x3) {} };
        var r = d.show();
        return r === 1 ? "lassen" : (r === 3 ? "ersetzen" : "zurueck");
    }
    function shellText(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

    // ------------------------------------------------------------------------
    // Ordner einlesen
    // ------------------------------------------------------------------------

    // Mac: find statt Folder.getFiles() — getFiles braucht für 5000 Dateien
    // über eine Minute (gemessen). Versteckte Namen, Pakete (.app, Fotos-
    // Mediatheken …) und __MACOSX fallen weg; Verknüpfungen werden nicht verfolgt.
    function ordnerPfadeMac(wurzel) {
        var o = hilfsOrdnerHolen(), stempel = new Date().getTime() + "_" + Math.floor(Math.random() * 1000000);
        var aus = File(o.fsName + "/ordner_" + stempel + ".txt"), namen = [], basis = wurzel.fsName;
        var endungen = ["app", "bundle", "framework", "plugin", "photoslibrary", "photolibrary", "aplibrary", "migratedphotolibrary",
                        "imovielibrary", "fcpbundle", "lrdata", "lrlibrary", "cocatalog", "cosessiondb", "sparsebundle", "pages",
                        "numbers", "key", "rtfd", "xcassets", "logicx", "musiclibrary", "tvlibrary"];
        for (var k = 0; k < endungen.length; k++) namen.push("-iname '*." + endungen[k] + "'");
        // Namen mit Steuerzeichen (Zeilenumbruch) fallen weg — die Ausgabe ist zeilenweise
        var befehl = "/usr/bin/find " + shellText(basis) + " -mindepth 1 \\( -name '.*' -o -name '__MACOSX' -o -name '*[[:cntrl:]]*' -o " +
                     namen.join(" -o ") + " \\) -prune -o -type f -print > " + shellText(aus.fsName) + " 2>/dev/null; exit 0";
        try { app.doScript("do shell script " + alsAppleScriptText(befehl), ScriptLanguage.APPLESCRIPT_LANGUAGE); } catch (e) {}
        var roh = textLesen(aus), pfade = [];
        try { aus.remove(); } catch (e) {}
        if (roh) {
            var z = roh.split("\n");
            for (k = 0; k < z.length; k++) if (z[k].indexOf(basis + "/") === 0) pfade.push(z[k]);
        }
        return pfade;
    }
    function ordnerPfadeWin(wurzel) {
        var pfade = [], stapel = [{ o: wurzel, tiefe: 0 }], besucht = {};
        while (stapel.length) {
            if (pfade.length >= 20000) { pfade.gekappt = true; break; }
            var s0 = stapel.shift();
            if (besucht["~" + s0.o.fsName]) continue;
            besucht["~" + s0.o.fsName] = true;
            var liste = [];
            try { liste = s0.o.getFiles() || []; } catch (e) {}
            for (var k = 0; k < liste.length; k++) {
                var f = liste[k], name = f.displayName;
                if (name.charAt(0) === "." || f.alias) continue;
                if (f instanceof Folder) {
                    if (ORDNER_WEG.test(name) || PAKETE.test(name)) continue;
                    if (s0.tiefe < 12) stapel.push({ o: f, tiefe: s0.tiefe + 1 });
                    else pfade.gekappt = true;
                } else {
                    pfade.push(f.fsName);
                }
            }
        }
        return pfade;
    }

    // { eintraege: [...], mehrereOrdner: bool } oder null (abgebrochen).
    // ohneMengenfrage: aus der Übersicht — dort fragt zufuegen mit der Gesamtzahl.
    function ordnerEinlesen(o, vorlage, ohneMengenfrage) {
        var pfade = MAC ? ordnerPfadeMac(o) : ordnerPfadeWin(o);
        var eigen = "";
        try { eigen = vergleichsText(doc.fullName.fsName); } catch (e) {}
        var wurzel = String(o.fsName).replace(/\\/g, "/"), titel = o.displayName;
        var oben = [], unten = [], ordnerNamen = {}, anzahlOrdner = 0, fremd = 0, k;
        for (k = 0; k < pfade.length; k++) {
            var pf = pfade[k], pfN = String(pf).replace(/\\/g, "/"), name = pfN.substring(pfN.lastIndexOf("/") + 1);
            if (!BILDENDUNGEN.test(name)) { fremd++; continue; }
            if (eigen && INDD.test(name) && vergleichsText(pf) === eigen) continue;     // das offene Dokument selbst
            var rel = pfN.indexOf(wurzel + "/") === 0 ? pfN.substring(wurzel.length + 1) : name;
            var schnitt = rel.lastIndexOf("/"), relOrdner = schnitt > 0 ? rel.substring(0, schnitt) : "";
            var stueck = { pfad: pf, rel: relOrdner };
            if (relOrdner) {
                unten.push(stueck);
                if (!ordnerNamen["~" + relOrdner]) { ordnerNamen["~" + relOrdner] = true; anzahlOrdner++; }
            } else {
                oben.push(stueck);
            }
        }
        // Keine Vorsortierung: jeder Aufrufer sortiert die Einträge ohnehin.
        var mitUnter = false;
        if (unten.length) {
            var uo = anzahlOrdner === 1 ? " Unterordner" : " Unterordnern";
            if (TEST && TEST.unterordner !== undefined) mitUnter = !!TEST.unterordner;
            else if (!oben.length) mitUnter = frage("„" + titel + "“ enthält selbst keine Bilder, aber " + unten.length + " in " + anzahlOrdner + uo + ".\n\nDiese einlesen?", false);
            else mitUnter = frage("„" + titel + "“: " + mehrzahl(oben.length, "Bild", "Bilder") + ".\nIn " + anzahlOrdner + uo + ": " + unten.length + " weitere.\n\nUnterordner mit einlesen?", true);
        }
        var liste = mitUnter ? oben.concat(unten) : oben;
        if (pfade.gekappt) melden("„" + titel + "“ ist sehr umfangreich — gelesen wurden nur die ersten " + pfade.length + " Dateien bis 12 Ordnerebenen tief.");
        if (!liste.length) {
            melden("Keine Bilder in „" + titel + "“ gefunden." + (fremd ? " (" + mehrzahl(fremd, "andere Datei", "andere Dateien") + ")" : ""));
            return { eintraege: [], mehrereOrdner: false, fremd: fremd };
        }
        if (!ohneMengenfrage && liste.length > 300 && !frage(liste.length + " Bilder ergeben " + liste.length + " Dokumentseiten. Weiter?", false)) return null;
        var eintr = [];
        for (k = 0; k < liste.length; k++) {
            var e = eintrag(File(liste[k].pfad), 1, vorlage);
            e.rel = liste[k].rel;
            eintr.push(e);
        }
        return { eintraege: eintr, mehrereOrdner: mitUnter && unten.length > 0, fremd: fremd };
    }
    function ordnerWaehlen(vorlage) {
        var start = Folder(app.extractLabel(MERKER_ORDNER));
        if (!start.exists) start = Folder.desktop;
        var o = start.selectDlg("Ordner mit Bildern wählen");
        if (!o) return null;
        try { app.insertLabel(MERKER_ORDNER, o.fsName); } catch (e) {}
        return ordnerEinlesen(o, vorlage, true);
    }

    // ------------------------------------------------------------------------
    // Doppelte Bilder: gleicher Inhalt · schon im Dokument platziert
    // ------------------------------------------------------------------------

    // Pfade und Namen vergleichbar machen: /private/tmp = /tmp, Groß/klein egal,
    // zerlegte Umlaute (NFD, Ordnerlisten) wie in den Links (NFC) zusammensetzen.
    // Akzente bleiben: „Bär.jpg“ ist nicht „Bar.jpg“.
    function vergleichsText(s) {
        s = String(s).replace(/\\/g, "/").replace(/^\/private\/(tmp|var|etc)\//, "/$1/");
        s = s.replace(/([A-Za-z])([̀-ͯ])/g, function (m, b, k) { var t = KOMBI[k]; return (t && t[b]) ? t[b] : m; });
        return s.toLowerCase();
    }

    function listeDazu(tabelle, sch, wert) { (tabelle[sch] || (tabelle[sch] = [])).push(wert); }
    // Was im Dokument schon platziert ist (das Bild im gewählten Rahmen zählt nicht).
    function platzierteErfassen() {
        var erg = { pfad: {}, name: {}, dateien: [] }, eigene = {}, k;
        try { var gr = rahmen.allGraphics; for (k = 0; k < gr.length; k++) eigene[gr[k].id] = true; } catch (e) {}
        var links = [];
        try { links = doc.links.length ? doc.links.everyItem().getElements() : []; } catch (e) {}
        for (k = 0; k < links.length; k++) {
            try {
                var l = links[k], grafik = l.parent;
                if (eigene[grafik.id]) continue;
                var name = l.name, seite = 0;
                try { name = decodeURI(l.name); } catch (x) {}          // „50%.jpg“ ist kein gültiges Escape
                if (MEHRSEITIG.test(name) || INDD.test(name)) {
                    try { seite = grafik.pdfAttributes.pageNumber || 1; }
                    catch (x) { try { seite = grafik.pageNumber || 1; } catch (y) { seite = 1; } }
                }
                var wo = { link: l, seite: null, rahmenId: -1 };
                try { wo.rahmenId = grafik.parent.id; } catch (x) {}
                var lesbar = false;
                if (l.filePath) {
                    listeDazu(erg.pfad, vergleichsText(l.filePath) + "#" + seite, wo);
                    var f = File(l.filePath), n = f.exists ? f.length : 0;
                    if (n > 0) { erg.dateien.push({ datei: f, groesse: n, seite: seite, wo: wo }); lesbar = true; }
                }
                // Name + Größe („vermutlich“) nur, wo kein Inhaltsvergleich geht: Datei fehlt, oder Windows
                if (l.size > 0 && (!lesbar || !MAC)) listeDazu(erg.name, vergleichsText(name) + "|" + l.size + "#" + seite, wo);
            } catch (e) {}
        }
        return erg;
    }
    function ortVon(wo) {
        if (wo.seite === null) {
            try {
                var pp = wo.link.parent.parentPage;
                wo.seite = !pp ? "Montagefläche" : (pp.parent.constructor.name === "MasterSpread" ? "Muster " + pp.name : "S. " + pp.name);
            } catch (e) { wo.seite = "?"; }
        }
        return wo.seite;
    }

    // Inhaltsvergleich nur für Dateien gleicher Größe; Mac: md5 in einem Aufruf.
    // Ergebnis je Pfad in inhalt[fsName].gruppe: "" = einzigartig, sonst Gruppenname.
    var inhalt = {}, AUTO_PRUEF_BYTES = (TEST && TEST.pruefBytes !== undefined) ? TEST.pruefBytes : 2048 * 1048576;
    function inhaltPruefen(liste, platziert, erzwingen) {
        var jeGroesse = {}, k, p, g;
        function merken(datei) {
            var pf = datei.fsName;
            if (/[\t\r\n]/.test(pf) || !datei.exists) return;
            var n = datei.length, t = datei.modified ? datei.modified.getTime() : 0, info = inhalt[pf];
            if (!info || info.groesse !== n || info.zeit !== t) info = inhalt[pf] = { groesse: n, zeit: t, gruppe: null };
            if (n <= 0) { info.gruppe = ""; return; }            // leer/unlesbar: nie „doppelt“
            if (!jeGroesse[n]) jeGroesse[n] = {};
            jeGroesse[n][pf] = info;
        }
        for (k = 0; k < liste.length; k++) merken(liste[k].datei);
        for (k = 0; k < platziert.dateien.length; k++) if (jeGroesse[platziert.dateien[k].groesse]) merken(platziert.dateien[k].datei);
        var pruefen = [], bytes = 0;
        for (g in jeGroesse) {
            if (!jeGroesse.hasOwnProperty(g)) continue;
            var pfade = [], neu = false;
            for (p in jeGroesse[g]) if (jeGroesse[g].hasOwnProperty(p)) { pfade.push(p); if (jeGroesse[g][p].gruppe === null) neu = true; }
            if (pfade.length === 1) continue;                    // bleibt ungeprüft, bis ein Partner gleicher Größe kommt
            if (!neu) continue;
            pruefen.push(pfade);
            bytes += pfade.length * Number(g);
        }
        if (!pruefen.length) return "fertig";
        if (!MAC) {                                             // Windows: nur Pfad und Dokument
            for (k = 0; k < pruefen.length; k++) for (var w0 = 0; w0 < pruefen[k].length; w0++) inhalt[pruefen[k][w0]].gruppe = "";
            return "fertig";
        }
        if (!erzwingen && bytes > AUTO_PRUEF_BYTES) return "offen";
        var alle = [];
        for (k = 0; k < pruefen.length; k++) alle = alle.concat(pruefen[k]);
        var o = hilfsOrdnerHolen(), stempel = new Date().getTime() + "_" + Math.floor(Math.random() * 1000000);
        var ein = File(o.fsName + "/md5ein_" + stempel + ".txt"), aus = File(o.fsName + "/md5aus_" + stempel + ".txt");
        var hash = {};
        if (textSchreiben(ein, alle.join("\n") + "\n")) {
            var befehl = "/usr/bin/tr '\\n' '\\000' < " + shellText(ein.fsName) + " | /usr/bin/xargs -0 /sbin/md5 -r > " + shellText(aus.fsName) + " 2>/dev/null; exit 0";
            try { app.doScript("do shell script " + alsAppleScriptText(befehl), ScriptLanguage.APPLESCRIPT_LANGUAGE); } catch (e) {}
            var roh = textLesen(aus);
            if (roh) {
                var z = roh.split("\n");
                for (k = 0; k < z.length; k++) if (z[k].length > 33) hash[z[k].substring(33)] = z[k].substring(0, 32);
            }
        }
        try { ein.remove(); } catch (e) {}
        try { aus.remove(); } catch (e) {}
        for (k = 0; k < pruefen.length; k++) {
            var zahl = {}, i;
            for (i = 0; i < pruefen[k].length; i++) { var h = hash[pruefen[k][i]]; if (h) zahl[h] = (zahl[h] || 0) + 1; }
            for (i = 0; i < pruefen[k].length; i++) {
                var h2 = hash[pruefen[k][i]];
                inhalt[pruefen[k][i]].gruppe = (h2 && zahl[h2] > 1) ? "g" + h2 : "";
            }
        }
        return "fertig";
    }

    // ------------------------------------------------------------------------
    // Zielseiten planen: direkt dahinter · am Dokumentende · Folgeseiten füllen
    // ------------------------------------------------------------------------

    // Punkt und Druckbogen-Ursprung: relMitte() braucht Objekt- und Seitenumkasten
    // im selben Bezug — beim Ursprung „Seite“ sind rechte Seiten sonst verschoben.
    function mitPunkt(fn) {
        var v = app.scriptPreferences, alt = v.measurementUnit, altUrsprung = null;
        v.measurementUnit = MeasurementUnits.POINTS;
        try { altUrsprung = doc.viewPreferences.rulerOrigin; doc.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN; } catch (e) { altUrsprung = null; }
        try { return fn(); }
        finally {
            try { if (altUrsprung !== null) doc.viewPreferences.rulerOrigin = altUrsprung; } catch (e) {}
            v.measurementUnit = alt;
        }
    }
    function mehrzahl(n, eins, viele) { return n + " " + (n === 1 ? eins : viele); }
    function seitenFestFuer(seite) {
        try {
            return seite.parent.allowPageShuffle === false || doc.documentPreferences.allowPageShuffle === false;
        } catch (e) { return false; }
    }
    // Lage der Mitte relativ zur eigenen (Muster-)Seite: Umkasten minus
    // Seitenumkasten im selben Linealsystem. Gemessen: mitte() − ursprung()
    // weicht bei Musterobjekten ab (bis 195 pt), PAGE_COORDINATES ist auf
    // linken Seiten um 4,7 pt versetzt — nur dieser Weg spiegelt exakt.
    function relMitte(obj) {
        var gb = obj.geometricBounds, pb = obj.parentPage.bounds;
        return [(gb[1] + gb[3]) / 2 - pb[1], (gb[0] + gb[2]) / 2 - pb[0]];
    }
    // Drehung aus der Richtung der Innenachse — absoluteRotationAngle meldet
    // in gedrehten Gruppen 0 (gemessen).
    function winkel(obj) {
        try {
            var G = BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS, I = CoordinateSpaces.INNER_COORDINATES;
            var a = obj.resolve([[0, 0], G, I], PB)[0], b = obj.resolve([[1, 0], G, I], PB)[0];
            var w = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
            return ((w % 360) + 360) % 360;
        } catch (e) { return 0; }
    }
    function winkelGleich(a, b) {
        var d = Math.abs(a - b) % 360;
        return Math.min(d, 360 - d) <= 1;
    }

    var steckbriefWert = null;
    function steckbrief() {
        if (steckbriefWert) return steckbriefWert;
        var gb = rahmen.geometricBounds, m = relMitte(rahmen), ebene = "";
        try { ebene = rahmen.itemLayer.name; } catch (e) {}
        steckbriefWert = { art: rahmen.constructor.name, b: RAHMEN_MASS[0], h: RAHMEN_MASS[1],
                           gbB: gb[3] - gb[1], gbH: gb[2] - gb[0], mx: m[0], my: m[1],
                           winkel: winkel(rahmen), ebene: ebene, lage: quellSeite.side };
        return steckbriefWert;
    }
    function sammlungFuer(behaelter, art) {
        return art === "Oval" ? behaelter.ovals : (art === "Polygon" ? behaelter.polygons : behaelter.rectangles);
    }
    function umkastenPasst(gb, s) {
        return Math.abs((gb[3] - gb[1]) - s.gbB) <= TOLERANZ && Math.abs((gb[2] - gb[0]) - s.gbH) <= TOLERANZ;
    }
    // Rahmen gleicher Art auf der Seite (auch in Gruppen) und nicht gelöste
    // Musterrahmen; Vorfilter über den Umkasten (ein everyItem() je Sammlung).
    function kandidaten(seite, s) {
        var aus = [];
        function durch(behaelter, tiefe) {
            var sm = sammlungFuer(behaelter, s.art), k;
            if (sm.length) {
                var els = sm.everyItem().getElements(), gbs = sm.everyItem().geometricBounds;
                for (k = 0; k < els.length; k++) {
                    if (gbs[k] && umkastenPasst(gbs[k], s)) aus.push({ obj: els[k], muster: false });
                }
            }
            if (tiefe < 6 && behaelter.groups.length) {
                var gr = behaelter.groups.everyItem().getElements();
                for (k = 0; k < gr.length; k++) durch(gr[k], tiefe + 1);
            }
        }
        try { durch(seite, 0); } catch (e) {}
        try {
            var mpi = seite.masterPageItems;              // leer bei „Musterseitenobjekte ausblenden“
            for (var j = 0; j < mpi.length; j++) {
                var m = mpi[j];
                if (m.constructor.name !== s.art) continue;
                if (umkastenPasst(m.geometricBounds, s)) aus.push({ obj: m, muster: true });
            }
        } catch (e) {}
        return aus;
    }
    function passt(t, s, sollX) {
        try {
            if (!winkelGleich(winkel(t.obj), s.winkel)) return false;
            var mm = eigeneMasse(t.obj);
            if (Math.abs(mm[0] - s.b) > TOLERANZ || Math.abs(mm[1] - s.h) > TOLERANZ) return false;
            var c = relMitte(t.obj);
            return Math.abs(c[0] - sollX) <= TOLERANZ && Math.abs(c[1] - s.my) <= TOLERANZ;
        } catch (e) { return false; }
    }
    function bevorzugt(liste, test) {
        var a = [];
        for (var k = 0; k < liste.length; k++) if (test(liste[k])) a.push(liste[k]);
        return a.length ? a : liste;
    }
    function auswaehlen(treffer, s, ersetzen) {
        var offen = [], gesperrt = false, k, o;
        for (k = 0; k < treffer.length; k++) {
            o = treffer[k].obj;
            try {
                if (o.visible === false || o.itemLayer.visible === false) continue;
                if (treffer[k].muster ? o.allowOverrides === false : (o.locked || o.itemLayer.locked)) { gesperrt = true; continue; }
                offen.push(treffer[k]);
            } catch (e) {}
        }
        if (!offen.length) return { status: gesperrt ? "gesperrt" : "keiner" };
        offen = bevorzugt(offen, function (x) { try { return x.obj.itemLayer.name === s.ebene; } catch (e) { return false; } });
        var leer = [], belegt = 0;
        for (k = 0; k < offen.length; k++) {
            if (offen[k].obj.allGraphics.length) belegt++; else leer.push(offen[k]);
        }
        if (belegt && !ersetzen) return { status: "belegt" };
        var wahlListe = ersetzen ? offen : leer;
        if (wahlListe.length > 1) wahlListe = bevorzugt(wahlListe, function (x) { return !x.muster; });
        if (wahlListe.length > 1) return { status: "mehrdeutig" };
        return { status: "ok", treffer: wahlListe[0] };
    }
    // { status: "ok"|"keiner"|"belegt"|"gesperrt"|"mehrdeutig", treffer: {obj, muster} }
    function folgeRahmen(seite, ersetzen, spiegeln) {
        var s = steckbrief(), kand = kandidaten(seite, s);
        if (!kand.length) return { status: "keiner" };
        var sb = seite.bounds, bz = sb[3] - sb[1];
        var wechsel = doppelseitig(seite) && s.lage !== PageSideOptions.SINGLE_SIDED && seite.side !== s.lage;
        var stellen = !wechsel ? [s.mx] : (spiegeln ? [bz - s.mx, s.mx] : [s.mx, bz - s.mx]);
        for (var st = 0; st < stellen.length; st++) {
            var treffer = [];
            for (var k = 0; k < kand.length; k++) if (passt(kand[k], s, stellen[st])) treffer.push(kand[k]);
            if (treffer.length) return auswaehlen(treffer, s, ersetzen);
        }
        return { status: "keiner" };
    }
    // Seiten hinter der Quelle, die bei ungerader Einfügung links/rechts
    // wechseln: bis zum nächsten Abschnitt mit eigener Nummerierung (gemessen).
    function verschobeneFolgeseiten(start) {
        var ende = doc.pages.length;
        try {
            var ab = doc.sections.everyItem().getElements();
            for (var k = 0; k < ab.length; k++) {
                if (ab[k].continueNumbering) continue;
                var off = ab[k].pageStart.documentOffset;
                if (off > start && off < ende) ende = off;
            }
        } catch (e) {}
        return Math.max(0, ende - start - 1);
    }
    function neuName(basis, k) {
        return /^\d+$/.test(basis) ? "+" + (parseInt(basis, 10) + k) : basis + " +" + k;
    }
    // Plan VOR dem Anlegen (liest nur). offset = documentOffset NACH dem Anlegen:
    // neue Seiten bilden einen lückenlosen Block hinter der Quelle bzw. am Ende,
    // befüllte Folgeseiten liegen davor und behalten ihren Offset.
    function zielePlanen(modus, n, spiegeln, cache) {
        var start = quellSeite.documentOffset, anzahl = doc.pages.length, k;
        var plan = { modus: modus, ziele: [{ art: "quelle", offset: start, name: quellSeite.name }],
                     neu: 0, eigen: {}, uebersprungen: [], ohneRahmen: 0, verschoben: 0, ungerade: false, fest: false };
        plan.eigen[start] = true;
        if (modus === ZIEL_LEERE || modus === ZIEL_ERSETZEN) {
            var ersetzen = modus === ZIEL_ERSETZEN;
            for (var off = start + 1; off < anzahl && plan.ziele.length < n; off++) {
                var sch = off + "|" + ersetzen + "|" + spiegeln, r = cache ? cache[sch] : null;
                if (!r) {
                    var seite = doc.pages[off];
                    r = folgeRahmen(seite, ersetzen, spiegeln);
                    r.name = seite.name;
                    if (cache) cache[sch] = r;
                }
                if (r.status === "ok") plan.ziele.push({ art: "vorhanden", offset: off, name: r.name, treffer: r.treffer });
                else if (r.status === "keiner") plan.ohneRahmen++;
                else plan.uebersprungen.push({ name: r.name, grund: r.status });
            }
        }
        plan.neu = n - plan.ziele.length;
        if (plan.neu > 0) {
            var basis = modus === ZIEL_DAHINTER ? quellSeite : doc.pages[anzahl - 1];
            var b0 = basis.documentOffset, bn = basis.name;
            plan.fest = seitenFestFuer(basis);
            for (k = 1; k <= plan.neu; k++) {
                plan.ziele.push({ art: "neu", offset: b0 + k, name: neuName(bn, k) });
                plan.eigen[b0 + k] = true;
            }
            if (modus === ZIEL_DAHINTER && DOPPELSEITIG && plan.neu % 2 === 1 && !plan.fest) {
                plan.verschoben = verschobeneFolgeseiten(start);
                plan.ungerade = plan.verschoben > 0;
            }
        }
        return plan;
    }
    var GRUENDE = { belegt: "Rahmen schon belegt", gesperrt: "gesperrt", mehrdeutig: "mehrere gleiche Rahmen" };
    // ["3","4","5","9","+57","+58"] -> „3–5, 9, +57–+58“
    function seitenAufzaehlung(namen) {
        var teile = [], k = 0;
        function zahl(t) { return /^\+?\d+$/.test(t) ? parseInt(t.replace("+", ""), 10) : NaN; }
        while (k < namen.length) {
            var j = k;
            while (j + 1 < namen.length && !isNaN(zahl(namen[j])) && zahl(namen[j + 1]) === zahl(namen[j]) + 1) j++;
            teile.push(j > k ? namen[k] + "–" + namen[j] : namen[k]);
            k = j + 1;
        }
        return teile.length > 12 ? teile.slice(0, 12).join(", ") + " …" : teile.join(", ");
    }
    function uebersprungenText(liste) {
        var je = {}, reihe = [], k, g;
        for (k = 0; k < liste.length; k++) {
            g = liste[k].grund;
            if (!je[g]) { je[g] = []; reihe.push(g); }
            je[g].push(liste[k].name);
        }
        var teile = [];
        for (k = 0; k < reihe.length; k++) teile.push("S. " + seitenAufzaehlung(je[reihe[k]]) + " (" + GRUENDE[reihe[k]] + ")");
        return teile.join(" · ");
    }

    // Kachel-Geometrie: Bild- und Rahmenrechteck [l, o, r, u] relativ zur
    // Kachelmitte im gemeinsamen Maßstab, die Vereinigung passt in „platz“ px.
    function ausschnitt(rb, rh, ob, oh, art, ah, av, platz) {
        if (!(rb > 0 && rh > 0 && ob > 0 && oh > 0 && platz > 0)) return null;
        var s = massstab(rb, rh, ob, oh, art);
        var bw = ob * s, bh = oh * s;
        var bx = (rb - bw) * (ah + 1) / 2, by = (rh - bh) * (av + 1) / 2;
        var x0 = Math.min(0, bx), y0 = Math.min(0, by);
        var x1 = Math.max(rb, bx + bw), y1 = Math.max(rh, by + bh);
        var k = Math.min(platz / (x1 - x0), platz / (y1 - y0));
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        return {
            bild:   [(bx - cx) * k, (by - cy) * k, (bx + bw - cx) * k, (by + bh - cy) * k],
            rahmen: [(0 - cx) * k, (0 - cy) * k, (rb - cx) * k, (rh - cy) * k],
            wirkt:  { h: Math.abs(bw - rb) > rb * 0.002, v: Math.abs(bh - rh) > rh * 0.002 }
        };
    }
    function pixel(q, mx, my, min) {
        var l = Math.round(mx + q[0]), o = Math.round(my + q[1]), r = Math.round(mx + q[2]), u = Math.round(my + q[3]);
        if (min && r - l < min) { l = Math.round((l + r - min) / 2); r = l + min; }
        if (min && u - o < min) { o = Math.round((o + u - min) / 2); u = o + min; }
        return [l, o, r, u];
    }
    function baender(bi, ra) {                      // Bild außerhalb des Rahmens, bis zu 4 Rechtecke
        var aus = [];
        var l = Math.max(bi[0], ra[0]), o = Math.max(bi[1], ra[1]), r = Math.min(bi[2], ra[2]), u = Math.min(bi[3], ra[3]);
        if (l >= r || o >= u) return [bi];
        var teile = [[bi[0], bi[1], bi[2], o], [bi[0], u, bi[2], bi[3]], [bi[0], o, l, u], [r, o, bi[2], u]];
        for (var k = 0; k < teile.length; k++) {
            if (teile[k][2] - teile[k][0] >= 1 && teile[k][3] - teile[k][1] >= 1) aus.push(teile[k]);
        }
        return aus;
    }
    function flaeche(g, pinsel, q) {
        if (q[2] - q[0] < 1 || q[3] - q[1] < 1) return;
        g.newPath();
        g.rectPath(q[0], q[1], q[2] - q[0], q[3] - q[1]);
        g.fillPath(pinsel);
    }
    function umriss(g, stift, q) {
        g.newPath();
        g.rectPath(q[0], q[1], q[2] - q[0], q[3] - q[1]);
        g.strokePath(stift);
    }

    // ------------------------------------------------------------------------
    // Übersicht
    // ------------------------------------------------------------------------

    var DOPPELSEITIG = false;
    try { DOPPELSEITIG = doc.documentPreferences.facingPages === true; } catch (e) {}


    function uebersicht(anfang) {
        var folge = anfang.slice(0);
        var auswahl = 0;
        var MANUELL = REIHENFOLGEN.length;
        var stumm = false;
        var vorschau = {};
        var pdfSchluessel = null, pdfVorbelegt = "", offenPdf = 0;
        var standard = { ah: wahl.ah, av: wahl.av };        // Vorgabe für „Hinzufügen“ und den Merker
        var platziert = platzierteErfassen();
        var doppel = {}, doppelZahl = { inhalt: 0, dokument: 0, vermutlich: 0 }, pruefStand = "fertig";
        var reiheSelbstGewaehlt = false;
        vorschauenLaden(folge, vorschau);
        try { pruefStand = inhaltPruefen(folge, platziert, false); } catch (x) { pruefStand = "offen"; }

        var w = new Window("dialog", TITEL);
        w.orientation = "column";
        w.alignChildren = "fill";
        w.margins = 14;
        w.spacing = 10;

        var info = w.add("statictext", undefined, "");
        info.characters = 96;

        var haupt = w.add("group");
        haupt.orientation = "row";
        haupt.alignChildren = "top";
        haupt.spacing = 14;

        // ---- links: Liste, Knöpfe, PDF-Seiten, Sortierung, Einpassung
        var links = haupt.add("group");
        links.orientation = "column";
        links.alignChildren = "fill";
        links.spacing = 8;

        var liste = links.add("listbox", undefined, [], {
            numberOfColumns: 3, showHeaders: true, columnTitles: ["Seite", "Bild", "ppi"],
            columnWidths: [44, 212, 66]
        });
        liste.preferredSize = [356, 290];

        var gKnoepfe = links.add("group");
        gKnoepfe.spacing = 4;
        var bHoch = gKnoepfe.add("button", undefined, "▲");
        var bRunter = gKnoepfe.add("button", undefined, "▼");
        bHoch.preferredSize = bRunter.preferredSize = [40, 24];
        bHoch.helpTip = "Ausgewähltes Bild eine Seite nach vorn (" + kuerzel("⌘↑") + ", ganz nach vorn " + kuerzel("⇧⌘↑") + ")";
        bRunter.helpTip = "Ausgewähltes Bild eine Seite nach hinten (" + kuerzel("⌘↓") + ", ganz nach hinten " + kuerzel("⇧⌘↓") + ")";
        var bWeg = gKnoepfe.add("button", undefined, "Entfernen");
        bWeg.helpTip = "Markiertes Bild aus der Liste nehmen (" + kuerzel("⌫") + ")";
        var bDazu = gKnoepfe.add("button", undefined, "Dateien …");
        bDazu.helpTip = "Weitere Bilder hinzufügen (" + kuerzel("⌘O") + ")";
        var bOrdner = gKnoepfe.add("button", undefined, "Ordner …");
        bOrdner.helpTip = "Alle Bilder eines Ordners hinzufügen — Unterordner auf Wunsch (" + kuerzel("⇧⌘O") + ")";

        var gPdf = links.add("group");
        gPdf.spacing = 4;
        gPdf.add("statictext", undefined, "PDF-Seiten:").preferredSize.width = 72;
        var ePdf = gPdf.add("edittext", undefined, "");
        ePdf.characters = 10;
        ePdf.helpTip = "z. B. 1-3, 7 oder alle — jede Seite wird ein eigener Eintrag und bekommt eine eigene Dokumentseite";
        var lVon = gPdf.add("statictext", undefined, "");
        lVon.characters = 7;
        var bAufteilen = gPdf.add("button", undefined, "Aufteilen");

        var gSort = links.add("group");
        gSort.add("statictext", undefined, "Sortieren:").preferredSize.width = 72;
        var ddReihe = gSort.add("dropdownlist", undefined, REIHENFOLGEN.concat(["Von Hand"]));
        ddReihe.preferredSize.width = 276;

        var gEin = links.add("group");
        gEin.spacing = 6;
        gEin.alignChildren = ["left", "center"];
        gEin.add("statictext", undefined, "Einpassung:").preferredSize.width = 72;
        var ddEin = gEin.add("dropdownlist", undefined, EINPASSUNGEN);
        ddEin.preferredSize.width = 176;
        ddEin.helpTip = "Wie die Bilder in den Rahmen kommen (E wechselt)";
        var punkt = gEin.add("group");                  // selbst gezeichneter Bezugspunkt
        punkt.preferredSize = [3 * PUNKT, 3 * PUNKT];
        var bAlle = gEin.add("button", undefined, "Für alle");
        bAlle.preferredSize = [62, 24];
        bAlle.helpTip = "Ausrichtung des markierten Bildes auf alle Bilder übertragen — gilt dann auch für neu hinzugefügte (0)";

        var gZiel = links.add("group");
        gZiel.add("statictext", undefined, "Neue Seiten:").preferredSize.width = 72;
        var ddZiel = gZiel.add("dropdownlist", undefined, SEITENZIELE);
        ddZiel.preferredSize.width = 276;
        ddZiel.helpTip = "direkt dahinter: hinter der Seite mit dem Rahmen\n" +
                         "am Dokumentende: vorhandene Seiten bleiben, wo sie sind\n" +
                         "Folgeseiten füllen: Seiten dahinter mit demselben Rahmen (Art, Größe, Lage ±2 pt, auch auf der Musterseite) — " +
                         "Seiten ohne ihn werden übersprungen, was übrig bleibt, kommt ans Dokumentende";

        var cbSpiegeln = links.add("checkbox", undefined, "Doppelseiten: Gegenseiten spiegeln (Anschnitt bleibt außen)");
        cbSpiegeln.value = wahl.spiegeln;
        cbSpiegeln.enabled = DOPPELSEITIG;
        cbSpiegeln.helpTip = "Wechselt eine neue Seite von links nach rechts (oder umgekehrt), wird die Lage aller Objekte und senkrechten Hilfslinien an der Seitenmitte gespiegelt — die Formen selbst nicht.";

        // ---- rechts: Raster mit Vorschaubildern
        var rechts = haupt.add("panel", undefined, "Vorschau · klicken wählt aus · ziehen sortiert um");
        rechts.margins = [8, 18, 8, 8];
        var feld = rechts.add("group");
        feld.preferredSize = [FELD_B, FELD_H];

        if (rahmen.allGraphics.length > 0) {
            w.add("statictext", undefined, "Hinweis: der Rahmen enthält schon ein Bild — es wird ersetzt.");
        }

        // ---- unten: Texte zum markierten Bild (Metadaten → Textrahmen)
        var metaEdit = {}, metaKnopf = {}, enterImFeld = 0, ePraefix = null, cbMuster = null, lMuster = null;
        // Rückfrage „vorhandener Text“ in bOk: Vorgabe aus wahl, Entscheidung dieses Klicks
        var textVorgabe = wahl.textVorhanden, textEntscheid = wahl.textVorhanden, textGeprueft = false;
        var mZeile1 = null, mZeile2 = null;
        // Zeile 1 = Titel | Copyright (Präfix + Autor) | Stadt — gemessen 820 pt Zeilenbreite, gerechnet 816 belegt
        var META_MASSE = { titel: [186, 22], praefix: [52, 22], copyright: [150, 22], stadt: [120, 22], unterschrift: [664, 40] };
        if (META_AKTIV) {
            var pMeta = w.add("panel", undefined, xmpBereit() ? "Texte zum markierten Bild · aus den Metadaten, hier änderbar · die Bilddatei bleibt unverändert"
                                                           : "Texte zum markierten Bild · Metadaten hier nicht lesbar (XMP fehlt) — bitte eintragen");
            pMeta.orientation = "column";
            pMeta.alignChildren = "fill";
            pMeta.margins = [10, 16, 10, 8];
            pMeta.spacing = 6;
            mZeile1 = pMeta.add("group");
            mZeile2 = pMeta.add("group");
            mZeile1.spacing = mZeile2.spacing = 6;
            mZeile1.alignChildren = ["left", "center"];
            mZeile2.alignChildren = ["left", "top"];
            for (var mfb = 0; mfb < FELDER.length; mfb++) metaFeldBauen(FELDER[mfb]);
            var mZeile3 = pMeta.add("group");
            mZeile3.spacing = 10;
            mZeile3.alignChildren = ["left", "center"];
            cbMuster = mZeile3.add("checkbox", undefined, "Gleiche Texte auf die Musterseite");
            cbMuster.value = wahl.musterTexte;
            lMuster = mZeile3.add("statictext", undefined, "", { multiline: true });
            lMuster.preferredSize = [590, 30];              // gemessen: Schalter 213 pt + 10 + 590 ≤ 820 — sonst wird das Fenster breiter
            var musterMoeglich = false;
            for (var mm0 = 0; mm0 < FELDER.length; mm0++) {
                var trm0 = META_RAHMEN[FELDER[mm0].id];
                if (trm0 && !trm0.mehrdeutig && (trm0.muster || musterVon(trm0.rahmen))) musterMoeglich = true;
            }
            cbMuster.enabled = musterMoeglich;
            cbMuster.helpTip = musterMoeglich
                ? "Ist ein Text bei allen Bildern gleich, kommt er einmal in den Rahmen der Musterseite — Schrift und Lage dann nur dort anpassen; er steht auf allen Seiten mit dieser Musterseite. Unterschiedliche Texte kommen wie bisher auf die einzelnen Seiten."
                : "Die Textrahmen liegen nicht auf der Musterseite — die Texte kommen auf die einzelnen Seiten.";
            cbMuster.onClick = function () { musterAnzeigeNeu(); };
        }

        var gFuss = w.add("group");
        gFuss.orientation = "row";
        gFuss.alignment = "fill";
        var gLinks = gFuss.add("group");
        gLinks.alignment = ["left", "center"];
        gLinks.spacing = 8;
        var bHilfe = gLinks.add("button", undefined, "?");
        bHilfe.preferredSize = [30, 24];
        bHilfe.helpTip = "Tastenkürzel (H)";
        var bDoppelt = gLinks.add("button", undefined, "Doppelte entfernen");
        bDoppelt.preferredSize.width = 176;
        bDoppelt.helpTip = "Inhaltsgleiche Bilder bis auf das erste aus der Liste nehmen (auf Wunsch auch schon platzierte) — das Dokument bleibt unberührt (" + kuerzel("⇧⌘D") + ")";
        var lStatus = gLinks.add("statictext", undefined, "");
        lStatus.characters = 50;                            // gemessen: 42 schnitt Hinweise ab, 58 machte das Fenster 911 statt 872 pt breit
        var gRechts = gFuss.add("group");
        gRechts.alignment = ["right", "center"];
        var bAbbrechen = gRechts.add("button", undefined, "Abbrechen", { name: "cancel" });
        var bOk = gRechts.add("button", undefined, "Platzieren", { name: "ok" });

        var statusDoppelt = false;                          // Statuszeile zeigt gerade einen Doppelt-Hinweis
        var hinweisFuer = null;                             // Markierung, für die der Hinweis zuletzt galt
        function status(text) { lStatus.text = text || ""; statusDoppelt = false; }

        function enterSchutz(ev) {                          // Eingabetaste im Textfeld löst nicht „Platzieren“ aus
            if (ev.keyName === "Enter" || ev.keyName === "Return") enterImFeld = new Date().getTime();
        }
        function praefixJetzt() { return ePraefix ? String(ePraefix.text).replace(/[\r\n]+/g, "") : wahl.praefix; }
        function feldVon(id) {
            for (var k = 0; k < FELDER.length; k++) if (FELDER[k].id === id) return FELDER[k];
            return null;
        }
        function copyrightStatus() {
            if (!META_RAHMEN.copyright) return;
            var e = folge[auswahl], t = metaWert(e ? e.meta : null, feldVon("copyright"), praefixJetzt());
            status(t ? "Copyright wird „" + t + "“" : "Kein Autor — „" + META_RAHMEN.copyright.rahmen.name + "“ bleibt leer");
        }
        // Welche Texte auf die Musterseite kommen — und ob das auch andere Seiten betrifft.
        var musterSammelSpeicher = { sch: null, mr: [] };
        function musterAnzeigeNeu() {
            if (!lMuster) return;
            if (!cbMuster.enabled) { lMuster.text = ""; return; }
            if (!cbMuster.value) { lMuster.text = "Alle Texte kommen auf die einzelnen Seiten."; return; }
            var mw = musterFeldWerte(folge, praefixJetzt(), true), ziele = zielPlan ? zielPlan.ziele : [];
            var inM = [], jeS = [], namen = [], aussen = [], gesehen = {}, platzhalter = false, k, i;
            for (k = 0; k < FELDER.length; k++) {
                if (!META_RAHMEN[FELDER[k].id]) continue;
                if (mw[FELDER[k].id] === undefined) jeS.push(FELDER[k].text); else inM.push(FELDER[k].text);
            }
            if (!inM.length) {
                lMuster.text = folge.length > 1 ? "Kein Text ist bei allen Bildern gleich" : "Bei nur einem Bild kommen die Texte auf die Seite";
                return;
            }
            // Welche Musterrahmen getroffen werden, hängt nur von Feldern und Seitenplan ab (nicht vom Text)
            var sch = inM.join("|") + "#" + zielIndex() + "#" + ziele.length + "#" + folge.length;
            if (musterSammelSpeicher.sch !== sch) {
                try { musterSammelSpeicher = { sch: sch, mr: musterRahmenSammeln(ziele, folge, mw) }; } catch (e) { musterSammelSpeicher = { sch: sch, mr: [] }; }
            }
            var mr = musterSammelSpeicher.mr;
            for (k = 0; k < mr.length; k++) {
                try {
                    var b = musterBewerten(mr[k].m, mr[k].feld, mw[mr[k].feld.id], ziele);
                    if (!gesehen["n" + b.name]) { gesehen["n" + b.name] = true; namen.push("„" + b.name + "“"); }
                    if (b.fremd && b.frage) platzhalter = true;
                    for (i = 0; i < b.aussen.length; i++) {
                        if (!gesehen["s" + b.aussen[i]]) { gesehen["s" + b.aussen[i]] = true; aussen.push(b.aussen[i]); }
                    }
                } catch (e2) {}
            }
            var t = "Musterseite" + (namen.length ? " " + namen.join(", ") : "") + ": " + inM.join(", ");
            if (aussen.length) t += " — ändert auch " + mehrzahl(aussen.length, "andere Seite", "andere Seiten") + " (Rückfrage beim Platzieren)";
            else if (platzhalter) t += " — Platzhalter im Muster (Rückfrage beim Platzieren)";
            if (jeS.length) t += " · je Seite: " + jeS.join(", ");
            lMuster.text = t;
        }
        function metaFeldBauen(f) {
            var zeile = f.id === "unterschrift" ? mZeile2 : mZeile1;
            var da = !!META_RAHMEN[f.id], ort = zeile;
            zeile.add("statictext", undefined, f.text + ":");
            if (f.praefix) {                                    // Präfix + Autor als ein Wert lesbar
                ort = zeile.add("group");
                ort.orientation = "row";
                ort.margins = 0;
                ort.spacing = 2;
                ort.alignChildren = ["left", "center"];
                ePraefix = ort.add("edittext", undefined, wahl.praefix);
                ePraefix.preferredSize = META_MASSE.praefix;
                ePraefix.enabled = da;
                ePraefix.helpTip = "Steht vor dem Autor — gilt für alle Bilder und wird gemerkt. Das Leerzeichen am Ende zählt mit; leer = nur der Autor.";
                ePraefix.onChanging = function () { if (!stumm) { copyrightStatus(); musterAnzeigeNeu(); } };
                ePraefix.addEventListener("keydown", enterSchutz);
            }
            var ed = ort.add("edittext", undefined, "", f.id === "unterschrift" ? { multiline: true, scrolling: true } : undefined);
            ed.preferredSize = META_MASSE[f.id];
            ed.enabled = da;
            ed.helpTip = !da ? "Kein Textrahmen namens „" + f.text + "“ auf der Seite oder ihrer Musterseite"
                             : (f.praefix ? "Autor aus IPTC „Ersteller“ — kommt mit dem Präfix davor in den Textrahmen „"
                                          : "Kommt in den Textrahmen „") + META_RAHMEN[f.id].rahmen.name + "“";
            var ba = zeile.add("button", undefined, "alle");
            ba.preferredSize = [44, 22];
            ba.enabled = da;
            ba.helpTip = f.praefix ? "Diesen Autor für alle Bilder übernehmen (das Präfix gilt ohnehin für alle)" : "Diesen Text für alle Bilder übernehmen";
            ed.onChanging = function () {
                if (stumm) return;
                var e = folge[auswahl];
                if (e && e.meta) e.meta[f.id] = ed.text;
                if (f.praefix) copyrightStatus();    // KEIN knoepfeNeu: ruft metaFelderNeu → setzt ed.text → Cursor springt
                musterAnzeigeNeu();
            };
            ed.addEventListener("keydown", enterSchutz);
            ba.onClick = function () {
                var wert = ed.text;
                for (var k = 0; k < folge.length; k++) if (folge[k].meta) folge[k].meta[f.id] = wert;
                if (f.praefix) knoepfeNeu(); else musterAnzeigeNeu();   // Infozeile „ohne Autor“ bzw. Musterseiten-Zeile
                status((f.praefix ? "Autor" : f.text) + (wert === "" ? " bei allen Bildern geleert" : " für alle " + folge.length + " Bilder übernommen"));
            };
            metaEdit[f.id] = ed;
            metaKnopf[f.id] = ba;
        }

        function metaFelderNeu() {
            if (!META_AKTIV) return;
            var e = folge[auswahl], alt = stumm;
            stumm = true;
            for (var k = 0; k < FELDER.length; k++) {
                var ed = metaEdit[FELDER[k].id];
                if (ed) ed.text = (e && e.meta) ? (e.meta[FELDER[k].id] || "") : "";
            }
            stumm = alt;
            var ec = metaEdit.copyright;
            if (ec && META_RAHMEN.copyright) {
                var rn = META_RAHMEN.copyright.rahmen.name, rv = (e && rechteSpeicher[e.datei.fsName]) || "";
                if (e && e.meta && autorNorm(e.meta.copyright) !== "") {
                    ec.helpTip = "Autor aus IPTC „Ersteller“ — kommt mit dem Präfix davor in den Textrahmen „" + rn + "“";
                } else if (!xmpBereit()) {
                    ec.helpTip = "Metadaten hier nicht lesbar — Autor bitte eintragen (Textrahmen „" + rn + "“)";
                } else {
                    ec.helpTip = "Kein „Ersteller“ in den Metadaten — der Textrahmen „" + rn + "“ bleibt leer" +
                                 (rv ? ". Copyright-Vermerk der Datei: „" + rv + "“" : "");
                }
            }
        }

        // ---- Raster-Geometrie: so viele Spalten, dass die Zellen am größten werden
        function raster() {
            var n = Math.max(folge.length, 1), best = { spalten: 1, zelle: 0 };
            for (var s = 1; s <= n; s++) {
                var zeilen = Math.ceil(n / s);
                var z = Math.min(FELD_B / s, FELD_H / zeilen, 150);
                if (z > best.zelle + 0.01) best = { spalten: s, zelle: Math.floor(z) };
            }
            var zeilenAnzahl = Math.ceil(n / best.spalten);
            best.x0 = Math.floor((FELD_B - best.spalten * best.zelle) / 2);
            best.y0 = Math.floor((FELD_H - zeilenAnzahl * best.zelle) / 2);
            return best;
        }
        function zelleBei(x, y) {
            var r = raster();
            var s = Math.floor((x - r.x0) / r.zelle), z = Math.floor((y - r.y0) / r.zelle);
            if (x < r.x0 || y < r.y0 || s < 0 || s >= r.spalten) return -1;
            var i = z * r.spalten + s;
            return (i >= 0 && i < folge.length) ? i : -1;
        }

        var zugVon = -1, zugNach = -1;

        feld.onDraw = function () {
            var g = this.graphics;
            var r = raster();
            var grund = g.newBrush(g.BrushType.SOLID_COLOR, [0.2, 0.2, 0.2, 1]);
            var kachel = g.newBrush(g.BrushType.SOLID_COLOR, [0.29, 0.29, 0.29, 1]);
            var kachelDefekt = g.newBrush(g.BrushType.SOLID_COLOR, [0.55, 0.14, 0.14, 1]);
            var markeGrund = g.newBrush(g.BrushType.SOLID_COLOR, [0, 0, 0, 0.65]);
            var stiftWahl = g.newPen(g.PenType.SOLID_COLOR, [0.2, 0.6, 1, 1], 3);
            var stiftZiel = g.newPen(g.PenType.SOLID_COLOR, [1, 0.6, 0.1, 1], 3);
            var stiftText = g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1, 1], 1);
            var stiftGrau = g.newPen(g.PenType.SOLID_COLOR, [0.75, 0.75, 0.75, 1], 1);
            var schrift = ScriptUI.newFont("dialog", "BOLD", 11);
            var marken = r.zelle >= 44;             // bei winzigen Kacheln nur das Bild
            var artK = ddEin.selection ? ddEin.selection.index : wahl.einpassung;
            var dunkel = g.newBrush(g.BrushType.SOLID_COLOR, [0, 0, 0, 0.6]);
            var rahmenGrund = g.newBrush(g.BrushType.SOLID_COLOR, [0.4, 0.4, 0.4, 1]);
            var stiftRahmen = g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1, 1], 1);
            var punktFarbe = g.newBrush(g.BrushType.SOLID_COLOR, [0.2, 0.6, 1, 1]);
            var markeDoppelt = g.newBrush(g.BrushType.SOLID_COLOR, [0.85, 0.5, 0.05, 0.95]);
            var markeDok = g.newBrush(g.BrushType.SOLID_COLOR, [0.1, 0.5, 0.4, 0.95]);
            var stiftPartner = g.newPen(g.PenType.SOLID_COLOR, [1, 0.85, 0.2, 1], 2);
            var dWahl = folge[auswahl] ? doppel[schluessel(folge[auswahl])] : null, gWahl = dWahl ? dWahl.g : null;

            g.newPath();
            g.rectPath(0, 0, FELD_B, FELD_H);
            g.fillPath(grund);
            if (hilfeAn) { hilfeZeichnen(g, schrift, stiftText, stiftGrau); return; }

            for (var i = 0; i < folge.length; i++) {
                var x = r.x0 + (i % r.spalten) * r.zelle;
                var y = r.y0 + Math.floor(i / r.spalten) * r.zelle;
                var innen = r.zelle - 8;
                var e = folge[i], v = vorschau[schluessel(e)];
                var defekt = istDefekt(e, v);

                g.newPath();
                g.rectPath(x + 3, y + 3, r.zelle - 6, r.zelle - 6);
                g.fillPath(defekt ? kachelDefekt : kachel);

                // Kachel zeigt den Ausschnitt: ganzes Bild, darüber der Rahmen,
                // was übersteht (abgeschnitten wird) ist abgedunkelt.
                var mxK = x + r.zelle / 2, myK = y + r.zelle / 2;
                var obK = v ? (v.ob || v.b) : 0, ohK = v ? (v.oh || v.h) : 0;
                var ilK = innenLage(e.ah, e.av);
                var geo = (v && v.bild) ? ausschnitt(RAHMEN_MASS[0], RAHMEN_MASS[1], obK, ohK, artK, ilK[0], ilK[1], innen - 4) : null;
                if (geo) {
                    var bi = pixel(geo.bild, mxK, myK, 1), ra = pixel(geo.rahmen, mxK, myK, 2);
                    flaeche(g, rahmenGrund, ra);
                    try { g.drawImage(v.bild, bi[0], bi[1], bi[2] - bi[0], bi[3] - bi[1]); } catch (x1) {}
                    var bd = baender(bi, ra);
                    for (var bk = 0; bk < bd.length; bk++) flaeche(g, dunkel, bd[bk]);
                    umriss(g, stiftRahmen, ra);
                } else if (v && v.bild) {
                    var bb = v.b || innen, bh = v.h || innen;
                    var mass = Math.min((innen - 4) / bb, (innen - 4) / bh);
                    var dw = Math.max(1, Math.round(bb * mass)), dh = Math.max(1, Math.round(bh * mass));
                    try { g.drawImage(v.bild, x + Math.round((r.zelle - dw) / 2), y + Math.round((r.zelle - dh) / 2), dw, dh); } catch (x2) {}
                } else {
                    var nur = ausschnitt(RAHMEN_MASS[0], RAHMEN_MASS[1], RAHMEN_MASS[0], RAHMEN_MASS[1], 2, 0, 0, innen - 4);
                    if (nur) {
                        var rq = pixel(nur.rahmen, mxK, myK, 2);
                        umriss(g, stiftGrau, rq);
                        if (e.ah || e.av) {
                            var px = rq[0] + 2 + Math.round(Math.max(0, rq[2] - rq[0] - 9) * (e.ah + 1) / 2);
                            var py = rq[1] + 2 + Math.round(Math.max(0, rq[3] - rq[1] - 9) * (e.av + 1) / 2);
                            flaeche(g, punktFarbe, [px, py, px + 5, py + 5]);
                        }
                    }
                    var text = defekt ? "!" : (e.datei.displayName.match(/\.([^.]+)$/) || ["", "?"])[1].toUpperCase();
                    if (v && v.fehler === "kennwortgeschuetzt") text = "PDF 🔒";
                    g.drawString(text, defekt ? stiftText : stiftGrau, x + r.zelle / 2 - text.length * 3.5, y + r.zelle / 2 - 7, schrift);
                }

                if (marken) {
                    var marke = String(i + 1);
                    g.newPath();
                    g.rectPath(x + 5, y + r.zelle - 22, 8 + marke.length * 7, 16);
                    g.fillPath(markeGrund);
                    g.drawString(marke, stiftText, x + 9, y + r.zelle - 21, schrift);
                    if (seiteZeigen(e)) {
                        var sm = "S. " + e.seite;
                        var sb = 8 + sm.length * 6.5;
                        g.newPath();
                        g.rectPath(x + r.zelle - 5 - sb, y + 6, sb, 16);
                        g.fillPath(markeGrund);
                        g.drawString(sm, stiftText, x + r.zelle - 1 - sb, y + 7, schrift);
                    }
                }

                var dk = doppel[schluessel(e)];
                if (dk && (dk.art === "inhalt" || dk.art === "dokument")) {
                    var dt = r.zelle >= 100 ? (dk.art === "inhalt" ? "= " + seitenName(dk.erster) : (dk.sicher ? "im Dok." : "im Dok.?")) : "";
                    var db = dt ? 8 + dt.length * 6.5 : 10;
                    g.newPath();
                    g.rectPath(x + r.zelle - 5 - db, y + r.zelle - (dt ? 22 : 15), db, dt ? 16 : 10);
                    g.fillPath(dk.art === "inhalt" ? markeDoppelt : markeDok);
                    if (dt) g.drawString(dt, stiftText, x + r.zelle - 1 - db, y + r.zelle - 21, schrift);
                }

                if (i === zugNach && zugVon >= 0 && zugNach !== zugVon) {
                    g.newPath();
                    g.rectPath(x + 2, y + 2, r.zelle - 4, r.zelle - 4);
                    g.strokePath(stiftZiel);
                } else if (i === auswahl) {
                    g.newPath();
                    g.rectPath(x + 2, y + 2, r.zelle - 4, r.zelle - 4);
                    g.strokePath(stiftWahl);
                } else if (gWahl && dk && dk.g === gWahl) {
                    g.newPath();
                    g.rectPath(x + 5, y + 5, r.zelle - 10, r.zelle - 10);
                    g.strokePath(stiftPartner);
                }
            }
        };

        function neuZeichnen() {
            feld.hide();
            feld.show();
            punkt.hide();
            punkt.show();
        }

        // ---- Bezugspunkt: Ausrichtung des markierten Bildes
        function wirkungJetzt(e) {
            var v = e ? vorschau[schluessel(e)] : null;
            var ob = v ? (v.ob || v.b) : 0, oh = v ? (v.oh || v.h) : 0;
            var geo = ausschnitt(RAHMEN_MASS[0], RAHMEN_MASS[1], ob, oh, ddEin.selection ? ddEin.selection.index : wahl.einpassung, 0, 0, 100);
            if (!geo) return { h: true, v: true };
            // wirkt ist in Innenachsen gerechnet — auf die sichtbaren Achsen umlegen
            return { h: RAHMEN_INNEN.h[0] !== 0 ? geo.wirkt.h : geo.wirkt.v, v: RAHMEN_INNEN.v[1] !== 0 ? geo.wirkt.v : geo.wirkt.h };
        }
        punkt.onDraw = function () {
            var g = this.graphics, e = folge[auswahl], wirkt = wirkungJetzt(e), zh, zv;
            var grund = g.newBrush(g.BrushType.SOLID_COLOR, [0.2, 0.2, 0.2, 1]);
            var voll = g.newBrush(g.BrushType.SOLID_COLOR, [0.2, 0.6, 1, 1]);
            var hell = g.newPen(g.PenType.SOLID_COLOR, [0.85, 0.85, 0.85, 1], 1);
            var matt = g.newPen(g.PenType.SOLID_COLOR, [0.45, 0.45, 0.45, 1], 1);
            flaeche(g, grund, [0, 0, 3 * PUNKT, 3 * PUNKT]);
            umriss(g, matt, [PUNKT / 2, PUNKT / 2, 2.5 * PUNKT, 2.5 * PUNKT]);
            for (zv = -1; zv <= 1; zv++) {
                for (zh = -1; zh <= 1; zh++) {
                    var q = [(zh + 1) * PUNKT + 1, (zv + 1) * PUNKT + 1, (zh + 2) * PUNKT - 1, (zv + 2) * PUNKT - 1];
                    var an = !!e && e.ah === zh && e.av === zv;
                    var ohneWirkung = (zh !== 0 && !wirkt.h) || (zv !== 0 && !wirkt.v);
                    flaeche(g, an ? voll : grund, q);
                    umriss(g, (an || !ohneWirkung) ? hell : matt, q);
                }
            }
        };
        punkt.addEventListener("mousedown", function (ev) {
            var zh = Math.floor(ev.clientX / PUNKT), zv = Math.floor(ev.clientY / PUNKT);
            if (zh < 0 || zh > 2 || zv < 0 || zv > 2) return;
            ausrichtungSetzen(zh - 1, zv - 1, ev.altKey === true);     // ⌥-Klick: für alle
            fokusZurueck();
        });

        function ausrichtungSetzen(h, v, alle) {
            if (!folge.length) return;
            h = achse(h);
            v = achse(v);
            if (alle) {
                for (var k = 0; k < folge.length; k++) { folge[k].ah = h; folge[k].av = v; }
                standard.ah = h;
                standard.av = v;
                listeNeu();
                status("Alle Bilder: " + LAGEN[(v + 1) * 3 + (h + 1)]);
            } else {
                folge[auswahl].ah = h;
                folge[auswahl].av = v;
                zeileNeu(auswahl);
                status("Bild " + (auswahl + 1) + ": " + LAGEN[(v + 1) * 3 + (h + 1)]);
            }
            knoepfeNeu();
            neuZeichnen();
        }
        function bildSpalte(e, v) {
            var pfeil = PFEILE[lageIndex(e)], d = doppel[schluessel(e)];
            var vor = istDefekt(e, v) ? "⚠ " : (d && d.art === "inhalt" ? "= " : (d && d.art === "dokument" ? "● " : ""));
            return vor + (pfeil ? pfeil + " " : "") + anzeigeName(e);
        }
        function zeileNeu(i) {                      // eine Zeile statt removeAll (Liste springt nicht)
            try { liste.items[i].subItems[0].text = bildSpalte(folge[i], vorschau[schluessel(folge[i])]); }
            catch (x) { listeNeu(); }
        }

        // ---- Zielseiten: Plan je Modus (zwischengespeichert), Spalte „Seite“
        var folgeCache = {}, zielPlan = null, zielPlanSchluessel = "";
        function zielIndex() { return ddZiel.selection ? ddZiel.selection.index : wahl.ziel; }
        function zielPlanNeu() {
            var m = zielIndex();
            var sch = m + "|" + folge.length + "|" + (m >= ZIEL_LEERE ? cbSpiegeln.value : "");
            if (zielPlan && sch === zielPlanSchluessel) return;
            zielPlan = mitPunkt(function () { return zielePlanen(m, folge.length, cbSpiegeln.value, folgeCache); });
            zielPlanSchluessel = sch;
        }
        function seitenName(i) {
            if (!zielPlan) zielPlanNeu();
            var z = zielPlan.ziele[i];
            return z ? z.name : "";
        }
        function zielText() {
            var n = folge.length, p = zielPlan, m = zielIndex(), t = "";
            if (n <= 1) return "keine neuen Seiten";
            var vorhanden = n - 1 - p.neu;
            if (m === ZIEL_DAHINTER) {
                t = p.ungerade ? "⚠ " + mehrzahl(p.verschoben, "Folgeseite wechselt", "Folgeseiten wechseln") + " links/rechts"
                               : mehrzahl(p.neu, "neue Seite", "neue Seiten") + " hinter S. " + quellSeite.name;
            } else if (m === ZIEL_ENDE) {
                t = mehrzahl(p.neu, "neue Seite", "neue Seiten") + " ab S. " + p.ziele[1].name.replace(/^\+/, "");
            } else {
                t = (vorhanden ? mehrzahl(vorhanden, "Folgeseite", "Folgeseiten") : "keine passende Folgeseite") +
                    (p.neu ? " · " + p.neu + " neu am Ende" : "") +
                    (p.uebersprungen.length ? " · " + p.uebersprungen.length + " übersprungen" : "");
            }
            if (p.neu && p.fest) t += " · ⚠ Seiten verschieben aus";
            return t;
        }

        function listeNeu() {
            stumm = true;
            liste.removeAll();
            var art = ddEin.selection ? ddEin.selection.index : wahl.einpassung;
            for (var i = 0; i < folge.length; i++) {
                var e = folge[i], v = vorschau[schluessel(e)];
                var zeile = liste.add("item", seitenName(i));
                zeile.subItems[0].text = bildSpalte(e, v);
                zeile.subItems[1].text = ppiText(e, v, art);
            }
            if (folge.length) liste.selection = auswahl;
            stumm = false;
        }

        // Seiten einer Datei, wie sie gerade in der Liste stehen: [1, 2, 3, 7]
        function seitenDerDatei(datei) {
            var s = [];
            for (var k = 0; k < folge.length; k++) {
                if (folge[k].seite && folge[k].datei.fsName === datei.fsName) s.push(folge[k].seite);
            }
            return s;
        }
        // [1, 2, 3, 7] -> „1-3, 7“
        function seitenText(s) {
            var teile = [], i = 0;
            while (i < s.length) {
                var j = i;
                while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
                teile.push(j > i ? s[i] + "-" + s[j] : String(s[i]));
                i = j + 1;
            }
            return teile.join(", ");
        }

        function pdfZeileNeu() {
            var e = folge[auswahl];
            var geht = !!(e && seiteZeigen(e));
            ePdf.enabled = bAufteilen.enabled = geht;
            lVon.text = !geht ? "" : (e.anzahl > 1 ? "von " + e.anzahl : "von ?");
            var sch = e ? schluessel(e) : null;
            if (sch !== pdfSchluessel || ePdf.text === pdfVorbelegt) {   // unberührt: jetzigen Stand zeigen
                pdfSchluessel = sch;
                ePdf.text = geht ? seitenText(seitenDerDatei(e.datei)) : "";
                pdfVorbelegt = ePdf.text;
            }
        }

        function knoepfeNeu() {
            // „offen“ = mehrseitige Datei, deren Seiten noch nie gewählt wurden
            var n = folge.length, defekte = 0, jeDatei = {}, anzahlOffen = 0, k;
            for (k = 0; k < n; k++) {
                var ek = folge[k];
                if (istDefekt(ek, vorschau[schluessel(ek)])) defekte++;
                if (ek.anzahl > 1) {
                    var p = ek.datei.fsName;
                    if (!jeDatei[p]) jeDatei[p] = { zahl: 0, geteilt: false };
                    jeDatei[p].zahl++;
                    if (ek.geteilt) jeDatei[p].geteilt = true;
                }
            }
            for (var pf in jeDatei) {
                if (jeDatei.hasOwnProperty(pf) && jeDatei[pf].zahl === 1 && !jeDatei[pf].geteilt) anzahlOffen++;
            }
            offenPdf = anzahlOffen;
            ddZiel.enabled = n > 1;
            var tip = "";
            if (zielPlan && zielIndex() >= ZIEL_LEERE) {
                tip = uebersprungenText(zielPlan.uebersprungen) +
                      (zielPlan.ohneRahmen ? (zielPlan.uebersprungen.length ? "\n" : "") + mehrzahl(zielPlan.ohneRahmen, "Seite", "Seiten") + " ohne passenden Rahmen" : "");
            }
            info.helpTip = tip;
            var ohneAutor = 0;
            if (META_RAHMEN.copyright && xmpBereit()) {
                for (k = 0; k < n; k++) if (folge[k].meta && autorNorm(folge[k].meta.copyright) === "") ohneAutor++;
            }
            info.text = n + (n === 1 ? " Bild" : " Bilder") + " · Rahmen auf Seite " + quellSeite.name + " · " + zielText() +
                        (anzahlOffen ? " · " + anzahlOffen + (anzahlOffen === 1 ? " mehrseitiges PDF" : " mehrseitige PDFs") + " (Seiten unter „PDF-Seiten“ wählen)" : "") +
                        (defekte ? " · " + defekte + (defekte === 1 ? " Datei nicht lesbar" : " Dateien nicht lesbar") : "") +
                        (ohneAutor ? " · " + ohneAutor + " ohne Autor" : "");
            bHoch.enabled = auswahl > 0;
            bRunter.enabled = auswahl < n - 1;
            bWeg.enabled = n > 1;
            bOk.enabled = n > 0;
            bAlle.enabled = n > 1;
            if (pruefStand === "offen") {
                bDoppelt.text = "Doppelte suchen";
                bDoppelt.enabled = true;
            } else {
                var zi = doppelZahl.inhalt, zd = doppelZahl.dokument;
                bDoppelt.text = zi ? "Doppelte entfernen (" + zi + ")" : (zd ? "Platzierte entfernen (" + zd + ")" : "Doppelte entfernen");
                bDoppelt.enabled = zi + zd > 0;
            }
            var schWahl = folge[auswahl] ? schluessel(folge[auswahl]) : null;
            var dm = schWahl ? doppel[schWahl] : null;
            if (dm && (dm.art === "inhalt" || dm.art === "dokument")) {
                // nur bei neuer Markierung — sonst überschriebe er die Meldung der gerade getanen Aktion
                if (schWahl !== hinweisFuer || statusDoppelt) {
                    status(dm.art === "inhalt" ? "Doppelt — gleicher Inhalt wie Seite " + seitenName(dm.erster) + " (" + anzeigeName(folge[dm.erster]) + ")"
                                               : (dm.sicher ? "Schon im Dokument: " : "Vermutlich schon im Dokument: ") + ortVon(dm.wo));
                    statusDoppelt = true;
                }
            } else if (statusDoppelt) {
                status("");
            }
            hinweisFuer = schWahl;
            var ea = folge[auswahl];
            punkt.helpTip = "Ausrichtung im Rahmen" + (ea ? ": " + LAGEN[lageIndex(ea)] : "") +
                            " — Klick: markiertes Bild · " + (MAC ? "⌥" : "Alt") + "-Klick: alle Bilder · Tasten 1–9 (1 2 3 = oben)";
            pdfZeileNeu();
            metaFelderNeu();
            musterAnzeigeNeu();
        }

        function allesNeu() {
            if (auswahl > folge.length - 1) auswahl = folge.length - 1;
            if (auswahl < 0) auswahl = 0;
            zielPlanNeu();
            doppelteBerechnen();
            listeNeu();
            knoepfeNeu();
            neuZeichnen();
        }

        function vonHand() {
            stumm = true;
            ddReihe.selection = MANUELL;
            stumm = false;
        }

        function verschieben(von, nach) {
            if (von === nach || von < 0 || nach < 0 || von >= folge.length || nach >= folge.length) return;
            var stueck = folge.splice(von, 1)[0];
            folge.splice(nach, 0, stueck);
            auswahl = nach;
            vonHand();
            allesNeu();
        }

        function waehlen(i) {
            auswahl = i;
            stumm = true;
            liste.selection = i;
            stumm = false;
            knoepfeNeu();
            neuZeichnen();
        }

        // Das Feld beschreibt den GANZEN Bestand dieser Datei in der Liste: alle
        // ihre Einträge werden durch die eingegebenen Seiten ersetzt — als
        // geschlossener Block in Eingabereihenfolge an der Stelle des markierten
        // Eintrags. Wer „1-4, 7-12“ tippt, nimmt also 5 und 6 heraus.
        function aufteilen() {
            var e = folge[auswahl];
            if (!e || !e.seite || !bAufteilen.enabled) return false;
            var seiten = seitenLesen(ePdf.text, e.anzahl);
            if (!seiten) {
                alert("Seiten bitte so angeben: 1-3, 7" + (e.anzahl > 1 ? " oder alle (1 bis " + e.anzahl + ")" : ""), TITEL);
                return false;
            }
            if (seiten.length > 200 &&
                !confirm(seiten.length + " Seiten ergeben " + seiten.length + " Dokumentseiten. Weiter?", false, TITEL)) return false;
            var rest = [], pos = 0, neue = [], vorher = {}, k;
            for (k = 0; k < folge.length; k++) {
                if (k === auswahl) pos = rest.length;
                if (folge[k].seite && folge[k].datei.fsName === e.datei.fsName) {
                    vorher[folge[k].seite] = folge[k];      // behält eigene Ausrichtung und Texte
                    continue;
                }
                rest.push(folge[k]);
            }
            for (k = 0; k < seiten.length; k++) {
                var n = eintrag(e.datei, seiten[k], vorher[seiten[k]] || e);
                n.anzahl = e.anzahl;
                n.geteilt = true;
                neue.push(n);
            }
            try { vorschauenLaden(neue, vorschau); } catch (x) {}
            folge = rest.slice(0, pos).concat(neue, rest.slice(pos));
            auswahl = pos;
            if (ddReihe.selection && ddReihe.selection.index !== MANUELL) {
                var soll = sortiert(folge, ddReihe.selection.index);
                for (k = 0; k < soll.length; k++) {
                    if (soll[k] !== folge[k]) { vonHand(); break; }
                }
            }
            pdfSchluessel = null;                   // Feld zeigt danach den neuen Stand
            allesNeu();
            return true;
        }

        function doppelteBerechnen() {
            var erste = {}, dokGruppe = {}, ersetzt = {}, k;
            doppel = {};
            doppelZahl = { inhalt: 0, dokument: 0, vermutlich: 0 };
            // „ersetzen“: Bilder in den Zielrahmen verschwinden gleich — kein „schon im Dokument“
            if (zielPlan && zielIndex() === ZIEL_ERSETZEN) {
                for (k = 0; k < zielPlan.ziele.length; k++) {
                    var zk = zielPlan.ziele[k];
                    if (zk.art === "vorhanden" && zk.treffer && !zk.treffer.muster) { try { ersetzt[zk.treffer.obj.id] = true; } catch (x) {} }
                }
            }
            function frei(liste) {
                for (var i = 0; liste && i < liste.length; i++) if (!ersetzt[liste[i].rahmenId]) return liste[i];
                return null;
            }
            for (k = 0; k < platziert.dateien.length; k++) {
                var pd = platziert.dateien[k], ip = inhalt[pd.datei.fsName];
                if (!ip || !ip.gruppe || ersetzt[pd.wo.rahmenId]) continue;
                if (!dokGruppe[ip.gruppe + "#" + pd.seite]) dokGruppe[ip.gruppe + "#" + pd.seite] = pd.wo;
            }
            for (k = 0; k < folge.length; k++) {
                var e = folge[k], sch = schluessel(e), info = inhalt[e.datei.fsName], s = e.seite || 0;
                var g = (info && info.gruppe) ? info.gruppe + "#" + s : null;
                if (g) {
                    if (erste[g] !== undefined) { doppel[sch] = { art: "inhalt", erster: erste[g], g: g }; doppelZahl.inhalt++; continue; }
                    erste[g] = k;
                }
                // Vergleichstexte je Datei nur einmal bilden — allesNeu läuft bei jeder Änderung
                if (info && info.vpfad === undefined) { info.vpfad = vergleichsText(e.datei.fsName); info.vname = vergleichsText(e.datei.displayName); }
                var wo = frei(platziert.pfad[(info ? info.vpfad : vergleichsText(e.datei.fsName)) + "#" + s]), sicher = true;
                if (!wo && g) wo = dokGruppe[g] || null;
                if (!wo && info && info.groesse > 0) {
                    wo = frei(platziert.name[info.vname + "|" + info.groesse + "#" + s]);
                    if (wo) sicher = false;
                }
                if (wo) { doppel[sch] = { art: "dokument", wo: wo, sicher: sicher, g: g }; doppelZahl.dokument++; if (!sicher) doppelZahl.vermutlich++; }
                else if (g) doppel[sch] = { art: "erster", g: g };
            }
        }

        // Neue Einträge aus „Dateien …“ oder „Ordner …“ in die Liste
        function zufuegen(neu, mehrereOrdner) {
            var vorhanden = {}, dazu = [], schon = 0, k;
            for (k = 0; k < folge.length; k++) vorhanden[schluessel(folge[k])] = true;
            for (k = 0; k < neu.length; k++) {
                var sch = schluessel(neu[k]);
                if (vorhanden[sch]) { schon++; continue; }
                vorhanden[sch] = true;
                dazu.push(neu[k]);
            }
            if (!dazu.length) {
                if (schon) status(schon === 1 ? "Das Bild steht schon in der Liste" : "Alle " + schon + " Bilder stehen schon in der Liste");
                return;
            }
            if (folge.length + dazu.length > 300 &&
                !frage((folge.length + dazu.length) + " Bilder ergeben ebenso viele Dokumentseiten. Weiter?", false)) return;
            vorschauenLaden(dazu, vorschau);
            var merken = folge[auswahl];
            if (mehrereOrdner && ddReihe.selection && ddReihe.selection.index === 0) {
                stumm = true; ddReihe.selection = ORDNER_SORT; stumm = false;
            }
            if (ddReihe.selection.index === MANUELL) folge = folge.concat(sortiert(dazu, ORDNER_SORT));
            else folge = sortiert(folge.concat(dazu), ddReihe.selection.index);
            auswahl = 0;
            for (k = 0; k < folge.length; k++) if (folge[k] === merken) auswahl = k;
            try { pruefStand = inhaltPruefen(folge, platziert, false); } catch (x) { pruefStand = "offen"; }
            status(mehrzahl(dazu.length, "Bild", "Bilder") + " hinzugefügt" + (schon ? " (" + schon + " standen schon in der Liste)" : ""));
            allesNeu();
        }

        function doppelteEntfernen() {
            if (pruefStand === "offen") {
                try { pruefStand = inhaltPruefen(folge, platziert, true); } catch (x) {}
                allesNeu();
                return;
            }
            var mitDok = false, k;
            var vermutet = doppelZahl.vermutlich ? " (" + doppelZahl.vermutlich + " davon nur nach Name und Größe)" : "";
            if (doppelZahl.dokument) {
                if (doppelZahl.inhalt) mitDok = frage(mehrzahl(doppelZahl.inhalt, "doppeltes Bild wird", "doppelte Bilder werden") + " aus der Liste genommen.\n\nAuch die " + doppelZahl.dokument + ", die schon im Dokument stehen" + vermutet + "?", true);
                else if (frage(mehrzahl(doppelZahl.dokument, "Bild steht", "Bilder stehen") + " schon im Dokument" + vermutet + " — aus der Liste nehmen?", true)) mitDok = true;
                else return;
            }
            var merken = folge[auswahl], rest = [], weg = 0;
            for (k = 0; k < folge.length; k++) {
                var d = doppel[schluessel(folge[k])];
                if (d && (d.art === "inhalt" || (mitDok && d.art === "dokument"))) { weg++; continue; }
                rest.push(folge[k]);
            }
            if (!rest.length) { status("Dann bliebe kein Bild übrig"); return; }
            auswahl = 0;
            for (k = 0; k < rest.length; k++) if (rest[k] === merken) auswahl = k;
            folge = rest;
            status(mehrzahl(weg, "Bild", "Bilder") + " aus der Liste genommen");
            allesNeu();
        }

        liste.onChange = function () {
            if (stumm || !liste.selection) return;
            auswahl = liste.selection.index;
            knoepfeNeu();
            neuZeichnen();
        };

        feld.addEventListener("mousedown", function (ev) {
            fokusZurueck();                         // Tipp danach nicht ins Textfeld des vorigen Bilds
            if (hilfeAn) { hilfeZeigen(false); return; }
            var i = zelleBei(ev.clientX, ev.clientY);
            if (i < 0) return;
            zugVon = i;
            zugNach = i;
            waehlen(i);
        });
        feld.addEventListener("mousemove", function (ev) {
            if (zugVon < 0) return;
            var i = zelleBei(ev.clientX, ev.clientY);
            if (i >= 0 && i !== zugNach) {
                zugNach = i;
                neuZeichnen();
            }
        });
        feld.addEventListener("mouseup", function (ev) {
            if (zugVon < 0) return;
            var i = zelleBei(ev.clientX, ev.clientY);
            if (i < 0) i = zugNach;                 // neben der Kachel losgelassen: letzter Zielrahmen
            var von = zugVon;
            zugVon = zugNach = -1;
            if (i >= 0 && i !== von) verschieben(von, i);
            else neuZeichnen();
        });
        feld.addEventListener("mouseout", function () {
            if (zugVon < 0) return;
            zugVon = zugNach = -1;
            neuZeichnen();
        });

        bHoch.onClick = function () { verschieben(auswahl, auswahl - 1); };
        bRunter.onClick = function () { verschieben(auswahl, auswahl + 1); };
        bWeg.onClick = function () {
            if (folge.length <= 1) return;
            var weg = folge.splice(auswahl, 1)[0];
            status(anzeigeName(weg) + " aus der Liste genommen");
            allesNeu();
        };
        bDazu.onClick = function () {
            var dateien = dateienWaehlen(), neu = [];
            for (var k = 0; k < dateien.length; k++) neu.push(eintrag(dateien[k], 1, standard));
            zufuegen(neu, false);
            fokusZurueck();
        };
        bOrdner.onClick = function () {
            var og = ordnerWaehlen(standard);
            if (og && og.eintraege.length) zufuegen(og.eintraege, og.mehrereOrdner);
            fokusZurueck();
        };
        bDoppelt.onClick = function () { doppelteEntfernen(); fokusZurueck(); };
        bAufteilen.onClick = function () { aufteilen(); fokusZurueck(); };
        // Getippte, aber nicht aufgeteilte Seitenwahl nicht stillschweigend übergehen.
        function frageFenster(text, vorgabeNein) {
            var ja = frage(text, vorgabeNein);                 // im Testzugang über TEST.antworten, sonst confirm
            if (!TEST) fokusZurueck();
            return ja;
        }
        bOk.onClick = function () {
            if (new Date().getTime() - enterImFeld < 400) return;   // Eingabetaste im Textfeld
            if (TEST) TEST.platzierenOk = false;
            var getippt = ePdf.text.replace(/\s+/g, "");
            if (ePdf.enabled && getippt !== "" && getippt !== pdfVorbelegt.replace(/\s+/g, "")) {
                if (frageFenster("Die Seitenwahl „" + ePdf.text + "“ ist noch nicht aufgeteilt.\n\n" +
                            "Jetzt aufteilen? (Die Übersicht bleibt dann offen.)", false)) {
                    aufteilen();
                    return;
                }
            }
            if (offenPdf && !frageFenster(offenPdf + (offenPdf === 1 ? " mehrseitiges PDF wird" : " mehrseitige PDFs werden") +
                                     " nur mit Seite 1 platziert.\n\nTrotzdem platzieren?", false)) return;
            zielPlanNeu();
            if (zielPlan.ungerade && !frageFenster(mehrzahl(zielPlan.neu, "neue Seite kommt", "neue Seiten kommen") +
                    " direkt hinter Seite " + quellSeite.name + " — eine ungerade Zahl.\n\n" +
                    "Dadurch wechseln die " + mehrzahl(zielPlan.verschoben, "Seite", "Seiten") +
                    " dahinter von links nach rechts und umgekehrt: Objekte mit Anschnitt oder am Bund stehen dort dann auf der falschen Seite.\n\n" +
                    "Trotzdem direkt dahinter einfügen?\n(Nein: die Übersicht bleibt offen — z. B. „Neue Seiten: am Dokumentende“ wählen.)", true)) return;
            // Vorhandener Text in den Textrahmen — mit dem fertigen Seitenplan, bei jedem Klick neu
            textEntscheid = textVorgabe;
            textGeprueft = false;
            if (META_AKTIV) {
                if (folge.length > 20) { info.text = "Textrahmen werden geprüft …"; try { w.update(); } catch (x) {} }
                var konf = null;
                try { konf = textKonflikte(zielPlan.ziele, folge, praefixJetzt(), musterFeldWerte(folge, praefixJetzt(), cbMuster ? cbMuster.value : wahl.musterTexte)); } catch (x2) { konf = null; }
                if (folge.length > 20) knoepfeNeu();
                if (TEST) TEST.textKonflikte = konf;
                if (konf && konf.length) {
                    var antw = textFrageFenster(konf);
                    if (!TEST) fokusZurueck();
                    if (antw === "zurueck") { status("Nichts platziert — Tasten erst nach Klick in die Liste"); return; }
                    textEntscheid = antw;
                }
                textGeprueft = konf !== null;                  // Prüffehler: der Hauptablauf prüft noch einmal
            }
            if (TEST && TEST.ohneAnzeige) { TEST.platzierenOk = true; return; }   // nie gezeigtes Fenster nicht schließen
            w.close(1);
        };
        // Eingabetaste im Seitenfeld teilt auf, statt „Platzieren“ auszulösen.
        ePdf.onActivate = function () { w.defaultElement = bAufteilen; };
        ePdf.onDeactivate = function () { w.defaultElement = bOk; };

        ddReihe.onChange = function () {
            if (stumm || !ddReihe.selection) return;
            var art = ddReihe.selection.index;
            reiheSelbstGewaehlt = true;
            if (art === MANUELL) return;            // „Von Hand“ ändert nichts
            var merken = folge[auswahl];
            folge = sortiert(folge, art);
            for (var k = 0; k < folge.length; k++) if (folge[k] === merken) auswahl = k;
            allesNeu();
        };
        ddZiel.onChange = function () {
            if (stumm) return;
            if (zielIndex() >= ZIEL_LEERE && !folgeCache.gesehen) {
                folgeCache.gesehen = true;
                info.text = "Folgeseiten werden geprüft …";
                try { w.update(); } catch (e) {}
            }
            allesNeu();
        };
        cbSpiegeln.onClick = function () {                  // Lage der Rahmen auf Gegenseiten ändert sich
            if (zielIndex() >= ZIEL_LEERE) allesNeu();
        };
        ddEin.onChange = function () {
            if (stumm) return;
            listeNeu();
            neuZeichnen();                          // Ausschnitt und Bezugspunkt hängen daran
        };
        bAlle.onClick = function () {
            var e = folge[auswahl];
            if (e) ausrichtungSetzen(e.ah, e.av, true);
        };

        stumm = true;
        ddReihe.selection = wahl.reihenfolge;
        ddEin.selection = wahl.einpassung;
        ddZiel.selection = wahl.ziel;
        stumm = false;
        allesNeu();

        // ---- Tastenkürzel: ein Empfänger am Fenster (keydown blubbert vom Ziel
        // hoch). Gemessen am Mac: ⌘-Kombinationen kommen doppelt an, Ziffern auch
        // im Textfeld, Pfeile ohne ⌘ bewegen die Listenauswahl selbst.
        var letzteTaste = { sig: "", zeit: 0 };
        // Nach einem Unterfenster (Hilfe, Dateiwahl, Rückfrage) bekommt die
        // Übersicht am Mac keine Tasten mehr, bis man hineinklickt (gemessen).
        function fokusZurueck() {
            try { w.active = true; } catch (x) {}
            try { if (liste.enabled) liste.active = true; } catch (x) {}
        }
        // Hilfe als Einblendung im Vorschaufeld: ein eigenes Fenster nimmt der
        // Übersicht am Mac den Tastaturfokus — danach gingen alle Tasten ins Leere (gemessen).
        var hilfeAn = false;
        function hilfeZeigen(an) {
            hilfeAn = (an === true || an === false) ? an : !hilfeAn;
            if (TEST) TEST.hilfe = hilfeAn;
            if (hilfeAn) {
                status("Tastenkürzel · Taste oder Klick in die Vorschau blendet aus");
            } else {
                status("");
                hinweisFuer = null;                                // Doppelt-Hinweis darf wieder erscheinen
                knoepfeNeu();
            }
            neuZeichnen();
        }
        function hilfeZeichnen(g, fett, stiftHell, stiftGrau) {
            var normal = ScriptUI.newFont("dialog", "REGULAR", 11), y = 16, breit = 0, k;
            g.drawString("Tastenkürzel", stiftHell, 20, y, ScriptUI.newFont("dialog", "BOLD", 13));
            y += 34;
            for (k = 0; k < TASTENHILFE.length; k++) {
                try { breit = Math.max(breit, g.measureString(kuerzel(TASTENHILFE[k][0]), fett)[0]); } catch (x) { breit = 150; }
            }
            var x2 = 20 + Math.min(Math.max(breit, 80), 220) + 18;
            for (k = 0; k < TASTENHILFE.length; k++) {
                g.drawString(kuerzel(TASTENHILFE[k][0]), stiftHell, 20, y, fett);
                g.drawString(TASTENHILFE[k][1], stiftGrau, x2, y, normal);
                y += 25;
            }
            g.drawString("Nach Datei- oder Ordnerwahl einmal in die Liste klicken.", stiftGrau, 20, FELD_H - 30, normal);
        }
        function tasteVerarbeiten(ev) {
            var name = String(ev.keyName || ""), shift = !!ev.shiftKey, alt = !!ev.altKey;
            var cmd = MAC ? !!ev.metaKey : (!!ev.ctrlKey && !alt);   // Windows: AltGr = Strg+Alt ist Texteingabe
            if (!name || /^(Meta|Shift|Alt|Control|Command|CapsLock|Option)$/.test(name)) return false;
            var ziel = ev.target ? ev.target.type : "";
            // In Textfeldern und Aufklapplisten bleibt alles Eingabe (auch ⌘↑ = Textanfang) —
            // dort greifen nur die Befehle ⌘O, ⇧⌘O, ⇧⌘D und ⌘J
            if ((ziel === "edittext" || ziel === "dropdownlist") && !(cmd && /^(O|D|J)$/.test(name))) return false;
            var sig = name + (cmd ? "|c" : "") + (shift ? "|s" : "") + (alt ? "|a" : "");
            if (sig === letzteTaste.sig && new Date().getTime() - letzteTaste.zeit < 150) {
                try { ev.preventDefault(); } catch (x) {}
                return true;                                      // zweite Zustellung derselben Taste
            }
            if (hilfeAn && name !== "H") {                        // Hilfe offen: die Taste blendet nur aus
                hilfeZeigen(false);
                try { ev.preventDefault(); } catch (x) {}
                letzteTaste = { sig: sig, zeit: new Date().getTime() };
                return true;
            }
            var getan = true, fokusLassen = false, n = folge.length, d = /^[0-9]$/.test(name) ? parseInt(name, 10) : -1;
            if (!cmd && d >= 1) {
                ausrichtungSetzen(((d - 1) % 3) - 1, Math.floor((d - 1) / 3) - 1, alt);
            } else if (!cmd && d === 0) {
                if (n > 1) bAlle.onClick();
            } else if (/^(Up|Down)$/.test(name)) {
                var runter = name === "Down";
                if (cmd && n > 1) verschieben(auswahl, shift ? (runter ? n - 1 : 0) : auswahl + (runter ? 1 : -1));
                else if (!cmd && ziel !== "listbox" && n) waehlen(Math.max(0, Math.min(n - 1, auswahl + (runter ? 1 : -1))));
                else getan = cmd;
            } else if (!cmd && (name === "Backspace" || name === "Delete")) {
                bWeg.onClick();
            } else if (!cmd && !alt && name === "E") {
                var anzahlE = ddEin.items.length, jetztE = ddEin.selection ? ddEin.selection.index : 0;
                ddEin.selection = (jetztE + (shift ? anzahlE - 1 : 1)) % anzahlE;     // löst onChange selbst aus
                status("Einpassung: " + ddEin.selection.text);
            } else if (!cmd && !alt && name === "H") {
                hilfeZeigen();
            } else if (cmd && name === "O") {
                if (shift) bOrdner.onClick(); else bDazu.onClick();
            } else if (cmd && shift && name === "D") {
                if (bDoppelt.enabled) doppelteEntfernen();
            } else if (cmd && !shift && name === "J") {
                if (ePdf.enabled) { ePdf.active = true; fokusLassen = true; }
            } else {
                getan = false;
            }
            if (!getan) return false;
            try { ev.preventDefault(); } catch (x) {}
            // Zeit NACH der Aktion: blockiert sie (Dateiwahl), kommt die zweite Zustellung erst danach
            letzteTaste = { sig: sig, zeit: new Date().getTime() };
            if (!fokusLassen) fokusZurueck();
            return true;
        }
        w.addEventListener("keydown", tasteVerarbeiten);
        w.onShow = fokusZurueck;
        bHilfe.onClick = hilfeZeigen;
        // Esc bei eingeblendeter Hilfe blendet nur aus, statt die ganze Übersicht zu verwerfen
        bAbbrechen.onClick = function () {
            if (hilfeAn) { hilfeZeigen(false); return; }
            w.close(2);
        };

        if (TEST && TEST.dialogAbfrage) TEST.dialogAbfrage(w, { folge: function () { return folge; }, verschieben: verschieben, aufteilen: aufteilen, feld: ePdf, waehlen: waehlen, reihe: function () { return ddReihe.selection ? ddReihe.selection.index : -1; },
            meta: function (id, text) { var ed = metaEdit[id]; if (!ed) return false; ed.text = text; ed.onChanging(); return true; },
            metaAlle: function (id) { if (metaKnopf[id]) metaKnopf[id].notify("onClick"); },
            metaTip: function (id) { return metaEdit[id] ? metaEdit[id].helpTip : null; },
            praefix: function (t) { if (t !== undefined && ePraefix) { ePraefix.text = t; ePraefix.onChanging(); } return praefixJetzt(); },
            info: function () { return info.text; },
            konflikte: function () { zielPlanNeu(); return textKonflikte(zielPlan.ziele, folge, praefixJetzt(), musterFeldWerte(folge, praefixJetzt(), cbMuster ? cbMuster.value : wahl.musterTexte)); },
            muster: function (v) { if (v !== undefined && cbMuster) { cbMuster.value = !!v; musterAnzeigeNeu(); } return lMuster ? lMuster.text : null; },
            musterAn: function () { return cbMuster ? cbMuster.enabled + "/" + cbMuster.value : null; },
            platzieren: function () { bOk.onClick(); return { ok: TEST.platzierenOk, entscheid: textEntscheid, geprueft: textGeprueft }; },
            metaFeld: function (id) { return metaEdit[id] ? metaEdit[id].text : null; }, status: function () { return lStatus.text; },
            ziel: function (i) { ddZiel.selection = i; ddZiel.onChange(); }, plan: function () { zielPlanNeu(); return zielPlan; },
            doppelt: function () { return { doppel: doppel, zahl: doppelZahl, stand: pruefStand }; }, doppelteEntfernen: doppelteEntfernen,
            zufuegen: zufuegen, ordner: function (o) { var og = ordnerEinlesen(o, standard, true); if (og && og.eintraege.length) zufuegen(og.eintraege, og.mehrereOrdner); },
            reiheName: function () { return ddReihe.selection ? ddReihe.selection.text : ""; },
            taste: function (name, mod, imFeld) {
                mod = mod || "";
                return tasteVerarbeiten({ keyName: name, metaKey: mod.indexOf("c") >= 0, ctrlKey: false, shiftKey: mod.indexOf("s") >= 0,
                                          altKey: mod.indexOf("a") >= 0, target: imFeld ? ePdf : liste, preventDefault: function () {} });
            },
            tasteVergessen: function () { letzteTaste = { sig: "", zeit: 0 }; },
            einpassung: function () { return ddEin.selection ? ddEin.selection.index : -1; }, hilfe: function () { return hilfeAn; },
            ausrichten: ausrichtungSetzen, ausrichtung: function (i) { var e = folge[i === undefined ? auswahl : i]; return e ? [e.ah, e.av] : null; } });

        // Testzugang: ohneAnzeige baut alles auf, zeigt aber nicht (close(1) aus onShow liefert 2 — gemessen).
        if (TEST && TEST.ohneAnzeige === "abbrechen") return null;
        if (TEST && TEST.ohneAnzeige && TEST.platzierenOk === false) return null;   // api.platzieren(): Zurück/Nein
        if ((TEST && TEST.ohneAnzeige) ? false : w.show() !== 1) return null;
        var art = ddReihe.selection.index;
        // Merker: haben alle Bilder dieselbe Ausrichtung, wird sie Vorgabe —
        // ein gemischter Lauf verstellt die Vorgabe nicht.
        var gemeinsam = folge.length ? folge[0] : null;
        for (var gk = 1; gemeinsam && gk < folge.length; gk++) {
            if (folge[gk].ah !== gemeinsam.ah || folge[gk].av !== gemeinsam.av) gemeinsam = null;
        }
        return {
            folge: folge,
            reihenfolge: (art === MANUELL || (art === ORDNER_SORT && !reiheSelbstGewaehlt)) ? wahl.reihenfolge : art,
            einpassung: ddEin.selection.index,
            spiegeln: cbSpiegeln.value,
            seitenziel: ddZiel.selection.index,
            ungerade: !!(zielPlan && zielPlan.ungerade),
            ah: gemeinsam ? gemeinsam.ah : standard.ah,
            av: gemeinsam ? gemeinsam.av : standard.av,
            praefix: praefixJetzt(),
            textVorhanden: textEntscheid,
            textGeprueft: textGeprueft,
            musterTexte: cbMuster ? cbMuster.value : wahl.musterTexte
        };
    }

    var bilder = (TEST && TEST.eintraege && !TEST.dialog) ? eintraege : sortiert(eintraege, wahl.reihenfolge);
    if (!TEST || TEST.dialog) {
        var ergebnis = uebersicht(bilder);
        if (TEST) TEST.dialogErgebnis = ergebnis;
        if (!ergebnis || !ergebnis.folge.length) return;
        bilder = ergebnis.folge;
        wahl.reihenfolge = ergebnis.reihenfolge;
        wahl.einpassung = ergebnis.einpassung;
        wahl.spiegeln = ergebnis.spiegeln;
        wahl.ah = ergebnis.ah;
        wahl.av = ergebnis.av;
        wahl.ziel = ergebnis.seitenziel;
        wahl.praefix = ergebnis.praefix;
        wahl.textVorhanden = ergebnis.textVorhanden;          // wird nicht gemerkt
        wahl.musterTexte = ergebnis.musterTexte;
        merkerSchreiben();
    }

    // ------------------------------------------------------------------------
    // Einpassen und Platzieren
    // ------------------------------------------------------------------------

    function einpassen(r, art, ah, av) {
        if (r.allGraphics.length === 0) return;
        if (art === 1) {
            r.fit(FitOptions.FILL_PROPORTIONALLY);
        } else if (art === 2) {
            r.fit(FitOptions.PROPORTIONALLY);
        } else {
            // Höhe einpassen: ist das Bild im Verhältnis breiter als der
            // Rahmen, trifft „füllen“ die Höhe (Seiten stehen über) — sonst
            // trifft „proportional einpassen“ die Höhe (Rand links/rechts).
            var mb = eigeneMasse(r.allGraphics[0]);
            var mr = eigeneMasse(r);
            if (mb[0] / mb[1] > mr[0] / mr[1]) r.fit(FitOptions.FILL_PROPORTIONALLY);
            else r.fit(FitOptions.PROPORTIONALLY);
        }
        r.fit(FitOptions.CENTER_CONTENT);           // Mitte = wie 1.2
        var innen = (ah || av) ? sichtbarNachInnen(r, ah, av) : [0, 0];
        if (ah || av) kanteBuendig(r, innen[0], innen[1]);
        autoFitNachziehen(r, innen[0], innen[1]);   // auch „mittig“: sonst bliebe ein alter Bezugspunkt stehen
    }

    // „Links/oben“ meint, wie man den Rahmen sieht. Bei gedrehten oder
    // gespiegelten Rahmen zeigt die Rahmenachse woanders hin (gemessen: 180°
    // → innen links = sichtbar rechts; 90° → innen links = sichtbar unten).
    // Deshalb die sichtbare Richtung auf die Innenachsen umrechnen.
    function sichtbarNachInnen(r, ah, av) {
        try {
            var G = BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS, I = CoordinateSpaces.INNER_COORDINATES;
            var o = r.resolve([[0, 0], G, I], PB)[0], x = r.resolve([[1, 0], G, I], PB)[0], y = r.resolve([[0, 1], G, I], PB)[0];
            var ux = [x[0] - o[0], x[1] - o[1]], uy = [y[0] - o[0], y[1] - o[1]];
            // normieren: sonst entschiede bei schräg gedrehten, länglichen Rahmen die Rahmenlänge statt der Richtung
            var lx = Math.sqrt(ux[0] * ux[0] + ux[1] * ux[1]) || 1, ly = Math.sqrt(uy[0] * uy[0] + uy[1] * uy[1]) || 1;
            ux = [ux[0] / lx, ux[1] / lx];
            uy = [uy[0] / ly, uy[1] / ly];
            var ih = 0, iv = 0;
            function vz(z) { return z < 0 ? -1 : 1; }
            if (ah) {                                // sichtbar waagerecht
                if (Math.abs(ux[0]) >= Math.abs(uy[0])) ih = ah * vz(ux[0]); else iv = ah * vz(uy[0]);
            }
            if (av) {                                // sichtbar senkrecht
                if (Math.abs(uy[1]) >= Math.abs(ux[1])) iv = av * vz(uy[1]); else ih = av * vz(ux[1]);
            }
            return [ih, iv];
        } catch (e) { return [ah, av]; }
    }

    // Rahmen mit „Automatisch einpassen“ richten beim späteren Größerziehen
    // nach fittingAlignment neu aus — den Bezugspunkt passend setzen, sonst
    // springt das Bild wieder in die Mitte (gemessen: Kante hält danach).
    function autoFitNachziehen(r, ih, iv) {
        try {
            if (r.frameFittingOptions.autoFit !== true) return;
            var anker = [AnchorPoint.TOP_LEFT_ANCHOR, AnchorPoint.TOP_CENTER_ANCHOR, AnchorPoint.TOP_RIGHT_ANCHOR,
                         AnchorPoint.LEFT_CENTER_ANCHOR, AnchorPoint.CENTER_ANCHOR, AnchorPoint.RIGHT_CENTER_ANCHOR,
                         AnchorPoint.BOTTOM_LEFT_ANCHOR, AnchorPoint.BOTTOM_CENTER_ANCHOR, AnchorPoint.BOTTOM_RIGHT_ANCHOR];
            r.frameFittingOptions.fittingAlignment = anker[(iv + 1) * 3 + (ih + 1)];
        } catch (e) {}
    }

    // Grafik an die gewählte Innenkante schieben, gerechnet im Innenraum des
    // Rahmens: PARENT der Grafik = INNER des Rahmens (gemessen in 216 Fällen:
    // 0°/90°/180°/gespiegelt/150 %/Oval, bündig ±0,05 pt, Skalierung fest).
    // Bündig bezieht sich auf den Rahmenpfad (Konturmitte).
    function kanteBuendig(r, ah, av) {
        var g = r.allGraphics[0];
        var G = BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS, I = CoordinateSpaces.INNER_COORDINATES,
            P = CoordinateSpaces.PARENT_COORDINATES;
        var ra = r.resolve([[0, 0], G, I], I)[0], rb = r.resolve([[1, 1], G, I], I)[0];
        var rx0 = Math.min(ra[0], rb[0]), rx1 = Math.max(ra[0], rb[0]);
        var ry0 = Math.min(ra[1], rb[1]), ry1 = Math.max(ra[1], rb[1]);
        var ecken = [[0, 0], [1, 0], [0, 1], [1, 1]], gx0 = 0, gx1 = 0, gy0 = 0, gy1 = 0;
        for (var k = 0; k < 4; k++) {
            var p = g.resolve([ecken[k], G, I], P)[0];
            if (k === 0) { gx0 = gx1 = p[0]; gy0 = gy1 = p[1]; }
            else {
                gx0 = Math.min(gx0, p[0]); gx1 = Math.max(gx1, p[0]);
                gy0 = Math.min(gy0, p[1]); gy1 = Math.max(gy1, p[1]);
            }
        }
        var dx = ah < 0 ? rx0 - gx0 : (ah > 0 ? rx1 - gx1 : 0);
        var dy = av < 0 ? ry0 - gy0 : (av > 0 ? ry1 - gy1 : 0);
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
        g.transform(P, AnchorPoint.CENTER_ANCHOR, verschiebung(dx, dy));
    }

    function platzieren(ziel, e) {
        var datei = e.datei, erg = null;
        // Altes Bild vorher heraus: place() in einen gefüllten Rahmen erbt
        // dessen Drehung/Spiegelung, und „Höhe einpassen“ entschiede falsch.
        try { while (ziel.graphics.length) ziel.graphics[0].remove(); } catch (x) {}
        // Seite immer ausdrücklich setzen — sonst gilt die vom letzten Import.
        if (MEHRSEITIG.test(datei.name)) app.pdfPlacePreferences.pageNumber = e.seite || 1;
        else if (INDD.test(datei.name)) app.importedPageAttributes.pageNumber = e.seite || 1;
        var vorgaben = app.scriptPreferences, alteInteraktion = vorgaben.userInteractionLevel;
        vorgaben.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        try {
            try {
                erg = ziel.place(datei);
            } catch (fehler) {
                // „Zuschneiden auf Endformat“ bei PDFs ohne Endformat: erst der
                // Zuschnitt-, dann der Medienrahmen.
                if (!MEHRSEITIG.test(datei.name)) throw fehler;
                var alterZuschnitt = app.pdfPlacePreferences.pdfCrop;
                try {
                    try {
                        app.pdfPlacePreferences.pdfCrop = PDFCrop.CROP_PDF;
                        erg = ziel.place(datei);
                    } catch (fehler2) {
                        app.pdfPlacePreferences.pdfCrop = PDFCrop.CROP_MEDIA;
                        erg = ziel.place(datei);
                    }
                } finally {
                    app.pdfPlacePreferences.pdfCrop = alterZuschnitt;
                }
            }
        } finally {
            vorgaben.userInteractionLevel = alteInteraktion;
        }
        // Eine „Bilddatei“ mit Textinhalt (etwa eine als .jpg gespeicherte Fehlerseite) setzt
        // InDesign als TEXT ein und macht aus dem Bildrahmen einen Textrahmen (gleiche id,
        // place() liefert eine Story — gemessen) → zurück zum leeren Bildrahmen, als Fehler melden.
        if (erg && erg.length && erg[0].constructor.name === "Story") {
            try {
                var tf = erg[0].textContainers[0];
                tf.contents = "";
                tf.contentType = ContentType.GRAPHIC_TYPE;
            } catch (x) {}
            throw new Error("keine lesbare Bilddatei, der Inhalt ist Text — Rahmen bleibt leer");
        }
    }

    // ------------------------------------------------------------------------
    // Seiten anlegen und Objekte kopieren
    // ------------------------------------------------------------------------

    function mitte(obj) { return obj.resolve(AnchorPoint.CENTER_ANCHOR, PB)[0]; }
    function ursprung(seite) { return seite.resolve(AnchorPoint.TOP_LEFT_ANCHOR, PB)[0]; }
    function elternSeite(obj) {
        try { return obj.parentPage; } catch (e) { return null; }
    }
    function doppelseitig(seite) {
        try { return seite.side !== PageSideOptions.SINGLE_SIDED; } catch (e) { return false; }
    }
    function alleElemente(sammlung) {
        return sammlung.length ? sammlung.everyItem().getElements() : [];
    }
    function traegtKennung(obj) {
        try {
            if (obj.extractLabel(KENNUNG) === LAUF) return obj;
            var innen = obj.allPageItems;
            for (var k = 0; k < innen.length; k++) if (innen[k].extractLabel(KENNUNG) === LAUF) return innen[k];
        } catch (e) {}
        return null;
    }
    function musterSeiteFuer(muster, seitenLage) {
        try {
            for (var k = 0; k < muster.pages.length; k++) if (muster.pages[k].side === seitenLage) return muster.pages[k];
            if (muster.pages.length === 1) return muster.pages[0];
        } catch (e) {}
        return null;
    }

    // Alles, was sich je Zielseite nicht ändert, einmal von der Quellseite lesen.
    function quelleErfassen(quelle) {
        var info = { objekte: [], hilfslinien: [], raender: null, muster: null, musterSeite: null,
                     ausgeblendet: [], lage: quelle.side };
        var qb = quelle.bounds;
        info.breite = qb[3] - qb[1];
        info.hoehe = qb[2] - qb[0];
        var uq = ursprung(quelle), k;

        // Was zur Seite gehört: alles, dessen Mitte auf ihr liegt, plus
        // Objekte, die von der Montagefläche aus in die Seite ragen.
        var alle = alleElemente(quelle.pageItems);
        for (k = 0; k < alle.length; k++) {
            var pp = elternSeite(alle[k]);
            if (pp && pp.id !== quelle.id) continue;
            var m = mitte(alle[k]);
            info.objekte.push({ obj: alle[k], mx: m[0] - uq[0], my: m[1] - uq[1], rahmen: !!traegtKennung(alle[k]) });
        }
        try {
            var mp = quelle.marginPreferences;
            info.raender = { top: mp.top, bottom: mp.bottom, left: mp.left, right: mp.right,
                             columnCount: mp.columnCount, columnGutter: mp.columnGutter };
        } catch (e) {}
        var linien = alleElemente(quelle.guides);
        for (k = 0; k < linien.length; k++) {
            try {
                info.hilfslinien.push({ ebene: linien[k].itemLayer, werte: {
                    orientation: linien[k].orientation, location: linien[k].location, fitToPage: linien[k].fitToPage,
                    viewThreshold: linien[k].viewThreshold, guideColor: linien[k].guideColor } });
            } catch (e) {}
        }
        // Musterobjekte, die auf der Quellseite gelöst/gelöscht sind, sollen auf
        // den neuen Seiten ebenfalls verschwinden — über die ganze Kette
        // („B-Bild“ basiert auf „A-Basis“). Ist für den Druckbogen „Muster-
        // seitenobjekte ausblenden“ an, wird stattdessen genau das übertragen
        // (masterPageItems ist dann leer — gemessen).
        try {
            info.musterAus = quelle.parent.showMasterItems === false;
            if (quelle.appliedMaster) {
                info.muster = quelle.appliedMaster;
                var mq = musterSeiteFuer(info.muster, quelle.side);
                if (mq) { info.musterSeiteId = mq.id; info.musterVersatz = musterVersatz(quelle, mq); }
                if (!info.musterAus) {
                    var sichtbar = {}, mpi = quelle.masterPageItems;
                    for (k = 0; k < mpi.length; k++) sichtbar[mpi[k].id] = true;
                    // Objekte tieferer Ebenen zählen nur, wenn die direkte Musterseite
                    // sie selbst zeigt — was schon die Mustervorlage ausblendet, hat
                    // niemand auf der Dokumentseite gelöscht.
                    var imMuster = null;
                    try {
                        var direkt = musterSeiteFuer(info.muster, quelle.side);
                        if (direkt) {
                            imMuster = {};
                            var dm = direkt.masterPageItems;
                            for (k = 0; k < dm.length; k++) imMuster[dm[k].id] = true;
                        }
                    } catch (x) { imMuster = null; }
                    var ebene = info.muster, tiefe = 0;
                    while (ebene && tiefe < 10) {
                        var mseite = musterSeiteFuer(ebene, quelle.side);
                        if (mseite) {
                            var um = ursprung(mseite), mel = alleElemente(mseite.pageItems), mbb = mseite.bounds;
                            for (var j = 0; j < mel.length; j++) {
                                if (sichtbar[mel[j].id]) continue;
                                if (ebene.id !== info.muster.id && (!imMuster || !imMuster[mel[j].id])) continue;
                                var mm = eigeneMasse(mel[j]), mc = mitte(mel[j]);
                                info.ausgeblendet.push({ id: mel[j].id, ebene: ebene, art: mel[j].constructor.name,
                                                         b: mm[0], h: mm[1], mx: mc[0] - um[0], my: mc[1] - um[1], mbreite: mbb[3] - mbb[1] });
                            }
                        }
                        ebene = ebene.appliedMaster;
                        tiefe++;
                    }
                }
            }
        } catch (e) {}
        return info;
    }

    // Bei Doppelseiten wechselt jede zweite neue Seite die Lage.
    function spiegelnFuer(ziel, info) {
        return wahl.spiegeln && doppelseitig(ziel) && info.lage !== PageSideOptions.SINGLE_SIDED && ziel.side !== info.lage;
    }

    function seiteAngleichen(ziel, info) {
        try {
            if (info.muster) {
                if (!ziel.appliedMaster || ziel.appliedMaster.id !== info.muster.id) ziel.appliedMaster = info.muster;
            } else if (ziel.appliedMaster) {
                ziel.appliedMaster = NothingEnum.NOTHING;
            }
        } catch (e) {}
        try {
            var zb = ziel.bounds;
            if (Math.abs(info.breite - (zb[3] - zb[1])) > 0.01 || Math.abs(info.hoehe - (zb[2] - zb[0])) > 0.01) {
                ziel.resize(CoordinateSpaces.INNER_COORDINATES, AnchorPoint.TOP_LEFT_ANCHOR,
                            ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH, [info.breite, info.hoehe]);
            }
        } catch (e) {}
        // Musterseite mit demselben Versatz zeigen wie die Quelle (gemessen: Zuweisen des
        // masterPageTransform verschiebt die Anzeige, JPG-Export) — nur bei derselben Musterseite
        try {
            if (info.musterVersatz && ziel.appliedMaster && ziel.appliedMaster.id === info.muster.id) {
                var mz = musterSeiteFuer(info.muster, ziel.side), vz = mz && mz.id === info.musterSeiteId ? musterVersatz(ziel, mz) : null;
                if (vz) {
                    var vdx = info.musterVersatz[0] - vz[0], vdy = info.musterVersatz[1] - vz[1];
                    if (Math.abs(vdx) > 0.01 || Math.abs(vdy) > 0.01) {
                        var mt = ziel.masterPageTransform.matrixValues;
                        ziel.masterPageTransform = verschiebung(mt[4] + vdx, mt[5] + vdy);
                    }
                }
            }
        } catch (e) {}
        try { if (info.raender) ziel.marginPreferences.properties = info.raender; } catch (e) {}
        var spiegeln = spiegelnFuer(ziel, info);
        for (var k = 0; k < info.hilfslinien.length; k++) {
            try {
                var hl = info.hilfslinien[k], werte = hl.werte;
                if (spiegeln && werte.orientation === HorizontalOrVertical.VERTICAL) {
                    werte = { orientation: werte.orientation, location: info.breite - werte.location, fitToPage: werte.fitToPage,
                              viewThreshold: werte.viewThreshold, guideColor: werte.guideColor };
                }
                ziel.guides.add(hl.ebene, werte);
            } catch (e) {}
        }
    }

    // Auf der Quellseite ausgeblendete Musterobjekte auch hier ausblenden:
    // lösen und sofort löschen, wie in der Oberfläche. Gleiche Seitenlage →
    // über die id (auch Objekte der Basis-Mustervorlage). Gegenseite → das
    // Objekt gleicher Art und Größe an der (bei „spiegeln“ gespiegelten) Stelle
    // derselben Mustervorlage; nur bei genau einem Treffer, sonst ein Hinweis.
    function musterObjekte(mseite) {
        var sch = String(mseite.id);
        if (musterVermessen[sch]) return musterVermessen[sch];
        var um = ursprung(mseite), el = alleElemente(mseite.pageItems), liste = [];
        for (var j = 0; j < el.length; j++) {
            try {
                var mm = eigeneMasse(el[j]), mc = mitte(el[j]);
                liste.push({ obj: el[j], art: el[j].constructor.name, b: mm[0], h: mm[1], mx: mc[0] - um[0], my: mc[1] - um[1] });
            } catch (e) {}
        }
        musterVermessen[sch] = liste;
        return liste;
    }

    function musterAngleichen(ziel, info) {
        if (!info.muster) return;
        try {
            if (!ziel.appliedMaster || ziel.appliedMaster.id !== info.muster.id) return;
            if (info.musterAus) {
                // Nur setzen, wenn im Druckbogen keine schon vorhandenen Seiten stehen.
                var bogen = ziel.parent, fremd = false;
                for (var bs = 0; bs < bogen.pages.length; bs++) {
                    if (!plan.eigen[bogen.pages[bs].documentOffset]) fremd = true;
                }
                if (!fremd) {
                    bogen.showMasterItems = false;
                } else {
                    // Druckbogen mit einer vorhandenen Seite geteilt: nur hier entfernen.
                    var alleM = ziel.masterPageItems, ohne = 0;
                    for (var im = alleM.length - 1; im >= 0; im--) {
                        try { alleM[im].override(ziel).remove(); } catch (x) { ohne++; }
                    }
                    if (ohne) bericht.bogenHinweis.push(ziel.name);
                }
                return;
            }
            if (!info.ausgeblendet.length) return;
            var spiegeln = spiegelnFuer(ziel, info);
            var gleicheLage = ziel.side === info.lage;
            var sichtbar = ziel.masterPageItems, nachId = {}, k;
            for (k = 0; k < sichtbar.length; k++) nachId[sichtbar[k].id] = sichtbar[k];
            var unklar = 0;
            for (k = 0; k < info.ausgeblendet.length; k++) {
                var a = info.ausgeblendet[k], kandidat = null;
                if (gleicheLage) {
                    kandidat = nachId[a.id] || null;
                    if (!kandidat) continue;        // hier ohnehin nicht sichtbar
                } else {
                    var mseite = musterSeiteFuer(a.ebene, ziel.side), treffer = [];
                    if (mseite) {
                        // Erst die gespiegelte Stelle (übliche Doppelseiten-Vorlage),
                        // dann dieselbe Stelle (Vorlagen, deren Musterseiten nicht
                        // gespiegelt angelegt sind).
                        var liste = musterObjekte(mseite);
                        var stellen = [(a.mbreite || info.breite) - a.mx, a.mx];
                        if (!spiegeln) stellen.reverse();
                        for (var st = 0; st < stellen.length && !treffer.length; st++) {
                            for (var j = 0; j < liste.length; j++) {
                                var m = liste[j];
                                if (m.art !== a.art) continue;
                                if (Math.abs(m.b - a.b) < 1 && Math.abs(m.h - a.h) < 1 &&
                                    Math.abs(m.mx - stellen[st]) < 1.5 && Math.abs(m.my - a.my) < 1.5) treffer.push(m.obj);
                            }
                        }
                    }
                    if (treffer.length !== 1) { unklar++; continue; }
                    kandidat = nachId[treffer[0].id] || null;
                    if (!kandidat) continue;        // dort schon ausgeblendet (z. B. von der Mustervorlage)
                }
                try { kandidat.override(ziel).remove(); } catch (e) { unklar++; }
            }
            if (unklar) bericht.musterHinweis.push(ziel.name);
        } catch (e) {}
    }

    function verschiebung(dx, dy) {
        var s = dx.toFixed(3) + "|" + dy.toFixed(3);
        if (!matrizen[s]) matrizen[s] = app.transformationMatrices.add({ horizontalTranslation: dx, verticalTranslation: dy });
        return matrizen[s];
    }

    // Von hinten nach vorn kopieren: jede Kopie kommt obenauf, so bleibt die
    // Stapelreihenfolge erhalten. Wechselt die Seitenlage, wird die Lage ALLER
    // Objekte an der Seitenmitte gespiegelt (Anschnitt bleibt außen, innen
    // bleibt innen, nichts überdeckt sich) — die Formen selbst nicht, und
    // Gruppen wandern als Ganzes. Liefert den Zielrahmen.
    function objekteKopieren(ziel, info, fehler) {
        var uz = ursprung(ziel), gefunden = null;
        var spiegeln = spiegelnFuer(ziel, info);
        for (var k = info.objekte.length - 1; k >= 0; k--) {
            var o = info.objekte[k];
            try {
                var kopie = o.obj.duplicate(ziel);
                var mx = spiegeln ? info.breite - o.mx : o.mx;
                var m1 = mitte(kopie);
                var dx = (uz[0] + mx) - m1[0], dy = (uz[1] + o.my) - m1[1];
                if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                    var gesperrt = kopie.locked;
                    if (gesperrt) kopie.locked = false;
                    kopie.transform(PB, AnchorPoint.CENTER_ANCHOR, verschiebung(dx, dy));
                    if (gesperrt) kopie.locked = true;
                }
                if (o.rahmen && !gefunden) gefunden = traegtKennung(kopie);
            } catch (f) {
                fehler.push("Seite " + ziel.name + ": ein Objekt ließ sich nicht kopieren (" + f.message + ")");
            }
        }
        return gefunden;
    }

    function rahmenAufSeite(seite) {
        var alle = seite.allPageItems, ersatz = null;
        for (var k = 0; k < alle.length; k++) {
            try {
                if (alle[k].extractLabel(KENNUNG) !== LAUF) continue;
                var pp = elternSeite(alle[k]);
                if (pp && pp.id === seite.id) return alle[k];
                if (!ersatz) ersatz = alle[k];
            } catch (e) {}
        }
        return ersatz;
    }

    // ------------------------------------------------------------------------
    // Die eigentliche Arbeit — ein Rückgängig-Schritt
    // ------------------------------------------------------------------------

    var fortschritt = null;

    function fortschrittOeffnen(gesamt) {
        if (TEST && !TEST.fortschritt) return null;
        try {
            var p = new Window("palette", TITEL);
            p.alignChildren = "fill";
            var zeile = p.add("statictext", undefined, "Vorbereiten …");
            zeile.characters = 50;
            var balken = p.add("progressbar", undefined, 0, gesamt);
            balken.preferredSize.width = 360;
            p.add("statictext", undefined, "Esc hält an — Bearbeiten ▸ Rückgängig nimmt dann alles zurück.");
            p.show();
            p.update();
            return { fenster: p, zeile: zeile, balken: balken, stand: 0 };
        } catch (e) { return null; }
    }

    function schritt(text) {
        if (fortschritt) {
            try {
                fortschritt.stand++;
                fortschritt.balken.value = fortschritt.stand;
                fortschritt.zeile.text = text;
                fortschritt.fenster.update();
            } catch (e) {}
        }
        var taste = null;
        try { taste = ScriptUI.environment.keyboardState.keyName; } catch (e) {}
        if (taste === "Escape") throw new Error("ABBRUCH");
    }

    // Vorhandene Folgeseite: Rahmen aus dem Plan (Musterrahmen erst jetzt lösen).
    function vorhandeneFuellen(k, z) {
        var e = bilder[k], name = anzeigeName(e), seite = doc.pages[z.offset];
        schritt("Bild " + (k + 1) + " von " + bilder.length + ": " + name + " → Seite " + z.name);
        bericht.seiten[k] = z.name;
        if (!e.datei.exists) {                          // vorhandenen Rahmen dann NICHT anfassen
            bericht.fehler.push("Seite " + z.name + ": " + name + " — Datei nicht mehr vorhanden");
            return;
        }
        var ziel = null;
        try {
            ziel = z.treffer.muster ? loesen(z.treffer.obj, seite) : z.treffer.obj;
            if (!ziel || !ziel.isValid) throw new Error("Rahmen nicht mehr vorhanden");
        } catch (x) {
            bericht.fehler.push("Seite " + z.name + ": Rahmen ließ sich nicht übernehmen (" + x.message + ")");
            return;
        }
        var gesetzt = false;
        try {
            platzieren(ziel, e);
            gesetzt = true;
            einpassen(ziel, wahl.einpassung, e.ah, e.av);
            bericht.platziert++;
        } catch (f) {
            bericht.fehler.push("Seite " + z.name + ": " + name + " — " + f.message);
        }
        if (META_AKTIV && gesetzt) metaFuellen(seite, e.meta, false);   // vorhandene Folgeseite; ohne Bild keine Texte dazu
    }

    function arbeiten() {
        var vorgaben = app.scriptPreferences, n = bilder.length, k;
        var alt = { einheit: vorgaben.measurementUnit, redraw: null, ursprung: doc.viewPreferences.rulerOrigin,
                    nullpunkt: null, pdfSeite: null, pdfZuschnitt: null, inddSeite: null };
        vorgaben.measurementUnit = MeasurementUnits.POINTS;
        alt.nullpunkt = doc.zeroPoint;              // erst NACH dem Einheitenwechsel lesen
        try { alt.redraw = vorgaben.enableRedraw; vorgaben.enableRedraw = false; } catch (e) {}
        try { alt.pdfSeite = app.pdfPlacePreferences.pageNumber; alt.pdfZuschnitt = app.pdfPlacePreferences.pdfCrop; } catch (e) {}
        try { alt.inddSeite = app.importedPageAttributes.pageNumber; } catch (e) {}
        // „Intelligenter Textumfluss“: eine zu lange Bildunterschrift in einem
        // gelösten Musterrahmen hängt sonst im Leerlauf NACH dem Skript Seiten
        // ans Dokument (gemessen). Während des Laufs aus, danach zurück — der
        // Übersatz bleibt dann stehen und steht im Bericht.
        alt.umfluss = null;
        try { alt.umfluss = doc.textPreferences.smartTextReflow; if (alt.umfluss) doc.textPreferences.smartTextReflow = false; } catch (e) { alt.umfluss = null; }
        var gesperrteEbenen = [], markierte = [rahmen], zielRahmen = [rahmen], j;
        try {
            // Hilfslinien-Positionen gelten dann je Seite.
            doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
            doc.zeroPoint = [0, 0];
            for (k = 0; k < doc.layers.length; k++) {
                if (doc.layers[k].locked) { doc.layers[k].locked = false; gesperrteEbenen.push(doc.layers[k]); }
            }
            // Reste früherer (abgebrochener) Läufe auf der Quellseite wegräumen.
            var reste = quellSeite.allPageItems;
            for (k = 0; k < reste.length; k++) {
                try { if (reste[k].extractLabel(KENNUNG)) reste[k].insertLabel(KENNUNG, ""); } catch (e) {}
            }
            rahmen.insertLabel(KENNUNG, LAUF);
            // (0) Gleiche Texte auf die Musterseite: gelöste Rahmen der Quellseite zuerst
            //     zurückführen — sonst übernähmen die neuen Seiten Kopien ohne Musterbezug.
            musterZiele = {};
            musterErledigt = {};
            if (META_AKTIV) {
                altVersatzBeheben(quellSeite);            // früher versetzt gelöste Rahmen — vor dem Kopieren
                for (k = 1; k < n; k++) if (plan.ziele[k].art === "vorhanden") altVersatzBeheben(doc.pages[plan.ziele[k].offset]);
                musterQuelleVorbereiten();
            }
            // (1) Vorhandene Folgeseiten zuerst — die Treffer aus dem Plan sind noch
            //     frisch; neue Seiten kommen immer dahinter und verschieben sie nicht.
            for (k = 1; k < n; k++) {
                if (plan.ziele[k].art === "vorhanden") vorhandeneFuellen(k, plan.ziele[k]);
            }

            // (2) Neue Seiten als lückenloser Block anlegen, dann befüllen. Seiten
            //     IMMER frisch über den Offset holen: bei Doppelseiten mischt
            //     InDesign die Druckbögen um, gemerkte Seiten zeigen woandershin.
            var neue = [];
            for (k = 1; k < n; k++) if (plan.ziele[k].art === "neu") neue.push(k);
            var info = neue.length ? quelleErfassen(quellSeite) : null;
            for (j = 0; j < neue.length; j++) {
                schritt("Seite " + (j + 1) + " von " + neue.length + " anlegen");
                doc.pages.add(LocationOptions.AFTER, doc.pages[plan.ziele[neue[j]].offset - 1]);
            }
            for (j = 0; j < neue.length; j++) {
                schritt("Seite " + (j + 1) + " von " + neue.length + " einrichten");
                var neueSeite = doc.pages[plan.ziele[neue[j]].offset];
                seiteAngleichen(neueSeite, info);
                musterAngleichen(neueSeite, info);
                zielRahmen[neue[j]] = objekteKopieren(neueSeite, info, bericht.fehler);
            }

            // (3) Quelle und neue Seiten befüllen
            for (k = 0; k < n; k++) {
                if (plan.ziele[k].art === "vorhanden") continue;
                var seite = doc.pages[plan.ziele[k].offset];
                var e = bilder[k], name = anzeigeName(e);
                schritt("Bild " + (k + 1) + " von " + n + ": " + name);
                var ziel = zielRahmen[k];
                if (!ziel || !ziel.isValid) ziel = rahmenAufSeite(seite);
                bericht.seiten[k] = seite.name;
                if (!ziel) {
                    bericht.fehler.push("Seite " + seite.name + ": markierter Rahmen nicht gefunden (" + name + ")");
                    continue;
                }
                markierte.push(ziel);
                if (!e.datei.exists) {
                    // Kopie des alten Bildes nicht stehen lassen (die Seite sähe fertig aus).
                    if (k > 0) { try { while (ziel.graphics.length) ziel.graphics[0].remove(); } catch (x) {} }
                    bericht.fehler.push("Seite " + seite.name + ": " + name + " — Datei nicht mehr vorhanden");
                    continue;
                }
                var gesetzt = false;
                try {
                    platzieren(ziel, e);
                    gesetzt = true;
                    einpassen(ziel, wahl.einpassung, e.ah, e.av);
                    bericht.platziert++;
                } catch (fehler) {
                    bericht.fehler.push("Seite " + seite.name + ": " + name + " — " + fehler.message);
                }
                if (META_AKTIV && gesetzt) metaFuellen(seite, e.meta, !!(plan.ziele[k] && plan.ziele[k].art === "neu"));
            }
            // (4) Texte, die für alle Bilder gleich sind, einmal in die Musterrahmen
            if (META_AKTIV) musterZieleSchreiben();
        } catch (fehler) {
            if (fehler.message === "ABBRUCH") bericht.angehalten = true;
            else bericht.abbruch = fehler.message + (fehler.line ? " (Zeile " + fehler.line + ")" : "");
        } finally {
            var aufraeumen = markierte.concat(zielRahmen);
            for (k = 0; k < aufraeumen.length; k++) {
                try { if (aufraeumen[k] && aufraeumen[k].isValid) aufraeumen[k].insertLabel(KENNUNG, ""); } catch (e) {}
            }
            // Nach Abbruch/Esc: auch Kopien, die noch nicht erreicht waren.
            if (bericht.angehalten || bericht.abbruch) {
                for (var zk = 0; zk < plan.ziele.length; zk++) {
                    var sk = plan.ziele[zk].offset;
                    if (plan.ziele[zk].art === "vorhanden" || sk >= doc.pages.length) continue;   // dort nie ein Label
                    try {
                        var ap = doc.pages[sk].allPageItems;
                        for (var ak = 0; ak < ap.length; ak++) {
                            try { if (ap[ak].extractLabel(KENNUNG) === LAUF) ap[ak].insertLabel(KENNUNG, ""); } catch (e) {}
                        }
                    } catch (e) {}
                }
            }
            for (k = 0; k < gesperrteEbenen.length; k++) {
                try { gesperrteEbenen[k].locked = true; } catch (e) {}
            }
            try { doc.viewPreferences.rulerOrigin = alt.ursprung; } catch (e) {}
            try { doc.zeroPoint = alt.nullpunkt; } catch (e) {}
            try { if (alt.pdfSeite !== null) app.pdfPlacePreferences.pageNumber = alt.pdfSeite; } catch (e) {}
            try { if (alt.pdfZuschnitt !== null) app.pdfPlacePreferences.pdfCrop = alt.pdfZuschnitt; } catch (e) {}
            try { if (alt.inddSeite !== null) app.importedPageAttributes.pageNumber = alt.inddSeite; } catch (e) {}
            try { if (alt.redraw !== null) vorgaben.enableRedraw = alt.redraw; } catch (e) {}
            try { if (alt.umfluss !== null) doc.textPreferences.smartTextReflow = alt.umfluss; } catch (e) {}
            vorgaben.measurementUnit = alt.einheit;
        }
    }

    // Dateien, die seit der Auswahl verschwunden sind (Netzlaufwerk getrennt,
    // umbenannt): vor dem Anlegen der Seiten fragen statt halbfertige Seiten.
    var fehlende = [], vorhandene = [];
    for (var fk = 0; fk < bilder.length; fk++) {
        if (bilder[fk].datei.exists) vorhandene.push(bilder[fk]);
        else fehlende.push(anzeigeName(bilder[fk]));
    }
    if (fehlende.length) {
        if (!vorhandene.length) {
            melden("Keine der gewählten Dateien ist mehr vorhanden.");
            return;
        }
        if (!TEST && !confirm(fehlende.length + (fehlende.length === 1 ? " Datei ist" : " Dateien sind") + " nicht mehr vorhanden:\n" +
                              fehlende.slice(0, 8).join("\n") + (fehlende.length > 8 ? "\n…" : "") +
                              "\n\nOhne sie weitermachen?", false, TITEL)) return;
        for (fk = 0; fk < fehlende.length; fk++) bericht.fehler.push(fehlende[fk] + " — Datei nicht mehr vorhanden, übersprungen");
        bilder = vorhandene;
    }

    // Frisch planen: bilder kann kürzer geworden sein; Ebenen sind hier noch
    // gesperrt (gleiches Urteil wie in der Übersicht).
    var plan = mitPunkt(function () { return zielePlanen(wahl.ziel, bilder.length, wahl.spiegeln, null); });
    if (plan.ungerade && ergebnis && !ergebnis.ungerade &&
        !frage(mehrzahl(plan.neu, "neue Seite kommt", "neue Seiten kommen") + " direkt hinter Seite " + quellSeite.name +
               " — ohne die fehlenden Dateien eine ungerade Zahl.\n\nDadurch wechseln die " + mehrzahl(plan.verschoben, "Seite", "Seiten") +
               " dahinter von links nach rechts und umgekehrt.\n\nTrotzdem direkt dahinter einfügen?", true)) return;
    // Vorhandener Text: in der Übersicht entschieden oder ohne Treffer geprüft. Neu prüfen ohne
    // Übersicht (Testzugang), nach einem Prüffehler oder wenn fehlende Dateien die Zuordnung
    // Bild ↔ Seite verschoben haben. Kein „Zurück“ mehr möglich: Ja = stehen lassen.
    musterWerte = META_AKTIV ? musterFeldWerte(bilder, wahl.praefix, wahl.musterTexte) : {};
    var textNochmal = META_AKTIV && (wahl.textVorhanden === null
                                     ? !(ergebnis && ergebnis.textGeprueft && !fehlende.length)
                                     : (fehlende.length > 0 && wahl.textVorhanden === "ersetzen"));
    if (textNochmal) {
        var konfL = [];
        try { konfL = textKonflikte(plan.ziele, bilder, wahl.praefix, musterWerte); } catch (e) { konfL = []; }
        if (TEST) TEST.textKonflikte = konfL;
        if (konfL.length) {
            var frageT = textFrageText(konfL);
            if (TEST) TEST.textFrageText = frageT;
            wahl.textVorhanden = frage(frageT, false) ? "lassen" : "ersetzen";
        }
    }
    fortschritt = fortschrittOeffnen(bilder.length + 2 * plan.neu);
    try {
        app.doScript(arbeiten, ScriptLanguage.JAVASCRIPT, undefined,
                     UndoModes.ENTIRE_SCRIPT, TITEL);
    } finally {
        try { if (fortschritt) fortschritt.fenster.close(); } catch (e) {}
    }

    // Zur Bildstrecke springen: „dahinter“ → Quelle mit Rahmen, sonst erste Zielseite.
    try {
        if (app.activeDocument.name === doc.name && bericht.platziert) {
            if (plan.modus === ZIEL_DAHINTER || bilder.length === 1) {
                app.activeWindow.activePage = doc.pages[plan.ziele[0].offset];
                if (rahmen.isValid) rahmen.select();
            } else {
                var erstes = plan.ziele[1].offset;
                if (erstes < doc.pages.length) app.activeWindow.activePage = doc.pages[erstes];
                app.select(NothingEnum.NOTHING);        // keine unsichtbare Auswahl weit weg
            }
        }
    } catch (e) {}

    // ------------------------------------------------------------------------
    // Bericht
    // ------------------------------------------------------------------------

    if (TEST) TEST.bericht = bericht;

    var text;
    if (bericht.angehalten) {
        text = "Angehalten (Esc) — " + bericht.platziert + " von " + bilder.length + " Bildern platziert.\n\n" +
               "Bearbeiten ▸ Rückgängig „" + TITEL + "“ nimmt den ganzen Lauf zurück.";
    } else if (bericht.abbruch) {
        text = "Abgebrochen: " + bericht.abbruch + "\n\n" +
               "Bearbeiten ▸ Rückgängig „" + TITEL + "“ nimmt den Teil-Stand zurück.";
    } else {
        text = bericht.platziert + " von " + bilder.length + " Bildern platziert";
        var namen = [];
        for (var bs2 = 0; bs2 < bericht.seiten.length; bs2++) if (bericht.seiten[bs2] !== undefined) namen.push(bericht.seiten[bs2]);
        if (namen.length > 1) {
            var vorh = bilder.length - 1 - plan.neu, teile = [];
            if (vorh) teile.push(mehrzahl(vorh, "vorhandene Seite", "vorhandene Seiten") + " befüllt");
            if (plan.neu) teile.push(plan.neu + " neu " + (plan.modus === ZIEL_DAHINTER ? "angelegt" : "am Dokumentende"));
            text += "\nSeite " + seitenAufzaehlung(namen) + " (" + teile.join(", ") + ")";
        }
        text += ".";
        if (plan.uebersprungen.length) text += "\n\nÜbersprungen: " + uebersprungenText(plan.uebersprungen);
        if (plan.ungerade) text += "\n\nDie Seiten hinter der Bildstrecke haben links/rechts gewechselt — Objekte am Anschnitt/Bund prüfen.";
    }
    if (bericht.musterHinweis.length) {
        text += "\n\nMusterobjekte der Gegenseite bitte prüfen: Seite " + bericht.musterHinweis.join(", ");
    }
    if (bericht.bogenHinweis.length) {
        text += "\n\nSeite " + bericht.bogenHinweis.join(", ") + " teilt den Druckbogen mit einer vorhandenen Seite — Musterobjekte bitte prüfen.";
    }
    if (plan.neu && plan.fest) {
        text += "\n\n„Seiten verschieben“ ist ausgeschaltet — bitte prüfen, ob die neuen Seiten im richtigen Druckbogen liegen.";
    }
    if (bericht.uebersatz.length) {
        text += "\n\nText passt nicht in den Rahmen (Übersatz): " + bericht.uebersatz.slice(0, 12).join(", ") +
                (bericht.uebersatz.length > 12 ? " …" : "");
    }
    var stehenTeile = [], zurueckTeile = [], jeSeiteTeile = [];
    for (var sf = 0; sf < FELDER.length; sf++) {
        var fid = FELDER[sf].id, sl = bericht.stehen[fid], sm = bericht.stehenMuster[fid], zr = bericht.musterZurueck[fid], wo = [];
        if (sl && sl.length) wo.push("S. " + seitenAufzaehlung(sl));
        if (sm && sm.length) wo.push("Musterseite „" + sm.join("“, „") + "“");
        if (wo.length) stehenTeile.push(FELDER[sf].text + " " + wo.join(" · "));
        if (zr && zr.length) zurueckTeile.push(FELDER[sf].text + " S. " + seitenAufzaehlung(zr));
        if (bericht.musterJeSeite[fid] && bericht.musterJeSeite[fid].length) jeSeiteTeile.push(FELDER[sf].text);
    }
    if (stehenTeile.length) text += "\n\nVorhandener Text blieb stehen: " + stehenTeile.join(" · ");
    if (bericht.musterEingesetzt.length) {
        var jeMuster = {}, mReihe = [], mTeile = [], mi, mj;
        for (mi = 0; mi < bericht.musterEingesetzt.length; mi++) {
            var me = bericht.musterEingesetzt[mi], msch = "~" + me.ort, schon = false;
            if (!jeMuster[msch]) { jeMuster[msch] = []; mReihe.push(me.ort); }
            for (mj = 0; mj < jeMuster[msch].length; mj++) if (jeMuster[msch][mj] === me.feld.text) schon = true;
            if (!schon) jeMuster[msch].push(me.feld.text);
        }
        for (mi = 0; mi < mReihe.length; mi++) mTeile.push("„" + mReihe[mi] + "“: " + jeMuster["~" + mReihe[mi]].join(", "));
        text += "\n\nAuf der Musterseite eingesetzt (Schrift und Lage dort anpassen — gilt für alle Seiten mit dieser Musterseite): " + mTeile.join(" · ");
    }
    if (zurueckTeile.length) text += "\n\nZur Musterseite zurückgesetzt (die Seiten folgen wieder der Musterseite): " + zurueckTeile.join(" · ");
    if (jeSeiteTeile.length) text += "\n\nAuf den einzelnen Seiten eingesetzt, weil die Musterseite auch für andere Seiten gilt: " + jeSeiteTeile.join(", ");
    if (bericht.musterGeloest.length) {
        text += "\n\nBleibt auf der Seite gelöst (dort von Hand geändert oder Musterobjekte ausgeblendet — Änderungen an der Musterseite wirken dort nicht): S. " + bericht.musterGeloest.join(", ");
    }
    if (bericht.versatzBehoben.length) {
        text += "\n\nVersetzte Textrahmen früherer Läufe an die Musterlage gerückt: S. " + bericht.versatzBehoben.join(", ");
    }
    var ohneTeile = [];
    for (var of0 = 0; of0 < FELDER.length; of0++) {
        var ol = bericht.ohneTextrahmen[FELDER[of0].id];
        if (ol && ol.length) ohneTeile.push(FELDER[of0].text + " S. " + seitenAufzaehlung(ol));
    }
    if (ohneTeile.length) text += "\n\nKein passender Textrahmen auf der Seite, Text nicht eingesetzt: " + ohneTeile.join(" · ");
    if (bericht.ohneAutor.length) {
        text += "\n\nOhne Autor (IPTC „Ersteller“), Copyright nicht gesetzt: S. " + seitenAufzaehlung(bericht.ohneAutor);
    }
    if (bericht.fehler.length) {
        var liste = bericht.fehler.slice(0, 15);
        text += "\n\nProbleme:\n" + liste.join("\n");
        if (bericht.fehler.length > 15) text += "\n… und " + (bericht.fehler.length - 15) + " weitere";
    }
    var still = TEST && !bericht.abbruch && !bericht.fehler.length;
    if (!still) melden(text);

})();
