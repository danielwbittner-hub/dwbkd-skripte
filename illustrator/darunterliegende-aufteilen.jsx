//@target illustrator
// Anzeigename: Darunterliegende aufteilen
/*
    DarunterliegendeAufteilen.jsx
    --------------------------------------------------------------
    Nimmt alle Objekte, die ÜBER einer ausgewählten Fläche liegen,
    und führt für jedes einzeln "Darunterliegende Objekte aufteilen"
    (Objekt > Pfad > Darunterliegende Objekte aufteilen) aus –
    eines nach dem anderen, von unten nach oben.

    Anwendung:
      1. Die Grundgrafik auswählen – EIN Objekt oder MEHRERE
         (z. B. alle Teile eines QR-Codes). Die Messer-Objekte
         (Balken) dürfen dabei NICHT mit ausgewählt sein.
      2. Datei > Skripten > DarunterliegendeAufteilen

    Einstellung ZWISCHENRAUM (im Abschnitt EINSTELLUNGEN unten):
      "entfernen"  = die neu entstandenen Stücke unter den
                     Messer-Objekten werden gelöscht (Standard)
      "einfaerben" = sie werden stattdessen mit FARBE gefüllt
      "behalten"   = sie bleiben unverändert

    Technik:
      - Der Menübefehl heißt intern "Knife Tool2".
      - Da Objektreferenzen in Illustrator nach Dokumentänderungen
        unzuverlässig werden, werden die Messer-Objekte vorab über
        das Notiz-Feld markiert und vor jedem Schnitt frisch im
        Dokument gesucht. Die Markierungen werden am Ende restlos
        entfernt.

    Hinweise:
      - Als "Messer" funktionieren nur Pfade und zusammengesetzte
        Pfade (Illustrator-Limit). Text vorher in Pfade umwandeln.
      - Besteht die Grundgrafik nur aus Konturlinien ohne Füllung,
        bietet das Skript an, sie zuerst in Flächen umzuwandeln
        (Objekt > Pfad > Konturlinie) – sonst gibt es nichts,
        woraus Lücken geschnitten werden könnten.
      - Die Messer-Objekte werden dabei verbraucht (wie beim
        manuellen Befehl auch).
      - Berücksichtigt werden nur Objekte, deren Begrenzungsrahmen
        die Fläche überlappt. Alles andere wird während des Laufs
        kurz ausgeblendet und danach wieder eingeblendet.
      - Rückgängig: mehrfach Cmd+Z (ein Schritt pro Objekt).
        Am besten vorher eine Kopie der Datei sichern.
*/

(function () {

    if (app.documents.length === 0) {
        alert("Kein Dokument geöffnet.");
        return;
    }
    var doc = app.activeDocument;

    if (doc.selection.length < 1) {
        alert("Bitte zuerst die Grundgrafik auswählen\n(ein Objekt oder mehrere), die aufgeteilt werden soll.\n\nDie Balken/Messer-Objekte dabei NICHT mit auswählen.");
        return;
    }

    // ---------- Konturlinien-Erkennung ----------
    // "Darunterliegende Objekte aufteilen" zerschneidet zuverlässig nur
    // gefüllte Flächen. Besteht die Auswahl nur aus Konturlinien ohne
    // Füllung, wird angeboten, sie zuerst in Flächen umzuwandeln
    // (entspricht Objekt > Pfad > Konturlinie).

    function zaehleFuellungen(it, zaehler) {
        if (it.typename === "GroupItem") {
            for (var g = 0; g < it.pageItems.length; g++) zaehleFuellungen(it.pageItems[g], zaehler);
        } else if (it.typename === "CompoundPathItem") {
            for (var p = 0; p < it.pathItems.length; p++) zaehleFuellungen(it.pathItems[p], zaehler);
        } else if (it.typename === "PathItem") {
            zaehler.pfade++;
            if (it.filled) zaehler.gefuellt++;
        }
    }

    var fuellungen = { pfade: 0, gefuellt: 0 };
    for (var f0 = 0; f0 < doc.selection.length; f0++) {
        zaehleFuellungen(doc.selection[f0], fuellungen);
    }

    if (fuellungen.pfade > 0 && fuellungen.gefuellt === 0) {
        if (!confirm("Die ausgewählte Grafik besteht nur aus Konturlinien\nohne Flächenfüllung – daran können die Balken keine\nLücken schneiden.\n\nSollen die Linien jetzt automatisch in Flächen\numgewandelt werden (Objekt > Pfad > Konturlinie)?")) {
            return;
        }
        try { app.executeMenuCommand("OffsetPath v22"); } catch (eKL) {}
        var kontrolle = { pfade: 0, gefuellt: 0 };
        for (var f1 = 0; f1 < doc.selection.length; f1++) {
            zaehleFuellungen(doc.selection[f1], kontrolle);
        }
        if (kontrolle.gefuellt === 0) {
            alert("Die automatische Umwandlung hat nicht geklappt.\n\nBitte manuell: Auswahl > Objekt > Pfad > Konturlinie,\ndanach das Skript erneut starten.");
            return;
        }
    }

    // Gemeinsamer Begrenzungsrahmen der gesamten Auswahl
    var basisGB = null; // [links, oben, rechts, unten]
    for (var b0 = 0; b0 < doc.selection.length; b0++) {
        var gbSel;
        try { gbSel = doc.selection[b0].geometricBounds; } catch (eB) { continue; }
        if (basisGB === null) {
            basisGB = [gbSel[0], gbSel[1], gbSel[2], gbSel[3]];
        } else {
            if (gbSel[0] < basisGB[0]) basisGB[0] = gbSel[0];
            if (gbSel[1] > basisGB[1]) basisGB[1] = gbSel[1];
            if (gbSel[2] > basisGB[2]) basisGB[2] = gbSel[2];
            if (gbSel[3] < basisGB[3]) basisGB[3] = gbSel[3];
        }
    }
    if (basisGB === null) {
        alert("Der Begrenzungsrahmen der Auswahl konnte nicht ermittelt werden.");
        return;
    }

    // ---------- EINSTELLUNGEN ----------

    // Was soll mit den neu entstandenen Stücken UNTER den Messer-
    // Objekten (den "Zwischenräumen") geschehen?
    //   "entfernen"  = löschen (Standard)
    //   "einfaerben" = mit FARBE füllen
    //   "behalten"   = unverändert lassen
    var ZWISCHENRAUM = "entfernen";
    var FARBE = { r: 255, g: 0, b: 255 }; // nur für "einfaerben" (RGB-Werte)

    // -----------------------------------

    // Unsichtbare Markierungen im Notiz-Feld (werden am Ende entfernt)
    var MESSER_MARK    = "«AUFTEILEN:MESSER»";
    var VERSTECKT_MARK = "«AUFTEILEN:VERSTECKT»";

    // ---------- Hilfsfunktionen ----------

    function ueberlappt(a, b) {
        return !(a[2] < b[0] || a[0] > b[2] || a[3] > b[1] || a[1] < b[3]);
    }

    function hatMark(it, mark) {
        try {
            return String(it.note || "").indexOf(mark) >= 0;
        } catch (e) {
            return false;
        }
    }

    function setzeMark(it, mark) {
        try {
            it.note = String(it.note || "") + mark;
            return true;
        } catch (e) {
            return false;
        }
    }

    function entferneMark(it, mark) {
        try {
            it.note = String(it.note || "").replace(mark, "");
        } catch (e) {}
    }

    // Taugt das Objekt als "Messer"?
    function istSchneider(it) {
        if (it.typename === "CompoundPathItem") {
            // ok
        } else if (it.typename === "PathItem") {
            if (it.guides) return false;
            if (it.parent.typename === "CompoundPathItem") return false; // Teil eines Compounds
        } else {
            return false; // Text, Bilder, Gruppen usw. können nicht schneiden
        }
        if (it.hidden || !it.editable) return false;
        try {
            return ueberlappt(it.geometricBounds, basisGB);
        } catch (e) {
            return false;
        }
    }

    // Enthält das Objekt (oder ist es) ein markiertes Messer oder die Auswahl?
    function enthaeltMarkOderAuswahl(it) {
        if (it.selected) return true;
        if (hatMark(it, MESSER_MARK)) return true;
        if (it.typename === "GroupItem") {
            for (var i = 0; i < it.pageItems.length; i++) {
                if (enthaeltMarkOderAuswahl(it.pageItems[i])) return true;
            }
        }
        return false;
    }

    function verstecke(it) {
        try {
            if (!it.hidden && it.editable) {
                if (setzeMark(it, VERSTECKT_MARK)) it.hidden = true;
            }
        } catch (e) {}
    }

    // Blendet in einer Liste alles aus, was kein Messer ist und keines enthält
    function versteckeNichtSchneider(liste) {
        for (var i = 0; i < liste.length; i++) {
            var c = liste[i];
            if (c.selected) continue;                 // die Basis selbst nie anfassen
            if (hatMark(c, MESSER_MARK)) continue;    // Messer sichtbar lassen
            if (c.typename === "GroupItem" && enthaeltMarkOderAuswahl(c)) {
                var kinder = [];
                for (var j = 0; j < c.pageItems.length; j++) kinder.push(c.pageItems[j]);
                versteckeNichtSchneider(kinder);
            } else {
                verstecke(c);
            }
        }
    }

    // Liegt der Begrenzungsrahmen "innen" komplett im Rahmen "aussen"?
    function liegtImRahmen(innen, aussen, toleranz) {
        return innen[0] >= aussen[0] - toleranz &&
               innen[2] <= aussen[2] + toleranz &&
               innen[1] <= aussen[1] + toleranz &&
               innen[3] >= aussen[3] - toleranz;
    }

    // Ankerpunkte eines Messer-Pfads als Polygon merken
    // (für den genauen Innen/Außen-Test; bei Compounds: null -> nur Rahmen)
    function messerPolygon(it) {
        try {
            if (it.typename !== "PathItem") return null;
            var pts = [];
            for (var i = 0; i < it.pathPoints.length; i++) {
                pts.push([it.pathPoints[i].anchor[0], it.pathPoints[i].anchor[1]]);
            }
            return (pts.length >= 3) ? pts : null;
        } catch (e) {
            return null;
        }
    }

    function punktImPolygon(x, y, poly) {
        var drin = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i][0], yi = poly[i][1];
            var xj = poly[j][0], yj = poly[j][1];
            if (((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                drin = !drin;
            }
        }
        return drin;
    }

    var zielFarbeCache = null;
    function zielFarbe() {
        if (zielFarbeCache !== null) return zielFarbeCache;
        if (doc.documentColorSpace === DocumentColorSpace.RGB) {
            var c = new RGBColor();
            c.red = FARBE.r; c.green = FARBE.g; c.blue = FARBE.b;
            zielFarbeCache = c;
        } else {
            var k = new CMYKColor();
            k.cyan    = (255 - FARBE.r) / 255 * 100;
            k.magenta = (255 - FARBE.g) / 255 * 100;
            k.yellow  = (255 - FARBE.b) / 255 * 100;
            k.black   = 0;
            zielFarbeCache = k;
        }
        return zielFarbeCache;
    }

    function faerbe(it) {
        if (it.typename === "CompoundPathItem") {
            for (var i = 0; i < it.pathItems.length; i++) faerbe(it.pathItems[i]);
            return;
        }
        it.filled = true;
        it.fillColor = zielFarbe();
    }

    // Behandelt nach einem Schnitt die neu entstandenen Stücke im
    // verbrauchten Messer. Gesucht wird direkt im Dokument – die
    // Auswahl nach executeMenuCommand ist nicht zuverlässig. Sichtbar
    // sind zu diesem Zeitpunkt nur die Teile der Grundgrafik und die
    // restlichen (markierten) Messer; alles Unbeteiligte ist
    // ausgeblendet.
    function behandleZwischenraeume(rahmen, polygon) {
        if (ZWISCHENRAUM === "behalten" || rahmen === null) return 0;

        function istZwischenraum(gb) {
            if (!liegtImRahmen(gb, rahmen, 0.5)) return false;
            if (polygon === null) return true;
            // Mittelpunkt muss im echten Messer-Umriss liegen
            // (wichtig bei gedrehten Messern: deren Rahmen ist größer)
            return punktImPolygon((gb[0] + gb[2]) / 2, (gb[1] + gb[3]) / 2, polygon);
        }

        function verarbeite(teil) {
            if (ZWISCHENRAUM === "entfernen") {
                teil.remove();
            } else {
                faerbe(teil);
            }
        }

        // Rückwärts durch alle Objekte, damit Löschen die noch zu
        // prüfenden Indizes nicht verschiebt
        var n = 0;
        var alleItems = doc.pageItems;
        for (var i = alleItems.length - 1; i >= 0; i--) {
            try {
                var it = alleItems[i];
                if (it.hidden || !it.editable) continue;
                if (hatMark(it, MESSER_MARK)) continue;

                if (it.typename === "PathItem") {
                    if (it.guides) continue;
                    if (it.parent.typename === "CompoundPathItem") continue; // über Compound
                    if (!istZwischenraum(it.geometricBounds)) continue;
                    verarbeite(it);
                    n++;
                } else if (it.typename === "CompoundPathItem") {
                    if (istZwischenraum(it.geometricBounds)) {
                        verarbeite(it);
                        n++;
                    } else {
                        // Compound als Ganzes zu groß -> Einzelpfade darin prüfen
                        for (var c = it.pathItems.length - 1; c >= 0; c--) {
                            try {
                                var kind = it.pathItems[c];
                                if (!istZwischenraum(kind.geometricBounds)) continue;
                                verarbeite(kind);
                                n++;
                            } catch (eKind) {}
                        }
                    }
                }
            } catch (e) {}
        }
        return n;
    }

    // Sucht frisch im Dokument das UNTERSTE markierte Messer
    // (doc.pageItems ist in Stapelreihenfolge, vorderstes zuerst)
    function findeUnterstesMesser() {
        var gefunden = null;
        var anzahl = 0;
        var alle = doc.pageItems;
        for (var i = 0; i < alle.length; i++) {
            if (hatMark(alle[i], MESSER_MARK)) {
                anzahl++;
                gefunden = alle[i]; // letztes = unterstes
            }
        }
        return { item: gefunden, anzahl: anzahl };
    }

    // Entfernt alle Markierungen und blendet Verstecktes wieder ein
    function aufraeumen() {
        var alle = doc.pageItems;
        for (var i = 0; i < alle.length; i++) {
            var it = alle[i];
            if (hatMark(it, VERSTECKT_MARK)) {
                try { it.hidden = false; } catch (e1) {}
                entferneMark(it, VERSTECKT_MARK);
            }
            if (hatMark(it, MESSER_MARK)) {
                entferneMark(it, MESSER_MARK);
            }
        }
    }

    // ---------- Stapelreihenfolge ermitteln ----------

    var alle = doc.pageItems;
    var ueber = [];         // alles über der Basis (vorderstes zuerst)
    var untenTop = [];      // Top-Level-Objekte unter der Basis
    var basisGefunden = false;

    for (var i = 0; i < alle.length; i++) {
        var it = alle[i];
        if (!basisGefunden) {
            if (it.selected) { basisGefunden = true; continue; }
            ueber.push(it);
        } else {
            if (it.parent.typename === "Layer" && !it.selected) untenTop.push(it);
        }
    }

    var schneider = [];
    for (var s = 0; s < ueber.length; s++) {
        if (istSchneider(ueber[s])) schneider.push(ueber[s]);
    }

    if (schneider.length === 0) {
        alert("Über der ausgewählten Grafik liegen keine Pfade,\ndie sie überlappen – nichts zu tun.\n\nBitte prüfen:\n– Liegen die Balken in der Stapelreihenfolge VOR der Grafik?\n   (Balken auswählen > Objekt > Anordnen > In den Vordergrund)\n– Sind die Balken mit der Grafik gruppiert?\n   (Dann zuerst die Gruppierung aufheben.)\n– Text muss vorher in Pfade umgewandelt werden.");
        return;
    }

    if (!confirm(schneider.length + " Objekt(e) über der Fläche gefunden.\n\n" +
                 "Jedes davon wird nacheinander (von unten nach oben) mit\n" +
                 "„Darunterliegende Objekte aufteilen“ angewendet und dabei verbraucht.\n\nFortfahren?")) {
        return;
    }

    // ---------- Messer markieren, Unbeteiligtes ausblenden ----------

    for (var m = 0; m < schneider.length; m++) {
        setzeMark(schneider[m], MESSER_MARK);
    }

    var topUeber = [];
    for (var t = 0; t < ueber.length; t++) {
        if (ueber[t].parent.typename === "Layer") topUeber.push(ueber[t]);
    }
    versteckeNichtSchneider(topUeber);

    for (var u = 0; u < untenTop.length; u++) {
        verstecke(untenTop[u]);
    }

    // ---------- Aufteilen: unterstes Messer zuerst, nach jedem Schnitt neu suchen ----------

    var geteilt = 0;
    var uebersprungen = 0;
    var zwischenraeume = 0;
    var letzterFehler = "";

    var interaktionAlt = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

    try {
        var maxRunden = schneider.length * 2 + 5; // Endlosschleifen-Bremse
        while (maxRunden-- > 0) {

            var fund = findeUnterstesMesser();
            if (fund.item === null) break; // alle verarbeitet
            var messer = fund.item;
            var vorher = fund.anzahl;

            doc.selection = null;
            var auswahlOk = true;
            try { messer.selected = true; } catch (eSel) { auswahlOk = false; }
            if (!auswahlOk || doc.selection.length !== 1) {
                entferneMark(messer, MESSER_MARK);
                uebersprungen++;
                continue;
            }

            // Rahmen und Umriss des Messers merken – nach dem Schnitt ist es weg
            var messerRahmen = null;
            try { messerRahmen = messer.geometricBounds; } catch (eGB) {}
            var messerPoly = messerPolygon(messer);

            try {
                app.executeMenuCommand("Knife Tool2"); // = Darunterliegende Objekte aufteilen
            } catch (eCmd) {
                letzterFehler = String(eCmd.message || eCmd);
            }

            // Wichtig: DOM-Zustand nach dem Menübefehl auffrischen –
            // ohne redraw liefern pageItems/selection veraltete Daten
            app.redraw();

            // Erfolgskontrolle: Anzahl markierter Messer muss gesunken sein
            var nachher = findeUnterstesMesser().anzahl;
            if (nachher < vorher) {
                geteilt++;
                zwischenraeume += behandleZwischenraeume(messerRahmen, messerPoly);
            } else {
                // Messer wurde nicht verbraucht -> Markierung entfernen, überspringen
                var rest = findeUnterstesMesser();
                if (rest.item !== null) entferneMark(rest.item, MESSER_MARK);
                uebersprungen++;
            }
        }
    } finally {
        app.userInteractionLevel = interaktionAlt;
        aufraeumen();
    }

    doc.selection = null;
    app.redraw();
    alert("Fertig.\n\nAufgeteilt: " + geteilt + " Objekt(e)" +
          (ZWISCHENRAUM === "entfernen"  ? "\nZwischenräume entfernt: " + zwischenraeume : "") +
          (ZWISCHENRAUM === "einfaerben" ? "\nZwischenräume eingefärbt: " + zwischenraeume : "") +
          (uebersprungen > 0 ? "\nÜbersprungen: " + uebersprungen : "") +
          (uebersprungen > 0 && letzterFehler !== "" ? "\n\nLetzte Fehlermeldung:\n" + letzterFehler : ""));

})();
