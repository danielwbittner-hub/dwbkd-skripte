// ============================================================================
// Siebdruckraster-Affinity.js  —  Affinity (Designer · Photo · Publisher 3.x)
// Version 1.0
// ----------------------------------------------------------------------------
// Erzeugt aus dem ausgewählten Objekt (Bild, Vektorgrafik, Gruppe …) ein
// grobes Halbtonraster wie beim Siebdruck: dunkle Töne = große Punkte,
// helle Töne = kleine Punkte. Neubau des Illustrator-Scripts
// „Siebdruckraster.jsx“ für die Affinity-Scripting-API.
//
// Funktionen:
//   • Punktformen: Ellipse/Kreis, Quadrat, Raute, Linie (flächengleich,
//     damit alle Formen denselben Tonwert wiedergeben)
//   • Farbmodus „Einfarbig“ mit frei wählbarer Punktfarbe
//   • Farbmodus „CMYK-Separation“: 4 Auszüge mit eigenen Rasterwinkeln
//     (klassisch 15/75/0/45) auf getrennten Ebenen, multiplizierend
//   • Tonwert-Gamma zur Mitteltonkorrektur (>1 = heller, <1 = dunkler)
//   • Ausgabe wahlweise als EINE Kurve je Auszug (Füllregel „Nicht-Null“,
//     überlappende Punkte erscheinen verschmolzen) oder als einzelne Punkte
//   • Zufalls-Einflüsse (Seed-basiert, reproduzierbar): Positions-, Größen-
//     und Drehungs-Streuung sowie zufälliges Auslassen von Punkten
//   • Presets: Einstellungen speichern/laden/löschen; die zuletzt benutzten
//     Werte werden automatisch wieder vorgeschlagen
//     (Datei: Desktop/Siebdruckraster-Presets.json – Affinity erlaubt
//     Scripten nur den Zugriff auf den Schreibtisch)
//
// Verwendung:
//   1. Genau EIN Objekt auswählen (mehrere Objekte vorher gruppieren)
//   2. Script im Panel „Skripte“ ausführen
//   3. Parameter einstellen, OK
//
// Das Original bleibt erhalten; das Raster liegt auf neuen Ebenen direkt
// über dem Original. Ein Durchlauf = ein Schritt in der Rückgängig-Liste.
//
// Funktionsweise: Die Affinity-Render-Engine zeichnet das Objekt (mit allen
// Transformationen, Effekten und Kindern) in einen Pixelpuffer. Danach wird
// je Kanal ein um den Rasterwinkel gedrehtes Punktgitter über das Objekt
// gelegt; pro Zelle bestimmt der gemittelte Tonwert die Punktgröße.
// Die CMYK-Werte der Separation entstehen per Standardformel aus RGB
// (K = min(C', M', Y'), volle Schwarzerzeugung).
//
// Voraussetzung: Affinity-Einstellungen → Skripte → „Affinity-Skripte
// aktivieren“ (für Presets zusätzlich „Auf Dateien auf dem Desktop zugreifen“).
// ----------------------------------------------------------------------------
// © 2026 dwbkd · www.dwbkd.de — Alle Rechte vorbehalten.
// ============================================================================

'use strict';

const { Application } = require('/application.js');
const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { ContainerNodeDefinition, PolyCurveNodeDefinition, NodeChildType } = require('/nodes.js');
const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, InsertionMode } = require('/commands.js');
const { Curve, PolyCurve, Rectangle, Transform, WindingOrder } = require('/geometry.js');
const { FillDescriptor, BlendMode } = require('/fills.js');
const { Colour, CMYKf, RGB8 } = require('/colours.js');
const { LineStyleDescriptor } = require('/linestyle.js');
const { Selection } = require('/selections.js');
const { RasterFormat, NodeRenderingEngine } = require('/rasterobject.js');
const { UnitType } = require('/units.js');
const { File, fs } = require('/fs.js');

const VERSION     = "1.0";
const TITLE       = "Siebdruck-Raster";
const PRESET_FILE = "Siebdruckraster-Presets.json";

// Für automatisierte Tests: ein vorher definiertes Objekt __SIEB_OPTS
// (gleiche Felder wie die Dialogwerte) übergeht den Dialog.
const TEST_OPTS = (typeof __SIEB_OPTS === 'object' && __SIEB_OPTS) ? __SIEB_OPTS : null;

function say(msg)     { Application.alert(msg, TITLE); }
function ask(msg)     { return Application.confirm(msg, TITLE); }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function isOk(result) { return (result?.value ?? result) == DialogResult.Ok.value; }

// Seed-basierter Zufallsgenerator (LCG) — reproduzierbar; liefert [0, 1)
function makeRng(seed) {
    let s = Math.floor(seed) % 4294967296;
    if (s < 0) s += 4294967296;
    return function () {
        s = (1664525 * s + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

// ------------------------------------------------------------ Standardwerte
const DEFAULTS = {
    cellMM: 3, angle: 45, shape: 0, ratio: 65, gain: 115, cutoff: 4, gamma: 1,
    staggered: false, invert: false, output: 0, mask: true, hide: false,
    mode: 0, colour: { r: 0, g: 0, b: 0, alpha: 255 },
    aC: 15, aM: 75, aY: 0, aK: 45,
    rnd: false, jit: 20, siz: 15, ang: 0, drp: 0, seed: 0
};

// ------------------------------------------------------------------ Presets
// JSON-Datei auf dem Schreibtisch: { presets: { name: werte }, last: werte }
function presetPath() { return Application.userDesktopPath + "/" + PRESET_FILE; }

function loadStore() {
    const empty = { presets: {}, last: null };
    try {
        const path = presetPath();
        if (!fs.exists(path)) return empty;
        const data = JSON.parse(File.readAll(path).toString());
        if (!data || typeof data !== 'object') return empty;
        if (!data.presets || typeof data.presets !== 'object') data.presets = {};
        return data;
    } catch (e) {
        return null;                               // kein Desktop-Zugriff
    }
}

function saveStore(store) {
    try {
        const f = File.create(presetPath(), "w");
        f.writeString(JSON.stringify(store, null, 1));
        f.close();
        return true;
    } catch (e) {
        say("Presets und zuletzt eingegebene Werte konnten nicht gespeichert werden –\nAffinity erlaubt diesem Script keinen Zugriff auf den Schreibtisch.\n\nAbhilfe: Affinity → Einstellungen → Skripte: für dieses Script\nden Zugriff auf Dateien auf dem Desktop erlauben.\n\nDatei: " + presetPath() + "\n" + e.message);
        return false;
    }
}

// ------------------------------------------------------------------- Dialog
function buildDialog(doc, init, store) {
    const pxPerMM = doc.dpi / 25.4;
    const dlg = Dialog.create(TITLE + "  ·  v" + VERSION);
    const colL = dlg.addColumn();
    const colR = dlg.addColumn();

    const num = (group, label, value, min, max, prec) =>
        group.addUnitValueEditor(label, UnitType.Number, UnitType.Number, value, min, max).setPrecision(prec ?? 0);

    // --- Raster (links) ------------------------------------------------------
    const gR = colL.addGroup("Raster");
    dlg.cell   = gR.addUnitValueEditor("Rasterweite (Punktabstand)", UnitType.Pixel, doc.units,
                                       init.cellMM * pxPerMM, 0.2 * pxPerMM, 200 * pxPerMM).setPrecision(2);
    dlg.angle  = num(gR, "Rasterwinkel (°)", init.angle, -180, 180, 1);
    dlg.shape  = gR.addComboBox("Punktform", ["Ellipse / Kreis", "Quadrat", "Raute", "Linie"], init.shape);
    dlg.ratio  = num(gR, "Höhe zu Breite (%, 100 = Kreis)", init.ratio, 20, 100);
    dlg.gain   = num(gR, "Maximale Punktgröße (% der Rasterweite)", init.gain, 30, 200);
    dlg.cutoff = num(gR, "Lichter auslassen unter (% Deckung)", init.cutoff, 0, 90);
    dlg.gamma  = num(gR, "Tonwert-Gamma (>1 = heller)", init.gamma, 0.1, 5, 2);

    // --- Optionen (links) ----------------------------------------------------
    const gO = colL.addGroup("Optionen");
    dlg.staggered = gO.addSwitch("Reihen versetzt (Diamant-Anordnung)", init.staggered);
    dlg.invert    = gO.addSwitch("Invertieren (helle Flächen = große Punkte)", init.invert);
    dlg.output    = gO.addComboBox("Ausgabe", ["Eine Kurve je Auszug (verschmolzen)", "Einzelne Punkte (viele Objekte)"], init.output);
    dlg.mask      = gO.addSwitch("Auf Objektgrenzen zuschneiden", init.mask);
    dlg.hide      = gO.addSwitch("Original ausblenden", init.hide);

    // --- Farbe (rechts) ------------------------------------------------------
    const gF = colR.addGroup("Farbe");
    dlg.mode   = gF.addComboBox("Modus", ["Einfarbig", "CMYK-Separation"], init.mode);
    dlg.colour = gF.addColourPicker("Punktfarbe", colourFromJson(init.colour));
    dlg.aC = num(gF, "Winkel Cyan (°)",    init.aC, -180, 180, 1);
    dlg.aM = num(gF, "Winkel Magenta (°)", init.aM, -180, 180, 1);
    dlg.aY = num(gF, "Winkel Gelb (°)",    init.aY, -180, 180, 1);
    dlg.aK = num(gF, "Winkel Schwarz (°)", init.aK, -180, 180, 1);
    gF.addStaticText("", "Separation: 4 Ebenen (C/M/Y/K), multiplizierend.");

    // --- Zufall (rechts) -----------------------------------------------------
    const gZ = colR.addGroup("Zufall");
    dlg.rnd  = gZ.addSwitch("Zufalls-Einflüsse aktivieren", init.rnd);
    dlg.jit  = num(gZ, "Position streuen (% der Rasterweite)", init.jit, 0, 100);
    dlg.siz  = num(gZ, "Größe streuen (± %)", init.siz, 0, 100);
    dlg.ang  = num(gZ, "Drehung streuen (± °)", init.ang, 0, 180);
    dlg.drp  = num(gZ, "Punkte auslassen (% zufällig)", init.drp, 0, 95);
    dlg.seed = num(gZ, "Startwert / Seed (0 = jedes Mal neu)", init.seed, 0, 999999999);

    // --- Presets (rechts) ----------------------------------------------------
    const gP = colR.addGroup("Presets");
    if (store) {
        const names = Object.keys(store.presets).sort((a, b) => a.localeCompare(b, "de"));
        dlg.presetNames = names;
        dlg.preset = gP.addComboBox("Preset laden", ["— keins —"].concat(names), 0);
        dlg.btSave = gP.addButton("Aktuelle Einstellungen als Preset speichern …");
        dlg.btDel  = gP.addButton("Gewähltes Preset löschen");
        gP.addStaticText("", "Datei: Schreibtisch/" + PRESET_FILE + " – neue Presets erscheinen in der Liste beim nächsten Öffnen.");
    } else {
        gP.addStaticText("", "Presets nicht verfügbar: In den Affinity-Einstellungen unter „MCP/Skripte“ den Zugriff auf Dateien auf dem Desktop erlauben.");
    }

    // --- Abhängigkeiten der Bedienelemente ----------------------------------
    const updateEnabled = () => {
        const sep = dlg.mode.selectedIndex === 1;
        dlg.angle.isEnabled  = !sep;
        dlg.colour.isEnabled = !sep;
        for (const c of [dlg.aC, dlg.aM, dlg.aY, dlg.aK]) c.isEnabled = sep;
        dlg.ratio.isEnabled = dlg.shape.selectedIndex !== 3;       // Linie: kein Seitenverhältnis
        const rnd = dlg.rnd.value;
        for (const c of [dlg.jit, dlg.siz, dlg.ang, dlg.drp, dlg.seed]) c.isEnabled = rnd;
    };
    dlg.mode.onValueChangedHandler  = updateEnabled;
    dlg.shape.onValueChangedHandler = updateEnabled;
    dlg.rnd.onValueChangedHandler   = updateEnabled;
    updateEnabled();

    // --- Preset-Bedienung ----------------------------------------------------
    if (store) {
        dlg.preset.onValueChangedHandler = () => {
            const i = dlg.preset.selectedIndex;
            if (i > 0) { setState(dlg, doc, store.presets[dlg.presetNames[i - 1]]); updateEnabled(); }
        };
        dlg.btSave.onClickHandler = () => {
            const current = (dlg.preset.selectedIndex > 0) ? dlg.presetNames[dlg.preset.selectedIndex - 1] : "";
            let name = Application.prompt("Name des Presets:", TITLE, current);
            if (name == null) return;
            name = ("" + name).trim();
            if (!name) return;
            store.presets[name] = getState(dlg, doc);
            if (saveStore(store))
                say("Preset „" + name + "“ gespeichert.\nEs erscheint in der Liste, sobald der Dialog das nächste Mal geöffnet wird.");
        };
        dlg.btDel.onClickHandler = () => {
            const i = dlg.preset.selectedIndex;
            if (i <= 0) { say("Bitte zuerst ein Preset in der Liste wählen."); return; }
            const name = dlg.presetNames[i - 1];
            if (!ask("Preset „" + name + "“ löschen?")) return;
            delete store.presets[name];
            if (saveStore(store)) say("Preset „" + name + "“ gelöscht.");
        };
    }

    dlg.initialWidth = 820;
    return dlg;
}

function colourFromJson(c) {
    try {
        if (c && typeof c === 'object')
            return Colour.createRGBA8({ r: c.r | 0, g: c.g | 0, b: c.b | 0, alpha: (c.alpha == null) ? 255 : c.alpha | 0 });
    } catch (e) { /* unten: Schwarz */ }
    return RGB8(0, 0, 0);
}

// Dialogzustand als einfaches Objekt (für Presets); Rasterweite in mm
function getState(dlg, doc) {
    const pxPerMM = doc.dpi / 25.4;
    const col = dlg.colour.value;
    return {
        cellMM: dlg.cell.value / pxPerMM, angle: dlg.angle.value, shape: dlg.shape.selectedIndex,
        ratio: dlg.ratio.value, gain: dlg.gain.value, cutoff: dlg.cutoff.value, gamma: dlg.gamma.value,
        staggered: dlg.staggered.value, invert: dlg.invert.value, output: dlg.output.selectedIndex,
        mask: dlg.mask.value, hide: dlg.hide.value,
        mode: dlg.mode.selectedIndex, colour: col ? col.rgba8 : DEFAULTS.colour,
        aC: dlg.aC.value, aM: dlg.aM.value, aY: dlg.aY.value, aK: dlg.aK.value,
        rnd: dlg.rnd.value, jit: dlg.jit.value, siz: dlg.siz.value, ang: dlg.ang.value,
        drp: dlg.drp.value, seed: dlg.seed.value
    };
}

function setState(dlg, doc, v) {
    if (!v) return;
    const pxPerMM = doc.dpi / 25.4;
    const n = (ctrl, x) => { if (typeof x === 'number' && isFinite(x)) ctrl.value = x; };
    const b = (ctrl, x) => { if (typeof x === 'boolean') ctrl.value = x; };
    const i = (ctrl, x, max) => { if (Number.isInteger(x) && x >= 0 && x < max) ctrl.selectedIndex = x; };
    if (typeof v.cellMM === 'number') dlg.cell.value = v.cellMM * pxPerMM;
    n(dlg.angle, v.angle); i(dlg.shape, v.shape, 4);
    n(dlg.ratio, v.ratio); n(dlg.gain, v.gain); n(dlg.cutoff, v.cutoff); n(dlg.gamma, v.gamma);
    b(dlg.staggered, v.staggered); b(dlg.invert, v.invert); i(dlg.output, v.output, 2);
    b(dlg.mask, v.mask); b(dlg.hide, v.hide);
    i(dlg.mode, v.mode, 2);
    if (v.colour) dlg.colour.value = colourFromJson(v.colour);
    n(dlg.aC, v.aC); n(dlg.aM, v.aM); n(dlg.aY, v.aY); n(dlg.aK, v.aK);
    b(dlg.rnd, v.rnd); n(dlg.jit, v.jit); n(dlg.siz, v.siz); n(dlg.ang, v.ang); n(dlg.drp, v.drp); n(dlg.seed, v.seed);
}

// Dialogwerte -> Laufzeit-Optionen (geprüft und normiert)
function makeOptions(state, doc) {
    const pxPerMM = doc.dpi / 25.4;
    const s = Object.assign({}, DEFAULTS, state || {});
    return {
        cell:      s.cellMM * pxPerMM,                        // Rasterweite in Spread-Pixeln
        cellMM:    s.cellMM,
        angle:     s.angle,
        shape:     s.shape,                                   // 0 Ellipse, 1 Quadrat, 2 Raute, 3 Linie
        ratio:     clamp(s.ratio / 100, 0.2, 1),
        gain:      clamp(s.gain / 100, 0.3, 2),
        cutoff:    clamp(s.cutoff / 100, 0, 0.9),
        gamma:     clamp(s.gamma, 0.1, 5),
        staggered: !!s.staggered,
        invert:    !!s.invert,
        single:    s.output !== 1,                            // eine Kurve je Auszug
        mask:      !!s.mask,
        hideOriginal: !!s.hide,
        separate:  s.mode === 1,
        colour:    colourFromJson(s.colour),
        sepAngles: [s.aC, s.aM, s.aY, s.aK],
        rnd: {
            on:       !!s.rnd,
            jitter:   clamp(s.jit / 100, 0, 1),
            sizeVar:  clamp(s.siz / 100, 0, 1),
            angleVar: clamp(s.ang, 0, 180),
            dropout:  clamp(s.drp / 100, 0, 0.95),
            seed:     s.seed
        }
    };
}

// ----------------------------------------------------------- Bild abtasten
// Rendert das Objekt in einen RGBA8-Puffer (Spread-Auflösung = Dokument-dpi).
function renderNode(node) {
    const box = node.getSpreadVisibleBox();
    const eng = NodeRenderingEngine.createDefault(node, RasterFormat.RGBA8);
    const w = eng.width, h = eng.height;
    if (w < 1 || h < 1) return null;
    if (w * h > 30e6 &&
        !ask("Das Objekt wird mit " + w + " × " + h + " Pixeln abgetastet (ca. " +
             Math.round(w * h * 4 / 1048576) + " MB Arbeitsspeicher).\nFortfahren?"))
        return null;
    const px = new Uint8Array(eng.createCompatibleBuffer(true).buffer);
    return { box, w, h, px, sx: w / box.width, sy: h / box.height };
}

// Mittelwert eines quadratischen Pixelblocks (max. ~5x5 Stützstellen),
// transparente Pixel werden über Weiß gerechnet. Liefert [r, g, b] 0…255.
function avgPixels(img, cx, cy, rad) {
    const step = Math.max(1, Math.ceil((rad * 2 + 1) / 5));
    let r = 0, g = 0, b = 0, cnt = 0;
    const w = img.w, h = img.h, px = img.px;
    for (let y = cy - rad; y <= cy + rad; y += step) {
        let py = Math.round(y); if (py < 0) py = 0; else if (py >= h) py = h - 1;
        for (let x = cx - rad; x <= cx + rad; x += step) {
            let qx = Math.round(x); if (qx < 0) qx = 0; else if (qx >= w) qx = w - 1;
            const i = (py * w + qx) * 4;
            const a = px[i + 3] / 255, inv = 255 * (1 - a);
            r += px[i] * a + inv; g += px[i + 1] * a + inv; b += px[i + 2] * a + inv;
            cnt++;
        }
    }
    return [r / cnt, g / cnt, b / cnt];
}

// RGB (0…255) -> CMYK (0…1), volle Schwarzerzeugung
function rgbToCmyk(r, g, b) {
    const c = 1 - r / 255, m = 1 - g / 255, y = 1 - b / 255;
    const k = Math.min(c, m, y);
    if (k >= 0.999) return [0, 0, 0, 1];
    return [(c - k) / (1 - k), (m - k) / (1 - k), (y - k) / (1 - k), k];
}

// --------------------------------------------- Punktkurven eines Kanals
// def: { angle, rng, cov(rgb) -> Deckung 0…1 }  ->  Array von Curve
function buildDots(img, geo, o, def) {
    const curves = [];
    const R = o.rnd, rng = def.rng;
    const rad  = -Math.PI / 180 * def.angle;       // Spread-y zeigt nach unten: Vorzeichen drehen
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const doRotate = (def.angle % 180 !== 0) && (o.shape !== 0 || o.ratio < 1);
    const box = img.box;

    let row = 0;
    for (let gy = -geo.halfDiag; gy <= geo.halfDiag; gy += geo.cell) {
        const xOff = (o.staggered && (row % 2 === 1)) ? geo.cell / 2 : 0;
        for (let gx = -geo.halfDiag + xOff; gx <= geo.halfDiag; gx += geo.cell) {
            // Gitterposition um Rasterwinkel gedreht (um Objektmitte)
            const x = geo.cx0 + gx * cosA - gy * sinA;
            const y = geo.cy0 + gx * sinA + gy * cosA;
            if (x < box.x - geo.margin || x > box.x + box.width + geo.margin ||
                y < box.y - geo.margin || y > box.y + box.height + geo.margin) continue;

            // Tonwert an dieser Stelle abtasten
            const rgb = avgPixels(img, (x - box.x) * img.sx, (y - box.y) * img.sy, geo.sampleRad);
            let covr = def.cov(rgb);
            if (o.invert) covr = 1 - covr;
            if (o.gamma !== 1) covr = Math.pow(covr, o.gamma);
            if (covr <= o.cutoff) continue;

            // Zufalls-Einflüsse (feste Aufrufreihenfolge = reproduzierbar)
            let jx = 0, jy = 0, sizeScale = 1, extraAngle = 0;
            if (rng) {
                if (R.dropout > 0 && rng() < R.dropout) continue;
                if (R.jitter > 0) {
                    jx = (rng() * 2 - 1) * R.jitter * geo.cell;
                    jy = (rng() * 2 - 1) * R.jitter * geo.cell;
                }
                if (R.sizeVar > 0) sizeScale = Math.max(0.05, 1 + (rng() * 2 - 1) * R.sizeVar);
                if (R.angleVar > 0) extraAngle = (rng() * 2 - 1) * R.angleVar;
            }
            const px = x + jx, py = y + jy;

            let c;
            if (o.shape === 3) {
                // Linie: Dicke linear zur Deckung, Länge = Zelle (mit Überlappung,
                // damit benachbarte Segmente durchgehende Linien ergeben)
                const t = geo.cell * covr * o.gain * sizeScale;
                if (t < 0.01) continue;
                const len = geo.cell * 1.05;
                c = Curve.createRectangle(new Rectangle(px - len / 2, py - t / 2, len, t));
            } else {
                // Referenz: Kreisdurchmesser; andere Formen flächengleich skaliert
                const d = geo.cell * Math.sqrt(covr) * o.gain * sizeScale;
                if (d < 0.01) continue;
                if (o.shape === 0) {                              // Ellipse (flächentreu)
                    const ew = d / geo.sqRatio, eh = d * geo.sqRatio;
                    c = Curve.createEllipse(new Rectangle(px - ew / 2, py - eh / 2, ew, eh));
                } else if (o.shape === 1) {                       // Quadrat: Seite = d·√π/2
                    const sq = d * 0.88623, sw = sq / geo.sqRatio, sh = sq * geo.sqRatio;
                    c = Curve.createRectangle(new Rectangle(px - sw / 2, py - sh / 2, sw, sh));
                } else {                                          // Raute: Diagonale = d·√(π/2)
                    const q = d * 1.25331, dw = q / geo.sqRatio, dh = q * geo.sqRatio;
                    c = Curve.createDiamond(new Rectangle(px - dw / 2, py - dh / 2, dw, dh));
                }
            }
            const rot = (doRotate ? def.angle : 0) + extraAngle;
            if (rot) {
                c.transform(Transform.createTranslate(px, py)
                    .multiply(Transform.createRotate(-Math.PI / 180 * rot))
                    .multiply(Transform.createTranslate(-px, -py)));
            }
            curves.push(c);
        }
        row++;
    }
    return curves;
}

// ------------------------------------------------- Befehle eines Kanals
// Hängt an den Compound-Builder: Ebene (ausgewählt) -> [Blend] -> [Beschnitt-
// Rechteck] -> Punkte -> Füllregel Nicht-Null. Befehle ohne Auswahl wirken
// auf die jeweils gerade eingefügten (ausgewählten) Knoten.
function addChannelCommands(cb, doc, target, box, curves, o, def) {
    const noFill = FillDescriptor.createNone();
    const noLine = LineStyleDescriptor.createDefault(0);
    const fill   = FillDescriptor.createSolid(def.colour, BlendMode.Normal);

    const lb = AddChildNodesCommandBuilder.create();
    lb.setInsertionTarget(target);
    lb.setInsertionMode(InsertionMode.Inside_AtBack);               // = zuoberst im Ziel
    lb.addNode(ContainerNodeDefinition.create(def.layerName));
    cb.addCommand(lb.createCommand(true), true);

    if (def.multiply) cb.addCommand(DocumentCommand.createSetBlendMode(null, BlendMode.Multiply));

    if (o.mask) {
        const pc = PolyCurve.create();
        pc.addCurve(Curve.createRectangle(new Rectangle(box.x, box.y, box.width, box.height)));
        const rdef = PolyCurveNodeDefinition.create(pc, noFill, noFill, noLine, noFill);
        rdef.userDescription = "Beschnitt";
        const rb = AddChildNodesCommandBuilder.create();
        rb.addNode(rdef);
        cb.addCommand(rb.createCommand(true));
    }

    // „Inside_AtBack“ ohne Ziel = in den gerade ausgewählten Knoten hinein
    // (Beschnitt-Rechteck bzw. Ebene); ohne diesen Modus landen die Punkte
    // als Geschwister neben dem Rechteck und werden nicht beschnitten.
    const db = AddChildNodesCommandBuilder.create();
    db.setInsertionMode(InsertionMode.Inside_AtBack);
    if (o.single) {
        const pc = PolyCurve.create();
        for (const c of curves) pc.addCurve(c);
        const ddef = PolyCurveNodeDefinition.create(pc, fill, noFill, noLine, noFill);
        ddef.userDescription = "Rasterpunkte";
        db.addNode(ddef);
    } else {
        let n = 0;
        for (const c of curves) {
            const pc = PolyCurve.create();
            pc.addCurve(c);
            const ddef = PolyCurveNodeDefinition.create(pc, fill, noFill, noLine, noFill);
            ddef.userDescription = "Punkt " + (++n);
            db.addNode(ddef);
        }
    }
    cb.addCommand(db.createCommand(true));
    cb.addCommand(DocumentCommand.createSetWindingMode(null, WindingOrder.NonZero));
}

// ---------------------------------------------------------------- Hauptteil
function run(doc, node, o) {
    const img = renderNode(node);
    if (!img) { say("Das Objekt lässt sich nicht abtasten (keine sichtbare Fläche)."); return false; }
    const box = img.box, cell = o.cell;
    if (box.width < cell || box.height < cell) { say("Das Objekt ist kleiner als die Rasterweite."); return false; }

    const estimate = Math.ceil(box.width / cell + 1) * Math.ceil(box.height / cell + 1) * (o.separate ? 4 : 1);
    if (estimate > 60000 &&
        !ask("Es entstehen bis zu " + estimate + " Rasterpunkte – das kann etwas dauern.\nFortfahren?"))
        return false;

    const geo = {
        cell: cell,
        cx0: box.x + box.width / 2, cy0: box.y + box.height / 2,
        halfDiag: Math.sqrt(box.width * box.width + box.height * box.height) / 2 + cell,
        sqRatio: Math.sqrt(o.ratio),                                   // flächentreue Ellipse
        sampleRad: Math.max(1, Math.round(cell * 0.45 * img.sx)),
        margin: cell * 0.6
    };

    const useRnd = o.rnd.on && (o.rnd.jitter > 0 || o.rnd.sizeVar > 0 || o.rnd.angleVar > 0 || o.rnd.dropout > 0);
    const seedBase = (o.rnd.seed > 0) ? Math.floor(o.rnd.seed) : Date.now();

    // Kanäle definieren
    const defs = [];
    if (o.separate) {
        const names = ["Cyan", "Magenta", "Gelb", "Schwarz"];
        const inks  = [CMYKf(1, 0, 0, 0), CMYKf(0, 1, 0, 0), CMYKf(0, 0, 1, 0), CMYKf(0, 0, 0, 1)];
        for (let i = 0; i < 4; i++) {
            defs.push({
                layerName: "Raster " + names[i],
                angle: o.sepAngles[i],
                colour: inks[i],
                multiply: true,
                rng: useRnd ? makeRng(seedBase + i * 1009) : null,   // je Auszug eigener Seed
                cov: (rgb) => rgbToCmyk(rgb[0], rgb[1], rgb[2])[i]
            });
        }
    } else {
        defs.push({
            layerName: "Siebdruckraster",
            angle: o.angle,
            colour: o.colour,
            multiply: false,
            rng: useRnd ? makeRng(seedBase) : null,
            cov: (rgb) => 1 - (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
        });
    }

    // Ziel: zuoberst im Container des Originals (Ebene oder Seite)
    const parent = node.parent;
    const target = (parent && !parent.isDocumentNode) ? parent : doc.currentSpread;

    const cb = CompoundCommandBuilder.create();
    let made = 0;
    for (const def of defs) {
        const curves = buildDots(img, geo, o, def);
        made += curves.length;
        if (curves.length) addChannelCommands(cb, doc, target, box, curves, o, def);
    }
    if (made === 0) {
        say("Es wurden keine Rasterpunkte erzeugt.\nMotiv evtl. zu hell – Lichter-Schwelle senken oder „Invertieren“ aktivieren.");
        return false;
    }
    if (o.hideOriginal) cb.addCommand(DocumentCommand.createSetVisibility(Selection.create(doc, node), false));

    doc.executeCommand(cb.createCommand());
    console.log(TITLE + ": " + made + " Rasterpunkte in " + defs.length + " Ebene(n) erzeugt.");
    return true;
}

function main() {
    const doc = Document.current;
    if (!doc) { say("Kein Dokument geöffnet."); return; }
    const nodes = doc.selection.nodes.toArray().filter(n => !n.isSpreadNode);
    if (nodes.length === 0) { say("Bitte zuerst ein Objekt auswählen (Bild oder Grafik)."); return; }
    if (nodes.length > 1) { say("Bitte genau EIN Objekt auswählen.\nMehrere Objekte vorher gruppieren (Cmd/Strg+G)."); return; }
    const node = nodes[0];

    if (TEST_OPTS) {                                    // automatisierter Lauf ohne Dialog
        run(doc, node, makeOptions(TEST_OPTS, doc));
        return;
    }

    const store = loadStore();                          // null = kein Desktop-Zugriff
    const init = Object.assign({}, DEFAULTS, (store && store.last) ? store.last : {});
    const dlg = buildDialog(doc, init, store);
    if (!isOk(dlg.runModal())) return;

    const state = getState(dlg, doc);
    if (state.cellMM < 0.2) { say("Rasterweite zu klein (min. 0,2 mm)."); return; }
    if (store) { store.last = state; saveStore(store); }   // zuletzt eingegebene Werte merken – vor dem Lauf
    run(doc, node, makeOptions(state, doc));
}

try {
    main();
} catch (err) {
    say("Fehler: " + err.message + (err.stack ? "\n\n" + err.stack.split("\n").slice(0, 4).join("\n") : ""));
}
