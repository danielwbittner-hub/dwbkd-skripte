// ============================================================================
// Aus-Flaeche-ausschneiden-Affinity.js — Affinity (Designer · Photo · Publisher 3.x)
// Version 1.0
// ----------------------------------------------------------------------------
// Schneidet alle Objekte, die ÜBER einer ausgewählten Fläche liegen und sie
// überlappen, aus dieser Fläche AUS (Löcher). Entspricht „Abziehen“ in der
// Werkzeugleiste – die oberen Objekte werden dabei verbraucht, die Fläche
// bekommt an ihren Stellen durchsichtige Aussparungen.
// Neubau des Illustrator-Scripts „AusFlaecheAusschneiden.jsx“.
//
// Anwendung:
//   1. Die Grundfläche auswählen (genau EIN Objekt, z. B. das grüne Rechteck).
//      Die auszuschneidenden Objekte NICHT mit auswählen.
//   2. Script im Panel „Skripte“ ausführen
//
// Hinweise:
//   - Die oberen Objekte müssen in derselben Ebene/Gruppe wie die Fläche
//     liegen und in der Stapelreihenfolge ÜBER ihr. Gruppen über der Fläche
//     werden nicht angefasst (vorher Gruppierung aufheben).
//   - Text vorher in Kurven umwandeln.
//   - Ergebnis ist EINE Kurve mit Löchern; ein Rückgängig-Schritt.
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

'use strict';

const { Application } = require('/application.js');
const { Document } = require('/document.js');
const { DocumentCommand } = require('/commands.js');
const { rectsIntersect } = require('/geometry.js');
const { Selection } = require('/selections.js');

const TITLE = "Aus Fläche ausschneiden";
const TEST  = (typeof __AUS_TEST !== 'undefined') && __AUS_TEST;   // Test: ohne Rückfragen

function say(msg) { if (TEST) console.log("ALERT: " + msg); else Application.alert(msg, TITLE); }
function ask(msg) { if (TEST) { console.log("CONFIRM: " + msg); return true; } return Application.confirm(msg, TITLE); }

// Vektorfläche, die als Schneider taugt: Form oder Kurve, sichtbar, bearbeitbar,
// keine Zeichenfläche, kein Text/Bild/Gruppe.
function isCutter(n) {
    if (!(n.isShapeNode || n.isPolyCurveNode)) return false;
    if (n.isArtboardEnabled) return false;
    return n.isVisible && n.isEditable;
}

function main() {
    const doc = Document.current;
    if (!doc) { say("Kein Dokument geöffnet."); return; }
    const nodes = doc.selection.nodes.toArray().filter(n => !n.isSpreadNode);
    if (nodes.length !== 1) {
        say("Bitte genau EIN Objekt auswählen:\ndie Fläche, aus der ausgeschnitten werden soll.\n\nDie auszuschneidenden Objekte NICHT mit auswählen.");
        return;
    }
    const base = nodes[0];
    if (!(base.isShapeNode || base.isPolyCurveNode)) {
        say("Bitte eine Form oder Kurve als Fläche auswählen\n(ausgewählt ist: " + base.description + ").");
        return;
    }
    const baseBox = base.getSpreadBaseBox();

    // Geschwister über der Fläche: die Kindliste ist von unten nach oben
    // sortiert, alles NACH der Fläche liegt also darüber.
    const parent = base.parent;
    const siblings = parent ? parent.children.toArray() : [];
    const i0 = siblings.findIndex(n => n.isSameNode(base));
    if (i0 < 0) { say("Die Auswahl konnte in der Stapelreihenfolge nicht gefunden werden."); return; }

    const cutters = [];
    let groups = 0, others = 0;
    for (const n of siblings.slice(i0 + 1)) {
        if (!rectsIntersect(n.getSpreadBaseBox(), baseBox)) continue;
        if (isCutter(n)) cutters.push(n);
        else if (n.isGroupNode || n.isContainerNode) groups++;
        else others++;
    }

    if (cutters.length === 0) {
        say("Über der ausgewählten Fläche liegen keine Formen,\ndie sie überlappen – nichts zu tun.\n\nBitte prüfen:\n– Liegen die auszuschneidenden Objekte in derselben Ebene\n   und in der Stapelreihenfolge ÜBER der Fläche?\n– Sind sie gruppiert? (Dann zuerst die Gruppierung aufheben.)\n– Text vorher in Kurven umwandeln." +
            (groups ? "\n\nÜbersprungene Gruppen/Ebenen: " + groups : "") +
            (others ? "\nÜbersprungene andere Objekte (Text, Bilder …): " + others : ""));
        return;
    }

    if (!ask(cutters.length + " Objekt(e) über der Fläche gefunden.\n\n" +
             "Sie werden aus der Fläche ausgeschnitten (Löcher)\nund dabei entfernt – wie „Abziehen“.\n\nFortfahren?"))
        return;

    // Boolesches Abziehen: unterstes Objekt der Auswahl minus alle darüber.
    // Der Befehl arbeitet verlässlich auf der aktuellen Dokumentauswahl.
    doc.selection = Selection.create(doc, [base].concat(cutters));
    doc.executeCommand(DocumentCommand.createBoolOpSubtract(null));

    const result = doc.selection.nodes.toArray();
    const holes = result.length === 1 && result[0].polyCurve ? result[0].polyCurve.curveCount - 1 : -1;
    say("Fertig.\n\n" + cutters.length + " Objekt(e) wurden aus der Fläche ausgeschnitten" +
        (holes >= 0 ? " (" + holes + " Teilkurve(n) als Aussparung)" : "") + "." +
        (groups ? "\n\nNicht berücksichtigt – Gruppen/Ebenen über der Fläche: " + groups : "") +
        (others ? "\nNicht berücksichtigt – Text/Bilder über der Fläche: " + others : ""));
}

try {
    main();
} catch (err) {
    say("Fehler: " + err.message + (err.stack ? "\n\n" + err.stack.split("\n").slice(0, 4).join("\n") : ""));
}
