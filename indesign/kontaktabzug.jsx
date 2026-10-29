// ============================================================================
// Kontaktabzug.jsx  —  Adobe InDesign                             Version 1.1
// ----------------------------------------------------------------------------
// Baut aus allen Seiten des Dokuments eine Miniaturen-Übersicht als PDF —
// praktisch für Freigaben per Mail: alles auf einen Blick, A4 quer.
//
// Weg dorthin: das Dokument wird einmal als (unsichtbares) Zwischen-PDF
// exportiert, dessen Seiten werden in ein Rasterdokument platziert
// (Spaltenzahl wählbar, wahlweise mit Seitenname darunter), das Raster wird
// als PDF neben die Dokumentdatei gelegt und wieder verworfen. Das eigene
// Dokument bleibt unangetastet; ein offenes INDD lässt sich nämlich nicht
// direkt platzieren — deshalb der Umweg über das Zwischen-PDF.
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
    if (!doc.saved) {
        alert("Das Dokument wurde noch nie gesichert.\n" +
              "Bitte erst „Sichern unter …“ — der Kontaktabzug wird daneben abgelegt.");
        return;
    }

    // ------------------------------------------------------------ Das Fenster
    var vorgabenNamen = [];
    for (var i = 0; i < app.pdfExportPresets.length; i++)
        vorgabenNamen.push(String(app.pdfExportPresets[i].name));
    if (vorgabenNamen.length === 0) {
        alert("Keine PDF-Exportvorgaben gefunden.");
        return;
    }
    // Fürs Ergebnis reicht klein — falls vorhanden, gleich vorausgewählt.
    var vorschlag = 0;
    for (i = 0; i < vorgabenNamen.length; i++) {
        var klein = vorgabenNamen[i].toLowerCase();
        if (klein.indexOf("kleinste") >= 0 || klein.indexOf("smallest") >= 0) { vorschlag = i; break; }
    }

    var fenster = new Window("dialog", "Kontaktabzug");
    fenster.orientation = "column";
    fenster.alignChildren = "fill";
    var kasten = fenster.add("panel", undefined, "Übersicht (A4 quer)");
    kasten.orientation = "column";
    kasten.alignChildren = "left";
    kasten.margins = [12, 16, 12, 10];

    var zeileSpalten = kasten.add("group");
    zeileSpalten.add("statictext", undefined, "Spalten");
    var feldSpalten = zeileSpalten.add("edittext", undefined, "4");
    feldSpalten.preferredSize.width = 50;

    var hakenNamen = kasten.add("checkbox", undefined, "Seitenname unter jede Miniatur");
    hakenNamen.value = true;

    var zeileVorgabe = kasten.add("group");
    zeileVorgabe.add("statictext", undefined, "PDF-Vorgabe");
    var wahlVorgabe = zeileVorgabe.add("dropdownlist", undefined, vorgabenNamen);
    wahlVorgabe.preferredSize.width = 240;
    wahlVorgabe.selection = vorschlag;

    var hakenOeffnen = kasten.add("checkbox", undefined, "Fertiges PDF danach öffnen");
    hakenOeffnen.value = true;

    var fuss = fenster.add("group");
    fuss.alignment = "right";
    fuss.add("button", undefined, "Abbrechen", { name: "cancel" });
    fuss.add("button", undefined, "Erzeugen", { name: "ok" });
    if (fenster.show() !== 1) return;

    var spalten = Math.max(1, Math.min(10, Math.round(parseFloat(feldSpalten.text) || 4)));

    // Ungesicherte Änderungen wären im Zwischen-PDF nicht drin — kurz sichern.
    try { if (doc.modified) doc.save(); } catch (e) {}

    // ----------------------------------------------- Maße in mm, PDF im Stillen
    var altEinheit = null, altViewPdf = null, altBereich = null;
    try { altEinheit = app.scriptPreferences.measurementUnit; } catch (e) {}
    try { app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS; } catch (e) {}
    try { altViewPdf = app.pdfExportPreferences.viewPDF; app.pdfExportPreferences.viewPDF = false; } catch (e) {}
    try { altBereich = app.pdfExportPreferences.pageRange; } catch (e) {}
    // Platzier-Vorgaben gelten für die ganze Programmsitzung — sichern, damit
    // spätere Skripte (und das Platzieren von Hand) nicht Seite x erben.
    var altPlatzSeite = null, altPlatzZuschnitt = null, altPlatzTransparenz = null;
    try {
        altPlatzSeite = app.pdfPlacePreferences.pageNumber;
        altPlatzZuschnitt = app.pdfPlacePreferences.pdfCrop;
        altPlatzTransparenz = app.pdfPlacePreferences.transparentBackground;
    } catch (e) {}

    var zwischen = new File(Folder.temp.fsName + "/dwbkd_kontaktabzug_zwischen.pdf");
    var raster = null;
    var fehler = null;

    try {
        // 1. Zwischen-PDF: möglichst originalgetreu.
        var zwischenVorgabe = app.pdfExportPresets[0];
        for (i = 0; i < vorgabenNamen.length; i++) {
            var n = vorgabenNamen[i].toLowerCase();
            if (n.indexOf("hohe qualit") >= 0 || n.indexOf("high quality") >= 0) {
                zwischenVorgabe = app.pdfExportPresets[i]; break;
            }
        }
        app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
        doc.exportFile(ExportFormat.PDF_TYPE, zwischen, false, zwischenVorgabe);

        var quellSeiten = doc.pages.length;
        var quellNamen = [];
        for (i = 0; i < quellSeiten; i++) quellNamen.push(String(doc.pages[i].name));
        var quellB = doc.documentPreferences.pageWidth;
        var quellH = doc.documentPreferences.pageHeight;

        // 2. Rasterdokument A4 quer.
        var randMM = 10, lueckeMM = 5, schriftMM = 4;
        raster = app.documents.add({
            documentPreferences: {
                pageWidth: "297mm", pageHeight: "210mm",
                pagesPerDocument: 1, facingPages: false
            },
            viewPreferences: {
                horizontalMeasurementUnits: MeasurementUnits.MILLIMETERS,
                verticalMeasurementUnits: MeasurementUnits.MILLIMETERS
            }
        });

        var nutzB = 297 - 2 * randMM, nutzH = 210 - 2 * randMM;
        var beschriftung = hakenNamen.value ? schriftMM + 1 : 0;
        var zellB = (nutzB - lueckeMM * (spalten - 1)) / spalten;
        var bildH = zellB * (quellH / quellB);
        // Zu hohe Zellen (Hochformat, wenige Spalten): auf die Nutzhöhe deckeln.
        if (bildH + beschriftung > nutzH) {
            bildH = nutzH - beschriftung;
            zellB = bildH * (quellB / quellH);
        }
        var zellH = bildH + beschriftung;
        var reihen = Math.max(1, Math.floor((nutzH + lueckeMM) / (zellH + lueckeMM)));
        var jeSeite = reihen * spalten;

        app.pdfPlacePreferences.transparentBackground = false;
        try { app.pdfPlacePreferences.pdfCrop = PDFCrop.CROP_TRIM; } catch (e) {}

        for (i = 0; i < quellSeiten; i++) {
            var blatt = Math.floor(i / jeSeite);
            while (raster.pages.length <= blatt) raster.pages.add();
            var seite = raster.pages[blatt];
            var platz = i % jeSeite;
            var reihe = Math.floor(platz / spalten), spalte = platz % spalten;
            var x1 = randMM + spalte * (zellB + lueckeMM);
            var y1 = randMM + reihe * (zellH + lueckeMM);

            app.pdfPlacePreferences.pageNumber = i + 1;
            var rahmen = seite.rectangles.add({
                geometricBounds: [y1, x1, y1 + bildH, x1 + zellB],
                strokeWeight: 0
            });
            rahmen.place(zwischen);
            rahmen.fit(FitOptions.PROPORTIONALLY);
            rahmen.fit(FitOptions.CENTER_CONTENT);

            if (hakenNamen.value) {
                var text = seite.textFrames.add({
                    geometricBounds: [y1 + bildH + 0.5, x1, y1 + bildH + 0.5 + schriftMM, x1 + zellB]
                });
                text.contents = "Seite " + quellNamen[i];
                try {
                    text.paragraphs[0].pointSize = 7;
                    text.paragraphs[0].justification = Justification.CENTER_ALIGN;
                } catch (e) {}
            }
        }

        // 3. Ergebnis neben die Dokumentdatei — nie überschreiben, numerieren.
        var quelle = new File(doc.fullName.fsName);
        var name = quelle.name;
        var punkt = name.lastIndexOf(".");
        var basis = (punkt > 0) ? name.substring(0, punkt) : name;
        var zielName = basis + "_Kontaktabzug.pdf";
        var zaehler = 2;
        while (File(quelle.parent.fsName + "/" + zielName).exists && zaehler < 1000) {
            zielName = basis + "_Kontaktabzug_" + zaehler + ".pdf";
            zaehler++;
        }
        var ziel = new File(quelle.parent.fsName + "/" + zielName);

        app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
        raster.exportFile(ExportFormat.PDF_TYPE, ziel, false,
                          app.pdfExportPresets[wahlVorgabe.selection.index]);

        raster.close(SaveOptions.NO);
        raster = null;

        if (hakenOeffnen.value) {
            try { ziel.execute(); } catch (e) {}
        }
        alert("Kontaktabzug fertig:\n" + zielName + "\n(" + quellSeiten +
              (quellSeiten === 1 ? " Seite" : " Seiten") + ", " + spalten + " Spalten)");
    } catch (e) {
        fehler = e;
    } finally {
        try { if (raster) raster.close(SaveOptions.NO); } catch (e) {}
        try { if (zwischen.exists) zwischen.remove(); } catch (e) {}
        try { if (altEinheit !== null) app.scriptPreferences.measurementUnit = altEinheit; } catch (e) {}
        try { if (altViewPdf !== null) app.pdfExportPreferences.viewPDF = altViewPdf; } catch (e) {}
        try { if (altBereich !== null) app.pdfExportPreferences.pageRange = altBereich; } catch (e) {}
        try { if (altPlatzSeite !== null) app.pdfPlacePreferences.pageNumber = altPlatzSeite; } catch (e) {}
        try { if (altPlatzZuschnitt !== null) app.pdfPlacePreferences.pdfCrop = altPlatzZuschnitt; } catch (e) {}
        try { if (altPlatzTransparenz !== null) app.pdfPlacePreferences.transparentBackground = altPlatzTransparenz; } catch (e) {}
    }
    if (fehler) alert("Kontaktabzug abgebrochen: " + fehler);

})();
