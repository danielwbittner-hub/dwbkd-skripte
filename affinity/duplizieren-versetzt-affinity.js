// ============================================================================
// Duplizieren-Versetzt-Affinity.js  —  Affinity (Designer · Photo · Publisher 3.x)
// Version 1.0
// ----------------------------------------------------------------------------
// Bringt InDesigns „Bearbeiten > Duplizieren und versetzt einfügen“ (Step and
// Repeat) nach Affinity: Das ausgewählte Objekt — oder mehrere zusammen — wird
// vervielfältigt und dabei um einen festen Betrag versetzt, wahlweise als Reihe
// oder als Raster. Neubau des Illustrator-Scripts „Duplizieren-Versetzt.jsx“.
//
// Dialog:
//   • Als Raster erstellen — Zeilen und Spalten statt einer einfachen Anzahl
//   • Anzahl / Zeilen / Spalten zählen wie in InDesign die WIEDERHOLUNGEN,
//     das Original ist immer zusätzlich dabei. Die Zeile „Ergebnis“ zeigt
//     jederzeit, wie viele Objekte am Ende herauskommen.
//   • Versatz vertikal und horizontal in der Maßeinheit des Dokuments.
//     Positive Werte versetzen nach rechts bzw. nach unten — wie in InDesign.
//   • Vorschau live im Dokument (wie InDesign), ab 400 Kopien automatisch aus
//
// Zusätzlich zu InDesign:
//   • „Versatz als Abstand zwischen den Objekten“ — der eingegebene Wert ist
//     dann der Zwischenraum, die Objektbreite bzw. -höhe wird automatisch
//     dazugerechnet (praktisch für Nutzen-Montage). Reine Reihe: Raster mit
//     Zeilen = 0, reine Spalte: Raster mit Spalten = 0.
//   • „Kopien mit Original zusammenfassen“ — alles wandert in eine neue
//     Ebene „Duplikate“ (Affinitys Gegenstück zur Gruppe per Script)
//   • Die letzten Einstellungen werden gemerkt
//     (Datei: Desktop/dwbkd-Scripte-Einstellungen.json – Affinity erlaubt
//     Scripten nur den Zugriff auf den Schreibtisch)
//
// Verwendung:
//   1. Objekt(e) auswählen
//   2. Script im Panel „Skripte“ ausführen
//   3. Werte eingeben, „OK“
//
// Hinweise:
//   • Die Kopien landen im selben Container wie das Original und sind danach
//     ausgewählt — wie in InDesign. Ein Durchlauf = ein Rückgängig-Schritt
//     (mit „zusammenfassen“: zwei).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

'use strict';

const { Application } = require('/application.js');
const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { ContainerNodeDefinition, NodeChildType } = require('/nodes.js');
const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, InsertionMode, NodeMoveType } = require('/commands.js');
const { Transform, unionRects } = require('/geometry.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');
const { File, fs } = require('/fs.js');

const VERSION       = "1.0";
const TITLE         = "Duplizieren und versetzt einfügen";
const SETTINGS_FILE = "dwbkd-Scripte-Einstellungen.json";   // gemeinsam für alle dwbkd-Scripte
const SETTINGS_KEY  = "duplizierenVersetzt";
const PREVIEW_MAX   = 400;      // ab so vielen Kopien keine Live-Vorschau mehr
const WARN_MAX      = 2000;     // ab so vielen Objekten nachfragen

// Für automatisierte Tests: vorher definiertes __DUP_OPTS übergeht den Dialog.
const TEST_OPTS = (typeof __DUP_OPTS === 'object' && __DUP_OPTS) ? __DUP_OPTS : null;

function say(msg) { Application.alert(msg, TITLE); }
function ask(msg) { return Application.confirm(msg, TITLE); }
function isOk(result) { return (result?.value ?? result) == DialogResult.Ok.value; }

// ------------------------------------------------------- Einstellungen merken
function settingsPath() { return Application.userDesktopPath + "/" + SETTINGS_FILE; }

function loadSettings(defaults) {
    try {
        const p = settingsPath();
        if (!fs.exists(p)) return Object.assign({}, defaults);
        const all = JSON.parse(File.readAll(p).toString());
        return Object.assign({}, defaults, (all && all[SETTINGS_KEY]) || {});
    } catch (e) {
        return Object.assign({}, defaults);              // kein Desktop-Zugriff: Standardwerte
    }
}

function saveSettings(values) {
    try {
        const p = settingsPath();
        let all = {};
        if (fs.exists(p)) { try { all = JSON.parse(File.readAll(p).toString()) || {}; } catch (e) { all = {}; } }
        all[SETTINGS_KEY] = values;
        const f = File.create(p, "w");
        f.writeString(JSON.stringify(all, null, 1));
        f.close();
    } catch (e) {
        say("Die zuletzt eingegebenen Werte konnten nicht gespeichert werden –\nAffinity erlaubt diesem Script keinen Zugriff auf den Schreibtisch.\n\nAbhilfe: Affinity → Einstellungen → Skripte: für dieses Script\nden Zugriff auf Dateien auf dem Desktop erlauben.\n\nDatei: " + settingsPath() + "\n" + e.message);
    }
}

const DEFAULTS = { grid: false, count: 1, rows: 1, cols: 1, oxMM: 0, oyMM: 0, gap: false, group: false, preview: true };

// --------------------------------------------------------------- Kopien bauen
// Versatz in Spread-Pixeln; positives dy = nach unten (Affinity-y zeigt nach unten).
function positions(o) {
    const pos = [];
    if (o.grid) {
        for (let r = 0; r <= o.rows; r++)
            for (let c = 0; c <= o.cols; c++) {
                if (r === 0 && c === 0) continue;             // das Original
                pos.push([c * o.stepX, r * o.stepY]);
            }
    } else {
        for (let i = 1; i <= o.count; i++) pos.push([i * o.stepX, i * o.stepY]);
    }
    return pos;
}

function createCopiesCommand(selection, o) {
    const pos = positions(o);
    if (pos.length === 0) return null;
    const cb = CompoundCommandBuilder.create();
    for (const [dx, dy] of pos)
        cb.addCommand(DocumentCommand.createTransform(selection, Transform.createTranslate(dx, dy), { duplicateNodes: true }));
    return cb.createCommand();
}

// Dialogwerte -> Laufzeit-Optionen
function makeOptions(s, doc, bounds) {
    const pxPerMM = doc.dpi / 25.4;
    const grid  = !!s.grid;
    const count = Math.max(0, Math.round(s.count || 0));
    const rows  = Math.max(0, Math.round(s.rows  || 0));
    const cols  = Math.max(0, Math.round(s.cols  || 0));
    const ox = (s.oxMM || 0) * pxPerMM, oy = (s.oyMM || 0) * pxPerMM;
    const stepX = (s.gap && bounds) ? bounds.width  + ox : ox;
    const stepY = (s.gap && bounds) ? bounds.height + oy : oy;
    const copies = grid ? ((rows + 1) * (cols + 1) - 1) : count;
    return { grid, count, rows, cols, stepX, stepY, copies, group: !!s.group, preview: s.preview !== false };
}

// ------------------------------------------------------------------- Dialog
function buildDialog(doc, init, nodeCount) {
    const pxPerMM = doc.dpi / 25.4;
    const dlg = Dialog.create(TITLE + "  ·  v" + VERSION);
    const col = dlg.addColumn();
    const num = (group, label, value, min, max) =>
        group.addUnitValueEditor(label, UnitType.Number, UnitType.Number, value, min, max).setPrecision(0);

    const gRep = col.addGroup("Wiederholen");
    dlg.grid  = gRep.addSwitch("Als Raster erstellen", init.grid);
    dlg.count = num(gRep, "Anzahl Kopien", init.count, 0, 10000);
    dlg.rows  = num(gRep, "Zusätzliche Zeilen", init.rows, 0, 1000);
    dlg.cols  = num(gRep, "Zusätzliche Spalten", init.cols, 0, 1000);

    const gOff = col.addGroup("Versatz");
    dlg.oy  = gOff.addUnitValueEditor("Vertikal", UnitType.Pixel, doc.units, init.oyMM * pxPerMM).setNoMinValue().setNoMaxValue().setPrecision(2);
    dlg.ox  = gOff.addUnitValueEditor("Horizontal", UnitType.Pixel, doc.units, init.oxMM * pxPerMM).setNoMinValue().setNoMaxValue().setPrecision(2);
    dlg.gap = gOff.addSwitch("Versatz als Abstand zwischen den Objekten", init.gap);
    dlg.hint = gOff.addStaticText("", "");

    const gOpt = col.addGroup("Optionen");
    dlg.group   = gOpt.addSwitch("Kopien mit Original zusammenfassen (neue Ebene „Duplikate“)", init.group);
    dlg.preview = gOpt.addSwitch("Vorschau", init.preview);
    dlg.total   = gOpt.addStaticText("", "");

    dlg.syncEnable = () => {
        const g = dlg.grid.value;
        dlg.count.isEnabled = !g;
        dlg.rows.isEnabled = dlg.cols.isEnabled = g;
        dlg.hint.text = dlg.gap.value
            ? "Objektgröße wird dazugerechnet · reine Reihe: Raster mit Zeilen = 0"
            : "Positive Werte versetzen nach rechts bzw. nach unten.";
    };
    dlg.syncEnable();
    dlg.initialWidth = 520;
    return dlg;
}

function readState(dlg, doc) {
    const pxPerMM = doc.dpi / 25.4;
    return {
        grid: dlg.grid.value, count: dlg.count.value, rows: dlg.rows.value, cols: dlg.cols.value,
        oxMM: dlg.ox.value / pxPerMM, oyMM: dlg.oy.value / pxPerMM,
        gap: dlg.gap.value, group: dlg.group.value, preview: dlg.preview.value
    };
}

// ---------------------------------------------------------------- Hauptteil
// Führt die Kopie aus (ohne Vorschau), wählt die Kopien aus und fasst sie
// auf Wunsch mit dem Original in einer neuen Ebene zusammen.
function commit(doc, nodes, selection, o) {
    const cmd = createCopiesCommand(selection, o);
    if (!cmd) { say("Mit diesen Werten entstehen keine Kopien."); return false; }
    const total = (o.copies + 1) * nodes.length;
    if (total > WARN_MAX && !ask("Es entstehen " + (o.copies * nodes.length) + " neue Objekte.\nFortfahren?")) return false;

    doc.executeCommand(cmd);
    const copies = cmd.newNodes;
    const all = nodes.concat(copies);

    if (o.group) {
        // Neue Ebene zuoberst im Container des Originals, dann alles hineinschieben
        const parent = nodes[0].parent;
        const target = (parent && !parent.isDocumentNode) ? parent : doc.currentSpread;
        const lb = AddChildNodesCommandBuilder.create();
        lb.setInsertionTarget(target);
        lb.setInsertionMode(InsertionMode.Inside_AtBack);
        lb.addNode(ContainerNodeDefinition.create("Duplikate"));
        const addCmd = lb.createCommand(false);
        doc.executeCommand(addCmd);
        const layer = addCmd.newNodes[0];
        doc.executeCommand(DocumentCommand.createMoveNodes(Selection.create(doc, all), layer, NodeMoveType.Inside, NodeChildType.Main));
        doc.selection = Selection.create(doc, layer);
    } else {
        doc.selection = Selection.create(doc, copies.length ? copies : nodes);
    }
    console.log(TITLE + ": " + copies.length + " Kopien erzeugt (" + total + " Objekte insgesamt).");
    return true;
}

function main() {
    const doc = Document.current;
    if (!doc) { say("Kein Dokument geöffnet."); return; }
    const selection = doc.selection;
    const nodes = selection.nodes.toArray().filter(n => !n.isSpreadNode);
    if (nodes.length === 0) { say("Bitte zuerst ein Objekt auswählen."); return; }
    const bounds = nodes.map(n => n.getSpreadVisibleBox()).reduce((a, b) => unionRects(a, b));

    if (TEST_OPTS) { commit(doc, nodes, selection, makeOptions(TEST_OPTS, doc, bounds)); return; }

    const init = loadSettings(DEFAULTS);
    const dlg = buildDialog(doc, init, nodes.length);

    let previewShown = false;
    const update = () => {
        dlg.syncEnable();
        const o = makeOptions(readState(dlg, doc), doc, bounds);
        const newItems = o.copies * nodes.length;
        dlg.total.text = (o.copies <= 0)
            ? "Ergebnis: keine Kopien"
            : "Ergebnis: " + ((o.copies + 1) * nodes.length) + " Objekte insgesamt (" + newItems + " neue Kopien)" +
              (newItems > PREVIEW_MAX ? " · Vorschau aus" : "");
        const cmd = (o.preview && o.copies > 0 && newItems <= PREVIEW_MAX) ? createCopiesCommand(selection, o) : null;
        if (cmd) { doc.executeCommand(cmd, true); previewShown = true; }
        else if (previewShown) { doc.clearPreviews(); previewShown = false; }
    };
    dlg.onControlValueChangedHandler = update;
    update();

    const result = dlg.runModal();
    if (previewShown) doc.clearPreviews();
    if (!isOk(result)) return;

    const state = readState(dlg, doc);
    saveSettings(state);                                // zuletzt eingegebene Werte merken – vor dem Lauf, unabhängig vom Ergebnis
    commit(doc, nodes, selection, makeOptions(state, doc, bounds));
}

try {
    main();
} catch (err) {
    say("Fehler: " + err.message + (err.stack ? "\n\n" + err.stack.split("\n").slice(0, 4).join("\n") : ""));
}
