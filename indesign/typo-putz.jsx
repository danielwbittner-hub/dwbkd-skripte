// ============================================================================
// Typo-Putz.jsx  —  Adobe InDesign                                Version 1.0
// ----------------------------------------------------------------------------
// Typografische Reinigung für deutsche Texte, jede Regel einzeln abwählbar:
//
//   • Apostroph im Wort:  geht's → geht’s
//   • "…" → „…“   und   '…' → ‚…‘
//   • Drei Punkte → Auslassungszeichen (…)
//   • Mehrfache Leerzeichen → eines
//   • Leerzeichen vor Satzzeichen entfernen
//   • Leerzeichen am Absatzende entfernen
//   • Leerzeichen-Divis-Leerzeichen → Halbgeviertstrich ( - → – )
//   • Bis-Strich zwischen Zahlen (3-4 → 3–4) — ab Werk AUS,
//     weil Telefonnummern und Datumsangaben mitgetroffen würden
//   • Schmales geschütztes Leerzeichen vor %, €, mm, cm, kg, Uhr …
//
// Gearbeitet wird im ganzen Dokument (samt Musterseiten und Fußnoten) oder
// nur im Textabschnitt der Auswahl. Alles zusammen ist EIN Rückgängig-Schritt,
// und am Ende steht, welche Regel wie oft gegriffen hat.
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

    // Die Reihenfolge zählt: der Apostroph muss vor den Anführungszeichen
    // laufen, sonst wird geht's als halbes Paar missverstanden.
    var REGELN = [
        { name: "Apostroph im Wort (geht's → geht’s)",
          find: "(?<=\\w)'(?=\\w)", ersatz: "’", an: true },
        { name: "\"…\" → „…“ (deutsche Anführungszeichen)",
          find: "\\x{22}([^\\x{22}\\r]+)\\x{22}", ersatz: "„$1“", an: true },
        { name: "'…' → ‚…‘ (einfache Anführungszeichen)",
          find: "'([^'\\r]+)'", ersatz: "‚$1‘", an: true },
        { name: "Drei Punkte → Auslassungszeichen (…)",
          find: "(?<!\\.)\\.{3}(?!\\.)", ersatz: "…", an: true },
        { name: "Mehrfache Leerzeichen → eines",
          find: "\\x{20}{2,}", ersatz: " ", an: true },
        { name: "Leerzeichen vor Satzzeichen entfernen",
          find: "\\x{20}+(?=[.,;:!?])", ersatz: "", an: true },
        { name: "Leerzeichen am Absatzende entfernen",
          find: "[\\x{20}\\t]+$", ersatz: "", an: true },
        { name: "„ - “ → „ – “ (Halbgeviertstrich)",
          find: "\\x{20}-\\x{20}", ersatz: " – ", an: true },
        { name: "Bis-Strich zwischen Zahlen (3-4 → 3–4) — Vorsicht bei Telefonnummern",
          find: "(?<=\\d)-(?=\\d)", ersatz: "–", an: false },
        { name: "Schmales geschütztes Leerzeichen vor %, € und Einheiten",
          find: "(?<=\\d)\\x{20}(?=(?:%|€|mm\\b|cm\\b|m\\b|km\\b|g\\b|kg\\b|l\\b|ml\\b|h\\b|min\\b|Uhr\\b))",
          ersatz: " ", an: true }
    ];

    // Hat die Auswahl einen Textabschnitt? Dann darf man sich darauf beschränken.
    var auswahlAbschnitt = null;
    try {
        if (app.selection.length > 0 && app.selection[0].hasOwnProperty("parentStory"))
            auswahlAbschnitt = app.selection[0].parentStory;
    } catch (e) { auswahlAbschnitt = null; }

    // ------------------------------------------------------------- Das Fenster
    var fenster = new Window("dialog", "Typo-Putz");
    fenster.orientation = "column";
    fenster.alignChildren = "fill";

    var kastenRegeln = fenster.add("panel", undefined, "Regeln");
    kastenRegeln.orientation = "column";
    kastenRegeln.alignChildren = "left";
    kastenRegeln.margins = [12, 16, 12, 10];
    var haken = [];
    for (var i = 0; i < REGELN.length; i++) {
        haken[i] = kastenRegeln.add("checkbox", undefined, REGELN[i].name);
        haken[i].value = REGELN[i].an;
    }

    var kastenWo = fenster.add("panel", undefined, "Wo");
    kastenWo.orientation = "column";
    kastenWo.alignChildren = "left";
    kastenWo.margins = [12, 16, 12, 10];
    var wahlDokument = kastenWo.add("radiobutton", undefined, "Ganzes Dokument (samt Musterseiten und Fußnoten)");
    var wahlAuswahl  = kastenWo.add("radiobutton", undefined, "Nur der Textabschnitt der Auswahl");
    wahlDokument.value = true;
    wahlAuswahl.enabled = (auswahlAbschnitt !== null);

    var fussZeile = fenster.add("group");
    fussZeile.alignment = "right";
    fussZeile.add("button", undefined, "Abbrechen", { name: "cancel" });
    fussZeile.add("button", undefined, "Aufräumen", { name: "ok" });

    if (fenster.show() !== 1) return;

    var ziel = (wahlAuswahl.value && auswahlAbschnitt) ? auswahlAbschnitt : doc;

    // ------------------------------------------------------------ Der Putzlauf
    // Alles in einem Rutsch, damit es EIN Rückgängig-Schritt ist.
    var bericht = [];
    var gesamt = 0;

    function putzen() {
        // Suchoptionen definiert setzen — was der letzte Suchen/Ersetzen-Dialog
        // hinterlassen hat, darf hier nicht mitspielen.
        var alt = {};
        var optionen = app.findChangeGrepOptions;
        try { alt.fuss = optionen.includeFootnotes;           optionen.includeFootnotes = true;  } catch (e) {}
        try { alt.master = optionen.includeMasterPages;       optionen.includeMasterPages = (ziel === doc); } catch (e) {}
        try { alt.versteckt = optionen.includeHiddenLayers;   optionen.includeHiddenLayers = false; } catch (e) {}
        try { alt.gesperrt = optionen.includeLockedLayersForFind; optionen.includeLockedLayersForFind = false; } catch (e) {}

        try {
            for (var i = 0; i < REGELN.length; i++) {
                if (!haken[i].value) continue;
                app.findGrepPreferences = NothingEnum.NOTHING;
                app.changeGrepPreferences = NothingEnum.NOTHING;
                app.findGrepPreferences.findWhat = REGELN[i].find;
                app.changeGrepPreferences.changeTo = REGELN[i].ersatz;
                var treffer = ziel.changeGrep();
                var anzahl = treffer ? treffer.length : 0;
                if (anzahl > 0) {
                    bericht.push(anzahl + " ×  " + REGELN[i].name);
                    gesamt += anzahl;
                }
            }
        } finally {
            app.findGrepPreferences = NothingEnum.NOTHING;
            app.changeGrepPreferences = NothingEnum.NOTHING;
            try { optionen.includeFootnotes = alt.fuss; } catch (e) {}
            try { optionen.includeMasterPages = alt.master; } catch (e) {}
            try { optionen.includeHiddenLayers = alt.versteckt; } catch (e) {}
            try { optionen.includeLockedLayersForFind = alt.gesperrt; } catch (e) {}
        }
    }

    app.doScript(putzen, ScriptLanguage.JAVASCRIPT, undefined,
                 UndoModes.ENTIRE_SCRIPT, "Typo-Putz");

    if (gesamt === 0) {
        alert("Nichts zu putzen — der Text ist sauber.");
    } else {
        alert("Typo-Putz fertig — " + gesamt +
              (gesamt === 1 ? " Ersetzung" : " Ersetzungen") + ":\n\n" +
              bericht.join("\n") + "\n\nAlles zusammen ist ein Rückgängig-Schritt.");
    }

})();
