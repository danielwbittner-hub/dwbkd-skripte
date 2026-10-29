// ============================================================================
// Flaechen-Vereinen-Affinity.js  —  Affinity (Designer · Photo · Publisher 3.x)
// Version 1.0
// ----------------------------------------------------------------------------
// Vereint nebeneinanderliegende oder überlappende Flächen („Hinzufügen“) zu
// möglichst wenigen Objekten — z. B. QR-Codes, Pixel-Grafiken oder gerasterte
// Motive, damit beim Plotten/Cutten/Lasern nicht hunderte Einzelquadrate
// geschnitten werden, sondern eine zusammenhängende Fläche.
// Neubau des Illustrator-Scripts „Flaechen-Vereinen.jsx“.
//
// Funktionen:
//   • Bereich: nur Auswahl oder gesamtes Dokument (sichtbar & bearbeitbar)
//   • Getrennt nach Farbe vereinen: gleiche Füllfarbe = eine Fläche, damit
//     mehrfarbige Motive (z. B. Logo + QR) ihre Farben behalten
//   • Haarlinien-Lücken schließen: jede Fläche wird vor dem Vereinen minimal
//     vergrößert (Standard 0,02 mm je Seite). QR-Codes aus SVG-Generatoren
//     haben durch Rundungsfehler oft winzige Spalte zwischen den Modulen —
//     ohne diesen Schritt bleiben sie als doppelte Schnittlinien stehen.
//   • Originale behalten: vereint wahlweise eine Kopie auf einer neuen
//     Ebene „Vereint“, das Original bleibt unangetastet
//   • Leere Restgruppen werden nach dem Vereinen aufgeräumt
//   • Die letzten Einstellungen werden gemerkt
//     (Datei: Desktop/dwbkd-Scripte-Einstellungen.json)
//
// Verwendung:
//   1. Objekte auswählen (oder nichts auswählen = ganzes Dokument)
//   2. Script im Panel „Skripte“ ausführen
//   3. Optionen einstellen, „OK“
//
// Hinweise:
//   • Text vorher in Kurven umwandeln; Textobjekte werden übersprungen
//     und im Ergebnis gemeldet.
//   • Konturen bleiben Konturen — sollen Konturstärken mitgeschnitten
//     werden, vorher Ebene > Kontur erweitern anwenden.
//   • Rückgängig braucht mehrere Schritte (Cmd+Z mehrfach).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

'use strict';

const { Application } = require('/application.js');
const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { ContainerNodeDefinition, NodeChildType } = require('/nodes.js');
const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, InsertionMode, NodeMoveType } = require('/commands.js');
const { Transform } = require('/geometry.js');
const { FillType } = require('/fills.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');
const { File, fs } = require('/fs.js');

const VERSION       = "1.0";
const TITLE         = "Flächen vereinen";
const SETTINGS_FILE = "dwbkd-Scripte-Einstellungen.json";
const SETTINGS_KEY  = "flaechenVereinen";

// Für automatisierte Tests: vorher definiertes __VER_OPTS übergeht den Dialog.
const TEST_OPTS = (typeof __VER_OPTS === 'object' && __VER_OPTS) ? __VER_OPTS : null;

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
const DEFAULTS = { scopeAll: false, byColor: true, gap: true, gapMM: 0.02, keep: false };

// ------------------------------------------------------------------ Farben
// Lesbarer Schlüssel je Füllung — dient gleichzeitig als Gruppenname.
function colourKey(colour) {
    if (!colour) return "keine";
    const c = colour.rgba8;
    return c.r + "/" + c.g + "/" + c.b + (c.alpha < 255 ? "/" + c.alpha : "");
}
function fillKey(desc) {
    try {
        const fill = desc.fill;
        if (!fill || fill.fillType.value === FillType.None.value) return null;
        if (fill.fillType.value === FillType.Solid.value) return colourKey(fill.colour);
        return String(fill.fillType.keys ? fill.fillType : fill.fillType);   // Verlauf, Bitmap …
    } catch (e) { return null; }
}
// Gruppenschlüssel eines Objekts: Füllung vor Kontur, sonst „unbemalt“.
function paintKey(n) {
    const f = fillKey(n.brushFillDescriptor);
    if (f) return "Fläche " + f;
    const s = fillKey(n.penFillDescriptor);
    if (s) return "Kontur " + s;
    return "unbemalt";
}

// ------------------------------------------------------------------ Sammeln
// Rekursiv alle geeigneten Formen/Kurven einsammeln. Übersprungen: unsichtbar,
// gesperrt, Zeichenflächen, Text (gemeldet) und Sonstiges (Bilder …).
function collect(list, out, skipped) {
    for (const n of list) {
        if (n.isSpreadNode) { collect(n.children.toArray(), out, skipped); continue; }
        if (!n.isVisible || !n.isEditable) continue;
        if (n.isArtboardEnabled) { collect(n.children.toArray(), out, skipped); continue; }
        if (n.isShapeNode || n.isPolyCurveNode) {
            if (n.children.length > 0) collect(n.children.toArray(), out, skipped);   // Kinder = beschnittene Objekte
            out.push(n);
        } else if (n.isGroupNode || n.isContainerNode) {
            collect(n.children.toArray(), out, skipped);
        } else if (n.isTextNode) {
            skipped.text++;
        } else {
            skipped.other++;
        }
    }
}

// Fläche um delta (px) je Seite vergrößern — schließt Haarlinien-Lücken.
function overlapTransform(n, delta) {
    const b = n.getSpreadBaseBox();
    if (b.width < 0.001 || b.height < 0.001) return null;      // Linien ohne Fläche auslassen
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    return Transform.createTranslate(cx, cy)
        .multiply(Transform.createScale((b.width + 2 * delta) / b.width, (b.height + 2 * delta) / b.height))
        .multiply(Transform.createTranslate(-cx, -cy));
}

// „Hinzufügen“ auf eine Objektliste; arbeitet verlässlich auf der
// aktuellen Dokumentauswahl. Liefert die entstandenen Objekte.
function unite(doc, items) {
    doc.selection = Selection.create(doc, items);
    doc.executeCommand(DocumentCommand.createBoolOpUnion(null));
    return doc.selection.nodes.toArray();
}

function uniqueLayerName(doc, base) {
    const names = new Set(doc.currentSpread.children.toArray().map(n => n.userDescription));
    if (!names.has(base)) return base;
    for (let i = 2; i < 100; i++) if (!names.has(base + " " + i)) return base + " " + i;
    return base + " " + (Date.now() % 1000);
}

// ------------------------------------------------------------------- Dialog
function buildDialog(doc, init, selCount) {
    const pxPerMM = doc.dpi / 25.4;
    const dlg = Dialog.create(TITLE + "  ·  v" + VERSION);
    const col = dlg.addColumn();
    const gScope = col.addGroup("Bereich");
    dlg.scope = gScope.addRadioGroup("", [
        "Nur Auswahl (" + selCount + " Objekt" + (selCount === 1 ? "" : "e") + ")",
        "Gesamtes Dokument (sichtbar und bearbeitbar)"
    ], (selCount > 0 && !init.scopeAll) ? 0 : 1);
    if (selCount === 0) dlg.scope.isEnabled = false;

    const gOpt = col.addGroup("Optionen");
    dlg.byColor = gOpt.addSwitch("Getrennt nach Farbe vereinen (gleiche Füllung = eine Fläche)", init.byColor);
    dlg.gap     = gOpt.addSwitch("Haarlinien-Lücken schließen", init.gap);
    dlg.gapMM   = gOpt.addUnitValueEditor("Vergrößerung je Seite", UnitType.Pixel, doc.units, init.gapMM * pxPerMM, 0, 5 * pxPerMM).setPrecision(3);
    dlg.keep    = gOpt.addSwitch("Originale behalten (vereinte Kopie auf neuer Ebene „Vereint“)", init.keep);
    gOpt.addStaticText("", "Hinweis: Text vorher in Kurven umwandeln.");

    const sync = () => { dlg.gapMM.isEnabled = dlg.gap.value; };
    dlg.gap.onValueChangedHandler = sync;
    sync();
    dlg.initialWidth = 520;
    return dlg;
}

function readState(dlg, doc) {
    const pxPerMM = doc.dpi / 25.4;
    return { scopeAll: dlg.scope.selectedIndex === 1, byColor: dlg.byColor.value, gap: dlg.gap.value, gapMM: dlg.gapMM.value / pxPerMM, keep: dlg.keep.value };
}

// ---------------------------------------------------------------- Hauptteil
function run(doc, selNodes, s) {
    const pxPerMM = doc.dpi / 25.4;
    const overlap = s.gap ? Math.max(0, s.gapMM) * pxPerMM : 0;

    let items = [];
    const skipped = { text: 0, other: 0 };
    collect(s.scopeAll || selNodes.length === 0 ? [doc.currentSpread] : selNodes, items, skipped);

    if (items.length < 2) {
        say("Zu wenige geeignete Flächen gefunden (" + items.length + ")." +
            (skipped.text ? "\nÜbersprungene Textobjekte: " + skipped.text + " — bitte vorher in Kurven umwandeln." : ""));
        return false;
    }
    const before = items.length;

    // „Originale behalten“: alles auf eine neue Ebene duplizieren, nur Kopien vereinen
    if (s.keep) {
        const lb = AddChildNodesCommandBuilder.create();
        lb.setInsertionTarget(doc.currentSpread);
        lb.setInsertionMode(InsertionMode.Inside_AtBack);
        lb.addNode(ContainerNodeDefinition.create(uniqueLayerName(doc, "Vereint")));
        const addCmd = lb.createCommand(false);
        doc.executeCommand(addCmd);
        const layer = addCmd.newNodes[0];
        const dup = DocumentCommand.createTransform(Selection.create(doc, items), Transform.createIdentity(), { duplicateNodes: true });
        doc.executeCommand(dup);
        items = dup.newNodes;
        doc.executeCommand(DocumentCommand.createMoveNodes(Selection.create(doc, items), layer, NodeMoveType.Inside, NodeChildType.Main));
    }

    // Nach Farbe (oder alles in eine) gruppieren
    const groups = new Map();
    for (const n of items) {
        const key = s.byColor ? paintKey(n) : "alle Flächen";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
    }

    // Elterngruppen merken, um leere Reste später zu entfernen
    const parents = [];
    const remember = (p) => { if (p && p.isGroupNode && !parents.some(q => q.isSameNode(p))) parents.push(p); };

    const results = [];
    let unitedGroups = 0, singles = 0;
    for (const [key, list] of groups) {
        if (list.length < 2) { singles++; results.push(list[0]); continue; }
        for (const n of list) remember(n.parent);
        if (overlap > 0) {
            const cb = CompoundCommandBuilder.create();
            let any = false;
            for (const n of list) {
                const xf = overlapTransform(n, overlap);
                if (xf) { cb.addCommand(DocumentCommand.createTransform(Selection.create(doc, n), xf)); any = true; }
            }
            if (any) doc.executeCommand(cb.createCommand());
        }
        for (const r of unite(doc, list)) results.push(r);
        unitedGroups++;
    }

    // Leergewordene Gruppen aufräumen (nach oben durchreichen)
    const empties = [];
    for (let g of parents) {
        try {
            while (g && g.isGroupNode && g.children.length === 0) {
                if (!empties.some(q => q.isSameNode(g))) empties.push(g);
                g = g.parent;
            }
        } catch (e) { /* Referenz ungültig */ }
    }
    if (empties.length) { try { doc.executeCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, empties))); } catch (e) {} }

    try { doc.selection = Selection.create(doc, results); } catch (e) {}

    let msg = "Fertig.\n\nVorher:   " + before + " Flächen\nNachher: " + results.length + " Objekt" + (results.length === 1 ? "" : "e");
    if (s.byColor && unitedGroups > 1) msg += "  (" + unitedGroups + " Farbgruppen)";
    if (singles > 0) msg += "\nUnverändert (einzeln in ihrer Farbgruppe): " + singles;
    if (skipped.text > 0) msg += "\n\nÜbersprungene Textobjekte: " + skipped.text + "\n(vorher in Kurven umwandeln, dann erneut ausführen)";
    if (s.keep) msg += "\n\nDas Ergebnis liegt auf der neuen Ebene „Vereint“.";
    say(msg);
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
