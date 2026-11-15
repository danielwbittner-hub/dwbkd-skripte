#!/usr/bin/env node
/* Testlauf außerhalb von Acrobat:  node test/pruefen.js datei.pdf [--nur-boxen] [--inflate-test] */
"use strict";
var fs = require("fs"), path = require("path"), zlib = require("zlib");
var DWB = require("../src/core.js");
var args = process.argv.slice(2), datei = args.filter(function (a) { return a.charAt(0) !== "-"; })[0];
if (!datei) { console.error("Aufruf: node test/pruefen.js datei.pdf [--nur-boxen] [--inflate-test]"); process.exit(2); }
var bin = fs.readFileSync(datei).toString("latin1");
if (args.indexOf("--inflate-test") >= 0) {
    // jeden Flate-Strom mit zlib vergleichen
    var dok = new (function () { })();
    var a = DWB.analysieren(bin, { inhalt: false }), d = a.dok, n = 0, ok = 0, k;
    for (k in d.objs) if (d.objs.hasOwnProperty(k) && d.objs[k].sStart !== undefined) {
        var o = d.objs[k], f = d.aufloesen(o.v.get("Filter"));
        if (f !== "/FlateDecode" && !(f instanceof Array && f.length === 1 && f[0] === "/FlateDecode")) continue;
        n++;
        var roh = Buffer.from(bin.substring(o.sStart, o.sEnde), "latin1"), soll;
        try { soll = zlib.inflateSync(roh).toString("latin1"); } catch (e) { try { soll = zlib.inflateSync(roh, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString("latin1"); } catch (e2) { soll = null; } }
        var ist = DWB.inflate(bin, o.sStart, o.sEnde);
        if (soll === null) { console.log("  Objekt " + k + ": zlib scheitert, eigene Länge " + ist.length); continue; }
        if (ist === soll) ok++; else console.log("  ✖ Objekt " + k + ": Länge " + ist.length + " statt " + soll.length);
    }
    console.log("Inflate-Test: " + ok + " von " + n + " Strömen identisch");
}
var t0 = Date.now();
var a = DWB.analysieren(bin, { inhalt: args.indexOf("--nur-boxen") < 0 });
console.log(DWB.berichtKopf(a, path.basename(datei)));
console.log("");
console.log(DWB.berichtAnschnitt(a, 3));
if (args.indexOf("--nur-boxen") < 0) { console.log(DWB.berichtFarben(a)); console.log(DWB.berichtSchriften(a)); }
if (a.fehler.length) console.log("Lesefehler:", a.fehler.slice(0, 10));
if (args.indexOf("--nur-boxen") < 0) { console.log(DWB.berichtBilder(a)); console.log(""); console.log(DWB.berichtReinzeichnung(a)); }
