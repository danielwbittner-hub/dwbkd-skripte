//@target illustrator
// Anzeigename: Strichlinie in Segmente
/*
  Strichlinie_in_Segmente.jsx  –  Adobe Illustrator (ExtendScript)

  Zerlegt gestrichelte Pfade in einzelne, offene Pfadsegmente:
  Jeder sichtbare Strich wird ein eigener Pfad MIT KONTUR – keine Fläche
  (im Gegensatz zu „Objekt > Pfad > Konturlinie“).

  - Kurven bleiben echte Bézierkurven (exakt per De-Casteljau geteilt, nicht in Polygone zerlegt)
  - Konturfarbe, -stärke, Abschluss, Ecken, Gehrungsgrenze, Überdrucken,
    Deckkraft und Füllmethode werden übernommen
  - funktioniert auch in Gruppen und zusammengesetzten Pfaden
  - geschlossene Pfade: ein Strich, der über den Startpunkt läuft, wird zu EINEM Segment verbunden
  - Strichlänge 0 (Punktlinie mit rundem Abschluss) wird als Mini-Segment angelegt
  - eigenes Muster im Dialog definierbar (z. B. "1 2 1" = 1 Strich, 2 Lücke, 1 Strich)
    in der Linealeinheit des Dokuments, in mm oder pt, mit Versatz; wahlweise
    erzwungen oder nur als Ersatz für Pfade
    ohne eigene Strichelung
  - Voreinstellungen speichern/laden/löschen; die zuletzt benutzten Werte
    stehen beim nächsten Öffnen wieder da (Datei im Benutzerordner)

  Bedienung: Pfade auswählen > Datei > Skripten > Anderes Skript …
*/

var EPS = 1e-6;          // Rechentoleranz in pt
var DOT = 0.01;          // Länge (pt) für "Punkte" bei Strichlänge 0
var MAX_DASHES = 50000;  // Notbremse gegen versehentlich winzige Muster
var MM_TO_PT = 72 / 25.4;// Umrechnung mm -> pt fuer die Eingabe

// =====================================================================
// Geometrie
// =====================================================================

function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function dist(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }
function samePt(a, b) { return dist(a, b) < EPS; }

// Punkt auf kubischer Bézierkurve bei Parameter t
function bez(p, t) {
    var mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0],
            a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

// Segment zwischen zwei Ankerpunkten inkl. Längentabelle (Bogenlänge -> t)
function makeSeg(p0, p1, p2, p3) {
    var seg = { p: [p0, p1, p2, p3] };
    seg.isLine = samePt(p0, p1) && samePt(p2, p3);   // Griffe eingezogen = Gerade
    if (seg.isLine) { seg.len = dist(p0, p3); return seg; }
    var poly = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
    var n = Math.max(32, Math.min(4000, Math.ceil(poly * 2)));   // ca. 0,5 pt Auflösung
    var cum = [0], prev = p0, acc = 0;
    for (var i = 1; i <= n; i++) {
        var q = bez(seg.p, i / n);
        acc += dist(prev, q);
        cum.push(acc);
        prev = q;
    }
    seg.n = n; seg.cum = cum; seg.len = acc;
    return seg;
}

// Bogenlänge s innerhalb eines Segments -> Kurvenparameter t
function tAt(seg, s) {
    if (s <= 0) return 0;
    if (s >= seg.len) return 1;
    if (seg.isLine) return s / seg.len;
    var c = seg.cum, lo = 0, hi = seg.n;
    while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (c[mid] < s) lo = mid; else hi = mid;
    }
    var d = c[hi] - c[lo];
    var f = d > 0 ? (s - c[lo]) / d : 0;
    return (lo + f) / seg.n;
}

// Kurve bei t teilen (De Casteljau) -> [linker Teil, rechter Teil]
function splitAt(p, t) {
    var a = lerp(p[0], p[1], t), b = lerp(p[1], p[2], t), c = lerp(p[2], p[3], t);
    var d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t);
    return [[p[0], a, d, m], [m, e, c, p[3]]];
}

// Teilstück eines Segments zwischen den Längen s0 und s1
function subSeg(seg, s0, s1) {
    if (seg.isLine) {
        var a = lerp(seg.p[0], seg.p[3], s0 / seg.len);
        var b = lerp(seg.p[0], seg.p[3], s1 / seg.len);
        return [a, a, b, b];
    }
    var t0 = tAt(seg, s0), t1 = tAt(seg, s1), p = seg.p;
    if (t1 < 1 - EPS) p = splitAt(p, t1)[0];
    if (t0 > EPS) p = splitAt(p, t0 / t1)[1];
    return p;
}

// Pfadpunkte -> Segmentliste mit Startlängen
function buildGeometry(pts, closed) {
    var segs = [], starts = [], total = 0, n = pts.length;
    var count = closed ? n : n - 1;
    for (var i = 0; i < count; i++) {
        var A = pts[i], B = pts[(i + 1) % n];
        var s = makeSeg(A.a, A.r, B.l, B.a);
        starts.push(total);
        segs.push(s);
        total += s.len;
    }
    return { segs: segs, starts: starts, total: total, closed: closed };
}

// Kurvenstücke zwischen den Gesamtlängen a und b (b > total = Umlauf bei geschlossenem Pfad)
function extract(g, a, b) {
    if (g.closed && b > g.total + EPS) {
        return extract(g, a, g.total).concat(extract(g, 0, b - g.total));
    }
    var out = [];
    for (var i = 0; i < g.segs.length; i++) {
        var seg = g.segs[i], s0 = g.starts[i], s1 = s0 + seg.len;
        if (seg.len < EPS || s1 <= a + EPS || s0 >= b - EPS) continue;
        out.push(subSeg(seg, Math.max(a, s0) - s0, Math.min(b, s1) - s0));
    }
    return out;
}

// Strichmuster entlang der Gesamtlänge -> Liste {a, b} der sichtbaren Striche
function dashIntervals(total, pattern, offset, closed) {
    var n = pattern.length, plen = 0, i;
    for (i = 0; i < n; i++) plen += pattern[i];
    var res = [], k = 0;
    var pos = -(((offset % plen) + plen) % plen);
    while (pos < total - EPS) {
        var len = pattern[k];
        if (k % 2 === 0) {                                   // gerade Indizes = Strich
            if (len < EPS) {
                if (pos >= -EPS) res.push({ a: Math.max(pos, 0), b: Math.max(pos, 0), dot: true });
            } else {
                var a = Math.max(pos, 0), b = Math.min(pos + len, total);
                if (b - a > EPS) res.push({ a: a, b: b });
            }
            if (res.length > MAX_DASHES) throw new Error("Mehr als " + MAX_DASHES + " Striche – Muster prüfen.");
        }
        pos += len;
        k = (k + 1) % n;
    }
    if (closed && res.length > 1) {                          // Strich über den Startpunkt verbinden
        var f = res[0], l = res[res.length - 1];
        if (!f.dot && !l.dot && f.a < EPS && l.b > total - EPS) {
            res.shift();
            l.b = total + f.b;
        }
    }
    if (closed && res.length === 1 && !res[0].dot && res[0].a < EPS && res[0].b > total - EPS) {
        res[0].full = true;                                  // Strich länger als der ganze Pfad
    }
    return res;
}

// Kurvenstücke -> Ankerpunkte mit Griffen
function curvesToPoints(curves) {
    var pts = [], m = curves.length;
    for (var i = 0; i <= m; i++) {
        var prev = i > 0 ? curves[i - 1] : null;
        var next = i < m ? curves[i] : null;
        var anchor = next ? next[0] : prev[3];
        var left = prev ? prev[2] : anchor;
        var right = next ? next[1] : anchor;
        var smooth = false;
        if (prev && next) {                                  // Übergangspunkt: glatt, wenn Griffe auf einer Linie
            var ux = anchor[0] - left[0], uy = anchor[1] - left[1];
            var vx = right[0] - anchor[0], vy = right[1] - anchor[1];
            var lu = Math.sqrt(ux * ux + uy * uy), lv = Math.sqrt(vx * vx + vy * vy);
            if (lu > EPS && lv > EPS) {
                smooth = Math.abs(ux * vy - uy * vx) / (lu * lv) < 1e-3 && (ux * vx + uy * vy) > 0;
            }
        }
        pts.push({ a: anchor, l: left, r: right, smooth: smooth });
    }
    return pts;
}

function cleanPattern(arr) {
    if (!arr || !arr.length) return null;
    var p = [], sum = 0;
    for (var i = 0; i < arr.length; i++) {
        var v = Number(arr[i]);
        if (isNaN(v) || v < 0) v = 0;
        p.push(v);
        sum += v;
    }
    if (sum < EPS) return null;
    if (p.length % 2) p = p.concat(p);   // ungerade Anzahl: Muster wird wie in PostScript wiederholt
    return p;
}

// =====================================================================
// Illustrator
// =====================================================================

function collect(item, jobs, owners, ownerRec) {
    try { if (item.locked || item.hidden) return; } catch (e) {}
    switch (item.typename) {
        case "PathItem":
            if (item.clipping || item.guides || !item.stroked || item.pathPoints.length < 2) return;
            var rec = ownerRec;
            if (!rec) { rec = { item: item, jobs: 0, ok: 0 }; owners.push(rec); }
            rec.jobs++;
            jobs.push({ path: item, owner: rec });
            break;
        case "GroupItem":
            for (var i = 0; i < item.pageItems.length; i++) collect(item.pageItems[i], jobs, owners, null);
            break;
        case "CompoundPathItem":
            var crec = { item: item, jobs: 0, ok: 0 };
            owners.push(crec);
            for (var j = 0; j < item.pathItems.length; j++) collect(item.pathItems[j], jobs, owners, crec);
            break;
    }
}

function copyStroke(src, dst) {
    var props = ["strokeColor", "strokeWidth", "strokeCap", "strokeJoin", "strokeMiterLimit",
                 "strokeOverprint", "opacity", "blendingMode"];
    for (var i = 0; i < props.length; i++) {
        try { dst[props[i]] = src[props[i]]; } catch (e) {}
    }
    dst.strokeDashes = [];
}

function drawPath(container, pts, closed, src) {
    var p = container.pathItems.add();
    var anchors = [];
    for (var i = 0; i < pts.length; i++) anchors.push(pts[i].a);
    p.setEntirePath(anchors);
    for (var j = 0; j < pts.length; j++) {
        var pp = p.pathPoints[j];
        pp.leftDirection = pts[j].l;
        pp.rightDirection = pts[j].r;
        pp.pointType = pts[j].smooth ? PointType.SMOOTH : PointType.CORNER;
    }
    p.closed = closed;
    p.filled = false;
    p.stroked = true;
    copyStroke(src, p);
    return p;
}

function ungroup(grp) {
    var items = [];
    while (grp.pageItems.length) {
        var it = grp.pageItems[0];
        it.move(grp, ElementPlacement.PLACEBEFORE);
        items.push(it);
    }
    grp.remove();
    return items;
}

function processPath(path, owner, opts) {
    var pattern, offset;
    if (opts.override && opts.pattern) {            // eigenes Muster erzwingen
        pattern = opts.pattern;
        offset = opts.offset;
    } else {
        pattern = cleanPattern(path.strokeDashes);  // vorhandene Strichelung bevorzugen
        if (pattern) {
            offset = 0;
            try { offset = Number(path.strokeDashOffset) || 0; } catch (e) {}
        } else {                                     // kein eigenes Muster -> Ersatz
            pattern = opts.pattern;
            offset = opts.offset;
        }
    }
    if (!pattern) return null;

    var src = path.pathPoints, pts = [];
    for (var i = 0; i < src.length; i++) {
        var sp = src[i];
        pts.push({ a: sp.anchor, l: sp.leftDirection, r: sp.rightDirection });
    }
    var g = buildGeometry(pts, path.closed);
    if (g.total < EPS) return null;

    var iv = dashIntervals(g.total, pattern, offset, path.closed);
    if (!iv.length) return null;

    var grp = owner.parent.groupItems.add();
    grp.move(owner, ElementPlacement.PLACEBEFORE);
    grp.name = "Striche" + (path.name ? " – " + path.name : "");

    var count = 0;
    for (var k = 0; k < iv.length; k++) {
        var d = iv[k], a = d.a, b = d.b;
        if (d.dot) {
            a = Math.max(0, d.a - DOT / 2);
            b = Math.min(g.total, a + DOT);
        }
        var curves = extract(g, a, b);
        if (!curves.length) continue;
        var cp = curvesToPoints(curves);
        if (d.full) { cp[0].l = cp[cp.length - 1].l; cp.pop(); }
        drawPath(grp, cp, !!d.full, path);
        count++;
    }
    if (!count) { grp.remove(); return null; }
    return { count: count, items: opts.group ? [grp] : ungroup(grp) };
}

// Linealeinheit des Dokuments -> Umrechnungsfaktor nach pt + Anzeigename
function rulerUnitInfo() {
    var u = { factor: 1, name: "pt" };
    try {
        switch (app.activeDocument.rulerUnits) {
            case RulerUnits.Millimeters: u.factor = MM_TO_PT;          u.name = "mm";   break;
            case RulerUnits.Centimeters: u.factor = 72 / 2.54;         u.name = "cm";   break;
            case RulerUnits.Inches:      u.factor = 72;                u.name = "Zoll"; break;
            case RulerUnits.Picas:       u.factor = 12;                u.name = "Pica"; break;
            case RulerUnits.Qs:          u.factor = MM_TO_PT * 0.25;   u.name = "Q";    break;
            case RulerUnits.Pixels:      u.factor = 1;                 u.name = "px";   break;
            case RulerUnits.Points:      u.factor = 1;                 u.name = "pt";   break;
        }
    } catch (e) {}
    return u;
}

// ===== Voreinstellungen + \u201ezuletzt verwendet" (dwbkd, gemeinsam) ============
// F\u00fcgt oben ein Panel mit Dropdown + Speichern/L\u00f6schen ein. Nach dem Aufbau
// der Bedienelemente activate(getState, setState) aufrufen (l\u00e4dt die zuletzt
// verwendeten Werte); saveLast() nach OK aufrufen. Datei je Skript unter
// <Benutzerdaten>/<fileName>, Format: [Name] + schl\u00fcssel=wert, [__last__].
function dwbPrefs(parent, fileName) {
    var LAST = "__last__";
    var store = { list: [], last: null };
    function file() { return new File(Folder.userData + "/" + fileName); }
    (function read() {
        var f = file();
        if (!f.exists) return;
        f.encoding = "UTF-8";
        if (!f.open("r")) return;
        var cur = null;
        while (!f.eof) {
            var line = f.readln();
            if (line.length && line.charAt(line.length - 1) === "\r")
                line = line.substr(0, line.length - 1);
            if (!line.length) continue;
            if (line.charAt(0) === "[") {
                var nm = line.substring(1, line.length - 1);
                if (nm === LAST) { cur = {}; store.last = cur; }
                else { cur = { __name: nm }; store.list.push(cur); }
            } else if (cur) {
                var i = line.indexOf("=");
                if (i > 0) cur[line.substring(0, i)] = line.substring(i + 1);
            }
        }
        f.close();
    })();
    function write() {
        var f = file();
        f.encoding = "UTF-8";
        if (!f.open("w")) { alert("Voreinstellungen konnten nicht gespeichert werden:\n" + f.fsName); return false; }
        function block(nm, o) {
            f.writeln("[" + nm + "]");
            for (var k in o) { if (k === "__name") continue; f.writeln(k + "=" + o[k]); }
            f.writeln("");
        }
        if (store.last) block(LAST, store.last);
        for (var i = 0; i < store.list.length; i++) block(store.list[i].__name, store.list[i]);
        f.close();
        return true;
    }
    var pnl = parent.add("panel", undefined, "Voreinstellungen");
    pnl.orientation = "row";
    pnl.alignChildren = "center";
    var dd = pnl.add("dropdownlist", undefined, []);
    dd.preferredSize.width = 200;
    var bS = pnl.add("button", undefined, "Speichern \u2026");
    var bD = pnl.add("button", undefined, "L\u00f6schen");
    var self = { panel: pnl, dd: dd, getState: null, setState: null };
    function rebuild(sel) {
        dd.removeAll();
        for (var i = 0; i < store.list.length; i++) {
            var it = dd.add("item", store.list[i].__name);
            if (sel != null && store.list[i].__name === sel) dd.selection = it;
        }
    }
    dd.onChange = function () {
        if (dd.selection && self.setState) { try { self.setState(store.list[dd.selection.index]); } catch (e) {} }
    };
    bS.onClick = function () {
        if (!self.getState) return;
        var n = prompt("Name der Voreinstellung:", dd.selection ? dd.selection.text : "");
        if (!n) return;
        n = ("" + n).replace(/[\[\]\r\n=]/g, "");
        if (!n) return;
        var st = self.getState(); st.__name = n;
        var f = -1;
        for (var i = 0; i < store.list.length; i++) if (store.list[i].__name === n) f = i;
        if (f >= 0) store.list[f] = st; else store.list.push(st);
        if (write()) rebuild(n);
    };
    bD.onClick = function () {
        if (!dd.selection) { alert("Keine Voreinstellung ausgew\u00e4hlt."); return; }
        var idx = dd.selection.index;
        if (!confirm("Voreinstellung \"" + store.list[idx].__name + "\" l\u00f6schen?")) return;
        store.list.splice(idx, 1);
        write();
        rebuild(null);
    };
    self.activate = function (getState, setState) {
        self.getState = getState; self.setState = setState;
        rebuild(null);
        if (store.last) { try { setState(store.last); } catch (e) {} }
    };
    self.saveLast = function () {
        if (!self.getState) return;
        var st = self.getState(); st.__name = undefined;
        store.last = st; write();
    };
    return self;
}
// ===========================================================================

function showDialog() {
    var ru = rulerUnitInfo();
    var w = new Window("dialog", "Strichlinie \u2192 Einzelsegmente");
    w.orientation = "column";
    w.alignChildren = "fill";

    var prefs = dwbPrefs(w, "Strichlinie-Presets.txt");

    var p1 = w.add("panel", undefined, "Eigenes Strichmuster");
    p1.orientation = "column";
    p1.alignChildren = "left";
    p1.margins = 14;
    var row = p1.add("group");
    row.add("statictext", undefined, "Strich Lücke Strich Lücke …:");
    var fb = row.add("edittext", undefined, "");
    fb.characters = 20;

    var urow = p1.add("group");
    urow.add("statictext", undefined, "Einheit:");
    var rbDoc = urow.add("radiobutton", undefined, "Lineal (" + ru.name + ")");
    var rbMM = urow.add("radiobutton", undefined, "mm");
    var rbPT = urow.add("radiobutton", undefined, "pt");
    rbDoc.value = true;

    p1.add("statictext", undefined, "z. B. „1 2 1“ = 1 Strich, 2 Lücke, 1 Strich … (abwechselnd)");
    p1.add("statictext", undefined, "Dezimal mit Komma, z. B. „3,5 2“. Trenner: Leerzeichen, ; oder /");

    var orow = p1.add("group");
    orow.add("statictext", undefined, "Versatz:");
    var off = orow.add("edittext", undefined, "0");
    off.characters = 6;
    orow.add("statictext", undefined, "(verschiebt den Musteranfang)");

    var cbOverride = p1.add("checkbox", undefined, "Auf alle Pfade anwenden (vorhandene Strichelung überschreiben)");
    cbOverride.value = true;
    p1.add("statictext", undefined, "Ohne Haken: nur für Pfade, die selbst keine Strichelung haben.");

    var p2 = w.add("panel", undefined, "Optionen");
    p2.alignChildren = "left";
    var cbGroup = p2.add("checkbox", undefined, "Striche je Pfad gruppieren");
    cbGroup.value = true;
    var cbDel = p2.add("checkbox", undefined, "Originalpfad l\u00f6schen");
    cbDel.value = true;

    // Zustand <-> Bedienelemente (f\u00fcr Voreinstellungen & zuletzt verwendet)
    function getState() {
        return {
            pat:  fb.text,
            unit: rbMM.value ? "mm" : (rbPT.value ? "pt" : "doc"),
            off:  off.text,
            ovr:  cbOverride.value ? "1" : "0",
            grp:  cbGroup.value ? "1" : "0",
            del:  cbDel.value ? "1" : "0"
        };
    }
    function setState(v) {
        if (v.pat  !== undefined) fb.text = v.pat;
        if (v.unit === "mm") rbMM.value = true;
        else if (v.unit === "pt") rbPT.value = true;
        else if (v.unit === "doc") rbDoc.value = true;
        if (v.off  !== undefined) off.text = v.off;
        if (v.ovr  !== undefined) cbOverride.value = (v.ovr === "1");
        if (v.grp  !== undefined) cbGroup.value = (v.grp === "1");
        if (v.del  !== undefined) cbDel.value = (v.del === "1");
    }
    prefs.activate(getState, setState);

    var btns = w.add("group");
    btns.alignment = "right";
    btns.add("button", undefined, "Abbrechen", { name: "cancel" });
    btns.add("button", undefined, "OK", { name: "ok" });

    if (w.show() !== 1) return null;
    prefs.saveLast();

    var factor = rbMM.value ? MM_TO_PT : (rbPT.value ? 1 : ru.factor);
    var pattern = null, txt = fb.text.replace(/^\s+|\s+$/g, "");
    if (txt !== "") {
        var parts = txt.split(/[;\s\/]+/), nums = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === "") continue;
            var v = parseFloat(parts[i].replace(",", "."));
            if (!isNaN(v)) nums.push(v * factor);
        }
        pattern = cleanPattern(nums);
        if (!pattern) { alert("Muster ung\u00fcltig – wird ignoriert."); }
    }
    var offset = (parseFloat(String(off.text).replace(",", ".")) || 0) * factor;

    return {
        pattern: pattern,
        offset: offset,
        override: cbOverride.value && !!pattern,
        group: cbGroup.value,
        removeOriginal: cbDel.value
    };
}

function main() {
    if (app.documents.length === 0) { alert("Kein Dokument ge\u00f6ffnet."); return; }
    var doc = app.activeDocument, sel = doc.selection;
    if (!sel || !sel.length) { alert("Bitte zuerst die gestrichelten Pfade ausw\u00e4hlen."); return; }

    var opts = showDialog();
    if (!opts) return;

    var jobs = [], owners = [];
    for (var i = 0; i < sel.length; i++) collect(sel[i], jobs, owners, null);
    if (!jobs.length) { alert("In der Auswahl sind keine Pfade mit Kontur."); return; }

    var paths = 0, dashes = 0, skipped = 0, errors = [], result = [];
    for (var j = 0; j < jobs.length; j++) {
        try {
            var r = processPath(jobs[j].path, jobs[j].owner.item, opts);
            if (r) {
                paths++;
                dashes += r.count;
                jobs[j].owner.ok++;
                result = result.concat(r.items);
            } else {
                skipped++;
            }
        } catch (e) {
            skipped++;
            errors.push(e.message);
        }
    }

    if (opts.removeOriginal) {
        for (var k = 0; k < owners.length; k++) {
            if (owners[k].ok > 0 && owners[k].ok === owners[k].jobs) {
                try { owners[k].item.remove(); } catch (e2) {}
            }
        }
    }
    try { doc.selection = result; } catch (e3) {}

    var msg = paths + " Pfad(e) in " + dashes + " Einzelstriche zerlegt.";
    if (skipped) msg += "\n" + skipped + " Pfad(e) \u00fcbersprungen (keine Strichelung und kein Ersatzmuster).";
    if (errors.length) msg += "\nFehler: " + errors[0];
    alert(msg);
}

if (typeof app !== "undefined") main();
