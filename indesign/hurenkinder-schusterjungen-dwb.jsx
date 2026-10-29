#target "indesign"
#targetengine "session"
/*
 * Hurenkinder & Schusterjungen dwb
 * --------------------------------
 * Findet die klassischen Satzfehler im ganzen Dokument und springt sie an:
 *   • Schusterjunge  – erste Zeile eines Absatzes allein am Spalten-/Rahmenende
 *   • Hurenkind      – letzte Zeile eines Absatzes allein am Spalten-/Rahmenanfang
 *   • Kurze Ausgangszeile – letzte Zeile mit nur einem Wort
 *
 * Das Fenster bleibt offen (Palette): Eintrag anklicken → „Gehe zu“,
 * im Dokument korrigieren, dann „Neu scannen“.
 */

var FINDINGS = [];

/* ---------- Spalten-/Rahmenumbruch zwischen zwei Zeilen? ---------- */
function isBreak(a, b) {
  if (!a || !b) return false;
  // anderer Textrahmen
  try {
    var fa = a.parentTextFrames, fb = b.parentTextFrames;
    if (fa.length && fb.length && fa[0].id !== fb[0].id) return true;
  } catch (e) {}
  // gleiche Rahmen, aber Grundlinie springt nach oben -> neue Spalte
  try {
    if (b.baseline + 0.1 < a.baseline) return true;
  } catch (e2) {}
  return false;
}

function pageOf(line) {
  try {
    var f = line.parentTextFrames;
    if (f.length && f[0].parentPage) return f[0].parentPage.name;
  } catch (e) {}
  return "–";
}

function snippet(para) {
  var t = "";
  try { t = para.contents; } catch (e) {}
  t = String(t).replace(/[\r\n\t]+/g, " ");
  if (t.length > 52) t = t.substring(0, 52) + "…";
  return t;
}

/* ---------- Dokument durchsuchen ---------- */
function scan() {
  FINDINGS = [];
  var doc = app.activeDocument;
  var oldUnit = app.scriptPreferences.measurementUnit;
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  try {
    var stories = doc.stories.everyItem().getElements();
    for (var s = 0; s < stories.length; s++) {
      var paras = stories[s].paragraphs.everyItem().getElements();
      for (var p = 0; p < paras.length; p++) {
        var para = paras[p];
        var lines;
        try { lines = para.lines.everyItem().getElements(); } catch (e) { continue; }
        if (!lines || lines.length < 2) {
          // kurze Ausgangszeile nur sinnvoll bei mehrzeiligen Absätzen
          continue;
        }
        var first = lines[0], last = lines[lines.length - 1];

        // Schusterjunge: Umbruch direkt nach der ersten Zeile
        if (isBreak(lines[0], lines[1])) {
          FINDINGS.push({ type: "Schusterjunge", page: pageOf(first), line: first, text: snippet(para) });
        }
        // Hurenkind: Umbruch direkt vor der letzten Zeile
        if (isBreak(lines[lines.length - 2], last)) {
          FINDINGS.push({ type: "Hurenkind", page: pageOf(last), line: last, text: snippet(para) });
        }
        // Kurze Ausgangszeile: letzte Zeile nur ein Wort
        try {
          if (last.words.length === 1) {
            FINDINGS.push({ type: "Kurze Ausgangszeile", page: pageOf(last), line: last, text: snippet(para) });
          }
        } catch (e3) {}

        if (FINDINGS.length > 1500) return; // Sicherheitslimit
      }
    }
  } finally {
    app.scriptPreferences.measurementUnit = oldUnit;
  }
}

/* ---------- Im Layout anspringen ---------- */
function goTo(f) {
  try {
    var win = app.activeDocument.windows[0];
    var frames = f.line.parentTextFrames;
    if (frames.length && frames[0].parentPage) {
      win.activeSpread = frames[0].parentPage.parent;
    }
    app.select(f.line);
  } catch (e) {
    alert("Stelle lässt sich nicht anspringen (evtl. Übersatz).");
  }
}

/* ---------- Oberfläche (Palette) ---------- */
function buildUI() {
  var w = new Window("palette", "Hurenkinder & Schusterjungen dwb");
  w.alignChildren = "fill";
  w.margins = 12; w.spacing = 10;
  w.preferredSize.width = 460;

  var info = w.add("statictext", undefined, "");
  info.graphics.font = ScriptUI.newFont(info.graphics.font.name, "BOLD", 12);

  var filterG = w.add("group");
  filterG.add("statictext", undefined, "Anzeigen:");
  var cbH  = filterG.add("checkbox", undefined, "Hurenkinder");
  var cbSj = filterG.add("checkbox", undefined, "Schusterjungen");
  var cbK  = filterG.add("checkbox", undefined, "Kurze Ausgangszeilen");
  cbH.value = cbSj.value = cbK.value = true;

  var list = w.add("listbox", undefined, [], { multiselect: false });
  list.preferredSize = [436, 320];

  var btns = w.add("group");
  btns.alignment = "fill";
  var bGo = btns.add("button", undefined, "Gehe zu");
  var bRescan = btns.add("button", undefined, "Neu scannen");
  var sp = btns.add("statictext", undefined, "");
  sp.alignment = "fill";
  var bClose = btns.add("button", undefined, "Schließen");

  var shown = []; // parallele Liste zu den sichtbaren Einträgen

  function wanted(type) {
    if (type === "Hurenkind") return cbH.value;
    if (type === "Schusterjunge") return cbSj.value;
    return cbK.value;
  }

  function refresh() {
    list.removeAll();
    shown = [];
    var cH = 0, cS = 0, cK = 0;
    for (var i = 0; i < FINDINGS.length; i++) {
      var f = FINDINGS[i];
      if (f.type === "Hurenkind") cH++;
      else if (f.type === "Schusterjunge") cS++;
      else cK++;
      if (!wanted(f.type)) continue;
      var tag = f.type === "Hurenkind" ? "[H]" : (f.type === "Schusterjunge" ? "[S]" : "[K]");
      list.add("item", tag + " S. " + f.page + " · " + f.text);
      shown.push(f);
    }
    info.text = cH + " Hurenkinder · " + cS + " Schusterjungen · " + cK + " kurze Ausgangszeilen";
  }

  function doScan() {
    try { scan(); } catch (e) { alert("Fehler beim Scannen: " + e); }
    refresh();
  }

  cbH.onClick = cbSj.onClick = cbK.onClick = refresh;
  bRescan.onClick = doScan;
  bGo.onClick = function () {
    if (list.selection) goTo(shown[list.selection.index]);
  };
  list.onDoubleClick = function () {
    if (list.selection) goTo(shown[list.selection.index]);
  };
  bClose.onClick = function () { w.close(); };

  doScan();
  w.show();
}

/* ---------- Start ---------- */
(function () {
  if (app.documents.length === 0) { alert("Bitte zuerst ein Dokument öffnen."); return; }
  buildUI();
})();
