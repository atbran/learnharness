"""Apply the program's course-level dependency map (prerequisites block,
co-requisites run alongside) to every course file that exists, and set
the program's course order (the schedule's priority).

    python -I scripts/apply-dependencies.py
"""
import json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "curriculum", "physics")

# course: (prereqs, coreqs)
DEPS = {
    "m0-precalc": ([], []),
    "h0-horizons": ([], ["m0-precalc"]),
    "e0-circuits": ([], ["m0-precalc"]),
    "m1-calculus": (["m0-precalc"], []),
    "p1-mechanics": (["m0-precalc"], ["m1-calculus"]),
    "m3-linear-algebra": (["m0-precalc"], ["m1-calculus"]),
    "m2-multivariable": (["m1-calculus"], []),
    "p2-em-waves": (["p1-mechanics"], ["m2-multivariable"]),
    "m4-odes": (["m1-calculus"], ["m3-linear-algebra"]),
    "p7-statmech": (["p1-mechanics"], ["m2-multivariable"]),
    "p3-modern": (["p2-em-waves"], ["m3-linear-algebra"]),
    "m6-complex": (["m1-calculus"], ["m2-multivariable"]),
    "m5-methods": (["m2-multivariable", "m4-odes"], []),
    "e1-dsp": (["m4-odes"], ["m5-methods", "m6-complex"]),
    "p4-classical": (["p1-mechanics", "m2-multivariable"], ["m4-odes"]),
    "p5-em": (["p2-em-waves", "m2-multivariable"], ["m5-methods"]),
    "p6-quantum": (["p3-modern", "m3-linear-algebra"], ["m5-methods"]),
    "c1-quantum-chem": (["p3-modern", "m3-linear-algebra"], ["p6-quantum"]),
    "e2-plasma-icpms": (["p2-em-waves", "p7-statmech"], ["p5-em"]),
    "c2-spectroscopy-nmr": (["p3-modern", "p7-statmech"], ["p6-quantum"]),
    "s2-astro": (["p3-modern"], ["p7-statmech"]),
    "s1-particles": (["p3-modern"], ["p6-quantum"]),
    "s3-gr": (["p3-modern", "m2-multivariable"], ["m5-methods", "p4-classical"]),
    "s4-qft": (["p6-quantum", "p4-classical"], ["p5-em"]),
    "q-qualifier": (["p4-classical", "p5-em", "p6-quantum", "p7-statmech"], []),
}

prog_path = os.path.join(ROOT, "program.json")
prog = json.load(open(prog_path, encoding="utf8"))
prog["courses"] = list(DEPS)
open(prog_path, "w", encoding="utf8", newline="\n").write(json.dumps(prog, indent="\t", ensure_ascii=False) + "\n")

for cid, (pre, co) in DEPS.items():
    path = os.path.join(ROOT, "courses", f"{cid}.json")
    if not os.path.exists(path):
        print(f"missing (skipped): {cid}")
        continue
    raw = open(path, encoding="utf8").read()
    c = json.loads(raw)
    if c.get("prereqs") == pre and c.get("coreqs", []) == co:
        continue
    # Keep key order: coreqs sits right after prereqs.
    out = {}
    for k, v in c.items():
        if k == "coreqs":
            continue
        out[k] = pre if k == "prereqs" else v
        if k == "prereqs":
            out["coreqs"] = co
    open(path, "w", encoding="utf8", newline="\n").write(json.dumps(out, indent="\t", ensure_ascii=False) + "\n")
    print(f"updated: {cid}")
