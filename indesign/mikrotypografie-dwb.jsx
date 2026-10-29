#target "indesign"
/*
 * Mikrotypografie dwb
 * -------------------
 * Setzt deutsche Mikrotypografie per GREP in einem Durchgang:
 * geschützte Leerzeichen, Anführungszeichen, Gedankenstrich,
 * Auslassungspunkte, mehrfache Leerzeichen u. v. m.
 * Jede Regel ist einzeln abschaltbar. Ein Protokoll zeigt die Trefferzahl.
 * Rückgängig mit einem einzigen Cmd+Z.
 *
 * Typografische Ersatzzeichen bewusst als \uXXXX, damit sie unabhängig
 * von der Dateikodierung immer exakt stimmen.
 */

// Unicode-Konstanten
var NBSP   = " "; // geschütztes Leerzeichen
var NNBSP  = " "; // schmales geschütztes Leerzeichen
var QL     = "„"; // „
var QR     = "“"; // "
var SQL    = "‚"; // ‚
var SQR    = "‘"; // '
var APOS   = "’"; // ' (Apostroph / typografisch)
var ENDASH = "–"; // –
var ELL    = "…"; // …
var TIMES  = "×"; // ×

var OPTS = null; // wird von der Dialogmaske gefüllt

/* ---------- Regel-Metadaten für die Oberfläche ---------- */
var RULES = [
  { id: "multispace", label: "Mehrfache Leerzeichen zu einem zusammenfassen", def: true },
  { id: "quotes",     label: "Anführungszeichen „…“ (deutsch, paarweise)", def: true },
  { id: "apostrophe", label: "Apostroph gerade ’ zu typografisch (geht’s)", def: true },
  { id: "ellipsis",   label: "Auslassungspunkte … statt ...", def: true },
  { id: "dashes",     label: "Gedankenstrich – statt - (mit Leerzeichen)", def: true },
  { id: "abbr",       label: "Gesch. Leerzeichen in Abkürzungen (z. B., d. h.)", def: true },
  { id: "units",      label: "Gesch. Leerzeichen vor Einheiten (5 kg, 100 %, 5 €)", def: true },
  { id: "refs",       label: "Gesch. Leerzeichen bei Verweisen (Nr. 5, S. 12, § 3)", def: true },
  { id: "spacepunct", label: "Leerzeichen vor Satzzeichen entfernen ( , ; : . ! ?)", def: true },
  { id: "ranges",     label: "Bis-Strich bei Zahlbereichen (10-15 → 10–15)", def: false },
  { id: "times",      label: "Mal-Zeichen × bei Maßen (5 x 7 → 5 × 7)", def: false }
];

/* ---------- Abkürzungen mit geschütztem Leerzeichen ---------- */
var ABBR = [
  ["z.", "B."], ["d.", "h."], ["u.", "a."], ["u.", "Ä."], ["o.", "Ä."],
  ["s.", "o."], ["s.", "u."], ["s.", "a."], ["z.", "T."], ["u.", "U."],
  ["v.", "a."], ["z.", "Hd."], ["n.", "Chr."], ["v.", "Chr."], ["e.", "V."],
  ["i.", "A."], ["m.", "E."], ["u.", "v.", "m."], ["u.", "s.", "w."], ["i.", "d.", "R."]
];

/* ---------- GREP-Paare je Regel bauen ---------- */
function buildPairs(id, NB) {
  var p = [];
  if (id === "multispace") {
    p.push([" {2,}", " "]);
  } else if (id === "quotes") {
    p.push(['"([^"]*)"', QL + "$1" + QR]);
  } else if (id === "apostrophe") {
    p.push(["(\\p{L})'(\\p{L})", "$1" + APOS + "$2"]);
    p.push(["(\\p{L})'(?![\\p{L}])", "$1" + APOS]);
  } else if (id === "ellipsis") {
    p.push(["\\.\\.\\.", ELL]);
  } else if (id === "dashes") {
    p.push([" - ", " " + ENDASH + " "]);
    p.push(["--", ENDASH]);
  } else if (id === "abbr") {
    for (var i = 0; i < ABBR.length; i++) {
      var parts = ABBR[i];
      var findParts = [], repParts = [];
      for (var j = 0; j < parts.length; j++) {
        findParts.push(parts[j].replace(/\./g, "\\."));
        repParts.push(parts[j]);
      }
      p.push([findParts.join(" "), repParts.join(NB)]);
    }
  } else if (id === "units") {
    var units = "mm|cm|dm|km|nm|ml|cl|dl|hl|mg|kg|Hz|kHz|MHz|GHz|kWh|Wh|kW|MW|MB|GB|TB|KB|Std|min|Uhr|EUR|USD|CHF|dpi|px|m|g|t|l|s|h|A|V|W|%|€|£|°C|°F|°";
    p.push(["(\\d) (" + units + ")(?![\\p{L}])", "$1" + NB + "$2"]);
  } else if (id === "refs") {
    p.push(["(Nr|Abs|Art|Kap|Bd|Abb|Tab|Rn|Pos|Tel|Fax|S)\\. (\\d)", "$1." + NB + "$2"]);
    p.push(["(§{1,2}) (\\d)", "$1" + NB + "$2"]); // echtes Paragraphzeichen, nicht \\u im GREP
  } else if (id === "spacepunct") {
    p.push([" +([,;:.!?])", "$1"]);
  } else if (id === "ranges") {
    p.push(["(\\d)-(\\d)", "$1" + ENDASH + "$2"]);
  } else if (id === "times") {
    p.push(["(\\d)\\s*[xX]\\s*(\\d)", "$1 " + TIMES + " $2"]);
  }
  return p;
}

/* ---------- Ein GREP-Durchlauf ---------- */
function runGrep(find, change, targets) {
  app.findGrepPreferences = NothingEnum.NOTHING;
  app.changeGrepPreferences = NothingEnum.NOTHING;
  app.findGrepPreferences.findWhat = find;
  app.changeGrepPreferences.changeTo = change;
  var n = 0;
  for (var i = 0; i < targets.length; i++) {
    try { n += targets[i].changeGrep().length; } catch (e) {}
  }
  app.findGrepPreferences = NothingEnum.NOTHING;
  app.changeGrepPreferences = NothingEnum.NOTHING;
  return n;
}

/* ---------- Hauptlauf (global, damit doScript sie findet) ---------- */
function runRules() {
  var o = OPTS;
  var NB = o.narrow ? NNBSP : NBSP;

  app.findChangeGrepOptions.includeFootnotes = true;
  app.findChangeGrepOptions.includeHiddenLayers = false;
  app.findChangeGrepOptions.includeMasterPages = o.masters;
  app.findChangeGrepOptions.includeLockedLayersForFind = false;
  app.findChangeGrepOptions.includeLockedStoriesForFind = false;

  // Ziele festlegen
  var targets = [];
  if (o.scope === "selection") {
    var sel = app.selection;
    for (var s = 0; s < sel.length; s++) {
      // deckt Textauswahl (Type-Werkzeug) und ausgewählte Textrahmen ab
      try {
        var tx = sel[s].texts[0];
        if (tx !== undefined) targets.push(tx);
      } catch (eSel) {}
    }
    if (targets.length === 0) { alert("Keine Textauswahl gefunden. Bitte Text markieren oder „Gesamtes Dokument“ wählen."); return; }
  } else {
    targets.push(app.activeDocument);
  }

  var report = [];
  var total = 0;
  for (var r = 0; r < RULES.length; r++) {
    var id = RULES[r].id;
    if (!o.rules[id]) continue;
    var pairs = buildPairs(id, NB);
    var count = 0;
    for (var k = 0; k < pairs.length; k++) count += runGrep(pairs[k][0], pairs[k][1], targets);
    if (count > 0) report.push("  • " + RULES[r].label.split(" (")[0] + ": " + count);
    total += count;
  }

  var msg = total === 0
    ? "Keine Änderungen nötig – der Text ist typografisch schon sauber."
    : total + " Änderung" + (total === 1 ? "" : "en") + " vorgenommen:\n\n" + report.join("\n");
  alert(msg, "Mikrotypografie dwb");
}

/* ---------- Oberfläche ---------- */
function showDialog() {
  var w = new Window("dialog", "Mikrotypografie dwb");
  w.alignChildren = "fill";
  w.margins = 16; w.spacing = 12;

  var head = w.add("statictext", undefined, "Deutsche Mikrotypografie per GREP anwenden.");
  head.graphics.font = ScriptUI.newFont(head.graphics.font.name, "BOLD", 13);

  var pr = w.add("panel", undefined, "Regeln");
  pr.alignChildren = "left"; pr.margins = 14; pr.spacing = 6;
  var cbs = {};
  for (var i = 0; i < RULES.length; i++) {
    var cb = pr.add("checkbox", undefined, RULES[i].label);
    cb.value = RULES[i].def;
    cbs[RULES[i].id] = cb;
  }

  var po = w.add("panel", undefined, "Optionen");
  po.alignChildren = "left"; po.margins = 14; po.spacing = 6;
  var cbNarrow  = po.add("checkbox", undefined, "Schmales gesch. Leerzeichen verwenden (U+202F)");
  var cbMasters = po.add("checkbox", undefined, "Musterseiten einbeziehen");

  var pb = w.add("panel", undefined, "Bereich");
  pb.orientation = "row"; pb.margins = 14; pb.spacing = 16;
  var rbDoc = pb.add("radiobutton", undefined, "Gesamtes Dokument");
  var rbSel = pb.add("radiobutton", undefined, "Nur Auswahl");
  rbDoc.value = true;

  var row = w.add("group");
  row.alignment = "right"; row.spacing = 8;
  var bAll = row.add("button", undefined, "Alle an");
  var bNone = row.add("button", undefined, "Alle aus");
  var bCancel = row.add("button", undefined, "Abbrechen", { name: "cancel" });
  var bOk = row.add("button", undefined, "Anwenden", { name: "ok" });

  bAll.onClick  = function () { for (var id in cbs) cbs[id].value = true; };
  bNone.onClick = function () { for (var id in cbs) cbs[id].value = false; };

  if (w.show() !== 1) return null;

  var rules = {};
  for (var id2 in cbs) rules[id2] = cbs[id2].value;
  return {
    rules: rules,
    narrow: cbNarrow.value,
    masters: cbMasters.value,
    scope: rbSel.value ? "selection" : "document"
  };
}

/* ---------- Start ---------- */
(function () {
  if (app.documents.length === 0) { alert("Bitte zuerst ein Dokument öffnen."); return; }
  var opts = showDialog();
  if (!opts) return;
  OPTS = opts;
  var oldUnit = app.scriptPreferences.measurementUnit;
  try {
    app.doScript("runRules()", ScriptLanguage.JAVASCRIPT, undefined,
      UndoModes.ENTIRE_SCRIPT, "Mikrotypografie dwb");
  } catch (e) {
    alert("Fehler: " + e + "\nZeile " + (e.line || "?"));
  } finally {
    app.scriptPreferences.measurementUnit = oldUnit;
  }
})();
