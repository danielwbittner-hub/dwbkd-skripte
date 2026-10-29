// ============================================================================
// Risograph-Affinity.js  —  Affinity (Designer · Photo · Publisher 3.x)
// Version 1.0
// ----------------------------------------------------------------------------
// Bildet den typischen Risograph-/Risodruck-Look nach: das ausgewählte Objekt
// (Bild, Vektorgrafik, Gruppe …) wird in wenige Riso-Schmuckfarben zerlegt, je
// Farbe grob gerastert, multiplizierend überdruckt – und bewusst „nicht ganz
// perfekt“ dargestellt: leichtes Fehlregister (Farbversatz je Ebene), Korn/
// Rauschen und zufällige Streuung von Punkten, Größe und Drehung.
//
// Aufbauend auf „Siebdruckraster-Affinity.js“ (gleiche Render- und Raster-
// Engine), aber auf den Riso-Look ausgerichtet:
//   • Riso-Farbpalette (Fluoreszenz-Pink, Blau, Gelb, Grün … mit echten
//     Näherungswerten) – pro Farbe wählbar, Überdruck per „Multiplizieren“
//   • Trennung wählbar: Luminanz (1 Farbe) · Duoton (2) · RGB (3) · CMYK (4)
//   • Grobes Halbtonraster je Farbe mit eigenem Winkel (Punkt/Quadrat/Raute/Linie)
//   • FEHLREGISTER: jede Farbebene bekommt einen kleinen zufälligen Versatz –
//     das verschobene Übereinanderdrucken, das Riso ausmacht
//   • KORN: feines, zufälliges Rauschen (bevorzugt in Mitteltönen)
//   • Zufall: Position, Größe, Drehung streuen, Punkte auslassen (Seed = reproduzierbar)
//   • Presets: speichern/laden/löschen; zuletzt benutzte Werte werden gemerkt
//     (Datei: Desktop/Risograph-Presets.json – Affinity erlaubt Scripten nur
//     den Zugriff auf den Schreibtisch)
//
// Verwendung:
//   1. Genau EIN Objekt auswählen (mehrere Objekte vorher gruppieren)
//   2. Script im Panel „Skripte“ ausführen
//   3. Parameter einstellen, OK
//
// Das Original bleibt erhalten; die Riso-Ebenen liegen darüber. Ein Durchlauf
// = ein Schritt in der Rückgängig-Liste.
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
const { Colour, RGB8 } = require('/colours.js');
const { LineStyleDescriptor } = require('/linestyle.js');
const { Selection } = require('/selections.js');
const { RasterFormat, NodeRenderingEngine } = require('/rasterobject.js');
const { UnitType } = require('/units.js');
const { File, fs } = require('/fs.js');

const VERSION     = "1.0";
const TITLE       = "Risograph-Effekt";
const PRESET_FILE = "Risograph-Presets.json";

// Für automatisierte Tests: ein vorher definiertes Objekt __RISO_OPTS
// (gleiche Felder wie die Dialogwerte) übergeht den Dialog.
const TEST_OPTS = (typeof __RISO_OPTS === 'object' && __RISO_OPTS) ? __RISO_OPTS : null;

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

// ----------------------------------------------------- Riso-Farbpalette
// Näherungswerte echter Risograph-Tinten in sRGB. Index 0 = frei wählbar.
const PALETTE = [
    { name: "— benutzerdefiniert —",   rgb: null },
    { name: "Schwarz",                 rgb: [0, 0, 0] },
    { name: "Fluoreszenz-Pink",        rgb: [255, 72, 176] },
    { name: "Fluoreszenz-Orange",      rgb: [255, 116, 119] },
    { name: "Rot (Bright Red)",        rgb: [241, 80, 96] },
    { name: "Orange",                  rgb: [255, 108, 47] },
    { name: "Gelb",                    rgb: [255, 232, 0] },
    { name: "Gold",                    rgb: [187, 139, 65] },
    { name: "Grün",                    rgb: [0, 169, 92] },
    { name: "Mint",                    rgb: [130, 216, 174] },
    { name: "Teal",                    rgb: [0, 131, 138] },
    { name: "Aqua / Hellblau",         rgb: [94, 200, 229] },
    { name: "Blau (Medium Blue)",      rgb: [0, 120, 191] },
    { name: "Blau (Federal)",          rgb: [31, 71, 144] },
    { name: "Violett",                 rgb: [157, 122, 210] },
    { name: "Purpur",                  rgb: [118, 91, 167] },
    { name: "Burgund",                 rgb: [145, 78, 114] },
    { name: "Braun",                   rgb: [146, 95, 82] },
    { name: "Stahlgrau",               rgb: [55, 64, 77] }
];
const PALETTE_NAMES = PALETTE.map(p => p.name);
function paletteIndexFor(rgb) {
    for (let i = 1; i < PALETTE.length; i++)
        if (PALETTE[i].rgb[0] === rgb.r && PALETTE[i].rgb[1] === rgb.g && PALETTE[i].rgb[2] === rgb.b) return i;
    return 0;                                            // benutzerdefiniert
}

// ------------------------------------------------------------ Standardwerte
// Trennung: 0 Luminanz(1) · 1 Duoton(2) · 2 RGB(3) · 3 CMYK(4)
const DEFAULTS = {
    cellMM: 1.4, shape: 0, ratio: 90, gain: 120, cutoff: 3, gamma: 1.1,
    staggered: false, invert: false, output: 0, mask: true, hide: true,
    mode: 1,
    inks: [
        { colour: { r: 31, g: 71, b: 144, alpha: 255 }, angle: 45 },   // Blau   (Struktur/Schatten)
        { colour: { r: 255, g: 72, b: 176, alpha: 255 }, angle: 15 },  // Pink   (Mitteltöne)
        { colour: { r: 255, g: 232, b: 0, alpha: 255 }, angle: 75 },   // Gelb
        { colour: { r: 0, g: 0, b: 0, alpha: 255 }, angle: 0 }          // Schwarz
    ],
    misreg: 0.4, misregRnd: 60, grain: 25,
    rnd: true, jit: 12, siz: 20, ang: 6, drp: 4, seed: 0
};

// ------------------------------------------------------------------ Presets
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
        return null;                                     // kein Desktop-Zugriff
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

// ----------------------------------------------------------------- Farben
function colourFromJson(c) {
    try {
        if (c && typeof c === 'object')
            return Colour.createRGBA8({ r: c.r | 0, g: c.g | 0, b: c.b | 0, alpha: (c.alpha == null) ? 255 : c.alpha | 0 });
    } catch (e) { /* unten: Schwarz */ }
    return RGB8(0, 0, 0);
}

// Wie viele Tinten die Trennung benutzt
function inkCount(mode) { return [1, 2, 3, 4][mode] || 1; }

// ------------------------------------------------------------------- Dialog
function buildDialog(doc, init, store) {
    const pxPerMM = doc.dpi / 25.4;
    const dlg = Dialog.create(TITLE + "  ·  v" + VERSION);
    const colL = dlg.addColumn();
    const colM = dlg.addColumn();
    const colR = dlg.addColumn();

    const num = (group, label, value, min, max, prec) =>
        group.addUnitValueEditor(label, UnitType.Number, UnitType.Number, value, min, max).setPrecision(prec ?? 0);

    // --- Raster (links) ------------------------------------------------------
    const gR = colL.addGroup("Raster");
    dlg.cell   = gR.addUnitValueEditor("Rasterweite (Punktabstand)", UnitType.Pixel, doc.units,
                                       init.cellMM * pxPerMM, 0.2 * pxPerMM, 200 * pxPerMM).setPrecision(2);
    dlg.shape  = gR.addComboBox("Punktform", ["Ellipse / Kreis", "Quadrat", "Raute", "Linie"], init.shape);
    dlg.ratio  = num(gR, "Höhe zu Breite (%, 100 = Kreis)", init.ratio, 20, 100);
    dlg.gain   = num(gR, "Maximale Punktgröße (% der Rasterweite)", init.gain, 30, 200);
    dlg.cutoff = num(gR, "Lichter auslassen unter (% Deckung)", init.cutoff, 0, 90);
    dlg.gamma  = num(gR, "Tonwert-Gamma (>1 = heller)", init.gamma, 0.1, 5, 2);

    // --- Optionen (links) ----------------------------------------------------
    const gO = colL.addGroup("Optionen");
    dlg.staggered = gO.addSwitch("Reihen versetzt (Diamant-Anordnung)", init.staggered);
    dlg.invert    = gO.addSwitch("Invertieren (helle Flächen = große Punkte)", init.invert);
    dlg.output    = gO.addComboBox("Ausgabe", ["Eine Kurve je Farbe (verschmolzen)", "Einzelne Punkte (viele Objekte)"], init.output);
    dlg.mask      = gO.addSwitch("Auf Objektgrenzen zuschneiden", init.mask);
    dlg.hide      = gO.addSwitch("Original ausblenden", init.hide);

    // --- Trennung + Farben (Mitte) ------------------------------------------
    const gT = colM.addGroup("Farbtrennung");
    dlg.mode = gT.addComboBox("Modus",
        ["Luminanz → 1 Farbe", "Duoton → 2 Farben", "RGB subtraktiv → 3 Farben", "CMYK → 4 Farben"], init.mode);
    gT.addStaticText("", "Duoton: Farbe 1 trägt Schatten/Struktur, Farbe 2 die Mitteltöne.");

    dlg.inks = [];
    const inkLabels = ["Farbe 1", "Farbe 2", "Farbe 3", "Farbe 4"];
    for (let i = 0; i < 4; i++) {
        const gi = colM.addGroup(inkLabels[i]);
        const cur = (init.inks && init.inks[i]) ? init.inks[i] : DEFAULTS.inks[i];
        const pal = gi.addComboBox("Riso-Farbe", PALETTE_NAMES, paletteIndexFor(cur.colour));
        const col = gi.addColourPicker("Farbton", colourFromJson(cur.colour));
        const ang = num(gi, "Rasterwinkel (°)", cur.angle, -180, 180, 1);
        pal.onValueChangedHandler = () => {
            const p = PALETTE[pal.selectedIndex];
            if (p && p.rgb) col.value = RGB8(p.rgb[0], p.rgb[1], p.rgb[2]);
        };
        dlg.inks.push({ pal, col, ang, group: gi });
    }

    // --- Fehlregister / Korn / Zufall (rechts) ------------------------------
    const gX = colR.addGroup("Fehlregister & Korn");
    dlg.misreg    = num(gX, "Fehlregister (Versatz je Ebene, mm)", init.misreg, 0, 10, 2);
    dlg.misregRnd = num(gX, "Versatz-Richtung zufällig (%)", init.misregRnd, 0, 100);
    dlg.grain     = num(gX, "Korn / Rauschen (Stärke %)", init.grain, 0, 100);

    const gZ = colR.addGroup("Zufall (Ungenauigkeit)");
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
        gP.addStaticText("", "Datei: Schreibtisch/" + PRESET_FILE + " – neue Presets erscheinen beim nächsten Öffnen.");
    } else {
        gP.addStaticText("", "Presets nicht verfügbar: In den Affinity-Einstellungen unter „Skripte“ den Zugriff auf Dateien auf dem Desktop erlauben.");
    }

    // --- Abhängigkeiten der Bedienelemente ----------------------------------
    const updateEnabled = () => {
        const n = inkCount(dlg.mode.selectedIndex);
        for (let i = 0; i < 4; i++) {
            const on = i < n;
            dlg.inks[i].pal.isEnabled = on;
            dlg.inks[i].col.isEnabled = on;
            dlg.inks[i].ang.isEnabled = on;
        }
        for (const c of dlg.inks) c.ang.isEnabled = (c.ang.isEnabled && dlg.shape.selectedIndex !== 3) ? true : c.ang.isEnabled;
        dlg.ratio.isEnabled = dlg.shape.selectedIndex !== 3;           // Linie: kein Seitenverhältnis
        const rnd = dlg.rnd.value;
        for (const c of [dlg.jit, dlg.siz, dlg.ang, dlg.drp, dlg.seed]) c.isEnabled = rnd;
        dlg.misregRnd.isEnabled = dlg.misreg.value > 0;
    };
    dlg.mode.onValueChangedHandler   = updateEnabled;
    dlg.shape.onValueChangedHandler  = updateEnabled;
    dlg.rnd.onValueChangedHandler    = updateEnabled;
    dlg.misreg.onValueChangedHandler = updateEnabled;
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

    dlg.initialWidth = 1120;
    return dlg;
}

// Dialogzustand als einfaches Objekt (für Presets); Rasterweite in mm
function getState(dlg, doc) {
    const pxPerMM = doc.dpi / 25.4;
    const inks = dlg.inks.map(c => {
        const col = c.col.value;
        return { colour: col ? col.rgba8 : { r: 0, g: 0, b: 0, alpha: 255 }, angle: c.ang.value };
    });
    return {
        cellMM: dlg.cell.value / pxPerMM, shape: dlg.shape.selectedIndex,
        ratio: dlg.ratio.value, gain: dlg.gain.value, cutoff: dlg.cutoff.value, gamma: dlg.gamma.value,
        staggered: dlg.staggered.value, invert: dlg.invert.value, output: dlg.output.selectedIndex,
        mask: dlg.mask.value, hide: dlg.hide.value,
        mode: dlg.mode.selectedIndex, inks: inks,
        misreg: dlg.misreg.value, misregRnd: dlg.misregRnd.value, grain: dlg.grain.value,
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
    i(dlg.shape, v.shape, 4);
    n(dlg.ratio, v.ratio); n(dlg.gain, v.gain); n(dlg.cutoff, v.cutoff); n(dlg.gamma, v.gamma);
    b(dlg.staggered, v.staggered); b(dlg.invert, v.invert); i(dlg.output, v.output, 2);
    b(dlg.mask, v.mask); b(dlg.hide, v.hide);
    i(dlg.mode, v.mode, 4);
    if (Array.isArray(v.inks)) {
        for (let k = 0; k < 4 && k < v.inks.length; k++) {
            const ink = v.inks[k]; if (!ink) continue;
            if (ink.colour) { dlg.inks[k].col.value = colourFromJson(ink.colour); dlg.inks[k].pal.selectedIndex = paletteIndexFor(ink.colour); }
            n(dlg.inks[k].ang, ink.angle);
        }
    }
    n(dlg.misreg, v.misreg); n(dlg.misregRnd, v.misregRnd); n(dlg.grain, v.grain);
    b(dlg.rnd, v.rnd); n(dlg.jit, v.jit); n(dlg.siz, v.siz); n(dlg.ang, v.ang); n(dlg.drp, v.drp); n(dlg.seed, v.seed);
}

// Dialogwerte -> Laufzeit-Optionen (geprüft und normiert)
function makeOptions(state, doc) {
    const pxPerMM = doc.dpi / 25.4;
    const s = Object.assign({}, DEFAULTS, state || {});
    const inks = (s.inks && s.inks.length ? s.inks : DEFAULTS.inks).map(k => ({
        colour: colourFromJson(k.colour), angle: k.angle
    }));
    return {
        cell:      s.cellMM * pxPerMM,
        cellMM:    s.cellMM,
        shape:     s.shape,
        ratio:     clamp(s.ratio / 100, 0.2, 1),
        gain:      clamp(s.gain / 100, 0.3, 2),
        cutoff:    clamp(s.cutoff / 100, 0, 0.9),
        gamma:     clamp(s.gamma, 0.1, 5),
        staggered: !!s.staggered,
        invert:    !!s.invert,
        single:    s.output !== 1,
        mask:      !!s.mask,
        hideOriginal: !!s.hide,
        mode:      clamp(s.mode | 0, 0, 3),
        inks:      inks,
        misreg:    clamp(s.misreg, 0, 10) * pxPerMM,                   // Versatz in Spread-Pixeln
        misregRnd: clamp(s.misregRnd / 100, 0, 1),
        grain:     clamp(s.grain / 100, 0, 1),
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

// Mittelwert eines Pixelblocks; transparente Pixel über Weiß. Liefert [r,g,b] 0…255.
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

// Punkt-Pixel (für Korn): ein Abtastwert, transparent über Weiß
function onePixel(img, cx, cy) {
    let qx = Math.round(cx), py = Math.round(cy);
    if (qx < 0) qx = 0; else if (qx >= img.w) qx = img.w - 1;
    if (py < 0) py = 0; else if (py >= img.h) py = img.h - 1;
    const i = (py * img.w + qx) * 4, px = img.px;
    const a = px[i + 3] / 255, inv = 255 * (1 - a);
    return [px[i] * a + inv, px[i + 1] * a + inv, px[i + 2] * a + inv];
}

function luma(rgb) { return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255; }

// RGB (0…255) -> CMYK (0…1), volle Schwarzerzeugung
function rgbToCmyk(r, g, b) {
    const c = 1 - r / 255, m = 1 - g / 255, y = 1 - b / 255;
    const k = Math.min(c, m, y);
    if (k >= 0.999) return [0, 0, 0, 1];
    return [(c - k) / (1 - k), (m - k) / (1 - k), (y - k) / (1 - k), k];
}

// Deckungs-Funktion je Farbkanal nach Trennmodus
function coverageFn(mode, idx) {
    if (mode === 0) return (rgb) => 1 - luma(rgb);                     // Luminanz
    if (mode === 1) {                                                  // Duoton
        return idx === 0
            ? (rgb) => Math.pow(1 - luma(rgb), 1.5)                    // Schatten/Struktur
            : (rgb) => Math.pow(1 - luma(rgb), 0.7);                   // Mitteltöne
    }
    if (mode === 2) return (rgb) => 1 - rgb[idx] / 255;                // RGB subtraktiv
    return (rgb) => rgbToCmyk(rgb[0], rgb[1], rgb[2])[idx];            // CMYK
}

// --------------------------------------------- Punktkurven eines Kanals
// def: { angle, rng, cov(rgb)->Deckung, offset {dx,dy} }  ->  Array von Curve
function buildDots(img, geo, o, def) {
    const curves = [];
    const R = o.rnd, rng = def.rng;
    const rad  = -Math.PI / 180 * def.angle;        // Spread-y zeigt nach unten: Vorzeichen drehen
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const doRotate = (def.angle % 180 !== 0) && (o.shape !== 0 || o.ratio < 1);
    const box = img.box;
    const ox = def.offset ? def.offset.dx : 0, oy = def.offset ? def.offset.dy : 0;

    let row = 0;
    for (let gy = -geo.halfDiag; gy <= geo.halfDiag; gy += geo.cell) {
        const xOff = (o.staggered && (row % 2 === 1)) ? geo.cell / 2 : 0;
        for (let gx = -geo.halfDiag + xOff; gx <= geo.halfDiag; gx += geo.cell) {
            const x = geo.cx0 + gx * cosA - gy * sinA;
            const y = geo.cy0 + gx * sinA + gy * cosA;
            if (x < box.x - geo.margin || x > box.x + box.width + geo.margin ||
                y < box.y - geo.margin || y > box.y + box.height + geo.margin) continue;

            const rgb = avgPixels(img, (x - box.x) * img.sx, (y - box.y) * img.sy, geo.sampleRad);
            let covr = def.cov(rgb);
            if (o.invert) covr = 1 - covr;
            if (o.gamma !== 1) covr = Math.pow(covr, o.gamma);
            if (covr <= o.cutoff) continue;

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
            const px = x + jx + ox, py = y + jy + oy;

            let c;
            if (o.shape === 3) {
                const t = geo.cell * covr * o.gain * sizeScale;
                if (t < 0.01) continue;
                const len = geo.cell * 1.05;
                c = Curve.createRectangle(new Rectangle(px - len / 2, py - t / 2, len, t));
            } else {
                const d = geo.cell * Math.sqrt(covr) * o.gain * sizeScale;
                if (d < 0.01) continue;
                if (o.shape === 0) {
                    const ew = d / geo.sqRatio, eh = d * geo.sqRatio;
                    c = Curve.createEllipse(new Rectangle(px - ew / 2, py - eh / 2, ew, eh));
                } else if (o.shape === 1) {
                    const sq = d * 0.88623, sw = sq / geo.sqRatio, sh = sq * geo.sqRatio;
                    c = Curve.createRectangle(new Rectangle(px - sw / 2, py - sh / 2, sw, sh));
                } else {
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

// ------------------------------------------------- Korn / Rauschen
// Feine, zufällige Punkte, bevorzugt in Mitteltönen des jeweiligen Kanals.
function buildGrain(img, geo, o, def) {
    const curves = [];
    if (o.grain <= 0 || !def.grng) return curves;
    const rng = def.grng, box = img.box;
    const ox = def.offset ? def.offset.dx : 0, oy = def.offset ? def.offset.dy : 0;
    const cells = (box.width / geo.cell) * (box.height / geo.cell);
    const tries = Math.min(80000, Math.round(cells * 6 * o.grain));
    const base  = geo.cell * 0.09;
    for (let i = 0; i < tries; i++) {
        const x = box.x + rng() * box.width, y = box.y + rng() * box.height;
        const rgb = onePixel(img, (x - box.x) * img.sx, (y - box.y) * img.sy);
        let covr = def.cov(rgb);
        if (o.invert) covr = 1 - covr;
        if (o.gamma !== 1) covr = Math.pow(covr, o.gamma);
        const peak = covr * (1 - covr) * 4;             // Maximum bei 50 % Deckung
        if (rng() > peak * o.grain) continue;
        const r = base * (0.5 + rng());
        curves.push(Curve.createEllipse(new Rectangle(x + ox - r, y + oy - r, 2 * r, 2 * r)));
    }
    return curves;
}

// ------------------------------------------------- Befehle eines Kanals
function addChannelCommands(cb, doc, target, box, curves, o, def) {
    const noFill = FillDescriptor.createNone();
    const noLine = LineStyleDescriptor.createDefault(0);
    const fill   = FillDescriptor.createSolid(def.colour, BlendMode.Normal);

    const lb = AddChildNodesCommandBuilder.create();
    lb.setInsertionTarget(target);
    lb.setInsertionMode(InsertionMode.Inside_AtBack);
    lb.addNode(ContainerNodeDefinition.create(def.layerName));
    cb.addCommand(lb.createCommand(true), true);

    cb.addCommand(DocumentCommand.createSetBlendMode(null, BlendMode.Multiply));   // Riso: Überdruck

    if (o.mask) {
        const pc = PolyCurve.create();
        pc.addCurve(Curve.createRectangle(new Rectangle(box.x, box.y, box.width, box.height)));
        const rdef = PolyCurveNodeDefinition.create(pc, noFill, noFill, noLine, noFill);
        rdef.userDescription = "Beschnitt";
        const rb = AddChildNodesCommandBuilder.create();
        rb.addNode(rdef);
        cb.addCommand(rb.createCommand(true));
    }

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

    const n = inkCount(o.mode);
    const estimate = Math.ceil(box.width / cell + 1) * Math.ceil(box.height / cell + 1) * n;
    if (estimate > 60000 &&
        !ask("Es entstehen bis zu " + estimate + " Rasterpunkte (plus Korn) – das kann etwas dauern.\nFortfahren?"))
        return false;

    const geo = {
        cell: cell,
        cx0: box.x + box.width / 2, cy0: box.y + box.height / 2,
        halfDiag: Math.sqrt(box.width * box.width + box.height * box.height) / 2 + cell + o.misreg,
        sqRatio: Math.sqrt(o.ratio),
        sampleRad: Math.max(1, Math.round(cell * 0.45 * img.sx)),
        margin: cell * 0.6 + o.misreg
    };

    const useRnd = o.rnd.on && (o.rnd.jitter > 0 || o.rnd.sizeVar > 0 || o.rnd.angleVar > 0 || o.rnd.dropout > 0);
    const seedBase = (o.rnd.seed > 0) ? Math.floor(o.rnd.seed) : Date.now();
    const offRng = makeRng(seedBase + 777);             // Fehlregister-Richtungen

    // Kanäle definieren
    const names = (o.mode === 0) ? ["Riso"]
                : (o.mode === 1) ? ["Riso 1 (Schatten)", "Riso 2 (Mitten)"]
                : (o.mode === 2) ? ["Riso Rot-Auszug", "Riso Grün-Auszug", "Riso Blau-Auszug"]
                :                  ["Riso Cyan", "Riso Magenta", "Riso Gelb", "Riso Schwarz"];
    const defs = [];
    for (let i = 0; i < n; i++) {
        // Fehlregister: feste Länge, zufällige (oder gerade) Richtung je Ebene
        let dx = 0, dy = 0;
        if (o.misreg > 0) {
            const baseAng = (i / Math.max(1, n)) * Math.PI * 2;        // gleichmäßig verteilt
            const ang = baseAng + (offRng() * 2 - 1) * Math.PI * o.misregRnd;
            dx = Math.cos(ang) * o.misreg;
            dy = Math.sin(ang) * o.misreg;
        }
        defs.push({
            layerName: names[i],
            angle: o.inks[i].angle,
            colour: o.inks[i].colour,
            cov: coverageFn(o.mode, i),
            offset: { dx, dy },
            rng:  useRnd ? makeRng(seedBase + i * 1009) : null,
            grng: (o.grain > 0) ? makeRng(seedBase + 50021 + i * 2003) : null
        });
    }

    const parent = node.parent;
    const target = (parent && !parent.isDocumentNode) ? parent : doc.currentSpread;

    const cb = CompoundCommandBuilder.create();
    let made = 0;
    for (const def of defs) {
        const curves = buildDots(img, geo, o, def);
        const grain  = buildGrain(img, geo, o, def);
        for (const g of grain) curves.push(g);
        made += curves.length;
        if (curves.length) addChannelCommands(cb, doc, target, box, curves, o, def);
    }
    if (made === 0) {
        say("Es wurden keine Rasterpunkte erzeugt.\nMotiv evtl. zu hell – Lichter-Schwelle senken oder „Invertieren“ aktivieren.");
        return false;
    }
    if (o.hideOriginal) cb.addCommand(DocumentCommand.createSetVisibility(Selection.create(doc, node), false));

    doc.executeCommand(cb.createCommand());
    console.log(TITLE + ": " + made + " Objekte in " + defs.length + " Ebene(n) erzeugt.");
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

    const store = loadStore();
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
