#target "indesign"
#targetengine "session"
/*
 * Ueberdruck & Schwarz-Check dwb
 * ------------------------------
 * Findet typische Druck-Fallen im ganzen Dokument und springt sie an:
 *   • Mischschwarz im Text (nicht reines 100 % K)
 *   • Registrierfarbe als Füllung/Text (druckt auf allen Platten)
 *   • Weiß auf Überdruck (verschwindet im Druck)
 *   • Überdruck allgemein (zur Kontrolle)
 *   • Haarlinien unter einem Grenzwert (Standard 0,25 pt)
 *
 * Zwei sichere Reparaturen auf Knopfdruck:
 *   • Mischschwarz-Text → 100 % K
 *   • Weiß-Überdruck entfernen
 */

var FINDINGS = [];
var THIN_PT = 0.25;        // Grenzwert Haarlinie in Punkt
var RICH_K  = 60;          // ab diesem K-Wert gilt Text mit CMY als "Mischschwarz"

/* ---------- Farb-Analyse ---------- */
function colorInfo(c) {
  var o = { name: "", reg: false, paper: false, white: false, none: false, cmyk: null };
  try { o.name = c.name; } catch (e) {}
  if (o.name === "None") o.none = true;
  if (o.name === "Paper") o.paper = true;
  try { if (c.model === ColorModel.REGISTRATION) o.reg = true; } catch (e2) {}
  try { if (c.space === ColorSpace.CMYK) o.cmyk = c.colorValue; } catch (e3) {}
  // Prozessweiß 0/0/0/0 ist der eigentliche Weiß-Überdruck-Fall (Paper lässt InDesign gar nicht überdrucken)
  if (o.cmyk && o.cmyk.length === 4 && o.cmyk[0] === 0 && o.cmyk[1] === 0 && o.cmyk[2] === 0 && o.cmyk[3] === 0) o.white = true;
  return o;
}

function isMixedBlack(ci) {
  if (!ci.cmyk || ci.cmyk.length < 4) return false;
  var c = ci.cmyk[0], m = ci.cmyk[1], y = ci.cmyk[2], k = ci.cmyk[3];
  return (k >= RICH_K && (c > 0 || m > 0 || y > 0));
}

function pageName(obj) {
  try {
    var f = obj.parentTextFrames;
    if (f && f.length && f[0].parentPage) return f[0].parentPage.name;
  } catch (e) {}
  try { if (obj.parentPage) return obj.parentPage.name; } catch (e2) {}
  return "Montagefläche";
}

function add(cat, page, desc, obj, fix) {
  FINDINGS.push({ cat: cat, page: page, desc: desc, obj: obj, fix: fix });
}

/* ---------- Text prüfen ---------- */
function scanText(opts) {
  var stories = app.activeDocument.stories.everyItem().getElements();
  for (var s = 0; s < stories.length; s++) {
    var ranges;
    try { ranges = stories[s].textStyleRanges.everyItem().getElements(); } catch (e) { continue; }
    for (var r = 0; r < ranges.length; r++) {
      var tr = ranges[r];
      var txt = "";
      try { txt = String(tr.contents).replace(/[\r\n\t]+/g, " "); } catch (e0) {}
      if (txt.length === 0) continue;
      if (txt.length > 30) txt = txt.substring(0, 30) + "…";
      var pg = pageName(tr);

      var fc; try { fc = colorInfo(tr.fillColor); } catch (e1) { fc = null; }
      if (fc) {
        if (opts.rich && isMixedBlack(fc)) {
          add("Mischschwarz-Text", pg, "„" + txt + "“ – " + fc.cmyk.join("/"), tr, "richblack");
        }
        if (opts.reg && fc.reg) {
          add("Registrierfarbe (Text)", pg, "„" + txt + "“", tr, null);
        }
        if (opts.whiteop && (fc.paper || fc.white)) {
          var op = false; try { op = tr.overprintFill; } catch (e2) {}
          if (op) add("Weiß auf Überdruck (Text)", pg, "„" + txt + "“", tr, "whiteFill");
        }
      }
      if (opts.thin) {
        try {
          var sw = tr.strokeWeight, sci = colorInfo(tr.strokeColor);
          if (sw > 0 && sw < opts.thinPt && !sci.none && !sci.paper) {
            add("Haarlinie (Textkontur)", pg, "„" + txt + "“ – " + fmtPt(sw), tr, null);
          }
        } catch (e3) {}
      }
    }
  }
}

/* ---------- Objekte prüfen ---------- */
function scanItems(opts) {
  var items = app.activeDocument.allPageItems;
  for (var i = 0; i < items.length; i++) {
    var pi = items[i];
    var pg = pageName(pi);
    // Füllung
    var fc = null; try { fc = colorInfo(pi.fillColor); } catch (e1) {}
    if (fc) {
      if (opts.reg && fc.reg) add("Registrierfarbe (Objekt)", pg, typeName(pi), pi, null);
      if (opts.whiteop && (fc.paper || fc.white)) {
        var of = false; try { of = pi.overprintFill; } catch (e2) {}
        if (of) add("Weiß auf Überdruck (Füllung)", pg, typeName(pi), pi, "whiteFill");
      }
      if (opts.overprint) {
        var of2 = false; try { of2 = pi.overprintFill; } catch (e3) {}
        if (of2 && !fc.paper && !fc.white && !fc.none && !isBlackName(fc)) {
          add("Überdruck prüfen (Füllung)", pg, typeName(pi) + " · " + fc.name, pi, null);
        }
      }
    }
    // Kontur
    var sc = null; try { sc = colorInfo(pi.strokeColor); } catch (e4) {}
    if (sc) {
      if (opts.whiteop && (sc.paper || sc.white)) {
        var os = false; try { os = pi.overprintStroke; } catch (e5) {}
        if (os) add("Weiß auf Überdruck (Kontur)", pg, typeName(pi), pi, "whiteStroke");
      }
      if (opts.thin) {
        try {
          var w = pi.strokeWeight;
          if (w > 0 && w < opts.thinPt && !sc.none && !sc.paper) {
            add("Haarlinie (Kontur)", pg, typeName(pi) + " – " + fmtPt(w), pi, null);
          }
        } catch (e6) {}
      }
    }
  }
}

function isBlackName(ci) { return ci.name === "Black" || ci.name === "Schwarz"; }
function fmtPt(v) { return (Math.round(v * 100) / 100) + " pt"; }
function typeName(pi) {
  try { return pi.constructor.name; } catch (e) { return "Objekt"; }
}

/* ---------- Reines Schwarz beschaffen ---------- */
function pureBlack(doc) {
  var b = doc.swatches.itemByName("Black");
  if (b.isValid) return b;
  var c;
  try {
    c = doc.colors.add();
    c.model = ColorModel.PROCESS; c.space = ColorSpace.CMYK;
    c.colorValue = [0, 0, 0, 100]; c.name = "Schwarz 100K";
  } catch (e) { return null; }
  return c;
}

/* ---------- Scan ---------- */
function scan(opts) {
  FINDINGS = [];
  var oldUnit = app.scriptPreferences.measurementUnit;
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  try {
    scanText(opts);
    scanItems(opts);
  } finally {
    app.scriptPreferences.measurementUnit = oldUnit;
  }
}

/* ---------- Reparaturen ---------- */
function fixRichBlack() {
  var doc = app.activeDocument;
  var black = pureBlack(doc);
  if (!black) { alert("Kein Schwarz-Feld gefunden."); return 0; }
  var n = 0;
  for (var i = 0; i < FINDINGS.length; i++) {
    if (FINDINGS[i].fix !== "richblack") continue;
    try { FINDINGS[i].obj.fillColor = black; FINDINGS[i].obj.fillTint = 100; n++; } catch (e) {}
  }
  return n;
}
function fixWhiteOverprint() {
  var n = 0;
  for (var i = 0; i < FINDINGS.length; i++) {
    var f = FINDINGS[i];
    try {
      if (f.fix === "whiteFill")   { f.obj.overprintFill = false; n++; }
      if (f.fix === "whiteStroke") { f.obj.overprintStroke = false; n++; }
    } catch (e) {}
  }
  return n;
}

/* ---------- Anspringen ---------- */
function goTo(f) {
  try {
    var win = app.activeDocument.windows[0];
    var pg = null;
    try { var fr = f.obj.parentTextFrames; if (fr && fr.length) pg = fr[0].parentPage; } catch (e0) {}
    if (!pg) { try { pg = f.obj.parentPage; } catch (e1) {} }
    if (pg) win.activeSpread = pg.parent;
    app.select(f.obj);
  } catch (e) { alert("Stelle lässt sich nicht anspringen."); }
}

/* ---------- Oberfläche ---------- */
function buildUI() {
  var w = new Window("palette", "Überdruck & Schwarz-Check dwb");
  w.alignChildren = "fill";
  w.margins = 12; w.spacing = 10;
  w.preferredSize.width = 520;

  var pc = w.add("panel", undefined, "Prüfungen");
  pc.alignChildren = "left"; pc.margins = 12; pc.spacing = 5;
  var cbRich = pc.add("checkbox", undefined, "Mischschwarz im Text (nicht 100 % K)");
  var cbReg  = pc.add("checkbox", undefined, "Registrierfarbe als Füllung/Text");
  var cbWO   = pc.add("checkbox", undefined, "Weiß auf Überdruck");
  var cbOP   = pc.add("checkbox", undefined, "Überdruck allgemein (zur Kontrolle)");
  var gThin  = pc.add("group");
  var cbThin = gThin.add("checkbox", undefined, "Haarlinien unter");
  var etThin = gThin.add("edittext", undefined, String(THIN_PT)); etThin.characters = 4;
  gThin.add("statictext", undefined, "pt");
  cbRich.value = cbReg.value = cbWO.value = cbThin.value = true;

  var info = w.add("statictext", undefined, "Noch nicht geprüft.");
  info.graphics.font = ScriptUI.newFont(info.graphics.font.name, "BOLD", 12);

  var list = w.add("listbox", undefined, [],
    { multiselect: false, numberOfColumns: 3, showHeaders: true,
      columnTitles: ["Kategorie", "Seite", "Objekt / Text"], columnWidths: [190, 60, 230] });
  list.preferredSize = [496, 300];

  var g1 = w.add("group"); g1.alignment = "fill";
  var bScan = g1.add("button", undefined, "Prüfen");
  var bGo = g1.add("button", undefined, "Gehe zu");
  var spc = g1.add("statictext", undefined, ""); spc.alignment = "fill";
  var bClose = g1.add("button", undefined, "Schließen");

  var g2 = w.add("panel", undefined, "Reparieren (markierte Funde dieser Art, mit Undo)");
  g2.orientation = "row"; g2.margins = 12; g2.spacing = 8; g2.alignment = "fill";
  var bFixBlack = g2.add("button", undefined, "Mischschwarz-Text → 100 % K");
  var bFixWhite = g2.add("button", undefined, "Weiß-Überdruck entfernen");

  var shown = [];

  function currentOpts() {
    var t = parseFloat(String(etThin.text).replace(",", "."));
    if (isNaN(t) || t <= 0) t = THIN_PT;
    return { rich: cbRich.value, reg: cbReg.value, whiteop: cbWO.value,
             overprint: cbOP.value, thin: cbThin.value, thinPt: t };
  }

  function refresh() {
    list.removeAll(); shown = [];
    for (var i = 0; i < FINDINGS.length; i++) {
      var f = FINDINGS[i];
      var it = list.add("item", f.cat);
      it.subItems[0].text = "S. " + f.page;
      it.subItems[1].text = f.desc;
      shown.push(f);
    }
    info.text = FINDINGS.length === 0
      ? "Keine Auffälligkeiten gefunden ✓"
      : FINDINGS.length + " Auffälligkeit" + (FINDINGS.length === 1 ? "" : "en") + " gefunden.";
  }

  function doScan() {
    try { scan(currentOpts()); } catch (e) { alert("Fehler beim Prüfen: " + e); }
    refresh();
  }

  bScan.onClick = doScan;
  bGo.onClick = function () { if (list.selection) goTo(shown[list.selection.index]); };
  list.onDoubleClick = function () { if (list.selection) goTo(shown[list.selection.index]); };
  bClose.onClick = function () { w.close(); };

  bFixBlack.onClick = function () {
    var n = 0;
    app.doScript("$.global._fxB=fixRichBlack();", ScriptLanguage.JAVASCRIPT, undefined,
      UndoModes.ENTIRE_SCRIPT, "Mischschwarz → 100 % K");
    n = $.global._fxB || 0;
    alert(n + " Textstelle(n) auf 100 % K gesetzt.");
    doScan();
  };
  bFixWhite.onClick = function () {
    app.doScript("$.global._fxW=fixWhiteOverprint();", ScriptLanguage.JAVASCRIPT, undefined,
      UndoModes.ENTIRE_SCRIPT, "Weiß-Überdruck entfernen");
    var n = $.global._fxW || 0;
    alert(n + " Weiß-Überdruck(e) entfernt.");
    doScan();
  };

  doScan();
  w.show();
}

/* ---------- Start ---------- */
(function () {
  if (app.documents.length === 0) { alert("Bitte zuerst ein Dokument öffnen."); return; }
  buildUI();
})();
