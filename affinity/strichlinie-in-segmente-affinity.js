// ============================================================================
// Strichlinie-in-Segmente-Affinity.js — Affinity (Designer · Photo · Publisher 3.x)
// Version 1.0
// ----------------------------------------------------------------------------
// Zerlegt gestrichelte Kurven in einzelne, offene Kurvensegmente: Jeder
// sichtbare Strich wird eine eigene Kurve MIT KONTUR – keine Fläche (im
// Gegensatz zu „Kontur erweitern“). Neubau des Illustrator-Scripts
// „Strichlinie_in_Segmente.jsx“.
//
//   • Kurven bleiben echte Bézierkurven (exakt an der Bogenlänge geteilt,
//     nicht in Polygone zerlegt)
//   • Konturfarbe, -stärke, Abschluss, Ecken, Gehrungsgrenze, Deckkraft und
//     Mischmodus werden übernommen; das Strichmuster wird auf „durchgehend“
//     gesetzt
//   • funktioniert auch in Gruppen/Ebenen und bei Formen (Rechteck, Ellipse …)
//   • geschlossene Kurven: ein Strich, der über den Startpunkt läuft, wird
//     zu EINEM Segment verbunden
//   • Strichlänge 0 (Punktlinie mit rundem Abschluss) wird als Mini-Segment
//     angelegt
//   • Affinitys „ausgeglichene Striche“ (Muster an die Länge angepasst,
//     halbe Striche an den Enden) werden angenähert
//
// Hinweis: Affinity rechnet Strichmuster in Vielfachen der Konturbreite –
// ein Muster „3 1“ bei 2 pt Kontur ergibt 6 pt Strich und 2 pt Lücke.
// Das Ersatzmuster im Dialog verwendet dieselbe Einheit.
//
// Verwendung: Kurven auswählen > Script im Panel „Skripte“ ausführen
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

'use strict';

const { Application } = require('/application.js');
const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { ContainerNodeDefinition, PolyCurveNodeDefinition, NodeChildType } = require('/nodes.js');
const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, InsertionMode } = require('/commands.js');
const { Curve, CurveBuilder, PolyCurve } = require('/geometry.js');
const { FillDescriptor, BlendMode } = require('/fills.js');
const { LineStyle, LineType } = require('/linestyle.js');
const { Selection } = require('/selections.js');
const { File, fs } = require('/fs.js');

const VERSION       = "1.0";
const TITLE         = "Strichlinie → Einzelsegmente";
const SETTINGS_FILE = "dwbkd-Scripte-Einstellungen.json";
const SETTINGS_KEY  = "strichlinieSegmente";
const EPS           = 1e-6;         // Rechentoleranz in px
const DOT           = 0.01;         // Länge (px) für „Punkte“ bei Strichlänge 0
const MAX_DASHES    = 50000;        // Notbremse gegen versehentlich winzige Muster

// Für automatisierte Tests: vorher definiertes __STR_OPTS übergeht den Dialog.
const TEST_OPTS = (typeof __STR_OPTS === 'object' && __STR_OPTS) ? __STR_OPTS : null;

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
const DEFAULTS = { fallback: "", group: true, removeOriginal: true };

// ---------------------------------------------------------------- Geometrie
// Teilstück einer Kurve zwischen den Bogenlängen a und b (0 ≤ a < b ≤ Länge)
function subCurve(cv, a, b) {
    let c = cv;
    if (b < c.length - EPS) c = c.cut(false, b).curveA;
    if (a > EPS) c = c.cut(false, a).curveB;
    return c;
}

// Bézier-Segmente einer (offenen) Kurve
function beziersOf(cv) {
    const out = [];
    for (let i = cv.firstOnCurvePointIndex; i < cv.lastOnCurvePointIndex; i = cv.getNextOnCurvePointIndex(i, false))
        out.push(cv.getCubicBezier(i));
    return out;
}

// Mehrere Kurvenstücke zu einer durchgehenden Kurve verbinden
function joinPieces(pieces) {
    const cb = CurveBuilder.create();
    let started = false;
    for (const p of pieces) {
        for (const b of beziersOf(p)) {
            if (!started) { cb.begin({ x: b.start.x, y: b.start.y }); started = true; }
            cb.addBezier({ x: b.c1.x, y: b.c1.y }, { x: b.c2.x, y: b.c2.y }, { x: b.end.x, y: b.end.y });
        }
    }
    return started ? cb.createCurve() : null;
}

// Strichmuster entlang der Gesamtlänge -> Liste {a, b} der sichtbaren Striche.
// pattern in px (gerade Anzahl), phase in px; balanced = Affinitys
// „ausgeglichene Striche“: Muster wird so gestreckt, dass es ganzzahlig auf
// die Länge passt, und beginnt mit einem halben Strich.
function dashIntervals(total, pattern, phase, closed, balanced) {
    let pat = pattern.slice();
    let plen = pat.reduce((s, v) => s + v, 0);
    let offset = phase;
    if (balanced && plen > EPS) {
        const n = Math.max(1, Math.round(total / plen));
        const scale = total / (n * plen);
        pat = pat.map(v => v * scale);
        plen = total / n;
        offset = -pat[0] / 2;                             // halber Strich am Anfang
    }
    const res = [];
    let k = 0;
    let pos = -(((offset % plen) + plen) % plen);
    while (pos < total - EPS) {
        const len = pat[k];
        if (k % 2 === 0) {                                // gerade Indizes = Strich
            if (len < EPS) {
                if (pos >= -EPS) res.push({ a: Math.max(pos, 0), b: Math.max(pos, 0), dot: true });
            } else {
                const a = Math.max(pos, 0), b = Math.min(pos + len, total);
                if (b - a > EPS) res.push({ a, b });
            }
            if (res.length > MAX_DASHES) throw new Error("Mehr als " + MAX_DASHES + " Striche – Muster prüfen.");
        }
        pos += len;
        k = (k + 1) % pat.length;
    }
    if (closed && res.length > 1) {                       // Strich über den Startpunkt verbinden
        const f = res[0], l = res[res.length - 1];
        if (!f.dot && !l.dot && f.a < EPS && l.b > total - EPS) {
            res.shift();
            l.b = total + f.b;
        }
    }
    if (closed && res.length === 1 && !res[0].dot && res[0].a < EPS && res[0].b > total - EPS)
        res[0].full = true;                               // Strich länger als der ganze Pfad
    return res;
}

function cleanPattern(arr) {
    if (!arr || !arr.length) return null;
    let p = arr.map(v => { const n = Number(v); return (isNaN(n) || n < 0) ? 0 : n; });
    if (p.reduce((s, v) => s + v, 0) < EPS) return null;
    if (p.length % 2) p = p.concat(p);                    // ungerade Anzahl: Muster wiederholen
    return p;
}

function parsePattern(text) {
    const txt = String(text || "").trim();
    if (!txt) return null;
    const nums = txt.split(/[;\s\/]+/).filter(s => s !== "").map(s => parseFloat(s.replace(",", ".")));
    return cleanPattern(nums);
}

// ------------------------------------------------------------------ Sammeln
function collect(list, out) {
    for (const n of list) {
        if (n.isSpreadNode) { collect(n.children.toArray(), out); continue; }
        if (!n.isVisible || !n.isEditable) continue;
        if (n.isArtboardEnabled) { collect(n.children.toArray(), out); continue; }
        if (n.isShapeNode || n.isPolyCurveNode) {
            if (n.children.length > 0) collect(n.children.toArray(), out);
            if (n.hasPenFill && n.lineWeight > 0) out.push(n);
        } else if (n.isGroupNode || n.isContainerNode) {
            collect(n.children.toArray(), out);
        }
    }
}

// Einfügeposition direkt über einem Objekt
function placeAbove(builder, node) {
    const next = node.nextSibling;
    if (next) { builder.setInsertionTarget(next); builder.setInsertionMode(InsertionMode.Behind); }
    else {
        const parent = node.parent;
        builder.setInsertionTarget((parent && !parent.isDocumentNode) ? parent : node.document.currentSpread);
        builder.setInsertionMode(InsertionMode.Inside_AtBack);
    }
}

// ------------------------------------------------------ Einen Pfad zerlegen
// Liefert { count, nodes } oder null (übersprungen)
function processNode(doc, node, opts) {
    const ls = node.lineStyleDescriptor.lineStyle;
    const weight = node.lineWeight;
    let pattern = null;
    if (ls.type.value === LineType.Dash.value) pattern = cleanPattern(Array.from(ls.dashPattern).map(v => v * weight));
    if (!pattern && opts.fallback) pattern = opts.fallback.map(v => v * weight);
    if (!pattern) return null;
    const phase = (Number(ls.dashPhase) || 0) * weight;
    const balanced = !!ls.hasBalancedDashes;

    // Kurven in Seitenkoordinaten (dann stimmen Längen und Strichmaße)
    const xf = node.baseToSpreadTransform;
    const dashes = [];
    const pc = node.polyCurve;
    for (let ci = 0; ci < pc.curveCount; ci++) {
        const cv = pc.at(ci).clone();
        cv.transform(xf);
        const total = cv.length;
        if (total < EPS) continue;
        const closed = cv.isClosed;
        for (const d of dashIntervals(total, pattern, phase, closed, balanced)) {
            if (d.full) { dashes.push(cv.clone()); continue; }
            let a = d.a, b = d.b;
            if (d.dot) { a = Math.max(0, d.a - DOT / 2); b = Math.min(total, a + DOT); }
            let piece;
            if (b > total + EPS) {                            // Umlauf über den Startpunkt
                piece = joinPieces([subCurve(cv, a, total), subCurve(cv, 0, b - total)]);
            } else {
                piece = subCurve(cv, a, b);
            }
            if (piece && !piece.isEmpty) dashes.push(piece);
        }
    }
    if (!dashes.length) return null;

    // Kontur übernehmen, Muster auf durchgehend
    const solid = LineStyle.create({
        cap: ls.cap, join: ls.join, type: LineType.Solid, weight: weight,
        miterLimit: ls.miterLimit, resIndependent: ls.isResolutionIndependent, balancedDashes: false
    });
    const lineDesc = node.lineStyleDescriptor.cloneWithNewLineStyle(solid);
    const penFill = node.penFillDescriptor.clone();
    const noFill = FillDescriptor.createNone();

    const cb = CompoundCommandBuilder.create();
    if (opts.group) {
        const lb = AddChildNodesCommandBuilder.create();
        placeAbove(lb, node);
        lb.addNode(ContainerNodeDefinition.create("Striche" + (node.userDescription ? " – " + node.userDescription : "")));
        cb.addCommand(lb.createCommand(true), true);
    }
    const db = AddChildNodesCommandBuilder.create();
    if (opts.group) db.setInsertionMode(InsertionMode.Inside_AtBack);
    else placeAbove(db, node);
    let n = 0;
    for (const c of dashes) {
        const p = PolyCurve.create();
        p.addCurve(c);
        const def = PolyCurveNodeDefinition.create(p, noFill, penFill, lineDesc, noFill);
        def.userDescription = "Strich " + (++n);
        db.addNode(def);
    }
    cb.addCommand(db.createCommand(true));
    // Deckkraft und Mischmodus des Originals auf die neuen Striche
    if (node.globalOpacity < 0.9999) cb.addCommand(DocumentCommand.createSetOpacity(null, node.globalOpacity));
    if (node.blendMode.value !== BlendMode.Normal.value) cb.addCommand(DocumentCommand.createSetBlendMode(null, node.blendMode));
    const cmd = cb.createCommand();
    doc.executeCommand(cmd);
    // newNodes gibt es nur am ausgeführten Compound, nicht an seinen Teilbefehlen
    return { count: dashes.length, nodes: cmd.newNodes.filter(n => n.isPolyCurveNode) };
}

// ------------------------------------------------------------------- Dialog
function buildDialog(init) {
    const dlg = Dialog.create(TITLE + "  ·  v" + VERSION);
    const col = dlg.addColumn();
    const g1 = col.addGroup("Ersatzmuster (nur für Kurven ohne Strichelung)");
    dlg.fallback = g1.addTextBox("Strich Lücke … in Konturbreiten", init.fallback);
    g1.addStaticText("", "z. B. „3 1“ oder „2,5; 1“ – leer = solche Kurven überspringen");
    const g2 = col.addGroup("Optionen");
    dlg.group  = g2.addSwitch("Striche je Kurve in eine Ebene „Striche“ zusammenfassen", init.group);
    dlg.remove = g2.addSwitch("Originalkurve löschen", init.removeOriginal);
    dlg.initialWidth = 520;
    return dlg;
}

// ---------------------------------------------------------------- Hauptteil
function run(doc, selNodes, s) {
    const opts = { fallback: parsePattern(s.fallback), group: !!s.group, removeOriginal: !!s.removeOriginal };
    if (String(s.fallback || "").trim() && !opts.fallback) say("Ersatzmuster ungültig – wird ignoriert.");

    const jobs = [];
    collect(selNodes, jobs);
    if (!jobs.length) { say("In der Auswahl sind keine Kurven mit Kontur."); return false; }

    let paths = 0, dashes = 0, skipped = 0;
    const errors = [], result = [], done = [];
    for (const node of jobs) {
        try {
            const r = processNode(doc, node, opts);
            if (r) { paths++; dashes += r.count; done.push(node); for (const x of r.nodes) result.push(x); }
            else skipped++;
        } catch (e) { skipped++; errors.push(e.message); }
    }
    if (opts.removeOriginal && done.length) {
        try { doc.executeCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, done))); } catch (e) { errors.push(e.message); }
    }
    try { if (result.length) doc.selection = Selection.create(doc, result); } catch (e) { }

    let msg = paths + " Kurve(n) in " + dashes + " Einzelstriche zerlegt.";
    if (skipped) msg += "\n" + skipped + " Kurve(n) übersprungen (keine Strichelung und kein Ersatzmuster).";
    if (errors.length) msg += "\nFehler: " + errors[0];
    say(msg);
    return paths > 0;
}

function main() {
    const doc = Document.current;
    if (!doc) { say("Kein Dokument geöffnet."); return; }
    const selNodes = doc.selection.nodes.toArray().filter(n => !n.isSpreadNode);
    if (!selNodes.length) { say("Bitte zuerst die gestrichelten Kurven auswählen."); return; }

    if (TEST_OPTS) { run(doc, selNodes, Object.assign({}, DEFAULTS, TEST_OPTS)); return; }

    const init = loadSettings(DEFAULTS);
    const dlg = buildDialog(init);
    if (!isOk(dlg.runModal())) return;
    const state = { fallback: dlg.fallback.text, group: dlg.group.value, removeOriginal: dlg.remove.value };
    saveSettings(state);                                // zuletzt eingegebene Werte merken – vor dem Lauf, unabhängig vom Ergebnis
    run(doc, selNodes, state);
}

try {
    main();
} catch (err) {
    say("Fehler: " + err.message + (err.stack ? "\n\n" + err.stack.split("\n").slice(0, 4).join("\n") : ""));
}
