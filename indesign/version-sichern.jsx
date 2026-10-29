// ============================================================================
// Version-sichern.jsx  —  Adobe InDesign                          Version 1.0
// ----------------------------------------------------------------------------
// Sichert das Dokument und legt eine datierte Kopie in den Unterordner
// „Versionen“ neben der Dokumentdatei:
//
//   Versionen/Name_2026-09-01.indd
//   Versionen/Name_2026-09-01_2.indd     (wenn es an dem Tag schon eine gibt)
//
// Der Arbeitsstand bleibt geöffnet — die Kopie ist das Sicherheitsnetz.
// Gelöscht wird nie etwas.
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

    // Ohne gesicherte Datei gibt es nichts zu kopieren — und keinen Ort dafür.
    if (!doc.saved) {
        alert("Das Dokument wurde noch nie gesichert.\n" +
              "Bitte erst „Sichern unter …“ — danach kann dieses Script Versionen ablegen.");
        return;
    }

    // Erst der normale Sichern-Schritt, damit die Kopie den aktuellen Stand trägt.
    try {
        if (doc.modified) doc.save();
    } catch (fehler) {
        alert("Sichern fehlgeschlagen: " + fehler);
        return;
    }

    var quelle = new File(doc.fullName.fsName);
    var ordner = new Folder(quelle.parent.fsName + "/Versionen");
    if (!ordner.exists && !ordner.create()) {
        alert("Der Ordner „Versionen“ ließ sich nicht anlegen:\n" + ordner.fsName);
        return;
    }

    // Name_JJJJ-MM-TT.indd — bei Bedarf numeriert, überschrieben wird nie.
    function zweistellig(n) { return (n < 10 ? "0" : "") + n; }
    var d = new Date();
    var datum = d.getFullYear() + "-" + zweistellig(d.getMonth() + 1) + "-" + zweistellig(d.getDate());
    var name = quelle.name;
    var punkt = name.lastIndexOf(".");
    var basis = (punkt > 0) ? name.substring(0, punkt) : name;
    var endung = (punkt > 0) ? name.substring(punkt) : ".indd";

    var zielName = basis + "_" + datum + endung;
    var zaehler = 2;
    while (File(ordner.fsName + "/" + zielName).exists && zaehler < 1000) {
        zielName = basis + "_" + datum + "_" + zaehler + endung;
        zaehler++;
    }

    if (!quelle.copy(ordner.fsName + "/" + zielName)) {
        alert("Die Kopie ließ sich nicht anlegen:\n" + ordner.fsName + "/" + zielName);
        return;
    }

    alert("Version gesichert:\nVersionen/" + zielName);

})();
