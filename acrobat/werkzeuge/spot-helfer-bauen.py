#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Erzeugt aus resources/spotfarben.json:
  1) src/spotfarben.js     - Datenmodul fuer das Acrobat-Skript (HKS + Pantone)
  2) resources/spot/*.pdf  - je Sonderfarbe eine 1000x1000-pt-PDF mit ECHTER
                             /Separation-Farbe (Vollton), die das Werkzeug per
                             addWatermarkFromFile als echte Sonderfarbplatte auflegt.

Aufruf:  python3 werkzeuge/spot-helfer-bauen.py
Danach:  ./bauen.sh  (klebt core + spotfarben + acrobat zu dwb_acrobat.js)
         ./installieren.command  (kopiert Skript + resources/spot nach Acrobat)

Einzige Datenquelle ist resources/spotfarben.json. Zum Ergaenzen/Korrigieren von
Farben dort die Werte aendern und dieses Skript erneut laufen lassen.
"""
import os, re, json, sys

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PFAD = os.path.join(HIER, "resources", "spotfarben.json")
SPOT_DIR  = os.path.join(HIER, "resources", "spot")
JS_PFAD   = os.path.join(HIER, "src", "spotfarben.js")


def dateiname(colorant):
    """Separationsname -> Dateiname (muss mit der JS-Seite uebereinstimmen)."""
    return re.sub(r"[^A-Za-z0-9]+", "_", colorant).strip("_") + ".pdf"


def pdf_name(s):
    """Beliebigen Text als gueltiges PDF-Name-Objekt kodieren (/..., #xx-maskiert).
    Der Separationsname MUSS ein Name-Objekt sein, kein String - sonst ist der
    Farbraum ungueltig (Leerzeichen -> #20)."""
    out = ["/"]
    for ch in s:
        o = ord(ch)
        if (48 <= o <= 57) or (65 <= o <= 90) or (97 <= o <= 122) or ch in "-_":
            out.append(ch)
        else:
            out.append("#%02X" % o)
    return "".join(out)


def pdf_baues(colorant, cmyk):
    """Minimale, gueltige 1-Seiten-PDF (1000x1000 pt), ganzflaechig mit der
    Separationsfarbe <colorant> bei Tonwert 100 % gefuellt. cmyk = Alternate in %."""
    c, m, y, k = [max(0.0, min(1.0, v / 100.0)) for v in cmyk]
    nm = pdf_name(colorant)   # Name-Objekt, z. B. /HKS#2043#20K
    content = b"/CS0 cs 1 scn 0 0 1000 1000 re f\n"
    objs = []
    objs.append(b"<</Type/Catalog/Pages 2 0 R>>")
    objs.append(b"<</Type/Pages/Kids[3 0 R]/Count 1>>")
    objs.append(b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 1000 1000]"
                b"/Resources<</ColorSpace<</CS0 5 0 R>>>>/Contents 4 0 R>>")
    objs.append(b"<</Length %d>>stream\n%sendstream" % (len(content), content))
    objs.append(("[/Separation%s/DeviceCMYK 6 0 R]" % nm).encode("latin-1"))
    objs.append(("<</FunctionType 2/Domain[0 1]/C0[0 0 0 0]/C1[%s]/N 1>>"
                 % " ".join(("%.4f" % v).rstrip("0").rstrip(".") or "0"
                            for v in (c, m, y, k))).encode("latin-1"))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += ("%d 0 obj" % i).encode("latin-1") + body + b"\nendobj\n"
    xref_pos = len(out)
    n = len(objs) + 1
    out += ("xref\n0 %d\n" % n).encode("latin-1")
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += ("%010d 00000 n \n" % off).encode("latin-1")
    out += ("trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n"
            % (n, xref_pos)).encode("latin-1")
    return bytes(out)


def main():
    with open(JSON_PFAD, encoding="utf-8") as f:
        data = json.load(f)
    hks = data["hks"]
    pantone = data["pantone"]

    os.makedirs(SPOT_DIR, exist_ok=True)
    # alte Helfer entfernen, damit nichts Verwaistes liegen bleibt
    for alt in os.listdir(SPOT_DIR):
        if alt.lower().endswith(".pdf"):
            os.remove(os.path.join(SPOT_DIR, alt))

    gebaut = []

    def schreibe(colorant, cmyk):
        fn = dateiname(colorant)
        with open(os.path.join(SPOT_DIR, fn), "wb") as f:
            f.write(pdf_baues(colorant, cmyk))
        gebaut.append(fn)

    for e in hks:
        schreibe("HKS %d K" % e["nr"], e["K"])
        if "N" in e:
            schreibe("HKS %d N" % e["nr"], e["N"])
    for p in pantone:
        schreibe("%s %s" % (p["nm"], p["paper"]), p["cmyk"])

    # --- src/spotfarben.js schreiben ---
    def arr(a):
        return "[" + ",".join(str(int(x)) for x in a) + "]"

    lines = []
    lines.append("/* ============================================================================")
    lines.append("   dwb Acrobat - Sonderfarben-Datenmodul  (AUTOMATISCH ERZEUGT)")
    lines.append("   ----------------------------------------------------------------------------")
    lines.append("   Nicht von Hand aendern! Quelle: resources/spotfarben.json")
    lines.append("   Neu erzeugen: python3 werkzeuge/spot-helfer-bauen.py  (schreibt dieses File")
    lines.append("   und die Helfer-PDFs in resources/spot/), danach ./bauen.sh.")
    lines.append("   HKS-CMYK: gepruefte Umrechnungstabelle (K=Kunstdruck, N=Naturpapier).")
    lines.append("   Pantone-CMYK: Bridge-Naeherung - vor Druck am Faecher pruefen.")
    lines.append("   ============================================================================ */")
    lines.append("var DWBSPOT = (function () {")
    lines.append("  var hks = [")
    for e in hks:
        n = 'N:' + arr(e["N"]) if "N" in e else 'N:null'
        lines.append("    { nr:%d, K:%s, %s }," % (e["nr"], arr(e["K"]), n))
    lines.append("  ];")
    lines.append("  var pantone = [")
    for p in pantone:
        nm = p["nm"].replace('"', '\\"')
        lines.append('    { nm:"%s", code:"%s", paper:"%s", cmyk:%s },'
                     % (nm, p["code"], p["paper"], arr(p["cmyk"])))
    lines.append("  ];")
    lines.append("  return { hks: hks, pantone: pantone };")
    lines.append("})();")
    js = "\n".join(lines) + "\n"
    with open(JS_PFAD, "w", encoding="utf-8") as f:
        f.write(js)

    print("Helfer-PDFs:    %d  ->  %s" % (len(gebaut), os.path.relpath(SPOT_DIR, HIER)))
    print("Datenmodul:     %s  (HKS %d, Pantone %d)"
          % (os.path.relpath(JS_PFAD, HIER), len(hks), len(pantone)))


if __name__ == "__main__":
    main()
