// ============================================================================
// Neues-Dokument.jsx  —  Adobe InDesign                           Version 1.0
// ----------------------------------------------------------------------------
// Legt ein neues Dokument aus einer Vorlage an: Format, Anschnitt, Ränder,
// Seitenzahl — dazu ein Farbfeld „Reichschwarz“ (40/30/30/100) und zwei
// schlichte Absatzformate (Grundtext, Überschrift), damit man nicht vom
// nackten [Einfacher Absatz] startet.
//
// Die Vorlagenliste steht direkt hier unten im Script — eigene Formate
// einfach als weitere Zeile ergänzen (alle Maße in Millimetern).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de
// ============================================================================

#target indesign

(function () {

    // ---------------------------------------------------- Die Vorlagen (mm)
    var VORLAGEN = [
        { name: "Visitenkarte 85 × 55",   breite: 85,  hoehe: 55,  anschnitt: 3, rand: 5,  seiten: 2, doppel: false },
        { name: "Flyer DIN lang",         breite: 105, hoehe: 210, anschnitt: 3, rand: 10, seiten: 2, doppel: false },
        { name: "Flyer A5",               breite: 148, hoehe: 210, anschnitt: 3, rand: 10, seiten: 2, doppel: false },
        { name: "Bogen A4",               breite: 210, hoehe: 297, anschnitt: 3, rand: 12, seiten: 1, doppel: false },
        { name: "Broschüre A4 (Doppelseiten)", breite: 210, hoehe: 297, anschnitt: 3, rand: 12, seiten: 8, doppel: true },
        { name: "Plakat A3",              breite: 297, hoehe: 420, anschnitt: 3, rand: 15, seiten: 1, doppel: false },
        { name: "Plakat A2",              breite: 420, hoehe: 594, anschnitt: 5, rand: 20, seiten: 1, doppel: false },
        { name: "Plakat A1",              breite: 594, hoehe: 841, anschnitt: 5, rand: 25, seiten: 1, doppel: false },
        { name: "Frei …",                 breite: 210, hoehe: 297, anschnitt: 3, rand: 12, seiten: 1, doppel: false }
    ];

    // ------------------------------------------------------------ Das Fenster
    var fenster = new Window("dialog", "Neues Dokument aus Vorlage");
    fenster.orientation = "column";
    fenster.alignChildren = "fill";

    var zeileVorlage = fenster.add("group");
    zeileVorlage.add("statictext", undefined, "Vorlage");
    var namen = [];
    for (var i = 0; i < VORLAGEN.length; i++) namen.push(VORLAGEN[i].name);
    var wahl = zeileVorlage.add("dropdownlist", undefined, namen);
    wahl.preferredSize.width = 260;
    wahl.selection = 0;

    var kasten = fenster.add("panel", undefined, "Maße (mm)");
    kasten.orientation = "column";
    kasten.alignChildren = "left";
    kasten.margins = [12, 16, 12, 10];

    function feldZeile(beschriftung, wert) {
        var g = kasten.add("group");
        var t = g.add("statictext", undefined, beschriftung);
        t.preferredSize.width = 90;
        var f = g.add("edittext", undefined, String(wert));
        f.preferredSize.width = 70;
        return f;
    }
    var feldBreite    = feldZeile("Breite",    VORLAGEN[0].breite);
    var feldHoehe     = feldZeile("Höhe",      VORLAGEN[0].hoehe);
    var feldAnschnitt = feldZeile("Anschnitt", VORLAGEN[0].anschnitt);
    var feldRand      = feldZeile("Ränder",    VORLAGEN[0].rand);
    var feldSeiten    = feldZeile("Seiten",    VORLAGEN[0].seiten);
    var hakenDoppel   = kasten.add("checkbox", undefined, "Doppelseiten");
    hakenDoppel.value = VORLAGEN[0].doppel;
    var hakenZubehoer = kasten.add("checkbox", undefined, "Reichschwarz und Grundformate anlegen");
    hakenZubehoer.value = true;

    wahl.onChange = function () {
        var v = VORLAGEN[wahl.selection.index];
        feldBreite.text    = String(v.breite);
        feldHoehe.text     = String(v.hoehe);
        feldAnschnitt.text = String(v.anschnitt);
        feldRand.text      = String(v.rand);
        feldSeiten.text    = String(v.seiten);
        hakenDoppel.value  = v.doppel;
    };

    var fuss = fenster.add("group");
    fuss.alignment = "right";
    fuss.add("button", undefined, "Abbrechen", { name: "cancel" });
    fuss.add("button", undefined, "Anlegen", { name: "ok" });

    if (fenster.show() !== 1) return;

    function zahl(text, ersatz) {
        var n = parseFloat(String(text).replace(",", "."));
        return isNaN(n) ? ersatz : n;
    }
    var breite    = Math.max(10, zahl(feldBreite.text, 210));
    var hoehe     = Math.max(10, zahl(feldHoehe.text, 297));
    var anschnitt = Math.max(0, zahl(feldAnschnitt.text, 3));
    var rand      = Math.max(0, zahl(feldRand.text, 10));
    var seiten    = Math.max(1, Math.round(zahl(feldSeiten.text, 1)));

    // ---------------------------------------------------------- Das Dokument
    var doc = app.documents.add({
        documentPreferences: {
            pageWidth:  breite + "mm",
            pageHeight: hoehe + "mm",
            pagesPerDocument: seiten,
            facingPages: hakenDoppel.value,
            documentBleedUniformSize: true,
            documentBleedTopOffset: anschnitt + "mm"
        },
        viewPreferences: {
            horizontalMeasurementUnits: MeasurementUnits.MILLIMETERS,
            verticalMeasurementUnits: MeasurementUnits.MILLIMETERS,
            rulerOrigin: RulerOrigin.PAGE_ORIGIN
        }
    });

    // Ränder auf allen Seiten UND den Musterseiten — neue Seiten erben sie.
    function raenderSetzen(seite) {
        try {
            seite.marginPreferences.top    = rand + "mm";
            seite.marginPreferences.bottom = rand + "mm";
            seite.marginPreferences.left   = rand + "mm";
            seite.marginPreferences.right  = rand + "mm";
        } catch (e) {}
    }
    var k;
    for (k = 0; k < doc.pages.length; k++) raenderSetzen(doc.pages[k]);
    for (k = 0; k < doc.masterSpreads.length; k++) {
        var master = doc.masterSpreads[k];
        for (var m = 0; m < master.pages.length; m++) raenderSetzen(master.pages[m]);
    }

    // ------------------------------------------------------------ Das Zubehör
    if (hakenZubehoer.value) {
        try {
            doc.colors.add({
                name: "Reichschwarz",
                model: ColorModel.PROCESS,
                space: ColorSpace.CMYK,
                colorValue: [40, 30, 30, 100]
            });
        } catch (e) { /* gibt es schon */ }

        var grund = null;
        try {
            grund = doc.paragraphStyles.add({
                name: "Grundtext",
                pointSize: 9.5,
                leading: 13,
                hyphenation: true,
                justification: Justification.LEFT_ALIGN
            });
        } catch (e) { grund = null; }
        try {
            var kopf = doc.paragraphStyles.add({
                name: "Überschrift",
                pointSize: 16,
                leading: 19,
                hyphenation: false,
                spaceAfter: "3mm"
            });
            if (grund) { kopf.nextStyle = grund; kopf.basedOn = grund; }
            // Fett nur, wenn die Grundschrift den Schnitt hat — sonst bleibt es ruhig.
            try { kopf.fontStyle = "Bold"; } catch (e) {}
        } catch (e) {}
    }

})();
