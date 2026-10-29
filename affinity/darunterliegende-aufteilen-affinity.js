// ============================================================================
// Darunterliegende-aufteilen-Affinity.js — Affinity (Designer · Photo · Publisher 3.x)
// Version 1.0
// ----------------------------------------------------------------------------
// Nimmt alle Objekte („Messer“), die ÜBER einer ausgewählten Grundgrafik
// liegen, und teilt die Grundgrafik damit auf – eines nach dem anderen, von
// unten nach oben, wie Illustrators „Darunterliegende Objekte aufteilen“.
// Die Stücke unter den Messern (die „Zwischenräume“) werden wahlweise
// entfernt, eingefärbt oder behalten; die Messer werden dabei verbraucht.
// Neubau des Illustrator-Scripts „DarunterliegendeAufteilen.jsx“.
//
// Anwendung:
//   1. Die Grundgrafik auswählen – EIN Objekt oder MEHRERE (z. B. alle Teile
//      eines QR-Codes). Die Messer-Objekte (Balken) NICHT mit auswählen.
//   2. Script im Panel „Skripte“ ausführen, Umgang mit Zwischenräumen wählen
//
// Hinweise:
//   - Als Messer zählen Formen/Kurven in derselben Ebene wie die Grundgrafik,
//     die in der Stapelreihenfolge ÜBER ihr liegen und sie überlappen.
//     Gruppen, Text und Bilder schneiden nicht (Text vorher in Kurven
//     umwandeln, Gruppen auflösen).
//   - Besteht die Grundgrafik nur aus Konturlinien ohne Füllung, gibt es
//     nichts, woraus Lücken geschnitten werden könnten: vorher
//     Ebene > Kontur erweitern anwenden.
//   - Rückgängig: ein Schritt pro Messer (Cmd+Z mehrfach).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

'use strict';

const { Application } = require('/application.js');
const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { DocumentCommand } = require('/commands.js');
const { rectsIntersect, unionRects, WindingOrder } = require('/geometry.js');
const { FillType, FillDescriptor } = require('/fills.js');
const { Colour, RGB8 } = require('/colours.js');
const { Selection } = require('/selections.js');
const { File, fs } = require('/fs.js');

const VERSION       = "1.0";
const TITLE         = "Darunterliegende aufteilen";
const SETTINGS_FILE = "dwbkd-Scripte-Einstellungen.json";
const SETTINGS_KEY  = "darunterliegendeAufteilen";

// Für automatisierte Tests: vorher definiertes __DAR_OPTS übergeht den Dialog.
const TEST_OPTS = (typeof __DAR_OPTS === 'object' && __DAR_OPTS) ? __DAR_OPTS : null;

function say(msg) { if (TEST_OPTS) console.log("ALERT: " + msg); else Application.alert(msg, TITLE); }
function ask(msg) { if (TEST_OPTS) { console.log("CONFIRM: " + msg); return true; } return Application.confirm(msg, TITLE); }
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
const DEFAULTS = { mode: 0, colour: { r: 255, g: 0, b: 255, alpha: 255 } };   // mode: 0 entfernen, 1 einfärben, 2 behalten

function colourFromJson(c) {
    try { if (c && typeof c === 'object') return Colour.createRGBA8({ r: c.r | 0, g: c.g | 0, b: c.b | 0, alpha: (c.alpha == null) ? 255 : c.alpha | 0 }); } catch (e) { }
    return RGB8(255, 0, 255);
}

// ------------------------------------------------------------------ Helfer
function isShape(n) { return (n.isShapeNode || n.isPolyCurveNode) && !n.isArtboardEnabled; }
function hasFill(n) {
    try { const f = n.brushFillDescriptor.fill; return f && f.fillType.value !== FillType.None.value; } catch (e) { return false; }
}

// Umriss eines Objekts in Seitenkoordinaten (für den Innen/Außen-Test)
function outlineOf(n) {
    const ppc = n.curvesInterface.polyPolyCurves.clone();
    ppc.transform(n.baseToSpreadTransform);
    return ppc;
}

// Flächenschwerpunkt eines Objekts in Seitenkoordinaten (Polygon-Näherung).
// Zuverlässiger als die Mitte des Begrenzungsrahmens, der bei gedrehten
// oder schrägen Stücken daneben liegen kann.
function centroid(n) {
    const ppc = outlineOf(n);
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < ppc.polyCurveCount; i++) {
        for (const cv of ppc.getTransformedPolyCurve(i)) {
            const poly = cv.generatePolygon(0.5);
            const m = poly.pointCount;
            if (m < 3) continue;
            for (let k = 0; k < m; k++) {
                const p = poly.getPoint(k), q = poly.getPoint((k + 1) % m);
                const w = p.x * q.y - q.x * p.y;
                A += w; cx += (p.x + q.x) * w; cy += (p.y + q.y) * w;
            }
        }
    }
    if (Math.abs(A) < 1e-9) { const b = n.getSpreadBaseBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
    return { x: cx / (3 * A), y: cy / (3 * A) };
}

// ------------------------------------------------------------------- Dialog
function buildDialog(init) {
    const dlg = Dialog.create(TITLE + "  ·  v" + VERSION);
    const col = dlg.addColumn();
    const g = col.addGroup("Zwischenräume (Stücke unter den Messern)");
    dlg.mode = g.addRadioGroup("", ["Entfernen (Lücken schneiden)", "Einfärben", "Behalten"], init.mode);
    dlg.colour = g.addColourPicker("Farbe fürs Einfärben", colourFromJson(init.colour));
    const sync = () => { dlg.colour.isEnabled = dlg.mode.selectedIndex === 1; };
    dlg.mode.onValueChangedHandler = sync;
    sync();
    col.addGroup("").addStaticText("", "Jedes Messer wird nacheinander (von unten nach oben) angewendet und dabei verbraucht.");
    dlg.initialWidth = 520;
    return dlg;
}

// ---------------------------------------------------------------- Hauptteil
function run(doc, bases, s) {
    const mode = s.mode | 0;
    const colour = colourFromJson(s.colour);

    // Nur Formen/Kurven als Grundgrafik; Gruppen werden aufgelöst betrachtet
    const flat = [];
    (function walk(list) { for (const n of list) { if (isShape(n)) flat.push(n); else if (n.isGroupNode || n.isContainerNode) walk(n.children.toArray()); } })(bases);
    if (!flat.length) { say("Die Auswahl enthält keine Formen oder Kurven."); return false; }
    if (!flat.some(hasFill)) {
        say("Die ausgewählte Grafik besteht nur aus Konturlinien ohne Flächenfüllung –\ndaran können die Messer keine Lücken schneiden.\n\nBitte vorher Ebene > Kontur erweitern anwenden und das Script erneut starten.");
        return false;
    }

    // Messer: Geschwister über dem obersten Grundobjekt, die den Rahmen überlappen
    const parent = bases[0].parent;
    const siblings = parent ? parent.children.toArray() : [];
    let top = -1;
    for (const b of bases) { const i = siblings.findIndex(n => n.isSameNode(b)); if (i > top) top = i; }
    if (top < 0) { say("Die Auswahl konnte in der Stapelreihenfolge nicht gefunden werden."); return false; }
    const frame = flat.map(n => n.getSpreadBaseBox()).reduce((a, b) => unionRects(a, b));
    const knives = [];
    let groups = 0, others = 0;
    for (const n of siblings.slice(top + 1)) {
        if (bases.some(b => b.isSameNode(n))) continue;
        if (!rectsIntersect(n.getSpreadBaseBox(), frame)) continue;
        if (isShape(n) && n.isVisible && n.isEditable) knives.push(n);
        else if (n.isGroupNode || n.isContainerNode) groups++;
        else others++;
    }
    if (!knives.length) {
        say("Über der ausgewählten Grafik liegen keine Formen,\ndie sie überlappen – nichts zu tun.\n\nBitte prüfen:\n– Liegen die Balken in derselben Ebene und in der\n   Stapelreihenfolge ÜBER der Grafik?\n– Sind sie gruppiert? (Dann zuerst die Gruppierung aufheben.)\n– Text vorher in Kurven umwandeln." +
            (groups ? "\n\nÜbersprungene Gruppen/Ebenen: " + groups : "") + (others ? "\nÜbersprungene andere Objekte: " + others : ""));
        return false;
    }
    if (!ask(knives.length + " Messer-Objekt(e) über der Grafik gefunden.\n\nJedes davon wird nacheinander (von unten nach oben) angewendet\nund dabei verbraucht.\n\nFortfahren?")) return false;

    let pieces = flat.slice();                       // aktuelle Stücke der Grundgrafik
    let cut = 0, skipped = 0, gaps = 0;
    const errors = [];
    for (const knife of knives) {
        const outline = outlineOf(knife);
        const kbox = knife.getSpreadBaseBox();
        const hit = pieces.filter(p => rectsIntersect(p.getSpreadBaseBox(), kbox));
        if (!hit.length) { skipped++; continue; }
        try {
            doc.selection = Selection.create(doc, hit.concat([knife]));
            doc.executeCommand(DocumentCommand.createDivideShapes(null));
        } catch (e) { skipped++; errors.push(e.message); continue; }
        const result = doc.selection.nodes.toArray();
        const inside = [], outside = [];
        for (const p of result) {
            let inK = false;
            try { inK = outline.containsPoint(centroid(p), false, WindingOrder.NonZero, true); } catch (e) { }
            (inK ? inside : outside).push(p);
        }
        // Stücke der Grundgrafik, die das Messer nicht berührt hat, bleiben dabei
        pieces = pieces.filter(p => !hit.some(h => h.isSameNode(p))).concat(outside);
        if (inside.length) {
            if (mode === 0) {
                doc.executeCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, inside)));
            } else if (mode === 1) {
                doc.executeCommand(DocumentCommand.createSetBrushFill(Selection.create(doc, inside), FillDescriptor.createSolid(colour)));
                pieces = pieces.concat(inside);
            } else {
                pieces = pieces.concat(inside);
            }
            gaps += inside.length;
        }
        cut++;
    }

    try { doc.selection = Selection.create(doc, pieces); } catch (e) { }
    say("Fertig.\n\nAufgeteilt: " + cut + " Messer" +
        (mode === 0 ? "\nZwischenräume entfernt: " + gaps : mode === 1 ? "\nZwischenräume eingefärbt: " + gaps : "\nZwischenräume behalten: " + gaps) +
        "\nStücke der Grundgrafik jetzt: " + pieces.length +
        (skipped ? "\nÜbersprungen: " + skipped : "") +
        (groups || others ? "\n\nNicht berücksichtigt – Gruppen: " + groups + ", andere Objekte: " + others : "") +
        (errors.length ? "\n\nLetzte Fehlermeldung:\n" + errors[errors.length - 1] : ""));
    return cut > 0;
}

function main() {
    const doc = Document.current;
    if (!doc) { say("Kein Dokument geöffnet."); return; }
    const bases = doc.selection.nodes.toArray().filter(n => !n.isSpreadNode);
    if (!bases.length) { say("Bitte zuerst die Grundgrafik auswählen\n(ein Objekt oder mehrere), die aufgeteilt werden soll.\n\nDie Balken/Messer-Objekte dabei NICHT mit auswählen."); return; }

    if (TEST_OPTS) { run(doc, bases, Object.assign({}, DEFAULTS, TEST_OPTS)); return; }

    const init = loadSettings(DEFAULTS);
    const dlg = buildDialog(init);
    if (!isOk(dlg.runModal())) return;
    const c = dlg.colour.value;
    const state = { mode: dlg.mode.selectedIndex, colour: c ? c.rgba8 : DEFAULTS.colour };
    saveSettings(state);                                // zuletzt eingegebene Werte merken – vor dem Lauf, unabhängig vom Ergebnis
    run(doc, bases, state);
}

try {
    main();
} catch (err) {
    say("Fehler: " + err.message + (err.stack ? "\n\n" + err.stack.split("\n").slice(0, 4).join("\n") : ""));
}
