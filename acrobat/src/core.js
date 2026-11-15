/* ============================================================================
   dwb Acrobat – Kern (reines ES5, läuft in Acrobats JavaScript UND in Node)
   ----------------------------------------------------------------------------
   Liest eine PDF-Datei als Binär-String, entpackt Flate-Ströme selbst und
   ermittelt daraus:
     • Seitenboxen (Media/Crop/Bleed/Trim/Art) samt Anschnitt je Seite
     • benutzte Farbräume (Vektor, Bilder, Verläufe), Sonderfarben, ICC-Profile,
       Output-Intent, PDF/X-Kennung
     • Schriften (eingebettet?), Textobjekte, unsichtbarer Text
   Kein DOM, keine Bibliotheken – Acrobats Engine ist SpiderMonkey 24 (ES5).
   ============================================================================ */
var DWB = (function () {
    "use strict";
    var K = { version: "1.3.0" };

    /* ------------------------------------------------------------------ Bytes */
    var HAT_TYPED = (typeof Uint8Array !== "undefined");
    function neuerPuffer(n) { return HAT_TYPED ? new Uint8Array(n) : new Array(n); }
    function pufferZuString(buf, len) {
        var teile = [], i, j, stueck, chunk = 8192;
        for (i = 0; i < len; i += chunk) {
            var ende = Math.min(len, i + chunk);
            stueck = new Array(ende - i);
            for (j = i; j < ende; j++) stueck[j - i] = buf[j];
            teile.push(String.fromCharCode.apply(null, stueck));
        }
        return teile.join("");
    }

    var B64 = (function () {
        var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", t = {}, i;
        for (i = 0; i < 64; i++) t[abc.charAt(i)] = i;
        t["-"] = 62; t["_"] = 63;
        return t;
    })();
    /** Base64 → Binär-String (jedes Zeichen ein Byte 0–255). */
    K.base64ZuBinaer = function (b64) {
        var out = [], stueck = [], bits = 0, akku = 0, i, c, v, n = b64.length;
        for (i = 0; i < n; i++) {
            c = b64.charAt(i);
            v = B64[c];
            if (v === undefined) continue;          // Zeilenumbrüche, '=' usw.
            akku = (akku << 6) | v; bits += 6;
            if (bits >= 8) {
                bits -= 8;
                stueck.push((akku >> bits) & 255);
                if (stueck.length >= 8192) { out.push(String.fromCharCode.apply(null, stueck)); stueck = []; }
            }
            akku &= (1 << bits) - 1;
        }
        if (stueck.length) out.push(String.fromCharCode.apply(null, stueck));
        return out.join("");
    };

    /* ---------------------------------------------------------------- Inflate */
    var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    function huffBauen(laengen, n) {
        var count = new Array(16), offs = new Array(16), symbol = new Array(n), i, len;
        for (i = 0; i < 16; i++) count[i] = 0;
        for (i = 0; i < n; i++) count[laengen[i]]++;
        count[0] = 0;
        offs[1] = 0;
        for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
        for (i = 0; i < n; i++) { len = laengen[i]; if (len) symbol[offs[len]++] = i; }
        return { count: count, symbol: symbol };
    }
    var FIX_LIT = null, FIX_DIST = null;
    function fixeTabellen() {
        if (FIX_LIT) return;
        var l = [], i;
        for (i = 0; i < 144; i++) l[i] = 8;
        for (; i < 256; i++) l[i] = 9;
        for (; i < 280; i++) l[i] = 7;
        for (; i < 288; i++) l[i] = 8;
        FIX_LIT = huffBauen(l, 288);
        l = [];
        for (i = 0; i < 30; i++) l[i] = 5;
        FIX_DIST = huffBauen(l, 30);
    }

    /**
     * Entpackt zlib/deflate-Daten aus s[start..ende). Gibt einen Binär-String
     * zurück; bei kaputten Daten das, was bis dahin entpackt wurde.
     */
    K.inflate = function (s, start, ende) {
        var pos = start, bitbuf = 0, bitcnt = 0;
        var out = neuerPuffer(Math.max(1024, (ende - start) * 4)), olen = 0;
        function sichern(n) {
            if (olen + n <= out.length) return;
            var neu = neuerPuffer(Math.max(out.length * 2, olen + n)), i;
            if (HAT_TYPED) neu.set(out); else for (i = 0; i < olen; i++) neu[i] = out[i];
            out = neu;
        }
        function bits(n) {
            var v = bitbuf;
            while (bitcnt < n) {
                if (pos >= ende) throw new Error("Datenende");
                v |= s.charCodeAt(pos++) << bitcnt; bitcnt += 8;
            }
            bitbuf = v >>> n; bitcnt -= n;
            return v & ((1 << n) - 1);
        }
        function dekod(h) {
            var code = 0, first = 0, index = 0, len, count;
            for (len = 1; len < 16; len++) {
                code |= bits(1);
                count = h.count[len];
                if (code - count < first) return h.symbol[index + (code - first)];
                index += count; first += count; first <<= 1; code <<= 1;
            }
            throw new Error("Ungültiger Huffman-Code");
        }
        function bloc(lit, dist) {
            var sym, len, d, i;
            for (;;) {
                sym = dekod(lit);
                if (sym < 256) { sichern(1); out[olen++] = sym; }
                else if (sym === 256) return;
                else {
                    sym -= 257;
                    if (sym >= 29) throw new Error("Ungültige Länge");
                    len = LBASE[sym] + bits(LEXT[sym]);
                    sym = dekod(dist);
                    if (sym >= 30) throw new Error("Ungültige Distanz");
                    d = DBASE[sym] + bits(DEXT[sym]);
                    if (d > olen) throw new Error("Distanz zu groß");
                    sichern(len);
                    for (i = 0; i < len; i++) { out[olen] = out[olen - d]; olen++; }
                }
            }
        }
        // zlib-Kopf überspringen (manche Ströme beginnen mit Zeilenumbruch).
        while (pos < ende && (s.charCodeAt(pos) === 10 || s.charCodeAt(pos) === 13 || s.charCodeAt(pos) === 32)) pos++;
        if (ende - pos >= 2) {
            var b0 = s.charCodeAt(pos), b1 = s.charCodeAt(pos + 1);
            if ((b0 & 15) === 8 && ((b0 << 8) | b1) % 31 === 0) pos += 2;
        }
        try {
            var letzter, typ;
            do {
                letzter = bits(1); typ = bits(2);
                if (typ === 0) {
                    bitbuf = 0; bitcnt = 0;
                    if (pos + 4 > ende) throw new Error("Datenende");
                    var n = s.charCodeAt(pos) | (s.charCodeAt(pos + 1) << 8);
                    pos += 4;
                    if (pos + n > ende) n = ende - pos;
                    sichern(n);
                    for (var i = 0; i < n; i++) out[olen++] = s.charCodeAt(pos++);
                } else if (typ === 1) {
                    fixeTabellen(); bloc(FIX_LIT, FIX_DIST);
                } else if (typ === 2) {
                    var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, j, l = [];
                    for (j = 0; j < 19; j++) l[j] = 0;
                    for (j = 0; j < ncode; j++) l[CLORDER[j]] = bits(3);
                    var lenh = huffBauen(l, 19), lens = [], sym, rep;
                    j = 0;
                    while (j < nlen + ndist) {
                        sym = dekod(lenh);
                        if (sym < 16) lens[j++] = sym;
                        else {
                            var wert = 0;
                            if (sym === 16) { if (j === 0) throw new Error("Wiederholung ohne Vorgänger"); wert = lens[j - 1]; rep = 3 + bits(2); }
                            else if (sym === 17) rep = 3 + bits(3);
                            else rep = 11 + bits(7);
                            while (rep--) lens[j++] = wert;
                        }
                    }
                    var lit = huffBauen(lens.slice(0, nlen), nlen), dist = huffBauen(lens.slice(nlen, nlen + ndist), ndist);
                    bloc(lit, dist);
                } else throw new Error("Ungültiger Blocktyp");
            } while (!letzter);
        } catch (e) { /* abgeschnitten/kaputt: liefern, was da ist */ }
        return pufferZuString(out, olen);
    };

    /* PNG-Prädiktor rückgängig machen (Objektströme/xref nutzen das manchmal) */
    function entpraedizieren(daten, parms) {
        var pred = num(parms && parms.get("Predictor")) || 1;
        if (pred < 10) return daten;
        var colors = num(parms.get("Colors")) || 1, bpc = num(parms.get("BitsPerComponent")) || 8,
            columns = num(parms.get("Columns")) || 1;
        var bpp = Math.ceil(colors * bpc / 8), rowlen = Math.ceil(colors * bpc * columns / 8);
        var zeilen = Math.floor(daten.length / (rowlen + 1)), out = neuerPuffer(zeilen * rowlen), prev = null, r, i, ft, p = 0, cur, a, b, c;
        for (r = 0; r < zeilen; r++) {
            ft = daten.charCodeAt(p++);
            cur = new Array(rowlen);
            for (i = 0; i < rowlen; i++) {
                var x = daten.charCodeAt(p++);
                a = i >= bpp ? cur[i - bpp] : 0; b = prev ? prev[i] : 0; c = (prev && i >= bpp) ? prev[i - bpp] : 0;
                if (ft === 1) x += a; else if (ft === 2) x += b; else if (ft === 3) x += (a + b) >> 1;
                else if (ft === 4) { var pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); x += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
                cur[i] = x & 255;
                out[r * rowlen + i] = cur[i];
            }
            prev = cur;
        }
        return pufferZuString(out, zeilen * rowlen);
    }

    function ascii85(s) {
        var out = [], tup = [], i, c, n = s.length, k;
        if (s.substr(0, 2) === "<~") s = s.substr(2);
        for (i = 0; i < s.length; i++) {
            c = s.charCodeAt(i);
            if (c === 126) break;                       // '~>'
            if (c <= 32) continue;
            if (c === 122 && tup.length === 0) { out.push(0, 0, 0, 0); continue; }  // 'z'
            tup.push(c - 33);
            if (tup.length === 5) {
                var v = 0; for (k = 0; k < 5; k++) v = v * 85 + tup[k];
                out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); tup = [];
            }
        }
        if (tup.length) {
            n = tup.length; for (k = n; k < 5; k++) tup.push(84);
            var w = 0; for (k = 0; k < 5; k++) w = w * 85 + tup[k];
            var by = [(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255];
            for (k = 0; k < n - 1; k++) out.push(by[k]);
        }
        return pufferZuString(out, out.length);
    }
    function asciihex(s) {
        var out = [], hex = "", i, c;
        for (i = 0; i < s.length; i++) {
            c = s.charAt(i);
            if (c === ">") break;
            if (/[0-9A-Fa-f]/.test(c)) { hex += c; if (hex.length === 2) { out.push(parseInt(hex, 16)); hex = ""; } }
        }
        if (hex.length === 1) out.push(parseInt(hex + "0", 16));
        return pufferZuString(out, out.length);
    }
    function lzw(s, early) {
        var out = [], dict = [], i, code, prev = null, bitbuf = 0, bitcnt = 0, pos = 0, codeLen = 9, n = s.length, eintrag;
        function reset() { dict = []; for (i = 0; i < 256; i++) dict[i] = String.fromCharCode(i); dict[256] = null; dict[257] = null; codeLen = 9; prev = null; }
        reset();
        while (true) {
            while (bitcnt < codeLen && pos < n) { bitbuf = (bitbuf << 8) | s.charCodeAt(pos++); bitcnt += 8; }
            if (bitcnt < codeLen) break;
            code = (bitbuf >>> (bitcnt - codeLen)) & ((1 << codeLen) - 1); bitcnt -= codeLen;
            if (code === 256) { reset(); continue; }
            if (code === 257) break;
            if (prev === null) { eintrag = dict[code]; }
            else if (code < dict.length) { eintrag = dict[code]; dict.push(prev + eintrag.charAt(0)); }
            else { eintrag = prev + prev.charAt(0); dict.push(eintrag); }
            out.push(eintrag); prev = eintrag;
            var grenze = dict.length + (early ? 1 : 0);
            if (grenze >= 4096) codeLen = 12; else if (grenze >= 2048) codeLen = 12; else if (grenze >= 1024) codeLen = 11; else if (grenze >= 512) codeLen = 10;
        }
        return out.join("");
    }
    function runlength(s) {
        var out = [], i = 0, l, n = s.length, k;
        while (i < n) {
            l = s.charCodeAt(i++);
            if (l === 128) break;
            if (l < 128) { for (k = 0; k <= l && i < n; k++) out.push(s.charCodeAt(i++)); }
            else { var b = s.charCodeAt(i++); for (k = 0; k < 257 - l; k++) out.push(b); }
        }
        return pufferZuString(out, out.length);
    }

    /* ------------------------------------------------------------ PDF-Objekte */
    function PDict() { this.m = {}; }
    PDict.prototype.get = function (k) { return this.m.hasOwnProperty(k) ? this.m[k] : undefined; };
    PDict.prototype.has = function (k) { return this.m.hasOwnProperty(k); };
    PDict.prototype.keys = function () { var a = [], k; for (k in this.m) if (this.m.hasOwnProperty(k)) a.push(k); return a; };
    function PRef(n, g) { this.num = n; this.gen = g; }
    function PStr(v) { this.v = v; }
    function PKw(v) { this.kw = v; }
    K.PDict = PDict; K.PRef = PRef; K.PStr = PStr;

    function istDict(v) { return v instanceof PDict; }
    function istRef(v) { return v instanceof PRef; }
    function istName(v) { return typeof v === "string" && v.charAt(0) === "/"; }
    function num(v) { return typeof v === "number" ? v : 0; }

    var WS = { 0: 1, 9: 1, 10: 1, 12: 1, 13: 1, 32: 1 };
    var DELIM = { 40: 1, 41: 1, 60: 1, 62: 1, 91: 1, 93: 1, 123: 1, 125: 1, 47: 1, 37: 1 };
    function istRegulaer(c) { return !WS[c] && !DELIM[c]; }

    function ws(s, p, ende) {
        var c;
        while (p < ende) {
            c = s.charCodeAt(p);
            if (WS[c]) p++;
            else if (c === 37) { while (p < ende && s.charCodeAt(p) !== 10 && s.charCodeAt(p) !== 13) p++; }
            else break;
        }
        return p;
    }
    function nameLesen(s, p, ende) {
        var start = ++p;  // hinter '/'
        while (p < ende && istRegulaer(s.charCodeAt(p))) p++;
        var roh = s.substring(start, p);
        if (roh.indexOf("#") >= 0) roh = roh.replace(/#([0-9A-Fa-f]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
        return { v: "/" + roh, p: p };
    }
    function stringLesen(s, p, ende) {
        var tiefe = 1, out = [], c;
        p++;
        while (p < ende && tiefe > 0) {
            c = s.charAt(p++);
            if (c === "\\") {
                var d = s.charAt(p++);
                if (d === "n") out.push("\n"); else if (d === "r") out.push("\r"); else if (d === "t") out.push("\t");
                else if (d === "b") out.push("\b"); else if (d === "f") out.push("\f");
                else if (d >= "0" && d <= "7") { var oct = d; while (oct.length < 3 && s.charAt(p) >= "0" && s.charAt(p) <= "7") oct += s.charAt(p++); out.push(String.fromCharCode(parseInt(oct, 8) & 255)); }
                else if (d === "\r") { if (s.charAt(p) === "\n") p++; }
                else if (d === "\n") { }
                else out.push(d);
            } else if (c === "(") { tiefe++; out.push(c); }
            else if (c === ")") { tiefe--; if (tiefe > 0) out.push(c); }
            else out.push(c);
        }
        return { v: new PStr(out.join("")), p: p };
    }
    function hexLesen(s, p, ende) {
        var start = ++p, e = s.indexOf(">", p);
        if (e < 0 || e > ende) e = ende;
        var hex = s.substring(start, e).replace(/[^0-9A-Fa-f]/g, ""), out = [], i;
        if (hex.length % 2) hex += "0";
        for (i = 0; i < hex.length; i += 2) out.push(String.fromCharCode(parseInt(hex.substr(i, 2), 16)));
        return { v: new PStr(out.join("")), p: e + 1 };
    }
    var RE_REF = /^[\s\0]+(\d+)[\s\0]+R(?![^\s\0\/\[\]<>(){}%])/;

    /** Liest ein Objekt ab Position p. Gibt {v, p} zurück. */
    function objekt(s, p, ende, tiefe) {
        tiefe = tiefe || 0;
        if (tiefe > 300) throw new Error("Verschachtelung zu tief");
        p = ws(s, p, ende);
        if (p >= ende) return { v: new PKw(""), p: p };
        var c = s.charCodeAt(p), r;
        if (c === 60) {                                   // '<'
            if (s.charCodeAt(p + 1) === 60) {             // '<<'
                var d = new PDict(); p += 2;
                for (;;) {
                    p = ws(s, p, ende);
                    if (p >= ende) break;
                    if (s.charCodeAt(p) === 62 && s.charCodeAt(p + 1) === 62) { p += 2; break; }
                    if (s.charCodeAt(p) !== 47) {          // Müll im Dict: überspringen
                        r = objekt(s, p, ende, tiefe + 1); p = r.p;
                        if (r.v instanceof PKw && (r.v.kw === "" || r.v.kw === "endobj" || r.v.kw === "stream")) { p -= r.v.kw.length; break; }
                        continue;
                    }
                    r = nameLesen(s, p, ende); var key = r.v.substr(1); p = r.p;
                    r = objekt(s, p, ende, tiefe + 1); p = r.p;
                    if (r.v instanceof PKw) { if (r.v.kw === "endobj" || r.v.kw === "stream") { p -= r.v.kw.length; break; } continue; }
                    d.m[key] = r.v;
                }
                return { v: d, p: p };
            }
            return hexLesen(s, p, ende);
        }
        if (c === 91) {                                   // '['
            var a = []; p++;
            for (;;) {
                p = ws(s, p, ende);
                if (p >= ende) break;
                if (s.charCodeAt(p) === 93) { p++; break; }
                r = objekt(s, p, ende, tiefe + 1); p = r.p;
                if (r.v instanceof PKw) { if (r.v.kw === "endobj" || r.v.kw === "stream" || r.v.kw === "") { p -= r.v.kw.length; break; } continue; }
                a.push(r.v);
            }
            return { v: a, p: p };
        }
        if (c === 47) return nameLesen(s, p, ende);
        if (c === 40) return stringLesen(s, p, ende);
        if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) return { v: new PKw(s.charAt(p)), p: p + 1 };
        // Zahl oder Schlüsselwort
        var start = p;
        while (p < ende && istRegulaer(s.charCodeAt(p))) p++;
        var tok = s.substring(start, p);
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
            if (/^\d+$/.test(tok)) {
                var m = RE_REF.exec(s.substr(p, 40));
                if (m) return { v: new PRef(parseInt(tok, 10), parseInt(m[1], 10)), p: p + m[0].length };
            }
            return { v: parseFloat(tok), p: p };
        }
        if (tok === "true") return { v: true, p: p };
        if (tok === "false") return { v: false, p: p };
        if (tok === "null") return { v: null, p: p };
        if (tok === "") return { v: new PKw(s.charAt(p)), p: p + 1 };   // Fremdzeichen
        return { v: new PKw(tok), p: p };
    }
    K.objekt = objekt;

    /* ------------------------------------------------------------- Dokument */
    function Dokument(s) {
        this.s = s;
        this.objs = {};            // num → { v, sStart, sEnde, dict }
        this.trailer = new PDict();
        this.fehler = [];
        this.verschluesselt = false;
        this.version = "";
        this.cacheDaten = {};
        this.cacheIcc = {};
    }
    Dokument.prototype.aufloesen = function (v, tiefe) {
        tiefe = tiefe || 0;
        while (istRef(v) && tiefe++ < 32) {
            var o = this.objs[v.num];
            v = o ? o.v : null;
        }
        return v;
    };
    Dokument.prototype.hole = function (d, key) {          // Dict-Eintrag, aufgelöst
        d = this.aufloesen(d);
        if (!istDict(d)) return undefined;
        return this.aufloesen(d.get(key));
    };
    Dokument.prototype.refNum = function (v) { return istRef(v) ? v.num : -1; };

    Dokument.prototype.einlesen = function () {
        var s = this.s, n = s.length, self = this;
        var kopf = /%PDF-(\d\.\d)/.exec(s.substr(0, 1024));
        this.version = kopf ? kopf[1] : "";
        var re = /(\d+)[ \t\r\n\f\0]+(\d+)[ \t\r\n\f\0]+obj\b/g, m, pos, r, anz = 0;
        while ((m = re.exec(s)) !== null) {
            pos = m.index + m[0].length;
            var nummer = parseInt(m[1], 10), gen = parseInt(m[2], 10);
            try { r = objekt(s, pos, n, 0); } catch (e) { this.fehler.push("Objekt " + nummer + ": " + e.message); continue; }
            var eintrag = { v: r.v, gen: gen };
            pos = ws(s, r.p, n);
            if (s.substr(pos, 6) === "stream") {
                pos += 6;
                if (s.charCodeAt(pos) === 13) pos++;
                if (s.charCodeAt(pos) === 10) pos++;
                var start = pos, ende = -1, len = istDict(r.v) ? r.v.get("Length") : undefined;
                if (istRef(len)) { var lo = this.objs[len.num]; len = lo ? lo.v : undefined; if (typeof len !== "number") len = this.laengeSpaeter(len, nummer); }
                if (typeof len === "number" && len >= 0 && start + len <= n) {
                    var probe = s.substr(start + len, 12);
                    if (/^[\r\n\s]{0,3}endstream/.test(probe)) ende = start + len;
                }
                if (ende < 0) {
                    ende = s.indexOf("endstream", start);
                    if (ende < 0) ende = n;
                    // Zeilenende vor 'endstream' gehört nicht zu den Daten
                    if (s.charCodeAt(ende - 1) === 10) ende--;
                    if (s.charCodeAt(ende - 1) === 13) ende--;
                }
                eintrag.sStart = start; eintrag.sEnde = ende;
                re.lastIndex = ende;
            }
            this.objs[nummer] = eintrag;
            anz++;
            if (istDict(r.v)) {
                var typ = r.v.get("Type");
                if (typ === "/ObjStm" && eintrag.sStart !== undefined) this.objektStrom(nummer, eintrag);
                else if (typ === "/XRef") this.trailerMischen(r.v);
            }
        }
        // klassische Trailer
        var tre = /trailer/g, tm;
        while ((tm = tre.exec(s)) !== null) {
            try { var tr = objekt(s, tm.index + 7, n, 0); if (istDict(tr.v)) this.trailerMischen(tr.v); } catch (e) { }
        }
        this.verschluesselt = this.trailer.has("Encrypt");
        this.anzahlObjekte = anz;
    };
    Dokument.prototype.laengeSpaeter = function (ref, objNum) {
        // /Length steht als Referenz auf ein Objekt, das erst später in der Datei kommt:
        // schnell nachschlagen, ohne die Reihenfolge zu stören.
        if (!istRef(ref)) return undefined;
        var re = new RegExp("(?:^|[^0-9])" + ref.num + "[ \\t\\r\\n]+\\d+[ \\t\\r\\n]+obj[ \\t\\r\\n]*(\\d+)"), m = re.exec(this.s);
        return m ? parseInt(m[1], 10) : undefined;
    };
    Dokument.prototype.trailerMischen = function (d) {
        var ks = d.keys(), i;
        for (i = 0; i < ks.length; i++) if (ks[i] === "Root" || ks[i] === "Info" || ks[i] === "Encrypt" || ks[i] === "ID") this.trailer.m[ks[i]] = d.get(ks[i]);
    };
    Dokument.prototype.objektStrom = function (nummer, eintrag) {
        var daten = this.stromDaten(nummer, eintrag);
        if (!daten) return;
        var d = eintrag.v, nObj = num(this.aufloesen(d.get("N"))), first = num(this.aufloesen(d.get("First"))), p = 0, i, r1, r2;
        for (i = 0; i < nObj; i++) {
            r1 = objekt(daten, p, first, 0); r2 = objekt(daten, r1.p, first, 0); p = r2.p;
            if (typeof r1.v !== "number" || typeof r2.v !== "number") break;
            try {
                var o = objekt(daten, first + r2.v, daten.length, 0);
                this.objs[r1.v] = { v: o.v, gen: 0, ausStrom: nummer };
            } catch (e) { this.fehler.push("Objektstrom " + nummer + "/" + r1.v + ": " + e.message); }
        }
    };
    /** Dekodierte Stromdaten (Binär-String) oder null (Bild/unbekannter Filter/verschlüsselt). */
    Dokument.prototype.stromDaten = function (nummer, eintrag) {
        eintrag = eintrag || this.objs[nummer];
        if (!eintrag || eintrag.sStart === undefined) return null;
        if (this.cacheDaten.hasOwnProperty(nummer)) return this.cacheDaten[nummer];
        var d = eintrag.v, daten = this.s.substring(eintrag.sStart, eintrag.sEnde);
        var filter = this.aufloesen(d.get("Filter")), parms = this.aufloesen(d.get("DecodeParms")), i, f, pm;
        if (filter === undefined || filter === null) filter = [];
        if (!(filter instanceof Array)) filter = [filter];
        if (!(parms instanceof Array)) parms = [parms];
        var ok = true;
        for (i = 0; i < filter.length; i++) {
            f = this.aufloesen(filter[i]); pm = this.aufloesen(parms[i]);
            if (f === "/FlateDecode" || f === "/Fl") daten = K.inflate(daten, 0, daten.length);
            else if (f === "/ASCII85Decode" || f === "/A85") daten = ascii85(daten);
            else if (f === "/ASCIIHexDecode" || f === "/AHx") daten = asciihex(daten);
            else if (f === "/LZWDecode" || f === "/LZW") daten = lzw(daten, !(istDict(pm) && num(pm.get("EarlyChange")) === 0));
            else if (f === "/RunLengthDecode" || f === "/RL") daten = runlength(daten);
            else { ok = false; break; }                      // DCT, JPX, CCITT, JBIG2, Crypt …
            if (istDict(pm) && num(this.aufloesen(pm.get("Predictor"))) >= 10) daten = entpraedizieren(daten, pm);
        }
        var erg = ok ? daten : null;
        this.cacheDaten[nummer] = erg;
        return erg;
    };

    /* -------------------------------------------------------------- ICC */
    function u32(s, p) { return ((s.charCodeAt(p) << 24) >>> 0) + (s.charCodeAt(p + 1) << 16) + (s.charCodeAt(p + 2) << 8) + s.charCodeAt(p + 3); }
    function iccLesen(daten) {
        if (!daten || daten.length < 132) return null;
        var erg = { raum: daten.substr(16, 4).replace(/\s+$/, ""), klasse: daten.substr(12, 4).replace(/\s+$/, ""), version: daten.charCodeAt(8), beschreibung: "" };
        var nTags = u32(daten, 128), i, sig, off, size, p = 132;
        if (nTags > 500) return erg;
        for (i = 0; i < nTags && p + 12 <= daten.length; i++, p += 12) {
            sig = daten.substr(p, 4); off = u32(daten, p + 4); size = u32(daten, p + 8);
            if (sig !== "desc" || off + 12 > daten.length) continue;
            var typ = daten.substr(off, 4);
            if (typ === "desc") {
                var cnt = u32(daten, off + 8);
                erg.beschreibung = daten.substr(off + 12, Math.max(0, Math.min(cnt - 1, daten.length - off - 12))).replace(/\0+$/, "");
            } else if (typ === "mluc") {
                var nrec = u32(daten, off + 8), rlen = u32(daten, off + 16), roff = u32(daten, off + 20), k, str = [];
                if (nrec >= 1 && off + roff + rlen <= daten.length) {
                    for (k = 0; k + 1 < rlen; k += 2) str.push(String.fromCharCode((daten.charCodeAt(off + roff + k) << 8) | daten.charCodeAt(off + roff + k + 1)));
                    erg.beschreibung = str.join("").replace(/\0+$/, "");
                }
            }
            break;
        }
        return erg;
    }
    Dokument.prototype.icc = function (ref) {
        var n = this.refNum(ref);
        if (n < 0) return null;
        if (this.cacheIcc.hasOwnProperty(n)) return this.cacheIcc[n];
        var o = this.objs[n], erg = null;
        if (o && istDict(o.v)) {
            erg = iccLesen(this.stromDaten(n, o));
            if (!erg) erg = { raum: "", beschreibung: "", klasse: "" };
            erg.n = num(this.aufloesen(o.v.get("N")));
        }
        this.cacheIcc[n] = erg;
        return erg;
    };

    /* ------------------------------------------------------- Farbräume */
    var PROZESS = { "/Cyan": 1, "/Magenta": 1, "/Yellow": 1, "/Black": 1 };
    /**
     * Klassifiziert einen Farbraum-Wert (Name, Array oder Referenz).
     * Rückgabe: { typ, label, spots:[] }  typ ∈ CMYK RGB Grau Lab Sonderfarbe DeviceN Muster Unbekannt
     */
    Dokument.prototype.farbraum = function (cs, tiefe) {
        tiefe = tiefe || 0;
        cs = this.aufloesen(cs);
        if (tiefe > 8) return { typ: "Unbekannt", label: "?", spots: [] };
        if (istName(cs)) {
            switch (cs) {
                case "/DeviceCMYK": case "/CMYK": return { typ: "CMYK", label: "DeviceCMYK", spots: [] };
                case "/DeviceRGB": case "/RGB": return { typ: "RGB", label: "DeviceRGB", spots: [] };
                case "/DeviceGray": case "/G": return { typ: "Grau", label: "DeviceGray", spots: [] };
                case "/Pattern": return { typ: "Muster", label: "Muster", spots: [] };
                case "/CalRGB": return { typ: "RGB", label: "CalRGB", spots: [] };
                case "/CalGray": return { typ: "Grau", label: "CalGray", spots: [] };
                case "/Lab": return { typ: "Lab", label: "Lab", spots: [] };
                case "/Indexed": case "/I": return { typ: "Unbekannt", label: "Indiziert (?)", spots: [] };
            }
            return { typ: "Unbekannt", label: cs.substr(1), spots: [] };
        }
        if (cs instanceof Array && cs.length) {
            var fam = this.aufloesen(cs[0]), sub;
            if (istName(fam)) switch (fam) {
                case "/ICCBased": {
                    var icc = this.icc(cs[1]), n = icc ? icc.n : 0, typ = n === 4 ? "CMYK" : n === 3 ? "RGB" : n === 1 ? "Grau" : "Unbekannt";
                    if (icc && !n) typ = icc.raum === "CMYK" ? "CMYK" : icc.raum === "RGB" ? "RGB" : icc.raum === "GRAY" ? "Grau" : "Unbekannt";
                    var bez = icc && icc.beschreibung ? icc.beschreibung : (icc && icc.raum ? "ohne Namen, " + icc.raum : "unlesbar");
                    return { typ: typ, label: "ICC " + typ + " · " + bez, spots: [] };
                }
                case "/Separation": {
                    var sname = this.aufloesen(cs[1]); sname = istName(sname) ? sname.substr(1) : "?";
                    sub = this.farbraum(cs[2], tiefe + 1);
                    if (sname === "All") return { typ: "CMYK", label: "Passermarkenfarbe (All)", spots: [] };
                    if (sname === "None") return { typ: "Grau", label: "Separation None (unsichtbar)", spots: [] };
                    return { typ: "Sonderfarbe", label: "Sonderfarbe " + sname, spots: [sname], alternativ: sub.typ };
                }
                case "/DeviceN": {
                    var namen = this.aufloesen(cs[1]) || [], i, liste = [], spots = [], nn;
                    if (!(namen instanceof Array)) namen = [namen];
                    for (i = 0; i < namen.length; i++) { nn = this.aufloesen(namen[i]); nn = istName(nn) ? nn.substr(1) : "?"; liste.push(nn); if (!PROZESS["/" + nn] && nn !== "None") spots.push(nn); }
                    if (!spots.length) return { typ: "CMYK", label: "DeviceN (" + liste.join(", ") + ")", spots: [] };
                    return { typ: "Sonderfarbe", label: "DeviceN " + liste.join(" + "), spots: spots, alternativ: this.farbraum(cs[2], tiefe + 1).typ };
                }
                case "/Indexed": case "/I": {
                    sub = this.farbraum(cs[1], tiefe + 1);
                    return { typ: sub.typ, label: "Indiziert → " + sub.label, spots: sub.spots };
                }
                case "/Pattern": {
                    if (cs.length > 1) { sub = this.farbraum(cs[1], tiefe + 1); return { typ: "Muster", label: "Muster", spots: [], basis: sub }; }
                    return { typ: "Muster", label: "Muster", spots: [] };
                }
                case "/CalRGB": return { typ: "RGB", label: "CalRGB", spots: [] };
                case "/CalGray": return { typ: "Grau", label: "CalGray", spots: [] };
                case "/CalCMYK": return { typ: "CMYK", label: "CalCMYK", spots: [] };
                case "/Lab": return { typ: "Lab", label: "Lab", spots: [] };
                case "/DeviceCMYK": case "/DeviceRGB": case "/DeviceGray": return this.farbraum(fam, tiefe + 1);
            }
        }
        return { typ: "Unbekannt", label: "?", spots: [] };
    };

    /* ------------------------------------------------ Inhaltsströme */
    function Zaehler() {
        this.vektor = {}; this.bilder = {}; this.verlauf = {}; this.text = 0; this.unsichtbar = 0; this.fonts = {}; this.bildNums = {}; this.spots = {};
        // Reinzeichnung
        this.platzierungen = [];                 // Bildplatzierungen mit effektiver Auflösung
        this.linien = { min: Infinity, duenn: 0, nullbreit: 0, minSeite: 0 };
        this.tac = { max: 0, maxSeite: 0, ueber: 0 };
        this.schwarzText = 0; this.tiefschwarzText = 0; this.rgbText = 0; this.grauText = 0;
        this.weissUeberdruckt = 0; this.passer = 0; this.transparenz = 0;
    }
    Zaehler.prototype.zaehle = function (topf, fr, n) {
        n = n || 1;
        var key = fr.label;
        if (!this[topf][key]) this[topf][key] = { typ: fr.typ, label: fr.label, n: 0 };
        this[topf][key].n += n;
        var i; for (i = 0; i < fr.spots.length; i++) this.spots[fr.spots[i]] = (this.spots[fr.spots[i]] || 0) + n;
    };
    Zaehler.prototype.addiere = function (z, mal) {
        mal = mal || 1;
        var t, k, i, self = this;
        ["vektor", "bilder", "verlauf"].forEach(function (t) {
            for (k in z[t]) if (z[t].hasOwnProperty(k)) { if (!self[t][k]) self[t][k] = { typ: z[t][k].typ, label: k, n: 0 }; self[t][k].n += z[t][k].n * mal; }
        });
        this.text += z.text * mal; this.unsichtbar += z.unsichtbar * mal;
        for (k in z.fonts) if (z.fonts.hasOwnProperty(k)) this.fonts[k] = (this.fonts[k] || 0) + z.fonts[k] * mal;
        for (k in z.bildNums) if (z.bildNums.hasOwnProperty(k)) this.bildNums[k] = (this.bildNums[k] || 0) + z.bildNums[k] * mal;
        for (k in z.spots) if (z.spots.hasOwnProperty(k)) this.spots[k] = (this.spots[k] || 0) + z.spots[k] * mal;
        for (i = 0; i < z.platzierungen.length; i++) { var q = z.platzierungen[i], c = {}; for (k in q) if (q.hasOwnProperty(k)) c[k] = q[k]; this.platzierungen.push(c); }
        if (z.linien.min < this.linien.min) { this.linien.min = z.linien.min; this.linien.minSeite = z.linien.minSeite; }
        this.linien.duenn += z.linien.duenn * mal; this.linien.nullbreit += z.linien.nullbreit * mal;
        if (z.tac.max > this.tac.max) { this.tac.max = z.tac.max; this.tac.maxSeite = z.tac.maxSeite; }
        this.tac.ueber += z.tac.ueber * mal;
        ["schwarzText", "tiefschwarzText", "rgbText", "grauText", "weissUeberdruckt", "passer", "transparenz"].forEach(function (f) { self[f] += z[f] * mal; });
    };
    /** Seitennummer nachtragen (für Platzierungen/Minima aus Formularen) */
    Zaehler.prototype.seiteSetzen = function (nr) {
        var i; for (i = 0; i < this.platzierungen.length; i++) if (!this.platzierungen[i].seite) this.platzierungen[i].seite = nr;
        if (!this.linien.minSeite) this.linien.minSeite = nr;
        if (!this.tac.maxSeite) this.tac.maxSeite = nr;
    };
    K.GRENZEN = { haarlinie: 0.25, farbauftrag: 300, ppiHalbton: 300, ppiKritisch: 150, ppiStrich: 600, ppiStrichKritisch: 300 };

    function matMul(m, n) {   // m × n (erst m, dann n)
        return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
    }
    function skalierung(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 0; }
    function farbauftrag(fr, werte) {
        if (!werte) return -1;
        if (fr.typ === "CMYK" && werte.length === 4) return Math.round((werte[0] + werte[1] + werte[2] + werte[3]) * 100);
        if (fr.typ === "Grau" && werte.length === 1) return Math.round((1 - werte[0]) * 100);
        return -1;
    }
    function istWeiss(fr, werte) {
        if (!werte) return false;
        var i, alle0 = true, alle1 = true;
        for (i = 0; i < werte.length; i++) { if (werte[i] > 0.005) alle0 = false; if (werte[i] < 0.995) alle1 = false; }
        if (fr.typ === "CMYK") return werte.length === 4 && alle0;
        if (fr.typ === "RGB") return werte.length === 3 && alle1;
        if (fr.typ === "Grau") return werte.length === 1 && alle1;
        if (fr.typ === "Sonderfarbe") return alle0;   // Tonwert 0
        return false;
    }

    var INLINE_CS = { "/G": "/DeviceGray", "/RGB": "/DeviceRGB", "/CMYK": "/DeviceCMYK", "/I": "/Indexed" };

    /**
     * Zählt Farbraum-Verwendungen, Bildplatzierungen, Linienstärken, Farbauftrag usw.
     * in einem Inhaltsstrom.
     * ress: Ressourcen-Dict (aufgelöst), stapel: Objekt-Nummern zur Zykluserkennung,
     * ctm0: Transformationsmatrix beim Eintritt (Seite: Einheitsmatrix)
     */
    Dokument.prototype.inhaltZaehlen = function (text, ress, stapel, ctm0) {
        var self = this, z = new Zaehler(), n = text.length, p = 0, c, tok, ops = [], G = K.GRENZEN;
        var csDict = this.hole(ress, "ColorSpace"), xoDict = this.hole(ress, "XObject"), shDict = this.hole(ress, "Shading"),
            patDict = this.hole(ress, "Pattern"), fontDict = this.hole(ress, "Font"), gsDict = this.hole(ress, "ExtGState");
        var grau = { typ: "Grau", label: "DeviceGray", spots: [] };
        var gs = { fuell: grau, kontur: grau, fw: [0], kw: [0], tr: 0, lw: 1, op: false, OP: false, transp: false, ctm: ctm0 || [1, 0, 0, 1, 0, 0] }, gsStapel = [];
        function kopie(g) { return { fuell: g.fuell, kontur: g.kontur, fw: g.fw, kw: g.kw, tr: g.tr, lw: g.lw, op: g.op, OP: g.OP, transp: g.transp, ctm: g.ctm }; }
        function zahlen(k) { var a = [], i; for (i = Math.max(0, ops.length - k); i < ops.length; i++) if (typeof ops[i] === "number") a.push(ops[i]); return a; }
        function csName(name) {
            var direkt = self.farbraum(name);
            if (direkt.typ !== "Unbekannt" || name === "/Pattern") return direkt;
            var eintrag = csDict ? csDict.get(name.substr(1)) : undefined;
            return eintrag !== undefined ? self.farbraum(eintrag) : direkt;
        }
        function gefuellt() {                      // ein Objekt wird mit der Füllfarbe gemalt
            var t = farbauftrag(gs.fuell, gs.fw);
            if (t > z.tac.max) { z.tac.max = t; z.tac.maxSeite = 0; }
            if (t > G.farbauftrag) z.tac.ueber++;
            if (gs.op && istWeiss(gs.fuell, gs.fw)) z.weissUeberdruckt++;
            if (gs.fuell.label === "Passermarkenfarbe (All)") z.passer++;
            if (gs.transp) z.transparenz++;
        }
        function gestrichen() {                     // ein Objekt wird mit der Konturfarbe gestrichen
            var b = gs.lw * skalierung(gs.ctm);
            if (b < z.linien.min) { z.linien.min = b; z.linien.minSeite = 0; }
            if (gs.lw <= 0) z.linien.nullbreit++; else if (b < G.haarlinie) z.linien.duenn++;
            var t = farbauftrag(gs.kontur, gs.kw);
            if (t > z.tac.max) { z.tac.max = t; z.tac.maxSeite = 0; }
            if (t > G.farbauftrag) z.tac.ueber++;
            if (gs.OP && istWeiss(gs.kontur, gs.kw)) z.weissUeberdruckt++;
            if (gs.kontur.label === "Passermarkenfarbe (All)") z.passer++;
            if (gs.transp) z.transparenz++;
        }
        function bildPlatzieren(num_, w, h, maske, fr, bpc) {
            var m = gs.ctm, wpt = Math.sqrt(m[0] * m[0] + m[1] * m[1]), hpt = Math.sqrt(m[2] * m[2] + m[3] * m[3]);
            var ppiX = wpt > 0 ? w / (wpt / 72) : 0, ppiY = hpt > 0 ? h / (hpt / 72) : 0;
            z.platzierungen.push({ num: num_, w: w, h: h, wpt: wpt, hpt: hpt, ppi: Math.round(Math.min(ppiX || ppiY, ppiY || ppiX)), maske: !!maske, label: fr ? fr.label : "", typ: fr ? fr.typ : "", bpc: bpc || 0, seite: 0 });
            if (gs.transp) z.transparenz++;
        }
        function musterZaehlen(pname, basis) {
            var pat = self.hole(patDict, pname.substr(1));
            if (!istDict(pat)) { z.zaehle("vektor", { typ: "Muster", label: "Muster (unbekannt)", spots: [] }); return; }
            var ptyp = num(self.aufloesen(pat.get("PatternType")));
            if (ptyp === 2) {
                var sh = self.hole(pat, "Shading"), fr = self.farbraum(istDict(sh) ? sh.get("ColorSpace") : null);
                z.zaehle("verlauf", { typ: fr.typ, label: fr.label, spots: fr.spots });
            } else {
                if (num(self.aufloesen(pat.get("PaintType"))) === 2 && basis) z.zaehle("vektor", { typ: basis.typ, label: basis.label + " (Musterfüllung)", spots: basis.spots });
                var pnum = patDict ? self.refNum(patDict.get(pname.substr(1))) : -1;
                if (pnum >= 0 && stapel.indexOf(pnum) < 0) {
                    var daten = self.stromDaten(pnum), pm = self.aufloesen(pat.get("Matrix"));
                    var ctm = (pm instanceof Array && pm.length === 6) ? matMul(pm.map(Number), ctm0 || [1, 0, 0, 1, 0, 0]) : (ctm0 || [1, 0, 0, 1, 0, 0]);
                    if (daten) z.addiere(self.inhaltZaehlen(daten, self.hole(pat, "Resources") || ress, stapel.concat([pnum]), ctm));
                }
            }
        }
        function extGState(name) {
            var eg = self.hole(gsDict, name.substr(1));
            if (!istDict(eg)) return;
            var v;
            if (eg.has("LW")) gs.lw = num(self.aufloesen(eg.get("LW")));
            if (eg.has("OP")) { gs.OP = self.aufloesen(eg.get("OP")) === true; if (!eg.has("op")) gs.op = gs.OP; }
            if (eg.has("op")) gs.op = self.aufloesen(eg.get("op")) === true;
            var transp = false;
            v = self.aufloesen(eg.get("CA")); if (typeof v === "number" && v < 0.999) transp = true;
            v = self.aufloesen(eg.get("ca")); if (typeof v === "number" && v < 0.999) transp = true;
            v = self.aufloesen(eg.get("SMask")); if (istDict(v)) transp = true;
            v = self.aufloesen(eg.get("BM")); if (v instanceof Array && v.length) v = self.aufloesen(v[0]); if (istName(v) && v !== "/Normal" && v !== "/Compatible") transp = true;
            if (eg.has("CA") || eg.has("ca") || eg.has("SMask") || eg.has("BM")) gs.transp = transp;
        }
        function op(name) {
            var i, fr, w;
            switch (name) {
                case "q": gsStapel.push(kopie(gs)); if (gsStapel.length > 256) gsStapel.shift(); break;
                case "Q": if (gsStapel.length) gs = gsStapel.pop(); break;
                case "cm": w = zahlen(6); if (w.length === 6) gs.ctm = matMul(w, gs.ctm); break;
                case "w": w = zahlen(1); if (w.length) gs.lw = w[0]; break;
                case "gs": if (ops.length && istName(ops[ops.length - 1])) extGState(ops[ops.length - 1]); break;
                case "k": gs.fuell = { typ: "CMYK", label: "DeviceCMYK", spots: [] }; gs.fw = zahlen(4); z.zaehle("vektor", gs.fuell); break;
                case "K": gs.kontur = { typ: "CMYK", label: "DeviceCMYK", spots: [] }; gs.kw = zahlen(4); z.zaehle("vektor", gs.kontur); break;
                case "rg": gs.fuell = { typ: "RGB", label: "DeviceRGB", spots: [] }; gs.fw = zahlen(3); z.zaehle("vektor", gs.fuell); break;
                case "RG": gs.kontur = { typ: "RGB", label: "DeviceRGB", spots: [] }; gs.kw = zahlen(3); z.zaehle("vektor", gs.kontur); break;
                case "g": gs.fuell = grau; gs.fw = zahlen(1); z.zaehle("vektor", gs.fuell); break;
                case "G": gs.kontur = grau; gs.kw = zahlen(1); z.zaehle("vektor", gs.kontur); break;
                case "cs": case "CS":
                    if (ops.length && istName(ops[ops.length - 1])) { fr = csName(ops[ops.length - 1]); if (name === "cs") { gs.fuell = fr; gs.fw = null; } else { gs.kontur = fr; gs.kw = null; } }
                    break;
                case "sc": case "scn": case "SC": case "SCN": {
                    var fuellt = (name === "sc" || name === "scn");
                    fr = fuellt ? gs.fuell : gs.kontur;
                    if (fr.typ === "Muster") { if (ops.length && istName(ops[ops.length - 1])) musterZaehlen(ops[ops.length - 1], fr.basis); }
                    else { z.zaehle("vektor", fr); w = zahlen(ops.length); if (fuellt) gs.fw = w; else gs.kw = w; }
                    break;
                }
                case "f": case "F": case "f*": gefuellt(); break;
                case "S": case "s": gestrichen(); break;
                case "B": case "B*": case "b": case "b*": gefuellt(); gestrichen(); break;
                case "sh": {
                    if (ops.length && istName(ops[ops.length - 1])) {
                        var sh = self.hole(shDict, ops[ops.length - 1].substr(1));
                        fr = self.farbraum(istDict(sh) ? sh.get("ColorSpace") : null);
                        z.zaehle("verlauf", fr);
                        if (gs.transp) z.transparenz++;
                    }
                    break;
                }
                case "Do": {
                    if (!ops.length || !istName(ops[ops.length - 1]) || !xoDict) break;
                    var xref = xoDict.get(ops[ops.length - 1].substr(1)), xnum = self.refNum(xref), xo = self.aufloesen(xref);
                    if (!istDict(xo)) break;
                    var st = self.aufloesen(xo.get("Subtype"));
                    if (st === "/Image") {
                        if (xnum >= 0) z.bildNums[xnum] = (z.bildNums[xnum] || 0) + 1;
                        var bi = bildInfo(self, xnum);
                        if (bi) bildPlatzieren(xnum, bi.w, bi.h, bi.maske, bi, bi.bpc);
                    }
                    else if (st === "/Form" && xnum >= 0 && stapel.indexOf(xnum) < 0) {
                        var fm = self.aufloesen(xo.get("Matrix")), ctm = gs.ctm;
                        if (fm instanceof Array && fm.length === 6) ctm = matMul(fm.map(Number), ctm);
                        var key = xnum + "|" + (Math.round(skalierung(ctm) * 1000) / 1000);
                        if (!self.cacheForm) self.cacheForm = {};
                        if (!self.cacheForm.hasOwnProperty(key)) {
                            var fd = self.stromDaten(xnum);
                            self.cacheForm[key] = fd ? self.inhaltZaehlen(fd, self.hole(xo, "Resources") || ress, stapel.concat([xnum]), ctm) : new Zaehler();
                        }
                        z.addiere(self.cacheForm[key]);
                        if (gs.transp) z.transparenz++;
                        var grp = self.hole(xo, "Group"); if (istDict(grp) && self.aufloesen(grp.get("S")) === "/Transparency" && (grp.has("K") || grp.has("I"))) { /* Gruppe – keine eigene Zählung */ }
                    }
                    break;
                }
                case "Tf": {
                    if (ops.length >= 2 && istName(ops[ops.length - 2]) && fontDict) {
                        var fn = self.refNum(fontDict.get(ops[ops.length - 2].substr(1)));
                        if (fn >= 0) z.fonts[fn] = (z.fonts[fn] || 0) + 1;
                    }
                    break;
                }
                case "Tr": if (ops.length) gs.tr = num(ops[ops.length - 1]); break;
                case "Tj": case "TJ": case "'": case "\"": {
                    z.text++;
                    if (gs.tr === 3 || gs.tr === 7) { z.unsichtbar++; break; }
                    if (gs.tr === 0 || gs.tr === 2 || gs.tr === 4 || gs.tr === 6) {
                        gefuellt();
                        if (gs.fuell.typ === "CMYK" && gs.fw && gs.fw.length === 4) { if (gs.fw[3] >= 0.99 && gs.fw[0] + gs.fw[1] + gs.fw[2] > 0.02) z.tiefschwarzText++; else if (gs.fw[3] >= 0.99) z.schwarzText++; }
                        else if (gs.fuell.typ === "RGB") z.rgbText++;
                        else if (gs.fuell.typ === "Grau" && gs.fw && gs.fw.length === 1 && gs.fw[0] <= 0.01) z.grauText++;
                    }
                    if (gs.tr === 1 || gs.tr === 2 || gs.tr === 5 || gs.tr === 6) gestrichen();
                    break;
                }
                case "BI": {
                    // Inline-Bild: Dict bis ID, dann Binärdaten bis EI
                    var d = new PDict(), r;
                    for (;;) {
                        p = ws(text, p, n);
                        if (p >= n) break;
                        if (text.substr(p, 2) === "ID" && (p + 2 >= n || WS[text.charCodeAt(p + 2)])) { p += 3; break; }
                        r = objekt(text, p, n, 0); p = r.p;
                        if (istName(r.v)) { var key2 = r.v.substr(1), r2 = objekt(text, p, n, 0); p = r2.p; d.m[key2] = r2.v; }
                        if (r.v instanceof PKw && r.v.kw === "") break;
                    }
                    var csv = d.get("CS") !== undefined ? d.get("CS") : d.get("ColorSpace"), iw = num(d.get("W") !== undefined ? d.get("W") : d.get("Width")), ih = num(d.get("H") !== undefined ? d.get("H") : d.get("Height"));
                    var ibpc = num(d.get("BPC") !== undefined ? d.get("BPC") : d.get("BitsPerComponent")), ifr;
                    if (d.get("IM") === true || d.get("ImageMask") === true) { ifr = { typ: "Grau", label: "Bitmap-Maske (1 Bit)", spots: [] }; z.zaehle("bilder", ifr); bildPlatzieren(-1, iw, ih, true, ifr, 1); }
                    else if (csv !== undefined) { if (istName(csv) && INLINE_CS[csv]) csv = INLINE_CS[csv]; var cfr = csName(istName(csv) ? csv : "/x"); ifr = { typ: cfr.typ, label: "Inline-Bild " + cfr.label, spots: [] }; z.zaehle("bilder", ifr); bildPlatzieren(-1, iw, ih, false, ifr, ibpc); }
                    var re = /[\s]EI(?=[\s]|$)/g; re.lastIndex = p;
                    var m = re.exec(text);
                    p = m ? m.index + m[0].length : n;
                    break;
                }
            }
            ops = [];
        }
        // Lexer
        while (p < n) {
            c = text.charCodeAt(p);
            if (WS[c]) { p++; continue; }
            if (c === 37) { while (p < n && text.charCodeAt(p) !== 10 && text.charCodeAt(p) !== 13) p++; continue; }
            if (c === 40) { var rs = stringLesen(text, p, n); p = rs.p; ops.push(rs.v); continue; }
            if (c === 60) {
                if (text.charCodeAt(p + 1) === 60) { var rd = objekt(text, p, n, 0); p = rd.p; ops.push(rd.v); continue; }
                var rh = hexLesen(text, p, n); p = rh.p; ops.push(rh.v); continue;
            }
            if (c === 91) { var ra = objekt(text, p, n, 0); p = ra.p; ops.push(ra.v); continue; }
            if (c === 47) { var rn = nameLesen(text, p, n); p = rn.p; ops.push(rn.v); continue; }
            if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { p++; continue; }
            var start = p;
            while (p < n && istRegulaer(text.charCodeAt(p))) p++;
            tok = text.substring(start, p);
            if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { ops.push(parseFloat(tok)); continue; }
            if (tok === "") { p++; continue; }
            op(tok);
            if (ops.length > 64) ops = [];
        }
        return z;
    };

    /* ------------------------------------------------------------ Seiten */
    function rect(a) {
        if (!(a instanceof Array) || a.length < 4) return null;
        var x0 = +a[0], y0 = +a[1], x1 = +a[2], y1 = +a[3];
        if (isNaN(x0) || isNaN(y0) || isNaN(x1) || isNaN(y1)) return null;
        return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
    }
    Dokument.prototype.rectAufloesen = function (v) {
        v = this.aufloesen(v);
        if (!(v instanceof Array)) return null;
        var a = [], i; for (i = 0; i < v.length; i++) a.push(this.aufloesen(v[i]));
        return rect(a);
    };
    Dokument.prototype.seiten = function () {
        var wurzel = this.hole(this.trailer, "Root"), erg = [], self = this, besucht = {};
        if (!istDict(wurzel)) {   // Katalog suchen
            var k; for (k in this.objs) if (this.objs.hasOwnProperty(k) && istDict(this.objs[k].v) && this.objs[k].v.get("Type") === "/Catalog") { wurzel = this.objs[k].v; this.trailer.m.Root = new PRef(parseInt(k, 10), 0); }
        }
        this.katalog = istDict(wurzel) ? wurzel : null;
        function lauf(ref, erbe, tiefe) {
            var n = self.refNum(ref), node = self.aufloesen(ref);
            if (!istDict(node) || tiefe > 60) return;
            if (n >= 0) { if (besucht[n]) return; besucht[n] = true; }
            var e = { Resources: erbe.Resources, MediaBox: erbe.MediaBox, CropBox: erbe.CropBox, Rotate: erbe.Rotate }, k;
            for (k in e) if (node.has(k)) e[k] = node.get(k);
            var typ = self.aufloesen(node.get("Type")), kids = self.aufloesen(node.get("Kids"));
            if (typ === "/Pages" || (kids instanceof Array && typ !== "/Page")) {
                if (kids instanceof Array) for (var i = 0; i < kids.length; i++) lauf(kids[i], e, tiefe + 1);
            } else if (typ === "/Page" || node.has("Contents") || node.has("MediaBox")) {
                erg.push({ num: n, dict: node, erbe: e });
            }
        }
        if (this.katalog) lauf(this.katalog.get("Pages"), {}, 0);
        if (!erg.length) {   // Notnagel: alle Seitenobjekte in Dateireihenfolge
            var nums = [], k2; for (k2 in this.objs) if (this.objs.hasOwnProperty(k2) && istDict(this.objs[k2].v) && this.objs[k2].v.get("Type") === "/Page") nums.push(parseInt(k2, 10));
            nums.sort(function (a, b) { return a - b; });
            for (var j = 0; j < nums.length; j++) { var nd = this.objs[nums[j]].v, eb = {}; ["Resources", "MediaBox", "CropBox", "Rotate"].forEach(function (kk) { var q = nd, t = 0; while (istDict(q) && t++ < 40) { if (q.has(kk)) { eb[kk] = q.get(kk); break; } q = self.aufloesen(q.get("Parent")); } }); erg.push({ num: nums[j], dict: nd, erbe: eb }); }
        }
        return erg;
    };

    /* --------------------------------------------------------- Schriften */
    Dokument.prototype.schrift = function (num_) {
        var f = this.aufloesen(new PRef(num_, 0));
        if (!istDict(f)) return null;
        var st = this.aufloesen(f.get("Subtype")), base = this.aufloesen(f.get("BaseFont")), fd = this.hole(f, "FontDescriptor"), eingebettet = false, teilmenge = false;
        if (st === "/Type0") {
            var desc = this.aufloesen(f.get("DescendantFonts"));
            if (desc instanceof Array && desc.length) { var d0 = this.aufloesen(desc[0]); if (istDict(d0)) { fd = this.hole(d0, "FontDescriptor"); st = "/Type0 (" + String(this.aufloesen(d0.get("Subtype")) || "").substr(1) + ")"; } }
        }
        if (istDict(fd)) eingebettet = fd.has("FontFile") || fd.has("FontFile2") || fd.has("FontFile3");
        var name = istName(base) ? base.substr(1) : "(ohne Namen)";
        if (/^[A-Z]{6}\+/.test(name)) { teilmenge = true; name = name.substr(7); }
        if (st === "/Type3") { eingebettet = true; }
        return { num: num_, name: name, typ: String(st || "?").substr(1), eingebettet: eingebettet, teilmenge: teilmenge, type3: st === "/Type3" };
    };

    /* ---------------------------------------------------------- Analyse */
    var PT_MM = 25.4 / 72;
    K.mm = function (pt) { return pt * PT_MM; };

    /**
     * Hauptfunktion. bin = Datei als Binär-String. opt.inhalt=false überspringt
     * die Inhaltsanalyse (nur Boxen – schnell).
     */
    K.analysieren = function (bin, opt) {
        opt = opt || {};
        var t0 = new Date().getTime();
        var dok = new Dokument(bin);
        dok.einlesen();
        var a = { version: dok.version, verschluesselt: dok.verschluesselt, bytes: bin.length, objekte: dok.anzahlObjekte, fehler: dok.fehler, seiten: [], fonts: {}, bilder: {}, outputIntents: [], pdfx: "", pdfa: "", info: {}, gesamt: new Zaehler(), ms: 0, dok: dok };
        var seiten = dok.seiten(), i, kat = dok.katalog;
        // Info & Output-Intent
        var info = dok.hole(dok.trailer, "Info");
        if (istDict(info)) {
            ["Producer", "Creator", "Title", "GTS_PDFXVersion", "Trapped"].forEach(function (k) { var v = dok.aufloesen(info.get(k)); if (v instanceof PStr) a.info[k] = textAusPdf(v.v); else if (istName(v)) a.info[k] = v.substr(1); });
            if (a.info.GTS_PDFXVersion) a.pdfx = a.info.GTS_PDFXVersion;
        }
        if (kat) {
            var ois = dok.aufloesen(kat.get("OutputIntents"));
            if (ois instanceof Array) for (i = 0; i < ois.length; i++) {
                var oi = dok.aufloesen(ois[i]);
                if (!istDict(oi)) continue;
                var e = { s: String(dok.aufloesen(oi.get("S")) || "").substr(1), kennung: strWert(dok, oi, "OutputConditionIdentifier"), info: strWert(dok, oi, "Info"), registry: strWert(dok, oi, "RegistryName"), profil: null };
                var icc = dok.icc(oi.get("DestOutputProfile"));
                if (icc) e.profil = icc;
                a.outputIntents.push(e);
            }
            var md = dok.hole(kat, "Metadata");
            if (istDict(md)) {
                var mdNum = dok.refNum(kat.get("Metadata")), xmp = mdNum >= 0 ? dok.stromDaten(mdNum) : null;
                if (xmp) {
                    var mx = /pdfx:GTS_PDFXVersion(?:>|=")([^<"]+)/.exec(xmp); if (mx && !a.pdfx) a.pdfx = mx[1];
                    var ma = /pdfaid:part(?:>|=")(\d)/.exec(xmp), mc = /pdfaid:conformance(?:>|=")([A-Za-z])/.exec(xmp);
                    if (ma) a.pdfa = "PDF/A-" + ma[1] + (mc ? mc[1].toLowerCase() : "");
                    var mu = /pdfuaid:part(?:>|=")(\d)/.exec(xmp); if (mu) a.pdfua = "PDF/UA-" + mu[1];
                }
            }
        }
        // Seiten
        for (i = 0; i < seiten.length; i++) {
            var sp = seiten[i], d = sp.dict, s = { nr: i + 1, num: sp.num, boxen: {}, vorhanden: {}, rotate: num(dok.aufloesen(sp.erbe.Rotate)) || 0, annots: 0 };
            s.boxen.Media = dok.rectAufloesen(sp.erbe.MediaBox); s.vorhanden.Media = !!sp.erbe.MediaBox;
            s.boxen.Crop = dok.rectAufloesen(sp.erbe.CropBox); s.vorhanden.Crop = !!s.boxen.Crop;
            ["Bleed", "Trim", "Art"].forEach(function (b) { s.boxen[b] = dok.rectAufloesen(d.get(b + "Box")); s.vorhanden[b] = !!s.boxen[b]; });
            if (!s.boxen.Media) s.boxen.Media = { x0: 0, y0: 0, x1: 612, y1: 792 };
            var an = dok.aufloesen(d.get("Annots")); s.kommentare = 0; s.felder = 0; s.links = 0;
            if (an instanceof Array) { s.annots = an.length; for (var q = 0; q < an.length; q++) { var ad = dok.aufloesen(an[q]); var ast = istDict(ad) ? dok.aufloesen(ad.get("Subtype")) : null; if (ast === "/Widget") s.felder++; else if (ast === "/Link") s.links++; else if (ast !== "/Popup") s.kommentare++; } }
            s.userUnit = num(dok.aufloesen(d.get("UserUnit"))) || 1;
            if (opt.inhalt !== false && !dok.verschluesselt) {
                var inhalt = dok.aufloesen(d.get("Contents")), teile = [], j;
                if (istRef(d.get("Contents")) && !(inhalt instanceof Array)) { var cd = dok.stromDaten(d.get("Contents").num); if (cd !== null) teile.push(cd); }
                else if (inhalt instanceof Array) for (j = 0; j < inhalt.length; j++) { var cn = dok.refNum(inhalt[j]); if (cn >= 0) { var cd2 = dok.stromDaten(cn); if (cd2 !== null) teile.push(cd2); } }
                var ress = dok.aufloesen(sp.erbe.Resources);
                s.z = dok.inhaltZaehlen(teile.join("\n"), istDict(ress) ? ress : new PDict(), [sp.num], [1, 0, 0, 1, 0, 0]);
                s.z.seiteSetzen(i + 1);
                var grp = dok.hole(d, "Group"); s.transparenzGruppe = istDict(grp) && dok.aufloesen(grp.get("S")) === "/Transparency";
                // Bilder der Seite klassifizieren
                var bn; for (bn in s.z.bildNums) if (s.z.bildNums.hasOwnProperty(bn)) {
                    var bild = bildInfo(dok, parseInt(bn, 10));
                    if (bild) { a.bilder[bn] = bild; s.z.zaehle("bilder", { typ: bild.typ, label: bild.label, spots: bild.spots }, s.z.bildNums[bn]); }
                }
                var fn; for (fn in s.z.fonts) if (s.z.fonts.hasOwnProperty(fn) && !a.fonts[fn]) { var fi = dok.schrift(parseInt(fn, 10)); if (fi) a.fonts[fn] = fi; }
                a.gesamt.addiere(s.z);
            }
            a.seiten.push(s);
        }
        // Ebenen, Anhänge, JavaScript
        a.ebenen = []; a.anhaenge = 0; a.javascript = false;
        if (kat) {
            var ocp = dok.hole(kat, "OCProperties"), ocgs = istDict(ocp) ? dok.aufloesen(ocp.get("OCGs")) : null;
            if (ocgs instanceof Array) for (i = 0; i < ocgs.length; i++) { var og = dok.aufloesen(ocgs[i]); if (istDict(og)) { var on = dok.aufloesen(og.get("Name")); a.ebenen.push(on instanceof PStr ? textAusPdf(on.v) : "(ohne Namen)"); } }
            var names = dok.hole(kat, "Names");
            if (istDict(names)) {
                var ef = dok.hole(names, "EmbeddedFiles");
                if (istDict(ef)) { var nm = dok.aufloesen(ef.get("Names")); a.anhaenge = nm instanceof Array ? Math.floor(nm.length / 2) : (ef.has("Kids") ? 1 : 0); }
                if (names.has("JavaScript")) a.javascript = true;
            }
            var oa = dok.hole(kat, "OpenAction"); if (istDict(oa) && dok.aufloesen(oa.get("S")) === "/JavaScript") a.javascript = true;
            if (kat.has("AA")) a.javascript = true;
        }
        // Schriftobjekte, die auf keiner Seite benutzt werden (Reste)
        var k, gesamtFonts = 0; for (k in dok.objs) if (dok.objs.hasOwnProperty(k) && istDict(dok.objs[k].v) && dok.objs[k].v.get("Type") === "/Font") { var stt = dok.objs[k].v.get("Subtype"); if (stt !== "/CIDFontType0" && stt !== "/CIDFontType2") gesamtFonts++; }
        a.fontObjekte = gesamtFonts;
        a.ms = new Date().getTime() - t0;
        return a;
    };
    function strWert(dok, d, k) { var v = dok.aufloesen(d.get(k)); return v instanceof PStr ? textAusPdf(v.v) : ""; }
    function textAusPdf(s) {
        if (s.length >= 2 && s.charCodeAt(0) === 0xFE && s.charCodeAt(1) === 0xFF) { var o = [], i; for (i = 2; i + 1 < s.length; i += 2) o.push(String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1))); return o.join(""); }
        return s;
    }
    K.textAusPdf = textAusPdf;
    function bildInfo(dok, n) {
        var o = dok.objs[n]; if (!o || !istDict(o.v)) return null;
        var d = o.v, w = num(dok.aufloesen(d.get("Width"))), h = num(dok.aufloesen(d.get("Height"))), bpc = num(dok.aufloesen(d.get("BitsPerComponent")));
        var filter = dok.aufloesen(d.get("Filter")); if (filter instanceof Array) filter = filter.length ? dok.aufloesen(filter[filter.length - 1]) : ""; filter = istName(filter) ? filter.substr(1) : "";
        if (dok.aufloesen(d.get("ImageMask")) === true) return { num: n, w: w, h: h, bpc: 1, typ: "Grau", label: "Bitmap-Maske (1 Bit)", spots: [], filter: filter, maske: true };
        var fr = dok.farbraum(d.get("ColorSpace"));
        if (filter === "JPXDecode" && fr.typ === "Unbekannt") fr = { typ: "Unbekannt", label: "JPEG 2000 (Farbraum im Bild)", spots: [] };
        var smask = d.has("SMask") ? " + Alphamaske" : "";
        return { num: n, w: w, h: h, bpc: bpc, typ: fr.typ, label: fr.label + (bpc ? " · " + bpc + " Bit" : "") + smask + (filter ? " · " + filter.replace("Decode", "") : ""), spots: fr.spots, filter: filter, maske: false, alpha: d.has("SMask") };
    }

    /* ------------------------------------------------------- Anschnitt */
    function fmt(v) { var r = Math.round(v * 10) / 10; return (Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : r.toFixed(1)).replace(".", ","); }
    K.fmtMm = function (pt) { return fmt(K.mm(pt)); };
    function masse(r) { return fmt(K.mm(r.x1 - r.x0)) + " × " + fmt(K.mm(r.y1 - r.y0)) + " mm"; }

    /** Anschnitt-Bewertung einer Seite: liefert {endformat, anschnitt:{l,r,o,u}, quelle, hinweise[]} */
    K.anschnitt = function (s, sollMm) {
        var b = s.boxen, v = s.vorhanden, e = { hinweise: [], ok: null, drehung: s.rotate };
        var trim = b.Trim, aussen = null, quelle = "";
        var quer = (((s.rotate % 360) + 360) % 360) === 90 || (((s.rotate % 360) + 360) % 360) === 270;
        function masseGedreht(r) { return quer ? fmt(K.mm(r.y1 - r.y0)) + " × " + fmt(K.mm(r.x1 - r.x0)) + " mm" : masse(r); }
        e.seite = masseGedreht(b.Media);
        if (!trim && b.Art && v.Art) { trim = b.Art; e.hinweise.push("Kein Endformat (TrimBox) – ArtBox als Ersatz genommen."); }
        if (!trim) {
            e.endformat = null;
            e.hinweise.push("Kein Endformat (TrimBox) definiert – Anschnitt nicht feststellbar. Seitenformat ist " + e.seite + ".");
            return e;
        }
        e.endformat = masseGedreht(trim);
        if (v.Bleed) { aussen = b.Bleed; quelle = "BleedBox"; }
        else if (b.Crop && v.Crop) { aussen = b.Crop; quelle = "CropBox (keine BleedBox)"; }
        else { aussen = b.Media; quelle = "MediaBox (keine BleedBox)"; }
        var l = trim.x0 - aussen.x0, r = aussen.x1 - trim.x1, u = trim.y0 - aussen.y0, o = aussen.y1 - trim.y1;
        // Drehung: links/rechts/oben/unten so benennen, wie die Seite angezeigt wird
        var rot = ((s.rotate % 360) + 360) % 360, m;
        if (rot === 90) m = { l: u, r: o, o: l, u: r }; else if (rot === 180) m = { l: r, r: l, o: u, u: o }; else if (rot === 270) m = { l: o, r: u, o: r, u: l }; else m = { l: l, r: r, o: o, u: u };
        e.anschnitt = { l: K.mm(m.l), r: K.mm(m.r), o: K.mm(m.o), u: K.mm(m.u) };
        e.quelle = quelle;
        var min = Math.min(e.anschnitt.l, e.anschnitt.r, e.anschnitt.o, e.anschnitt.u), max = Math.max(e.anschnitt.l, e.anschnitt.r, e.anschnitt.o, e.anschnitt.u);
        e.min = min; e.max = max;
        e.gleichmaessig = (max - min) < 0.05;
        e.ok = min >= sollMm - 0.05;
        if (max < 0.05) e.hinweise.push("Kein Anschnitt: Endformat und " + quelle.replace(/ \(.*$/, "") + " sind gleich groß.");
        else if (!e.ok) e.hinweise.push("Anschnitt zu klein (kleinster Wert " + fmt(min) + " mm, gefordert " + fmt(sollMm) + " mm).");
        if (min < -0.05) e.hinweise.push("Endformat ragt über die " + quelle.replace(/ \(.*$/, "") + " hinaus – Boxen sind fehlerhaft.");
        // Platz für Marken
        var ml = aussen.x0 - b.Media.x0, mr = b.Media.x1 - aussen.x1, mo = b.Media.y1 - aussen.y1, mu = aussen.y0 - b.Media.y0;
        e.markenraum = K.mm(Math.min(ml, mr, mo, mu));
        return e;
    };

    /* ------------------------------------------------------- Berichte */
    function zeile(a) { return a.join("\n"); }
    function plural(n, e, m) { return n + " " + (n === 1 ? e : m); }
    function sortiert(topf) { var a = [], k; for (k in topf) if (topf.hasOwnProperty(k)) a.push(topf[k]); a.sort(function (x, y) { return y.n - x.n; }); return a; }

    K.berichtAnschnitt = function (a, sollMm) {
        sollMm = sollMm || 3;
        var z = [], i, gruppen = [], g, e, key, alleOk = true, ohneTrim = 0;
        for (i = 0; i < a.seiten.length; i++) {
            e = K.anschnitt(a.seiten[i], sollMm);
            if (e.ok === false || e.endformat === null) alleOk = false;
            if (e.endformat === null) ohneTrim++;
            key = e.seite + "|" + e.endformat + "|" + (e.anschnitt ? [fmt(e.anschnitt.l), fmt(e.anschnitt.r), fmt(e.anschnitt.o), fmt(e.anschnitt.u)].join(",") : "-") + "|" + e.quelle;
            if (gruppen.length && gruppen[gruppen.length - 1].key === key) gruppen[gruppen.length - 1].seiten.push(i + 1);
            else gruppen.push({ key: key, e: e, seiten: [i + 1] });
        }
        z.push("ANSCHNITT – " + plural(a.seiten.length, "Seite", "Seiten") + (a.seiten.length ? "" : " (keine Seiten gefunden)"));
        z.push(alleOk ? "✔ Alle Seiten haben mindestens " + fmt(sollMm) + " mm Anschnitt." : (ohneTrim === a.seiten.length ? "✖ Kein Endformat (TrimBox) in der Datei – Anschnitt nicht feststellbar." : "✖ Nicht alle Seiten erfüllen " + fmt(sollMm) + " mm Anschnitt."));
        z.push("");
        for (i = 0; i < gruppen.length; i++) {
            g = gruppen[i]; e = g.e;
            var bereich = g.seiten.length === 1 ? "Seite " + g.seiten[0] : (g.seiten.length === g.seiten[g.seiten.length - 1] - g.seiten[0] + 1 ? "Seiten " + g.seiten[0] + "–" + g.seiten[g.seiten.length - 1] : "Seiten " + g.seiten.join(", "));
            z.push(bereich + (e.drehung ? " (gedreht " + e.drehung + "°)" : ""));
            z.push("   Seitenformat (MediaBox): " + e.seite);
            if (e.endformat) {
                z.push("   Endformat (TrimBox):     " + e.endformat);
                var an = e.anschnitt;
                if (e.gleichmaessig) z.push("   Anschnitt:               " + fmt(an.l) + " mm rundum" + (e.ok ? " ✔" : " ✖"));
                else z.push("   Anschnitt:               links " + fmt(an.l) + " · rechts " + fmt(an.r) + " · oben " + fmt(an.o) + " · unten " + fmt(an.u) + " mm" + (e.ok ? " ✔" : " ✖"));
                z.push("   Gemessen an:             " + e.quelle);
                if (e.markenraum > 0.05) z.push("   Rand für Druckmarken:    " + fmt(e.markenraum) + " mm außerhalb des Anschnitts");
            }
            for (var h = 0; h < e.hinweise.length; h++) z.push("   ⚠ " + e.hinweise[h]);
            z.push("");
        }
        return zeile(z);
    };

    K.berichtFarben = function (a) {
        var z = [], i, g = a.gesamt, vek = sortiert(g.vektor), bil = sortiert(g.bilder), ver = sortiert(g.verlauf), typen = {}, spots = [], k;
        function merk(liste) { for (var j = 0; j < liste.length; j++) { typen[liste[j].typ] = (typen[liste[j].typ] || 0) + liste[j].n; } }
        merk(vek); merk(bil); merk(ver);
        for (k in g.spots) if (g.spots.hasOwnProperty(k)) spots.push({ name: k, n: g.spots[k] });
        spots.sort(function (x, y) { return y.n - x.n; });
        z.push("FARBRÄUME");
        // Fazit
        var fazit = [], hatRGB = typen.RGB > 0, hatCMYK = typen.CMYK > 0, hatGrau = typen.Grau > 0, hatLab = typen.Lab > 0;
        if (hatCMYK) fazit.push("CMYK");
        if (hatRGB) fazit.push("RGB");
        if (hatGrau && !hatCMYK) fazit.push("Graustufen");
        if (hatLab) fazit.push("Lab");
        if (spots.length) fazit.push(plural(spots.length, "Sonderfarbe", "Sonderfarben"));
        if (a.verschluesselt) z.push("✖ Datei ist verschlüsselt – Inhalte konnten nicht gelesen werden.");
        else if (!fazit.length) z.push("Keine farbigen Objekte gefunden.");
        else z.push((hatRGB ? "⚠ " : "✔ ") + "Verwendet: " + fazit.join(" + ") + (hatRGB ? " – RGB-Objekte vorhanden, für den Druck ungeeignet." : ""));
        if (typen.Unbekannt) z.push("⚠ " + typen.Unbekannt + " Objekte mit nicht bestimmbarem Farbraum.");
        z.push("");
        // Output-Intent
        z.push("Ausgabebedingung (Output Intent):");
        if (!a.outputIntents.length) z.push("   keine hinterlegt");
        for (i = 0; i < a.outputIntents.length; i++) {
            var oi = a.outputIntents[i];
            z.push("   " + (oi.s || "?") + ": " + (oi.kennung || oi.info || "(ohne Kennung)") + (oi.profil && oi.profil.beschreibung ? " – Profil „" + oi.profil.beschreibung + "“" : oi.profil ? " – Profil " + oi.profil.raum : " – kein Profil eingebettet"));
        }
        z.push("Norm: " + (a.pdfx || a.pdfa || a.pdfua ? [a.pdfx, a.pdfa, a.pdfua].filter(function (x) { return x; }).join(", ") : "keine PDF/X-Kennung") + " · PDF " + (a.version || "?") + (a.info.Trapped ? " · Trapped: " + a.info.Trapped : ""));
        if (a.info.Producer || a.info.Creator) z.push("Erzeugt mit: " + [a.info.Creator, a.info.Producer].filter(function (x) { return x; }).join(" / "));
        z.push("");
        z.push("Vektorobjekte (Füllungen/Konturen):");
        if (!vek.length) z.push("   keine");
        for (i = 0; i < vek.length; i++) z.push("   " + pad(vek[i].n, 7) + "  " + vek[i].label + (vek[i].typ === "RGB" ? "  ⚠" : ""));
        z.push("Verläufe:");
        if (!ver.length) z.push("   keine");
        for (i = 0; i < ver.length; i++) z.push("   " + pad(ver[i].n, 7) + "  " + ver[i].label + (ver[i].typ === "RGB" ? "  ⚠" : ""));
        z.push("Bilder (Platzierungen):");
        if (!bil.length) z.push("   keine");
        for (i = 0; i < bil.length; i++) z.push("   " + pad(bil[i].n, 7) + "  " + bil[i].label + (bil[i].typ === "RGB" ? "  ⚠" : ""));
        z.push("");
        if (spots.length) {
            z.push("Sonderfarben:");
            for (i = 0; i < spots.length; i++) z.push("   " + spots[i].name + "  (" + plural(spots[i].n, "Verwendung", "Verwendungen") + ")");
            z.push("");
        }
        // ICC-Profile im Dokument
        var profile = {}, pl = [], n;
        for (n in a.dok.cacheIcc) if (a.dok.cacheIcc.hasOwnProperty(n) && a.dok.cacheIcc[n]) { var pn = a.dok.cacheIcc[n].beschreibung || ("(ohne Namen, " + a.dok.cacheIcc[n].raum + ")"); if (!profile[pn]) { profile[pn] = true; pl.push(pn); } }
        if (pl.length) { z.push("Eingebettete ICC-Profile: " + pl.join(" · ")); z.push(""); }
        return zeile(z);
    };
    function pad(n, w) { var s = String(n); while (s.length < w) s = " " + s; return s; }

    K.berichtSchriften = function (a) {
        var z = [], liste = [], k, i, nichtEingebettet = 0;
        for (k in a.fonts) if (a.fonts.hasOwnProperty(k)) { liste.push(a.fonts[k]); if (!a.fonts[k].eingebettet) nichtEingebettet++; }
        liste.sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : 0; });
        z.push("SCHRIFTEN");
        if (a.verschluesselt) { z.push("✖ Datei verschlüsselt – nicht lesbar."); return zeile(z); }
        if (!liste.length && !a.gesamt.text) z.push("✔ Kein Text und keine Schriften im Dokument – alles sind Pfade/Bilder.");
        else {
            z.push((nichtEingebettet ? "✖ " : "✔ ") + plural(liste.length, "Schrift", "Schriften") + " in Verwendung, " + plural(a.gesamt.text, "Textobjekt", "Textobjekte") + (nichtEingebettet ? " – " + nichtEingebettet + " NICHT eingebettet!" : ", alle eingebettet"));
            if (a.gesamt.unsichtbar) z.push("⚠ " + a.gesamt.unsichtbar + " unsichtbare Textobjekte (z. B. OCR-Text) – bleiben beim Umwandeln ggf. erhalten.");
        }
        z.push("");
        for (i = 0; i < liste.length; i++) {
            var f = liste[i];
            z.push("   " + (f.eingebettet ? "✔" : "✖") + " " + f.name + "  (" + f.typ + (f.teilmenge ? ", Teilmenge" : "") + (f.eingebettet ? "" : ", NICHT eingebettet") + ")");
        }
        if (a.fontObjekte > liste.length) z.push("   … dazu " + (a.fontObjekte - liste.length) + " Schriftobjekte, die auf keiner Seite benutzt werden.");
        return zeile(z);
    };

    function ppiStufe(pl) {
        var G = K.GRENZEN;
        if (pl.maske) return pl.ppi >= G.ppiStrich ? 0 : pl.ppi >= G.ppiStrichKritisch ? 1 : 2;
        return pl.ppi >= G.ppiHalbton ? 0 : pl.ppi >= G.ppiKritisch ? 1 : 2;
    }
    var STUFE = ["✔", "⚠", "✖"];

    K.berichtBilder = function (a) {
        var z = [], G = K.GRENZEN, pl = a.gesamt.platzierungen, i, stufen = [0, 0, 0], bilder = {}, anzBilder = 0, minPl = null;
        for (i = 0; i < pl.length; i++) {
            var st = ppiStufe(pl[i]); stufen[st]++;
            if (pl[i].num >= 0 && !bilder[pl[i].num]) { bilder[pl[i].num] = true; anzBilder++; }
            if (!pl[i].maske && (!minPl || pl[i].ppi < minPl.ppi)) minPl = pl[i];
        }
        z.push("BILDAUFLÖSUNG – " + plural(pl.length, "Platzierung", "Platzierungen") + (anzBilder ? " von " + plural(anzBilder, "Bild", "Bildern") : ""));
        if (a.verschluesselt) { z.push("✖ Datei verschlüsselt – nicht lesbar."); return zeile(z); }
        if (!pl.length) { z.push("✔ Keine Bilder im Dokument."); return zeile(z); }
        z.push((stufen[2] ? "✖ " : stufen[1] ? "⚠ " : "✔ ") + stufen[2] + " kritisch (unter " + G.ppiKritisch + " ppi) · " + stufen[1] + " grenzwertig (unter " + G.ppiHalbton + " ppi) · " + stufen[0] + " in Ordnung" + "   [Strichbilder: gut ab " + G.ppiStrich + " ppi]");
        if (minPl) z.push("Kleinste Halbton-Auflösung: " + minPl.ppi + " ppi (Seite " + minPl.seite + ")");
        z.push("");
        // je Seite: Stufe 1/2 einzeln (gleiche Zeilen zusammengefasst), Rest als Summe
        var seite = 0, gut = 0, gruppen = {}, reihenfolge = [];
        var sortiert = pl.slice().sort(function (x, y) { return x.seite - y.seite || x.ppi - y.ppi; });
        function flush() {
            var j; for (j = 0; j < reihenfolge.length; j++) { var gr = gruppen[reihenfolge[j]]; z.push("   " + STUFE[gr.st] + " " + (gr.n > 1 ? pad(gr.n, 3) + "× " : "     ") + pad(gr.q.ppi, 5) + " ppi   " + gr.q.w + " × " + gr.q.h + " px auf " + fmt(K.mm(gr.q.wpt)) + " × " + fmt(K.mm(gr.q.hpt)) + " mm   " + (gr.q.maske ? "Strichbild (1 Bit)" : gr.q.label)); }
            if (seite && gut) z.push("   " + STUFE[0] + " " + plural(gut, "weitere Platzierung", "weitere Platzierungen") + " in Ordnung");
            gut = 0; gruppen = {}; reihenfolge = [];
        }
        for (i = 0; i < sortiert.length; i++) {
            var q = sortiert[i];
            if (q.seite !== seite) { flush(); seite = q.seite; z.push("Seite " + seite); }
            var st2 = ppiStufe(q);
            if (st2 === 0) { gut++; continue; }
            var key = st2 + "|" + q.ppi + "|" + q.w + "|" + q.h + "|" + Math.round(q.wpt) + "|" + Math.round(q.hpt) + "|" + q.label + "|" + q.maske;
            if (!gruppen[key]) { gruppen[key] = { st: st2, q: q, n: 0 }; reihenfolge.push(key); }
            gruppen[key].n++;
        }
        flush();
        return zeile(z);
    };

    K.berichtReinzeichnung = function (a) {
        var z = [], g = a.gesamt, G = K.GRENZEN, i, probleme = 0, hinweise = 0;
        z.push("REINZEICHNUNG");
        if (a.verschluesselt) { z.push("✖ Datei verschlüsselt – nicht lesbar."); return zeile(z); }
        var zeilen = [];
        function eintrag(stufe, text) { zeilen.push("   " + STUFE[stufe] + " " + text); if (stufe === 2) probleme++; else if (stufe === 1) hinweise++; }
        // Linien
        if (g.linien.min === Infinity) eintrag(0, "Linien: keine Konturen im Dokument");
        else {
            var st = (g.linien.nullbreit || g.linien.duenn) ? 2 : 0;
            eintrag(st, "Linien: dünnste Kontur " + fmt(g.linien.min) + " pt (Seite " + g.linien.minSeite + ")" + (g.linien.duenn ? " · " + plural(g.linien.duenn, "Haarlinie", "Haarlinien") + " unter " + fmt(G.haarlinie) + " pt" : "") + (g.linien.nullbreit ? " · " + g.linien.nullbreit + " mit Breite 0 (druckt geräteabhängig dünn)" : ""));
        }
        // Farbauftrag
        if (g.tac.max > 0) eintrag(g.tac.max > G.farbauftrag ? 2 : 0, "Farbauftrag: höchster Wert " + g.tac.max + " % (Seite " + g.tac.maxSeite + ")" + (g.tac.ueber ? " · " + plural(g.tac.ueber, "Objekt", "Objekte") + " über " + G.farbauftrag + " %" : " · Grenze " + G.farbauftrag + " % eingehalten") + " – Vektoren und Text, Bilder nicht gemessen");
        // Schwarz
        var schw = [];
        if (g.schwarzText) schw.push(g.schwarzText + " in 100 % Schwarz");
        if (g.grauText) schw.push(g.grauText + " in Schwarz (DeviceGray)");
        if (g.tiefschwarzText) schw.push(g.tiefschwarzText + " in Tiefschwarz (4c – Passerprobleme bei kleiner Schrift)");
        if (g.rgbText) schw.push(g.rgbText + " in RGB");
        if (schw.length) eintrag(g.rgbText ? 2 : g.tiefschwarzText ? 1 : 0, "Textobjekte: " + schw.join(" · "));
        // Weiß überdruckend, Passer
        if (g.weissUeberdruckt) eintrag(2, plural(g.weissUeberdruckt, "weißes Objekt", "weiße Objekte") + " auf Überdrucken – verschwinden im Druck!"); else eintrag(0, "Kein Weiß auf Überdrucken");
        if (g.passer) eintrag(1, plural(g.passer, "Objekt", "Objekte") + " in Passermarkenfarbe (Registration/All) – nur für Marken gedacht");
        // Transparenz
        var alpha = 0, k; for (k in a.bilder) if (a.bilder.hasOwnProperty(k) && a.bilder[k].alpha) alpha++;
        var tg = 0; for (i = 0; i < a.seiten.length; i++) if (a.seiten[i].transparenzGruppe) tg++;
        if (g.transparenz || alpha) eintrag(1, "Transparenz: " + plural(g.transparenz, "Objekt", "Objekte") + " mit Deckkraft/Mischmodus/weicher Maske" + (alpha ? " · " + plural(alpha, "Bild", "Bilder") + " mit Alphakanal" : "") + " – für PDF/X-1a reduzieren, in PDF/X-4 erlaubt");
        else eintrag(0, "Keine Transparenz" + (tg ? " (Seiten tragen aber Transparenzgruppen)" : ""));
        // Seitenformate
        var formate = {}, fl = [];
        for (i = 0; i < a.seiten.length; i++) { var b = a.seiten[i].boxen.Media, key = fmt(K.mm(b.x1 - b.x0)) + " × " + fmt(K.mm(b.y1 - b.y0)) + " mm"; if (!formate[key]) { formate[key] = 0; fl.push(key); } formate[key]++; }
        if (fl.length > 1) eintrag(1, fl.length + " verschiedene Seitenformate: " + fl.map(function (f) { return f + " (" + formate[f] + "×)"; }).join(", ")); else if (fl.length) eintrag(0, "Einheitliches Seitenformat " + fl[0]);
        // Anmerkungen, Felder, Ebenen, Anhänge, JavaScript
        var kom = 0, fel = 0; for (i = 0; i < a.seiten.length; i++) { kom += a.seiten[i].kommentare || 0; fel += a.seiten[i].felder || 0; }
        if (kom) eintrag(1, plural(kom, "Kommentar/Anmerkung", "Kommentare/Anmerkungen") + " – werden je nach RIP mitgedruckt oder verschluckt");
        if (fel) eintrag(1, plural(fel, "Formularfeld", "Formularfelder") + " – Feldinhalte sind kein Seiteninhalt");
        if (a.ebenen && a.ebenen.length) eintrag(1, plural(a.ebenen.length, "Ebene", "Ebenen") + ": " + a.ebenen.slice(0, 8).join(", ") + (a.ebenen.length > 8 ? " …" : "") + " – Sichtbarkeit prüfen");
        if (a.anhaenge) eintrag(1, plural(a.anhaenge, "Dateianhang", "Dateianhänge"));
        if (a.javascript) eintrag(1, "Dokument enthält JavaScript");
        if (!kom && !fel && !(a.ebenen && a.ebenen.length) && !a.anhaenge && !a.javascript) eintrag(0, "Keine Kommentare, Formularfelder, Ebenen, Anhänge oder Skripte");
        if (g.unsichtbar) eintrag(1, plural(g.unsichtbar, "unsichtbares Textobjekt", "unsichtbare Textobjekte") + " (OCR-Text o. ä.)");
        z.push(probleme ? "✖ " + plural(probleme, "Problem", "Probleme") + (hinweise ? ", " + plural(hinweise, "Hinweis", "Hinweise") : "") : hinweise ? "⚠ Keine harten Fehler, " + plural(hinweise, "Hinweis", "Hinweise") : "✔ Nichts zu beanstanden");
        z.push("");
        return zeile(z) + "\n" + zeile(zeilen) + "\n";
    };

    K.berichtKopf = function (a, dateiname) {
        var z = [];
        z.push((dateiname || "Dokument") + " – " + plural(a.seiten.length, "Seite", "Seiten") + ", " + (Math.round(a.bytes / 1024 / 102.4) / 10).toString().replace(".", ",") + " MB, " + a.objekte + " Objekte, geprüft in " + (a.ms / 1000).toFixed(1).replace(".", ",") + " s");
        if (a.fehler.length) z.push("⚠ " + a.fehler.length + " Lesefehler (Datei teils beschädigt oder ungewöhnlich).");
        return zeile(z);
    };

    return K;
})();
if (typeof module !== "undefined" && module.exports) module.exports = DWB;
