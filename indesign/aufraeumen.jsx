// ============================================================================
// Aufraeumen.jsx  —  Adobe InDesign                               Version 1.0
// ----------------------------------------------------------------------------
// Macht ein Dokument übergabefertig: findet unbenutzte Absatz- und
// Zeichenformate, unbenutzte Farbfelder und leere Ebenen — zeigt erst den
// Bericht und räumt dann auf Wunsch auf (ein Rückgängig-Schritt).
//
// Geschützt bleibt, was gebraucht wird:
//   • Formate, die irgendwo im Text angewendet sind (samt Musterseiten,
//     Fußnoten und versteckten Ebenen)
//   • Formate, auf die verbleibende Formate sich stützen (Grundlage,
//     Folgeformat, verschachtelte/GREP-/Initial-Formate)
//   • Formate, die in Objekt-, Tabellen- oder Zellenformaten stecken
//   • die eingebauten Felder ([Ohne], [Papier], [Schwarz], [Passermarken],
//     [Kein Absatzformat], [Einfacher Absatz], [Ohne] bei Zeichenformaten)
//   • Ebenen mit Hilfslinien werden nur gemeldet, nie gelöscht
//
// Objektformate prüft das Script nicht (dafür kennt InDesign keine
// verlässliche Suche) — sie bleiben unangetastet.
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de
// ============================================================================

#target indesign

(function () {

    if (app.documents.length === 0) {
        alert("Kein Dokument geöffnet.");
        return;
    }
    var doc = app.activeDocument;

    // ---------------------------------------------------------- Kleine Helfer

    // ExtendScript-Eigenheit: zwei Verweise auf DASSELBE Format sind nie
    // „===“ (jeder DOM-Zugriff baut ein neues Hüllobjekt). Verglichen wird
    // deshalb über die id, die je Dokument eindeutig ist.
    function kennung(f) {
        try { return f.id; } catch (e) { return f; }
    }
    function enthaelt(liste, wert) {
        var w = kennung(wert);
        for (var i = 0; i < liste.length; i++) {
            try { if (kennung(liste[i]) === w) return true; } catch (e) {}
        }
        return false;
    }

    // Formate über die Suche auf Verwendung prüfen — samt Musterseiten,
    // Fußnoten und versteckten Ebenen, damit nichts fälschlich als
    // „unbenutzt“ gilt.
    function suchOptionenSetzen() {
        var o = app.findChangeGrepOptions, alt = {};
        try { alt.fuss = o.includeFootnotes;               o.includeFootnotes = true; } catch (e) {}
        try { alt.master = o.includeMasterPages;           o.includeMasterPages = true; } catch (e) {}
        try { alt.versteckt = o.includeHiddenLayers;       o.includeHiddenLayers = true; } catch (e) {}
        try { alt.gesperrt = o.includeLockedLayersForFind; o.includeLockedLayersForFind = true; } catch (e) {}
        try { alt.gesperrtText = o.includeLockedStoriesForFind; o.includeLockedStoriesForFind = true; } catch (e) {}
        return alt;
    }
    function suchOptionenZurueck(alt) {
        var o = app.findChangeGrepOptions;
        try { o.includeFootnotes = alt.fuss; } catch (e) {}
        try { o.includeMasterPages = alt.master; } catch (e) {}
        try { o.includeHiddenLayers = alt.versteckt; } catch (e) {}
        try { o.includeLockedLayersForFind = alt.gesperrt; } catch (e) {}
        try { o.includeLockedStoriesForFind = alt.gesperrtText; } catch (e) {}
    }

    function wirdVerwendet(eigenschaft, format) {
        app.findGrepPreferences = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences[eigenschaft] = format;
        var treffer = [];
        try { treffer = doc.findGrep(); } catch (e) { treffer = [null]; }   // im Zweifel: benutzt
        return treffer.length > 0;
    }

    // ------------------------------------------------ Bestandsaufnahme Formate

    var alleAbsatz  = doc.allParagraphStyles;
    var alleZeichen = doc.allCharacterStyles;

    // Die ersten beiden Absatzformate sind eingebaut ([Kein Absatzformat],
    // [Einfacher Absatz]); bei Zeichenformaten ist es [Ohne].
    var geschuetztAbsatz  = [alleAbsatz[0], alleAbsatz[1]];
    var geschuetztZeichen = [alleZeichen[0]];

    var suchAlt = suchOptionenSetzen();
    var benutztAbsatz = [], benutztZeichen = [];
    var i, j, s;
    try {
        for (i = 0; i < alleAbsatz.length; i++) {
            s = alleAbsatz[i];
            if (enthaelt(geschuetztAbsatz, s)) { benutztAbsatz.push(s); continue; }
            if (wirdVerwendet("appliedParagraphStyle", s)) benutztAbsatz.push(s);
        }
        for (i = 0; i < alleZeichen.length; i++) {
            s = alleZeichen[i];
            if (enthaelt(geschuetztZeichen, s)) { benutztZeichen.push(s); continue; }
            if (wirdVerwendet("appliedCharacterStyle", s)) benutztZeichen.push(s);
        }
    } finally {
        app.findGrepPreferences = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        suchOptionenZurueck(suchAlt);
    }

    // Verweise einsammeln: Was ein bleibendes Format als Grundlage, Folge-
    // oder Teilformat braucht, bleibt ebenfalls stehen. Objekt-, Tabellen-
    // und Zellenformate zählen dabei mit (sie bleiben ja alle im Dokument).
    function absatzVerweise(vonListe) {
        var raus = [];
        for (var k = 0; k < vonListe.length; k++) {
            var f = vonListe[k];
            try { if (f.basedOn && f.basedOn.constructor.name === "ParagraphStyle") raus.push(f.basedOn); } catch (e) {}
            try { if (f.nextStyle) raus.push(f.nextStyle); } catch (e) {}
        }
        return raus;
    }
    function zeichenVerweiseAus(absatzListe) {
        var raus = [];
        for (var k = 0; k < absatzListe.length; k++) {
            var f = absatzListe[k];
            try { if (f.basedOn && f.basedOn.constructor.name === "CharacterStyle") raus.push(f.basedOn); } catch (e) {}
            try { raus.push(f.dropCapStyle); } catch (e) {}
            try { raus.push(f.bulletsCharacterStyle); } catch (e) {}
            try { raus.push(f.numberingCharacterStyle); } catch (e) {}
            var gruppen = [];
            try { gruppen.push(f.nestedStyles); } catch (e) {}
            try { gruppen.push(f.nestedGrepStyles); } catch (e) {}
            try { gruppen.push(f.nestedLineStyles); } catch (e) {}
            for (var g = 0; g < gruppen.length; g++) {
                try {
                    for (var n = 0; n < gruppen[g].length; n++) {
                        try { raus.push(gruppen[g][n].appliedCharacterStyle); } catch (e) {}
                    }
                } catch (e) {}
            }
        }
        return raus;
    }

    // Objekt-/Tabellen-/Zellenformate verweisen ebenfalls auf Text-Formate.
    var objektVerweiseAbsatz = [], objektVerweiseZeichen = [];
    try {
        var objektFormate = doc.allObjectStyles;
        for (i = 0; i < objektFormate.length; i++) {
            try { objektVerweiseAbsatz.push(objektFormate[i].appliedParagraphStyle); } catch (e) {}
        }
    } catch (e) {}
    try {
        var zellenFormate = doc.allCellStyles;
        for (i = 0; i < zellenFormate.length; i++) {
            try { objektVerweiseAbsatz.push(zellenFormate[i].appliedParagraphStyle); } catch (e) {}
        }
    } catch (e) {}

    // Schutz schrittweise schließen: Verweise können auf Verweise zeigen
    // (Grundlage der Grundlage) — so lange sammeln, bis nichts mehr dazukommt.
    function schliessen(basis, verweiseHolen) {
        var geschlossen = basis.slice(0);
        var neu = true;
        while (neu) {
            neu = false;
            var kandidaten = verweiseHolen(geschlossen);
            for (var k = 0; k < kandidaten.length; k++) {
                var f = kandidaten[k];
                if (f && f.isValid && !enthaelt(geschlossen, f)) {
                    geschlossen.push(f);
                    neu = true;
                }
            }
        }
        return geschlossen;
    }

    var bleibtAbsatz = schliessen(
        benutztAbsatz.concat(objektVerweiseAbsatz),
        absatzVerweise);
    var bleibtZeichen = benutztZeichen.concat(objektVerweiseZeichen);
    var zeichenAusAbsatz = zeichenVerweiseAus(bleibtAbsatz);
    for (i = 0; i < zeichenAusAbsatz.length; i++) {
        var z = zeichenAusAbsatz[i];
        if (z && z.isValid && !enthaelt(bleibtZeichen, z)) bleibtZeichen.push(z);
    }
    // Auch Zeichenformate stützen sich aufeinander (Grundlage).
    bleibtZeichen = schliessen(bleibtZeichen, function (liste) {
        var raus = [];
        for (var k = 0; k < liste.length; k++) {
            try { if (liste[k].basedOn && liste[k].basedOn.constructor.name === "CharacterStyle") raus.push(liste[k].basedOn); } catch (e) {}
        }
        return raus;
    });

    var wegAbsatz = [], wegZeichen = [];
    for (i = 0; i < alleAbsatz.length; i++)
        if (!enthaelt(bleibtAbsatz, alleAbsatz[i]) && !enthaelt(geschuetztAbsatz, alleAbsatz[i]))
            wegAbsatz.push(alleAbsatz[i]);
    for (i = 0; i < alleZeichen.length; i++)
        if (!enthaelt(bleibtZeichen, alleZeichen[i]) && !enthaelt(geschuetztZeichen, alleZeichen[i]))
            wegZeichen.push(alleZeichen[i]);

    // ------------------------------------------------------------- Farbfelder
    // InDesign kennt seine unbenutzten Farbfelder selbst — samt Verwendung in
    // Formaten. Die eingebauten bleiben grundsätzlich stehen.
    var wegFarben = [];
    try {
        var unbenutzt = doc.unusedSwatches;
        for (i = 0; i < unbenutzt.length; i++) {
            var name = "";
            try { name = String(unbenutzt[i].name); } catch (e) { name = ""; }
            if (name === "" || name.charAt(0) === "[") continue;   // [Ohne], [Papier], …
            wegFarben.push(unbenutzt[i]);
        }
    } catch (e) {}

    // ----------------------------------------------------------------- Ebenen
    var wegEbenen = [], ebenenNurHilfslinien = [];
    if (doc.layers.length > 1) {
        for (i = 0; i < doc.layers.length; i++) {
            var ebene = doc.layers[i];
            var dinge = 0, linien = 0;
            try { dinge = ebene.pageItems.length; } catch (e) { dinge = 1; }
            try { linien = ebene.guides.length; } catch (e) { linien = 0; }
            if (dinge === 0 && linien === 0) wegEbenen.push(ebene);
            else if (dinge === 0 && linien > 0) ebenenNurHilfslinien.push(ebene);
        }
        // Nie alle Ebenen löschen — mindestens eine bleibt.
        if (wegEbenen.length >= doc.layers.length) wegEbenen.pop();
    }

    // ------------------------------------------------------------ Der Bericht

    function namen(liste, deckel) {
        var raus = [];
        for (var k = 0; k < liste.length && k < deckel; k++) {
            try { raus.push(String(liste[k].name)); } catch (e) {}
        }
        if (liste.length > deckel) raus.push("… und " + (liste.length - deckel) + " weitere");
        return raus.join(", ");
    }

    var summe = wegAbsatz.length + wegZeichen.length + wegFarben.length + wegEbenen.length;
    var zeilen = [];
    zeilen.push(wegAbsatz.length  + " unbenutzte Absatzformate"  + (wegAbsatz.length  ? ":  " + namen(wegAbsatz, 8)  : ""));
    zeilen.push(wegZeichen.length + " unbenutzte Zeichenformate" + (wegZeichen.length ? ":  " + namen(wegZeichen, 8) : ""));
    zeilen.push(wegFarben.length  + " unbenutzte Farbfelder"     + (wegFarben.length  ? ":  " + namen(wegFarben, 8)  : ""));
    zeilen.push(wegEbenen.length  + " leere Ebenen"              + (wegEbenen.length  ? ":  " + namen(wegEbenen, 8)  : ""));
    if (ebenenNurHilfslinien.length)
        zeilen.push("Nur gemeldet (nicht angefasst): " + ebenenNurHilfslinien.length +
                    " Ebene(n) allein mit Hilfslinien: " + namen(ebenenNurHilfslinien, 8));
    zeilen.push("Objektformate werden nicht geprüft und bleiben unangetastet.");

    if (summe === 0) {
        alert("Nichts aufzuräumen — das Dokument ist sauber.\n\n" + zeilen.join("\n"));
        return;
    }

    var fenster = new Window("dialog", "Aufräumen — Bericht");
    fenster.orientation = "column";
    fenster.alignChildren = "fill";
    var kasten = fenster.add("panel", undefined, "Das würde gelöscht");
    kasten.orientation = "column";
    kasten.alignChildren = "left";
    kasten.margins = [12, 16, 12, 10];
    for (i = 0; i < zeilen.length; i++) {
        var text = kasten.add("statictext", undefined, zeilen[i], { multiline: true });
        text.preferredSize.width = 460;
    }
    var fuss = fenster.add("group");
    fuss.alignment = "right";
    fuss.add("button", undefined, "Abbrechen", { name: "cancel" });
    fuss.add("button", undefined, "Aufräumen", { name: "ok" });
    if (fenster.show() !== 1) return;

    // ------------------------------------------------------------ Das Löschen
    var geloescht = 0, fehlgeschlagen = 0;
    function raeumen() {
        var k;
        for (k = 0; k < wegAbsatz.length; k++) {
            try { wegAbsatz[k].remove(doc.paragraphStyles[0]); geloescht++; }
            catch (e) { fehlgeschlagen++; }
        }
        for (k = 0; k < wegZeichen.length; k++) {
            try { wegZeichen[k].remove(doc.characterStyles[0]); geloescht++; }
            catch (e) { fehlgeschlagen++; }
        }
        for (k = 0; k < wegFarben.length; k++) {
            try { wegFarben[k].remove(); geloescht++; }
            catch (e) { fehlgeschlagen++; }
        }
        for (k = 0; k < wegEbenen.length; k++) {
            try { wegEbenen[k].remove(); geloescht++; }
            catch (e) { fehlgeschlagen++; }
        }
    }
    app.doScript(raeumen, ScriptLanguage.JAVASCRIPT, undefined,
                 UndoModes.ENTIRE_SCRIPT, "Aufräumen");

    alert("Aufgeräumt: " + geloescht + " von " + summe + " gelöscht." +
          (fehlgeschlagen ? "\n" + fehlgeschlagen + " ließen sich nicht löschen (vermutlich doch in Gebrauch) — sie stehen noch da." : "") +
          "\n\nAlles zusammen ist ein Rückgängig-Schritt.");

})();
