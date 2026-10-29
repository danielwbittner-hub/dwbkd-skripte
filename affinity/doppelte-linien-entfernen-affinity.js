// ============================================================================
// Doppelte-Linien-entfernen-Affinity.js — Affinity (Designer · Photo · Publisher 3.x)
// Version 1.1
// ----------------------------------------------------------------------------
// Findet exakt deckungsgleiche Linien UND Flächen (doppelt, dreifach oder öfter
// direkt übereinander) und löscht alle Kopien bis auf eine. So bleibt nach z. B.
// mehrfachem Einfügen, importierten PDFs/DXFs oder verschmolzenen Zeichnungen
// pro Linie/Fläche nur noch ein Objekt stehen — wichtig fürs Plotten, Cutten und
// Lasern, wo doppelte Schnittlinien doppelt gefahren werden und doppelte
// Flächen beim Füllen/Gravieren stören.
// Neubau des Illustrator-Scripts „Doppelte-Linien-entfernen.jsx“.
//
// Linie oder Fläche?
//   • Fläche = gefülltes Objekt (auch Formen mit Löchern, QR-Module, Buchstaben).
//     Deckungsgleiche Mehrfach-Flächen, die direkt untereinander liegen, werden
//     genauso entfernt wie doppelte Linien.
//   • Linie  = ungefülltes Objekt (reine Kontur, offen oder geschlossen).
//   • Über die Option „Objekte“ lässt sich wählen: nur Linien, nur Flächen oder
//     beide. Bei „beide“ werden Linien und Flächen getrennt verglichen – eine
//     Linie wird also nie wegen einer deckungsgleichen Fläche gelöscht.
//
// Was zählt als „exakt gleich“?
//   • Gleicher Kurvenverlauf: alle Ankerpunkte UND Bézier-Griffe stimmen
//     (auf Rundung genau) überein – in Seitenkoordinaten, also unabhängig
//     davon, ob eine Linie verschoben/gedreht als Objekt oder als Punkte
//     gezeichnet wurde. Kurven werden mitgeprüft, nicht nur Geraden.
//   • Offen/geschlossen muss übereinstimmen.
//   • Optional (aus): auch Aussehen (Kontur-/Füllfarbe & Konturstärke)
//     muss gleich sein. Standardmäßig zählt nur die Geometrie.
//   • Optional (an): umgekehrt gezeichnete Linien (A→B und B→A) gelten
//     als dasselbe Duplikat.
//
// Funktionen:
//   • Objekte: nur Linien, nur Flächen oder beide (neu in v1.1)
//   • Bereich: ganzes Dokument oder nur Auswahl (auch in Gruppen/Ebenen)
//   • Toleranz in Dokumenteinheit (0 = exakt, fängt nur Rundungsrauschen ab)
//   • Vorschau „nur zählen“ — wählt die Duplikate aus, löscht nichts
//   • Überspringt unsichtbare/gesperrte Objekte, Zeichenflächen, Text, Bilder
//   • Löschen = ein Rückgängig-Schritt
//
// Verwendung:
//   1. (optional) Objekte auswählen
//   2. Script im Panel „Skripte“ ausführen
//   3. Optionen einstellen, „OK“
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

'use strict';

const { Application } = require('/application.js');
const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { DocumentCommand } = require('/commands.js');
const { FillType } = require('/fills.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');
const { File, fs } = require('/fs.js');

const VERSION       = "1.1";
const TITLE         = "Doppelte Linien entfernen";
const SETTINGS_FILE = "dwbkd-Scripte-Einstellungen.json";
const SETTINGS_KEY  = "doppelteLinien";

// Für automatisierte Tests: vorher definiertes __DUB_OPTS übergeht den Dialog.
const TEST_OPTS = (typeof __DUB_OPTS === 'object' && __DUB_OPTS) ? __DUB_OPTS : null;

function say(msg) { if (TEST_OPTS) console.log("ALERT: " + msg); else Application.alert(msg, TITLE); }
function isOk(result) { return (result?.value ?? result) == DialogResult.Ok.value; }

// ------------------------------------------------------- Einstellungen merken
function settingsPath() { return Application.userDesktopPath + "/" + SETTINGS_FILE; }
function loadSettings(defaults) {
    try {
        const p = settingsPath();
        if (!fs.exists(p)) return Object.assign({}, defaults);
        const all = JSON.parse(File.readAll(p).toString());
        return Object.assign({}, defaults, (all && all[SETTINGS_KEY]) || {});
    } catch (e) { return Object.assign({}, defaults); }
}
function saveSettings(values) {
    try {
        const p = settingsPath();
        let all = {};
        if (fs.exists(p)) { try { all = JSON.parse(File.readAll(p).toString()) || {}; } catch (e) { all = {}; } }
        all[SETTINGS_KEY] = values;
        const f = File.create(p, "w"); f.writeString(JSON.stringify(all, null, 1)); f.close();
    } catch (e) {
        say("Die zuletzt eingegebenen Werte konnten nicht gespeichert werden –\nAffinity erlaubt diesem Script keinen Zugriff auf den Schreibtisch.\n\nAbhilfe: Affinity → Einstellungen → Skripte: für dieses Script\nden Zugriff auf Dateien auf dem Desktop erlauben.\n\nDatei: " + settingsPath() + "\n" + e.message);
    }
}
const DEFAULTS = { mode: 'B', scopeAll: false, look: false, bothDirections: true, tolMM: 0, countOnly: false };

// Linie = ungefüllt, Fläche = gefüllt. Eine Fläche mit Loch ist ein Objekt mit
// mehreren Kurven – das prüft geoKey() ohnehin mit, hier zählt nur die Füllung.
function isFilled(node) {
    try {
        const d = node.brushFillDescriptor;
        if (!d || !d.fill) return false;
        return d.fill.fillType.value !== FillType.None.value;
    } catch (e) { return false; }
}
function artOf(node) { return isFilled(node) ? 'F' : 'L'; }

// ------------------------------------------------------------- Signaturen
function colourKey(desc) {
    try {
        const fill = desc.fill;
        if (!fill || fill.fillType.value === FillType.None.value) return "-";
        if (fill.fillType.value === FillType.Solid.value) { const c = fill.colour.rgba8; return c.r + "/" + c.g + "/" + c.b + "/" + c.alpha; }
        return String(fill.fillType);
    } catch (e) { return "?"; }
}

// Geometrie-Signatur: je Bézier-Segment Start, beide Griffe, Ende – in
// Seitenkoordinaten, auf die Toleranz gerundet. Bei beidseitigem Vergleich
// wird auch die umgekehrte Reihenfolge (Griffe getauscht) gebildet und der
// kleinere String gewählt, damit A→B und B→A denselben Schlüssel ergeben.
function geoKey(node, q, bothDirections) {
    // Kurvenpunkte liegen im Basisraum des Objekts; baseToSpreadTransform
    // (nicht localToSpreadTransform!) bringt sie in Seitenkoordinaten.
    const xf = node.baseToSpreadTransform;
    const pt = (p) => { const t = xf.applyToPoint({ x: p.x, y: p.y }); return q(t.x) + "," + q(t.y); };
    const parts = [];
    const pc = node.polyCurve;
    for (let ci = 0; ci < pc.curveCount; ci++) {
        const cv = pc.at(ci);
        if (cv.isEmpty) continue;
        const segs = [];
        for (let i = cv.firstOnCurvePointIndex; i < cv.lastOnCurvePointIndex; i = cv.getNextOnCurvePointIndex(i, false)) {
            const b = cv.getCubicBezier(i);
            segs.push([pt(b.start), pt(b.c1), pt(b.c2), pt(b.end)]);
        }
        if (cv.isClosed && cv.lastOnCurvePointIndex !== cv.firstOnCurvePointIndex) {
            // Schließendes Segment vom letzten zum ersten Punkt
            try { const b = cv.getCubicBezier(cv.lastOnCurvePointIndex); segs.push([pt(b.start), pt(b.c1), pt(b.c2), pt(b.end)]); } catch (e) { }
        }
        const forward = segs.map(s => s.join(":")).join("|");
        let key = forward;
        if (bothDirections) {
            const backward = segs.slice().reverse().map(s => [s[3], s[2], s[1], s[0]].join(":")).join("|");
            if (backward < forward) key = backward;
        }
        parts.push((cv.isClosed ? "Z" : "O") + "#" + key);
    }
    return parts.join("//");
}

function signature(node, o, q, kind) {
    // Vorangestellte Objektart trennt Linien und Flächen, auch wenn sie
    // deckungsgleich sind.
    let key = kind + "#" + geoKey(node, q, o.bothDirections);
    if (o.look) {
        const stroke = node.hasPenFill ? "ST" + colourKey(node.penFillDescriptor) + "/" + q(node.lineWeight) : "noST";
        const fill = "FI" + colourKey(node.brushFillDescriptor);
        key += "@@" + stroke + "|" + fill;
    }
    return key;
}

// Kandidaten einsammeln: Formen und Kurven, sichtbar und bearbeitbar,
// keine Zeichenflächen; Gruppen/Ebenen werden durchsucht.
function collect(list, out) {
    for (const n of list) {
        if (n.isSpreadNode) { collect(n.children.toArray(), out); continue; }
        if (!n.isVisible || !n.isEditable) continue;
        if (n.isArtboardEnabled) { collect(n.children.toArray(), out); continue; }
        if (n.isShapeNode || n.isPolyCurveNode) {
            if (n.children.length > 0) collect(n.children.toArray(), out);
            out.push(n);
        } else if (n.isGroupNode || n.isContainerNode) {
            collect(n.children.toArray(), out);
        }
    }
}

// ------------------------------------------------------------------- Dialog
function buildDialog(doc, init, selCount) {
    const pxPerMM = doc.dpi / 25.4;
    const dlg = Dialog.create(TITLE + "  ·  v" + VERSION);
    const col = dlg.addColumn();
    const gScope = col.addGroup("Bereich");
    dlg.scope = gScope.addRadioGroup("", ["Ganzes Dokument", "Nur Auswahl (" + selCount + " Objekt" + (selCount === 1 ? "" : "e") + ")"],
                                     (selCount > 0 && !init.scopeAll) ? 1 : 0);
    if (selCount === 0) dlg.scope.isEnabled = false;

    const gKind = col.addGroup("Objekte");
    dlg.mode = gKind.addRadioGroup("", ["Nur Linien (ungefüllt)", "Nur Flächen (gefüllt)", "Beide (getrennt)"],
                                   init.mode === 'L' ? 0 : init.mode === 'F' ? 1 : 2);

    const gCmp = col.addGroup("Vergleich");
    dlg.look  = gCmp.addSwitch("Auch Aussehen muss gleich sein (Farbe & Konturstärke)", init.look);
    dlg.both  = gCmp.addSwitch("Umgekehrt gezeichnete Linien auch als Duplikat", init.bothDirections);
    dlg.tol   = gCmp.addUnitValueEditor("Toleranz (0 = exakt)", UnitType.Pixel, doc.units, init.tolMM * pxPerMM, 0, 10 * pxPerMM).setPrecision(3);

    const gOpt = col.addGroup("Ausführung");
    dlg.countOnly = gOpt.addSwitch("Nur zählen (Vorschau: Duplikate auswählen, nichts löschen)", init.countOnly);
    dlg.initialWidth = 520;
    return dlg;
}

function readState(dlg, doc) {
    const pxPerMM = doc.dpi / 25.4;
    const mode = dlg.mode.selectedIndex === 0 ? 'L' : dlg.mode.selectedIndex === 1 ? 'F' : 'B';
    return { mode: mode, scopeAll: dlg.scope.selectedIndex === 0, look: dlg.look.value, bothDirections: dlg.both.value, tolMM: dlg.tol.value / pxPerMM, countOnly: dlg.countOnly.value };
}

// ---------------------------------------------------------------- Hauptteil
function run(doc, selNodes, o) {
    const pxPerMM = doc.dpi / 25.4;
    const tolPx = Math.max(0, o.tolMM || 0) * pxPerMM;
    // Zahl auf Toleranz runden (0 -> 1/1000 px, nur gegen Fließkomma-Rauschen)
    const q = (n) => tolPx > 0 ? Math.round(n / tolPx) * tolPx : Math.round(n * 1000) / 1000;

    const all = [];
    collect((o.scopeAll || selNodes.length === 0) ? [doc.currentSpread] : selNodes, all);
    // Nach gewählter Objektart filtern (bei „Beide“ bleibt alles drin).
    const mode = o.mode || 'B';
    const source = (mode === 'B') ? all : all.filter(n => artOf(n) === mode);
    if (source.length === 0) {
        say(mode === 'F' ? "Keine passenden Flächen gefunden." :
            mode === 'L' ? "Keine passenden Linien gefunden." :
                           "Keine passenden Linien oder Flächen gefunden.");
        return false;
    }

    const seen = new Set();
    const dups = [];
    for (const n of source) {
        let sig;
        try { sig = signature(n, o, q, artOf(n)); } catch (e) { continue; }
        if (!sig) continue;
        if (seen.has(sig)) dups.push(n); else seen.add(sig);
    }

    const checked = source.length, found = dups.length;
    if (found === 0) { say("Geprüft: " + checked + " Objekt(e).\nKeine Duplikate gefunden."); return true; }

    if (o.countOnly) {
        try { doc.selection = Selection.create(doc, dups); } catch (e) { }
        say("Vorschau — es wurde nichts gelöscht.\n\nGeprüft:   " + checked + " Objekt(e)\nDuplikate: " + found + " (jetzt ausgewählt)\nBliebe übrig: " + (checked - found) + " Objekt(e)");
        return true;
    }

    doc.executeCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, dups)));
    say("Fertig.\n\nGeprüft:  " + checked + " Objekt(e)\nGelöscht: " + found + " Duplikat(e)\nÜbrig:    " + (checked - found) + " Objekt(e)\n\nRückgängig mit Cmd+Z.");
    return true;
}

function main() {
    const doc = Document.current;
    if (!doc) { say("Kein Dokument geöffnet."); return; }
    const selNodes = doc.selection.nodes.toArray().filter(n => !n.isSpreadNode);

    if (TEST_OPTS) { run(doc, selNodes, Object.assign({}, DEFAULTS, TEST_OPTS)); return; }

    const init = loadSettings(DEFAULTS);
    const dlg = buildDialog(doc, init, selNodes.length);
    if (!isOk(dlg.runModal())) return;
    const state = readState(dlg, doc);
    saveSettings(state);                                // zuletzt eingegebene Werte merken – vor dem Lauf, unabhängig vom Ergebnis
    run(doc, selNodes, state);
}

try {
    main();
} catch (err) {
    say("Fehler: " + err.message + (err.stack ? "\n\n" + err.stack.split("\n").slice(0, 4).join("\n") : ""));
}
