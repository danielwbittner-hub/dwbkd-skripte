//@target illustrator
// Anzeigename: Aus Fläche ausschneiden
/*
    AusFlaecheAusschneiden.jsx
    --------------------------------------------------------------
    Schneidet alle Objekte, die ÜBER einer ausgewählten Fläche
    liegen und sie überlappen, aus dieser Fläche AUS (Löcher).
    Entspricht Pathfinder "Vorne abziehen" – die oberen Objekte
    werden dabei verbraucht, die Fläche bekommt an ihren Stellen
    durchsichtige Aussparungen.

    Anwendung:
      1. Die Grundfläche auswählen (genau EIN Objekt,
         z. B. das grüne Rechteck). Die auszuschneidenden
         Objekte NICHT mit auswählen.
      2. Datei > Skripten > AusFlaecheAusschneiden

    Hinweise:
      - Die oberen Objekte müssen in der Stapelreihenfolge VOR der
        Fläche liegen.
      - Text vorher in Pfade umwandeln.
      - Ergebnis ist EIN zusammengesetzter Pfad mit Löchern.
      - Rückgängig: Cmd+Z. Am besten vorher eine Kopie sichern.
*/

(function () {

    if (app.documents.length === 0) {
        alert("Kein Dokument geöffnet.");
        return;
    }
    var doc = app.activeDocument;

    if (doc.selection.length !== 1) {
        alert("Bitte genau EIN Objekt auswählen:\ndie Fläche, aus der ausgeschnitten werden soll.\n\nDie auszuschneidenden Objekte NICHT mit auswählen.");
        return;
    }

    var basis = doc.selection[0];
    if (basis.typename !== "PathItem" && basis.typename !== "CompoundPathItem") {
        alert("Bitte einen Pfad oder zusammengesetzten Pfad als Fläche\nauswählen (ausgewählt ist: " + basis.typename + ").");
        return;
    }
    var basisGB = basis.geometricBounds; // [links, oben, rechts, unten]

    // Unsichtbare Markierung im Notiz-Feld (nur zur Erfolgskontrolle,
    // wird am Ende restlos entfernt)
    var MARK = "«AUSSCHNEIDEN:OBEN»";

    // ---------- Hilfsfunktionen ----------

    function ueberlappt(a, b) {
        return !(a[2] < b[0] || a[0] > b[2] || a[3] > b[1] || a[1] < b[3]);
    }

    function hatMark(it) {
        try { return String(it.note || "").indexOf(MARK) >= 0; }
        catch (e) { return false; }
    }

    function setzeMark(it) {
        try { it.note = String(it.note || "") + MARK; } catch (e) {}
    }

    function entferneMark(it) {
        try { it.note = String(it.note || "").replace(MARK, ""); } catch (e) {}
    }

    function istSchneider(it) {
        if (it.typename === "CompoundPathItem") {
            // ok
        } else if (it.typename === "PathItem") {
            if (it.guides) return false;
            if (it.parent.typename === "CompoundPathItem") return false; // Teil eines Compounds
        } else {
            return false; // Text, Bilder, Gruppen usw.
        }
        if (it.hidden || !it.editable) return false;
        try { return ueberlappt(it.geometricBounds, basisGB); }
        catch (e) { return false; }
    }

    // ---------- Objekte über der Fläche ermitteln ----------
    // doc.pageItems ist in Stapelreihenfolge (vorderstes zuerst)

    var alle = doc.pageItems;
    var ueber = [];
    var gefunden = false;

    for (var i = 0; i < alle.length; i++) {
        var it = alle[i];
        if (it.selected) { gefunden = true; break; }
        ueber.push(it);
    }
    if (!gefunden) {
        alert("Die Auswahl konnte in der Stapelreihenfolge nicht gefunden werden.");
        return;
    }

    var schneider = [];
    for (var s = 0; s < ueber.length; s++) {
        if (istSchneider(ueber[s])) schneider.push(ueber[s]);
    }

    if (schneider.length === 0) {
        alert("Über der ausgewählten Fläche liegen keine Pfade,\ndie sie überlappen – nichts zu tun.\n\nBitte prüfen:\n– Liegen die auszuschneidenden Objekte in der\n   Stapelreihenfolge VOR der Fläche?\n– Sind sie mit der Fläche gruppiert?\n   (Dann zuerst die Gruppierung aufheben.)\n– Text vorher in Pfade umwandeln.");
        return;
    }

    if (!confirm(schneider.length + " Objekt(e) über der Fläche gefunden.\n\n" +
                 "Sie werden aus der Fläche ausgeschnitten (Löcher)\nund dabei entfernt – wie Pathfinder „Vorne abziehen“.\n\nFortfahren?")) {
        return;
    }

    // ---------- Ausschneiden ----------

    for (var m = 0; m < schneider.length; m++) {
        setzeMark(schneider[m]);
    }

    var fehler = "";
    try {
        // Fläche + alle oberen Objekte auswählen
        doc.selection = null;
        basis.selected = true;
        for (var a = 0; a < schneider.length; a++) {
            try { schneider[a].selected = true; } catch (eSel) {}
        }

        // Gruppieren, Pathfinder "Vorne abziehen" als Live-Effekt,
        // umwandeln, Hilfsgruppe wieder auflösen
        app.executeMenuCommand("group");
        app.executeMenuCommand("Live Pathfinder Subtract");
        app.executeMenuCommand("expandStyle");
        app.redraw();
        app.executeMenuCommand("ungroup");
        app.redraw();
    } catch (e) {
        fehler = String(e.message || e);
    }

    // ---------- Erfolgskontrolle & Aufräumen ----------
    // Wurden die oberen Objekte verrechnet, sind ihre Markierungen weg

    var rest = 0;
    var alle2 = doc.pageItems;
    for (var r = 0; r < alle2.length; r++) {
        if (hatMark(alle2[r])) {
            entferneMark(alle2[r]);
            rest++;
        }
    }

    if (rest === 0) {
        alert("Fertig.\n\n" + schneider.length + " Objekt(e) wurden aus der Fläche ausgeschnitten.");
    } else {
        alert("Das hat nicht vollständig geklappt:\n" + rest + " von " + schneider.length + " Objekt(en) wurden nicht verrechnet." +
              (fehler !== "" ? "\n\nFehlermeldung:\n" + fehler : "") +
              "\n\nAlternative von Hand: Fläche und obere Objekte auswählen,\ndann Pathfinder-Bedienfeld > „Vorne abziehen“.");
    }

})();
