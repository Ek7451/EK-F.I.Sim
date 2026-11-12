#!/usr/bin/env python
"""Generate federal-tax oracle fixtures with PSL Tax-Calculator (taxcalc).

Builds a deterministic, systematic set of fixture households, runs them
through the pinned ``taxcalc`` release under current-law policy, and writes

    tests/validation/fixtures/taxcalc-<year>.json

for each requested tax year.  The TypeScript tax engine's validation test
reads those files.  See README.md in this directory for the variable mapping
and the modelling differences a comparison has to account for.

Usage:
    python generate_fixtures.py                 # writes 2026 and 2027
    python generate_fixtures.py --years 2026
    python generate_fixtures.py --check         # regenerate, compare, no write
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import random
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import taxcalc

SEED = 20261110
DEFAULT_YEARS = (2026, 2027)
HERE = Path(__file__).resolve().parent
FIXTURE_DIR = HERE.parent / "fixtures"

MARS = {"single": 1, "mfj": 2, "mfs": 3, "hoh": 4}
MARS_KEYS = ["single", "mfj", "mfs", "hoh", "qss"]  # taxcalc MARS 1..5 order


# --------------------------------------------------------------------------
# Household construction
# --------------------------------------------------------------------------

class Builder:
    """Collects household specs; all randomness flows through one seeded RNG."""

    def __init__(self, seed: int):
        self.rng = random.Random(seed)
        self.households: list[dict] = []

    def j(self, amount: float, pct: float = 0.03) -> int:
        """Jitter a dollar amount by +/- pct so values are not all round."""
        if amount == 0:
            return 0
        return int(round(amount * (1.0 + self.rng.uniform(-pct, pct))))

    def add(self, group, desc, fs, ages, kids=0, wages=0, se=0, interest=0,
            odiv=0, qdiv=0, ltcg=0, stcg=0, pension=0, ira=0, ss=0,
            salt=0, retax=0, mortgage=0, charity=0, notes=()):
        n = 2 if fs == "mfj" else 1
        ages = list(ages) if isinstance(ages, (list, tuple)) else [ages]
        assert len(ages) == n, (desc, ages)

        def pair(v):
            v = list(v) if isinstance(v, (list, tuple)) else [v]
            if n == 2 and len(v) == 1:
                v = v + [0]
            assert len(v) == n, (desc, v)
            return [int(x) for x in v]

        assert qdiv <= odiv, desc
        self.households.append({
            "group": group,
            "description": desc,
            "notes": list(notes),
            "input": {
                "filingStatus": fs,
                "ages": [int(a) for a in ages],
                "childrenUnder17": int(kids),
                "wages": pair(wages),
                "selfEmployment": pair(se),
                "taxableInterest": int(interest),
                "ordinaryDividends": int(odiv),
                "qualifiedDividends": int(qdiv),
                "longTermGains": int(ltcg),
                "shortTermGains": int(stcg),
                "pensionsTaxable": int(pension),
                "iraDistributions": int(ira),
                "socialSecurity": int(ss),
                "itemized": {
                    "stateLocalIncomeTax": int(salt),
                    "realEstateTax": int(retax),
                    "mortgageInterest": int(mortgage),
                    "charity": int(charity),
                },
            },
        })


def build_households(seed: int) -> list[dict]:
    b = Builder(seed)
    j = b.j
    LBL = {"single": "Single", "mfj": "MFJ", "hoh": "HoH", "mfs": "MFS"}

    # ---- A. wages only, each filing status, across the wage scale --------
    # exact amounts first (thresholds), then jittered ones
    wage_levels = {
        "single": [12000, 24000, 38000, 60000, 85000, 120000, 165000, 184500,
                   200000, 215000, 260000, 320000, 450000, 700000, 1200000],
        "mfj": [20000, 45000, 70000, 110000, 160000, 184500, 240000, 250000,
                300000, 420000, 560000, 850000, 1500000],
        "hoh": [18000, 30000, 48000, 75000, 105000, 150000, 210000, 280000,
                460000, 720000],
        "mfs": [9000, 22000, 41000, 66000, 98000, 125000, 140000, 190000,
                270000, 400000, 650000],
    }
    exact_wages = {60000, 184500, 200000, 250000, 125000}
    base_age = {"single": 34, "mfj": (41, 39), "hoh": 37, "mfs": 45}
    for fs, levels in wage_levels.items():
        for i, w in enumerate(levels):
            amt = w if w in exact_wages else j(w)
            kids = 0
            if fs == "hoh":
                kids = 0 if i % 5 == 4 else 1
            b.add("wages-only",
                  f"{LBL[fs]}, wages only ${amt:,}"
                  + (f", {kids} child" if kids else "")
                  + (" (exact amount)" if w in exact_wages else ""),
                  fs, base_age[fs], kids=kids, wages=amt)

    # ---- B. two-earner couples with wages split --------------------------
    splits = [
        (30000, 22000), (55000, 48000), (90000, 35000), (120000, 110000),
        (150000, 95000),     # each under 200k, combined under 250k
        (140000, 135000),    # each under 200k, combined above 250k addl-Medicare
        (210000, 20000),     # one above 200k, combined under 250k
        (184500, 184500),    # both exactly at the OASDI wage base
        (230000, 205000),    # both above the wage base
        (400000, 60000), (310000, 290000), (900000, 450000),
    ]
    for k, (w1, w2) in enumerate(splits):
        if (w1, w2) != (184500, 184500):
            w1, w2 = j(w1), j(w2)
        b.add("two-earner", f"MFJ two earners, wages ${w1:,} / ${w2:,}",
              "mfj", (30 + 2 * k, 29 + 2 * k), wages=(w1, w2))

    # ---- C. children: CTC, refundable ACTC, EITC, CTC phase-out ----------
    kid_cases = [
        # fs, ages, kids, wages
        ("mfj", (33, 31), 1, (9000, 0)), ("mfj", (33, 31), 2, (16000, 6000)),
        ("mfj", (36, 35), 3, (21000, 0)), ("mfj", (36, 35), 3, (30000, 14000)),
        ("mfj", (38, 38), 1, (52000, 0)), ("mfj", (38, 38), 2, (61000, 34000)),
        ("mfj", (40, 37), 3, (88000, 52000)),
        ("mfj", (42, 40), 2, (230000, 150000)),
        ("mfj", (44, 41), 1, (300000, 104500)),   # AGI just above 400k
        ("mfj", (44, 41), 2, (290000, 135000)),   # inside CTC phase-out
        ("mfj", (46, 45), 3, (330000, 160000)),
        ("mfj", (46, 45), 1, (350000, 110000)),   # CTC fully phased out
        ("hoh", 29, 1, 7000), ("hoh", 29, 1, 15500), ("hoh", 31, 2, 24000),
        ("hoh", 31, 3, 19000), ("hoh", 35, 2, 43000), ("hoh", 35, 3, 58000),
        ("hoh", 39, 1, 96000), ("hoh", 43, 2, 198000),
        ("hoh", 43, 2, 212300),                   # inside CTC phase-out
        ("hoh", 47, 1, 246000),                   # CTC fully phased out
        ("hoh", 47, 3, 255000),
        ("mfs", 36, 1, 34000), ("mfs", 40, 2, 78000), ("mfs", 40, 2, 214000),
    ]
    exact_kid_wages = {(300000, 104500), 212300}
    for fs, ages, kids, w in kid_cases:
        if w not in exact_kid_wages:
            w = tuple(j(x) for x in w) if isinstance(w, tuple) else j(w)
        tot = sum(w) if isinstance(w, tuple) else w
        b.add("children",
              f"{LBL[fs]}, {kids} child{'ren' if kids > 1 else ''} under 17, "
              f"wages ${tot:,}", fs, ages, kids=kids, wages=w)

    # ---- D. age: additional standard deduction and senior deduction ------
    # (senior deduction phases out at 6% of MAGI over 75k / 150k joint)
    for age, pen, intr, w in [
        (52, 0, 1500, 58000), (63, 30000, 2500, 0), (65, 28000, 1800, 0),
        (67, 52000, 3000, 0), (70, 70000, 4500, 0),      # just under 75k
        (72, 84000, 6000, 0),                             # inside phase-out
        (66, 60000, 5000, 62000),                         # inside phase-out
        (75, 150000, 22000, 0),                           # just below full
        (78, 190000, 15000, 0),                           # fully phased out
        (68, 0, 900, 21000),
    ]:
        pen, intr, w = j(pen), j(intr), j(w)
        b.add("age-senior",
              f"Single age {age}, pension ${pen:,}, interest ${intr:,}"
              + (f", wages ${w:,}" if w else ""),
              "single", age, wages=w, pension=pen, interest=intr)
    for ages, pen, ira, w in [
        ((58, 55), 0, 0, (72000, 40000)), ((64, 61), 45000, 12000, (0, 0)),
        ((66, 62), 48000, 15000, (0, 0)),       # only one spouse 65+
        ((60, 71), 60000, 20000, (0, 0)),       # only spouse 65+
        ((67, 66), 55000, 18000, (0, 0)), ((70, 69), 95000, 40000, (0, 0)),
        ((73, 64), 110000, 55000, (0, 0)),      # one 65+, inside phase-out
        ((74, 72), 120000, 60000, (0, 0)),      # both 65+, inside phase-out
        ((69, 67), 90000, 30000, (95000, 0)),   # inside phase-out with wages
        ((80, 78), 160000, 85000, (0, 0)),      # near full phase-out
        ((76, 75), 220000, 70000, (0, 0)),      # fully phased out
        ((66, 49), 20000, 0, (0, 64000)),
    ]:
        pen, ira = j(pen), j(ira)
        w = tuple(j(x) for x in w)
        b.add("age-senior",
              f"MFJ ages {ages[0]}/{ages[1]}, pension ${pen:,}, "
              f"IRA ${ira:,}" + (f", wages ${sum(w):,}" if sum(w) else ""),
              "mfj", ages, wages=w, pension=pen, ira=ira)
    b.add("age-senior", "HoH age 66, 1 child (grandchild), pension $41,000, "
          "wages $18,000", "hoh", 66, kids=1, wages=18000, pension=41000)
    b.add("age-senior", "HoH age 71, no child under 17, pension $88,500 "
          "(inside senior-deduction phase-out)", "hoh", 71, pension=88500)
    b.add("age-senior", "MFS age 68, pension $47,300, interest $2,150 "
          "(taxcalc gives MFS no senior deduction)", "mfs", 68,
          pension=47300, interest=2150)
    b.add("age-senior", "MFS age 70, pension $96,000", "mfs", 70,
          pension=96000)

    # ---- E. retirees: Social Security taxability phase-in ----------------
    # provisional income = other income + 0.5 * benefits
    # thresholds 25k/34k (single, HoH, MFS in taxcalc) and 32k/44k (MFJ)
    for age, pen, ira, ss, where in [
        (66, 0, 0, 21600, "SS only"),
        (67, 9000, 0, 24000, "below phase-in"),
        (69, 12990, 0, 24000, "just below first threshold"),
        (68, 16000, 0, 24000, "inside 50% tier"),
        (71, 14000, 6000, 26400, "inside 50% tier"),
        (70, 22000, 8000, 24000, "inside 85% tier"),
        (73, 30000, 12000, 31200, "inside 85% tier"),
        (74, 38000, 15000, 28800, "near 85% cap"),
        (77, 60000, 25000, 36000, "at 85% cap"),
        (63, 18000, 0, 19200, "age 63, inside 50% tier"),
        (62, 41000, 0, 17400, "age 62, at 85% cap"),
    ]:
        if "just below" not in where:
            pen, ira = j(pen), j(ira)
        b.add("social-security",
              f"Single age {age}, pension ${pen:,}, IRA ${ira:,}, "
              f"SS ${ss:,} ({where})", "single", age,
              pension=pen, ira=ira, ss=ss)
    for ages, pen, ira, ss, where in [
        ((67, 65), 0, 0, 43200, "SS only"),
        ((68, 66), 8000, 0, 40800, "below phase-in"),
        ((70, 68), 16000, 4000, 42000, "inside 50% tier"),
        ((66, 63), 14000, 0, 33600, "one 65+, inside 50% tier"),
        ((72, 70), 24000, 10000, 45600, "inside 85% tier"),
        ((71, 69), 36000, 14000, 50400, "inside 85% tier"),
        ((75, 74), 52000, 20000, 54000, "near 85% cap"),
        ((69, 64), 70000, 30000, 48000, "one 65+, at 85% cap"),
        ((78, 77), 95000, 45000, 62400, "at 85% cap, senior ded phase-out"),
        ((81, 79), 140000, 80000, 66000, "at 85% cap, high income"),
        ((62, 60), 30000, 0, 20400, "under 65, inside 85% tier"),
    ]:
        pen, ira = j(pen), j(ira)
        b.add("social-security",
              f"MFJ ages {ages[0]}/{ages[1]}, pension ${pen:,}, IRA ${ira:,}, "
              f"SS ${ss:,} ({where})", "mfj", ages,
              pension=pen, ira=ira, ss=ss)
    b.add("social-security", "MFJ ages 67/66, part-time wages + pension + SS "
          "(inside 85% tier)", "mfj", (67, 66), wages=(18500, 0),
          pension=21400, ss=38400)
    b.add("social-security", "HoH age 68, 1 child, pension $19,700, SS "
          "$25,200 (inside 50% tier)", "hoh", 68, kids=1, pension=19700,
          ss=25200)
    b.add("social-security", "HoH age 72, no child under 17, IRA $33,000, "
          "SS $27,600 (inside 85% tier)", "hoh", 72, ira=33000, ss=27600)
    b.add("social-security", "MFS age 69, pension $21,000, SS $20,400",
          "mfs", 69, pension=21000, ss=20400,
          notes=["taxcalc applies the 25k/34k Social Security thresholds to "
                 "MFS (i.e. spouses who lived apart all year); an MFS filer "
                 "who lived with the spouse has zero thresholds under law."])
    b.add("social-security", "MFS age 73, pension $46,000, SS $30,000",
          "mfs", 73, pension=46000, ss=30000,
          notes=["taxcalc applies the 25k/34k Social Security thresholds to "
                 "MFS (i.e. spouses who lived apart all year); an MFS filer "
                 "who lived with the spouse has zero thresholds under law."])

    # ---- F. interest, dividends, capital gains ---------------------------
    for fs, ages, w, intr, od, qd in [
        ("single", 29, 46000, 2400, 0, 0),
        ("single", 44, 72000, 9500, 3200, 0),
        ("single", 51, 0, 31000, 12000, 12000),
        ("single", 38, 95000, 1200, 8800, 6100),
        ("mfj", (48, 47), (88000, 61000), 5400, 14500, 11000),
        ("mfj", (56, 52), (0, 0), 18000, 64000, 58000),
        ("mfj", (35, 35), (52000, 0), 800, 2600, 2600),
        ("hoh", 42, 67000, 3100, 5200, 4000),
        ("mfs", 50, 84000, 7700, 9100, 5300),
        ("single", 60, 15000, 13500, 4000, 1000),   # EITC invest-income limit
    ]:
        w = tuple(j(x) for x in w) if isinstance(w, tuple) else j(w)
        intr, od = j(intr), j(od)
        qd = min(j(qd), od)
        tot = sum(w) if isinstance(w, tuple) else w
        ag = "/".join(str(a) for a in ages) if isinstance(ages, tuple) else ages
        b.add("interest-dividends",
              f"{LBL[fs]} age {ag}, wages ${tot:,}, interest ${intr:,}, "
              f"dividends ${od:,} (qualified ${qd:,})",
              fs, ages, kids=1 if fs == "hoh" else 0, wages=w, interest=intr,
              odiv=od, qdiv=qd)

    for fs, ages, w, lt, st, qd, where in [
        ("single", 33, 20000, 28000, 0, 0, "all LTCG at 0%"),
        ("single", 33, 0, 60000, 0, 0, "LTCG only, straddles 0%/15%"),
        ("single", 45, 40000, 40000, 0, 2000, "straddles 0%/15%"),
        ("single", 45, 100000, 80000, 0, 5000, "LTCG at 15%"),
        ("single", 52, 180000, 150000, 12000, 0, "15% + NIIT, with STCG"),
        ("single", 55, 300000, 400000, 0, 20000, "straddles 15%/20%"),
        ("single", 58, 600000, 500000, 0, 30000, "LTCG at 20%"),
        ("single", 40, 70000, -9000, 2500, 0, "net capital loss, -3,000 cap"),
        ("single", 40, 55000, 6000, -2000, 0, "LTCG net of ST loss"),
        ("mfj", (39, 38), (45000, 20000), 30000, 0, 1500, "all LTCG at 0%"),
        ("mfj", (47, 44), (80000, 30000), 70000, 0, 4000, "straddles 0%/15%"),
        ("mfj", (50, 50), (160000, 90000), 120000, 8000, 9000, "15% + NIIT"),
        ("mfj", (57, 55), (350000, 150000), 300000, 0, 25000,
         "straddles 15%/20%"),
        ("mfj", (61, 59), (500000, 300000), 900000, 0, 60000, "LTCG at 20%"),
        ("mfj", (36, 34), (0, 0), 125000, 0, 0, "LTCG only, straddles 0%/15%"),
        ("mfj", (43, 41), (95000, 70000), -14000, 4000, 0,
         "net capital loss, -3,000 cap"),
        ("hoh", 41, 38000, 35000, 0, 1000, "straddles 0%/15%"),
        ("hoh", 49, 140000, 90000, 5000, 3000, "LTCG at 15%"),
        ("hoh", 53, 380000, 320000, 0, 15000, "straddles 15%/20%"),
        ("mfs", 46, 30000, 25000, 0, 800, "straddles 0%/15%"),
        ("mfs", 54, 150000, 100000, 0, 6000, "15% + NIIT (MFS 125k)"),
        ("mfs", 59, 240000, 180000, 0, 10000, "straddles 15%/20% (MFS)"),
        ("mfs", 48, 62000, -5000, 0, 0, "net capital loss, -1,500 cap (MFS)"),
    ]:
        w = tuple(j(x) for x in w) if isinstance(w, tuple) else j(w)
        lt, st, qd = j(lt), j(st), j(qd)
        tot = sum(w) if isinstance(w, tuple) else w
        b.add("capital-gains",
              f"{LBL[fs]}, wages ${tot:,}, LTCG ${lt:,}"
              + (f", STCG ${st:,}" if st else "")
              + (f", qualified dividends ${qd:,}" if qd else "")
              + f" ({where})",
              fs, ages, kids=1 if fs == "hoh" else 0, wages=w, ltcg=lt,
              stcg=st, odiv=qd, qdiv=qd)

    # retirees mixing gains with Social Security
    b.add("capital-gains", "Single age 68, SS $30,000, IRA $12,000, LTCG "
          "$25,000 (gains pull SS into AGI, LTCG at 0%)", "single", 68,
          ira=12000, ss=30000, ltcg=25000)
    b.add("capital-gains", "MFJ ages 70/68, SS $52,000, pension $30,000, "
          "qualified dividends $18,000, LTCG $40,000", "mfj", (70, 68),
          pension=30000, ss=52000, odiv=18000, qdiv=18000, ltcg=40000)
    b.add("capital-gains", "MFJ ages 66/66, SS $44,000, IRA $65,000, LTCG "
          "$90,000 (straddles 0%/15%, senior deduction phase-out)", "mfj",
          (66, 66), ira=65000, ss=44000, ltcg=90000)

    # ---- G. net investment income tax ------------------------------------
    for fs, ages, w, intr, od, qd, lt, where in [
        ("single", 47, 190000, 6000, 9000, 7000, 0, "MAGI just over 200k"),
        ("single", 47, 150000, 20000, 30000, 24000, 40000, "NII > excess"),
        ("single", 62, 0, 90000, 160000, 150000, 250000, "all investment"),
        ("single", 50, 420000, 2000, 3000, 3000, 0, "NII < excess"),
        ("mfj", (52, 51), (170000, 70000), 9000, 16000, 12000, 0,
         "MAGI just over 250k"),
        ("mfj", (55, 53), (200000, 0), 35000, 50000, 41000, 110000,
         "NII < excess"),
        ("mfj", (64, 63), (0, 0), 120000, 240000, 220000, 380000,
         "all investment"),
        ("mfj", (45, 45), (600000, 250000), 15000, 22000, 20000, 60000,
         "NII < excess, addl Medicare"),
        ("hoh", 48, 185000, 14000, 21000, 17000, 30000, "NII > excess"),
        ("mfs", 51, 118000, 8000, 11000, 9000, 0, "MAGI just over 125k"),
        ("mfs", 56, 90000, 26000, 44000, 40000, 70000, "NII > excess"),
        ("single", 67, 0, 45000, 85000, 70000, 140000,
         "senior, investment income + NIIT"),
    ]:
        w = tuple(j(x) for x in w) if isinstance(w, tuple) else j(w)
        intr, od, lt = j(intr), j(od), j(lt)
        qd = min(j(qd), od)
        tot = sum(w) if isinstance(w, tuple) else w
        b.add("niit",
              f"{LBL[fs]}, wages ${tot:,}, interest ${intr:,}, dividends "
              f"${od:,} (qualified ${qd:,}), LTCG ${lt:,} ({where})",
              fs, ages, kids=1 if fs == "hoh" else 0, wages=w, interest=intr,
              odiv=od, qdiv=qd, ltcg=lt)

    # ---- H. self-employment (plain Schedule C) ---------------------------
    for fs, ages, kids, w, se, where in [
        ("single", 31, 0, 0, 300, "below $400 SE floor"),
        ("single", 31, 0, 0, 433, "net SE earnings $399.88: no SE tax"),
        ("single", 31, 0, 0, 434, "net SE earnings $400.80: SE tax due"),
        ("single", 36, 0, 0, 900, "QBI under $1,000: no minimum QBI ded"),
        ("single", 36, 0, 0, 14000, "low SE, EITC"),
        ("single", 42, 0, 0, 52000, "SE only"),
        ("single", 42, 0, 0, 118000, "SE only"),
        ("single", 49, 0, 0, 205000, "SE above wage base, addl Medicare"),
        ("single", 49, 0, 0, 290000, "SE in QBI phase-in range"),
        ("single", 54, 0, 0, 520000, "SE above QBI range: QBI ded limited"),
        ("single", 39, 0, 64000, 21000, "wages + SE"),
        ("single", 39, 0, 150000, 60000, "wages + SE crossing wage base"),
        ("single", 44, 0, 195000, 45000,
         "wages above wage base: SE pays Medicare only"),
        ("single", 44, 0, 170000, 80000, "wages + SE, addl Medicare on SE"),
        ("mfj", (37, 36), 2, (0, 0), (38000, 0), "one SE spouse, 2 children"),
        ("mfj", (41, 40), 0, (72000, 0), (0, 46000), "wages + spouse SE"),
        ("mfj", (46, 43), 1, (0, 0), (85000, 62000), "both spouses SE"),
        ("mfj", (50, 48), 0, (190000, 0), (0, 130000),
         "wages + spouse SE, addl Medicare"),
        ("mfj", (53, 52), 0, (0, 0), (260000, 210000),
         "both SE above wage base"),
        ("mfj", (58, 57), 0, (120000, 0), (480000, 0),
         "SE above QBI range: QBI ded limited"),
        ("mfj", (66, 65), 0, (0, 0), (30000, 0), "seniors with SE income"),
        ("hoh", 34, 1, 0, 26000, "SE only, 1 child, EITC/ACTC"),
        ("hoh", 45, 2, 40000, 55000, "wages + SE, 2 children"),
        ("mfs", 43, 0, 0, 74000, "SE only"),
        ("mfs", 47, 0, 100000, 60000, "wages + SE, addl Medicare (MFS 125k)"),
    ]:
        exact = se in (300, 433, 434, 900)
        if not exact:
            w = tuple(j(x) for x in w) if isinstance(w, tuple) else j(w)
            se = tuple(j(x) for x in se) if isinstance(se, tuple) else j(se)
        wt = sum(w) if isinstance(w, tuple) else w
        st = sum(se) if isinstance(se, tuple) else se
        b.add("self-employment",
              f"{LBL[fs]}, self-employment ${st:,}"
              + (f", wages ${wt:,}" if wt else "")
              + (f", {kids} child{'ren' if kids > 1 else ''}" if kids else "")
              + f" ({where})", fs, ages, kids=kids, wages=w, se=se)
    b.add("self-employment", "Single age 67, SE $24,000 + SS $26,400 + "
          "interest $3,000 (SE-tax deduction feeds provisional income)",
          "single", 67, se=24000, ss=26400, interest=3000)

    # ---- I. itemized deductions: SALT cap and phase-down, charity floor --
    for fs, ages, w, salt, ret, mort, char, where in [
        ("single", 44, 130000, 7000, 4500, 11000, 2500, "SALT under cap"),
        ("single", 51, 260000, 21000, 12000, 16000, 6000, "SALT under cap"),
        ("single", 51, 380000, 38000, 19000, 22000, 9000, "SALT capped"),
        ("single", 57, 540000, 52000, 24000, 30000, 20000,
         "SALT cap phase-down"),
        ("single", 57, 640000, 61000, 26000, 28000, 35000,
         "SALT cap at floor"),
        ("single", 60, 950000, 95000, 31000, 36000, 120000,
         "SALT floor + 37%-bracket itemized limitation"),
        ("mfj", (45, 44), (150000, 60000), 13000, 9000, 19000, 5000,
         "SALT under cap"),
        ("mfj", (49, 47), (280000, 140000), 33000, 18000, 27000, 12000,
         "SALT capped"),
        ("mfj", (52, 50), (360000, 170000), 44000, 21000, 31000, 18000,
         "SALT cap phase-down"),
        ("mfj", (52, 50), (400000, 180000), 49000, 22000, 33000, 26000,
         "SALT cap phase-down"),
        ("mfj", (56, 55), (520000, 230000), 68000, 27000, 35000, 50000,
         "SALT cap at floor"),
        ("mfj", (60, 58), (1100000, 600000), 170000, 42000, 38000, 260000,
         "SALT floor + 37%-bracket itemized limitation"),
        ("mfj", (68, 66), (0, 0), 6000, 11000, 9000, 14000,
         "seniors itemizing"),
        ("hoh", 46, 210000, 16000, 11000, 18000, 4000, "SALT under cap"),
        ("hoh", 50, 560000, 51000, 20000, 26000, 15000, "SALT cap phase-down"),
        ("mfs", 48, 160000, 15000, 9000, 14000, 3000,
         "SALT capped (MFS 20,200)"),
        ("mfs", 53, 275000, 27000, 12000, 17000, 8000,
         "SALT cap phase-down (MFS)"),
        ("mfs", 55, 420000, 40000, 15000, 20000, 30000,
         "SALT floor (MFS 5,000)"),
        ("single", 41, 82000, 3500, 2800, 4200, 1800,
         "itemized below standard: standard + non-itemizer charity"),
        ("mfj", (39, 38), (97000, 0), 4000, 5200, 8000, 3500,
         "itemized below standard: standard + non-itemizer charity"),
        ("single", 63, 190000, 9000, 6000, 3000, 85000,
         "large charity, 0.5%-of-AGI floor"),
    ]:
        w = tuple(j(x) for x in w) if isinstance(w, tuple) else j(w)
        salt, ret, mort, char = j(salt), j(ret), j(mort), j(char)
        tot = sum(w) if isinstance(w, tuple) else w
        pen = 0
        if fs == "mfj" and ages == (68, 66):
            pen = 93000
        b.add("itemized",
              f"{LBL[fs]}, {'pension' if pen else 'wages'} ${pen or tot:,}, "
              f"state income tax ${salt:,}, real estate tax ${ret:,}, "
              f"mortgage interest ${mort:,}, charity ${char:,} ({where})",
              fs, ages, kids=1 if fs == "hoh" else 0, wages=w, pension=pen,
              salt=salt, retax=ret, mortgage=mort, charity=char)

    # ---- J. high income, likely AMT (no preference items) ----------------
    # AMT arises here from the exemption phase-out (50% above 500k / 1M)
    # hitting returns whose income is mostly preferentially-taxed gains,
    # and from SALT add-back for itemizers.
    for fs, ages, w, lt, qd, salt, ret, mort, where in [
        ("single", 50, 150000, 600000, 0, 0, 0, 0, "LTCG erodes exemption"),
        ("single", 55, 90000, 900000, 40000, 0, 0, 0, "LTCG erodes exemption"),
        ("single", 58, 260000, 450000, 20000, 38000, 15000, 20000,
         "itemizer, SALT add-back"),
        ("single", 61, 40000, 1500000, 0, 0, 0, 0, "mostly LTCG"),
        ("mfj", (52, 51), (220000, 0), 1100000, 30000, 0, 0, 0,
         "LTCG erodes exemption"),
        ("mfj", (56, 54), (300000, 120000), 950000, 50000, 60000, 25000,
         30000, "itemizer, SALT add-back"),
        ("mfj", (63, 60), (80000, 0), 2400000, 0, 0, 0, 0, "mostly LTCG"),
        ("mfj", (48, 47), (380000, 150000), 0, 0, 39000, 14000, 24000,
         "itemizer near top of 24% bracket"),
        ("hoh", 49, 170000, 520000, 10000, 0, 0, 0, "LTCG erodes exemption"),
        ("mfs", 53, 130000, 480000, 0, 0, 0, 0, "MFS, LTCG erodes exemption"),
        ("mfs", 57, 210000, 700000, 15000, 20000, 9000, 12000,
         "MFS itemizer above the AMT exemption phase-out end"),
        ("single", 46, 2500000, 0, 0, 0, 0, 0, "very high wages, no AMT"),
    ]:
        w = tuple(j(x) for x in w) if isinstance(w, tuple) else j(w)
        lt, qd = j(lt), j(qd)
        salt, ret, mort = j(salt), j(ret), j(mort)
        tot = sum(w) if isinstance(w, tuple) else w
        b.add("amt",
              f"{LBL[fs]}, wages ${tot:,}, LTCG ${lt:,}"
              + (f", qualified dividends ${qd:,}" if qd else "")
              + (f", state tax ${salt:,}, real estate tax ${ret:,}, mortgage "
                 f"interest ${mort:,}" if salt else "")
              + f" ({where})",
              fs, ages, kids=1 if fs == "hoh" else 0, wages=w, ltcg=lt,
              odiv=qd, qdiv=qd, salt=salt, retax=ret, mortgage=mort)

    # ---- K. zero / tiny income and exact bracket edges -------------------
    b.add("edge", "Single age 40, zero income", "single", 40)
    b.add("edge", "MFJ ages 40/38, zero income", "mfj", (40, 38))
    b.add("edge", "HoH age 30, 1 child, zero income", "hoh", 30, kids=1)
    b.add("edge", "MFS age 40, zero income", "mfs", 40)
    b.add("edge", "Single age 70, zero income", "single", 70)
    b.add("edge", "Single age 22, wages $1", "single", 22, wages=1)
    b.add("edge", "Single age 22, wages $500 (under 25: no childless EITC)",
          "single", 22, wages=500)
    b.add("edge", "Single age 30, wages $8,000 (childless EITC)", "single",
          30, wages=8000)
    b.add("edge", "MFJ ages 28/27, wages $3,000 / $0", "mfj", (28, 27),
          wages=(3000, 0))
    b.add("edge", "HoH age 26, 2 children, wages $2,400 (under ACTC $2,500 "
          "earnings floor)", "hoh", 26, kids=2, wages=2400)
    b.add("edge", "Single age 35, interest $12", "single", 35, interest=12)
    b.add("edge", "Single age 66, SS $9,600 only", "single", 66, ss=9600)
    b.add("edge", "Single age 40, wages $16,100 (exactly the standard "
          "deduction)", "single", 40, wages=16100)
    b.add("edge", "Single age 40, wages $16,101 (taxable income $1)",
          "single", 40, wages=16101)
    b.add("edge", "Single age 40, wages $28,500 (taxable income exactly at "
          "top of 10% bracket)", "single", 40, wages=28500)
    b.add("edge", "Single age 40, wages $66,500 (taxable income exactly at "
          "top of 12% bracket)", "single", 40, wages=66500)
    b.add("edge", "MFJ ages 40/40, wages $133,000 (taxable income exactly "
          "at top of 12% bracket)", "mfj", (40, 40), wages=(133000, 0))
    b.add("edge", "Single age 40, wages $65,550 (taxable income exactly at "
          "the 0% LTCG breakpoint, no gains)", "single", 40, wages=65550)
    b.add("edge", "Single age 65, wages $75,000 (MAGI exactly at senior "
          "deduction phase-out start)", "single", 65, wages=75000)
    b.add("edge", "MFJ ages 65/65, pension $250,000 (senior deduction "
          "exactly phased out)", "mfj", (65, 65), pension=250000)
    b.add("edge", "Single age 64, pension $40,000 (one year short of 65)",
          "single", 64, pension=40000)
    b.add("edge", "MFJ ages 45/45, 2 children, wages $400,000 (AGI exactly "
          "at CTC phase-out start)", "mfj", (45, 45), kids=2,
          wages=(400000, 0))
    b.add("edge", "MFJ ages 45/45, 2 children, wages $400,001 (first "
          "$1,000 CTC phase-out step)", "mfj", (45, 45), kids=2,
          wages=(400001, 0))

    # ---- L. seeded random mixes ------------------------------------------
    rng = b.rng
    for i in range(24):
        fs = ["single", "mfj", "hoh", "mfs"][i % 4]
        n = 2 if fs == "mfj" else 1
        ages = tuple(rng.randint(24, 84) for _ in range(n))
        retired = min(ages) >= 62 and rng.random() < 0.7
        kids = 0
        if not retired and max(ages) < 60 and (fs == "hoh"
                                               or rng.random() < 0.4):
            kids = rng.randint(1, 3)
        scale = rng.choice([0.4, 0.7, 1.0, 1.0, 1.6, 2.5, 4.0])
        wages = [0] * n
        se = [0] * n
        pension = ira = ss = 0
        if retired:
            pension = int(rng.uniform(0, 60000) * scale)
            ira = int(rng.uniform(0, 40000) * scale)
            ss = int(rng.uniform(12000, 36000)) * n
        else:
            for k in range(n):
                r = rng.random()
                if r < 0.65:
                    wages[k] = int(rng.uniform(15000, 110000) * scale)
                elif r < 0.85:
                    se[k] = int(rng.uniform(8000, 90000) * scale)
        interest = int(rng.uniform(0, 6000) * scale) if rng.random() < 0.7 else 0
        odiv = int(rng.uniform(0, 12000) * scale) if rng.random() < 0.6 else 0
        qdiv = int(odiv * rng.uniform(0.3, 1.0))
        ltcg = int(rng.uniform(0, 60000) * scale) if rng.random() < 0.45 else 0
        stcg = int(rng.uniform(-4000, 9000)) if rng.random() < 0.2 else 0
        salt = retax = mort = char = 0
        if rng.random() < 0.3:
            tot = sum(wages) + sum(se) + pension + ira
            salt = int(tot * rng.uniform(0.03, 0.08))
            retax = int(rng.uniform(3000, 16000))
            mort = int(rng.uniform(4000, 28000))
            char = int(tot * rng.uniform(0.0, 0.05))
        b.add("random-mix",
              f"{LBL[fs]} random mix #{i + 1}: ages "
              f"{'/'.join(map(str, ages))}, {kids} children, "
              f"{'retired' if retired else 'working'}"
              + (", itemizer candidate" if salt else ""),
              fs, ages, kids=kids, wages=wages, se=se, interest=interest,
              odiv=odiv, qdiv=qdiv, ltcg=ltcg, stcg=stcg, pension=pension,
              ira=ira, ss=ss, salt=salt, retax=retax, mortgage=mort,
              charity=char)

    for idx, h in enumerate(b.households, start=1):
        h["id"] = f"h{idx:03d}"
    return b.households


# --------------------------------------------------------------------------
# Mapping to taxcalc input records
# --------------------------------------------------------------------------

def to_taxcalc_record(recid: int, inp: dict, year: int) -> dict:
    """Return the exact raw record handed to taxcalc for one household."""
    fs = inp["filingStatus"]
    joint = fs == "mfj"
    kids = inp["childrenUnder17"]
    w = inp["wages"]
    se = inp["selfEmployment"]
    it = inp["itemized"]
    adults = 2 if joint else 1
    return {
        "RECID": recid,
        "FLPDYR": year,
        "MARS": MARS[fs],
        "age_head": inp["ages"][0],
        "age_spouse": inp["ages"][1] if joint else 0,
        "XTOT": adults + kids,
        "n24": kids,                 # CTC-eligible children (under 17)
        "nu18": kids,
        "nu13": 0,                   # no dependent-care credit modelled
        "nu06": 0,
        "n1820": 0,
        "n21": adults,
        "EIC": min(kids, 3),         # EITC qualifying children
        "DSI": 0,
        "MIDR": 0,
        "blind_head": 0,
        "blind_spouse": 0,
        "e00200": w[0] + (w[1] if joint else 0),
        "e00200p": w[0],
        "e00200s": w[1] if joint else 0,
        "e00900": se[0] + (se[1] if joint else 0),
        "e00900p": se[0],
        "e00900s": se[1] if joint else 0,
        "e00300": inp["taxableInterest"],
        "e00600": inp["ordinaryDividends"],
        "e00650": inp["qualifiedDividends"],
        "p23250": inp["longTermGains"],
        "p22250": inp["shortTermGains"],
        "e01500": inp["pensionsTaxable"],    # total pensions (all taxable)
        "e01700": inp["pensionsTaxable"],
        "e01400": inp["iraDistributions"],
        "e02400": inp["socialSecurity"],
        "e18400": it["stateLocalIncomeTax"],
        "e18500": it["realEstateTax"],
        "e19200": it["mortgageInterest"],
        "e19800": it["charity"],             # cash contributions
        "PT_SSTB_income": 0,
        "PT_binc_w2_wages": 0,
        "PT_ubia_property": 0,
        "s006": 1.0,
    }


# --------------------------------------------------------------------------
# Policy snapshot
# --------------------------------------------------------------------------

def _val(pol, name):
    v = np.squeeze(np.asarray(getattr(pol, name)))
    if v.ndim == 0:
        x = v.item()
        return x if isinstance(x, bool) else _num(x)
    return [_num(x) for x in v.tolist()]


def _num(x):
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    x = float(x)
    if x >= 9e98:
        return None        # taxcalc's "infinity" (9e99)
    return int(x) if x == int(x) else x


def _by_status(pol, name):
    v = _val(pol, name)
    return {k: v[i] for i, k in enumerate(MARS_KEYS) if k != "qss"}


def policy_snapshot(pol) -> dict:
    """Key current-law parameter values for pol.current_year."""
    s = lambda n: _by_status(pol, n)    # noqa: E731
    v = lambda n: _val(pol, n)          # noqa: E731
    eitc_keys = ["0", "1", "2", "3+"]
    return {
        "_comment": ("Values taxcalc used for this year. Per-status objects "
                     "are keyed single/mfj/mfs/hoh. null means no limit."),
        "standardDeduction": s("STD"),
        "additionalStandardDeductionAged": s("STD_Aged"),
        "nonItemizerCharityDeductionMax": s("STD_charity_ded_nonitemizers_max"),
        "ordinaryRates": [v(f"II_rt{i}") for i in range(1, 8)],
        "ordinaryBracketTops": {
            k: [_by_status(pol, f"II_brk{i}")[k] for i in range(1, 8)]
            for k in ("single", "mfj", "mfs", "hoh")},
        "capitalGainsRates": [v("CG_rt1"), v("CG_rt2"), v("CG_rt3")],
        "capitalGainsBracketTops": {
            k: [_by_status(pol, f"CG_brk{i}")[k] for i in (1, 2)]
            for k in ("single", "mfj", "mfs", "hoh")},
        "capitalLossLimit": s("Capital_loss_limitation"),
        "seniorDeduction": {
            "amountPerSenior": v("SeniorDed_c"),
            "phaseoutStart": s("SeniorDed_ps"),
            "phaseoutRate": v("SeniorDed_prt"),
            "mfsEligible": False,
        },
        "salt": {
            "cap": s("ID_AllTaxes_c"),
            "phaseDownStartAgi": s("ID_AllTaxes_c_ps"),
            "phaseDownRate": v("ID_AllTaxes_c_po_rate"),
            "floor": s("ID_AllTaxes_c_po_floor"),
        },
        "itemized": {
            "charityFloorRateOfAgi": v("ID_Charity_frt"),
            "charityCeilingRateOfAgi": v("ID_Charity_crt_all"),
            "topBracketReductionRate": v("ID_reduction_rate"),
            "medicalFloorRateOfAgi": v("ID_Medical_frt"),
        },
        "childTaxCredit": {
            "perChild": v("CTC_c"),
            "refundableMaxPerChild": v("ACTC_c"),
            "refundableEarningsThreshold": v("ACTC_Income_thd"),
            "refundableRate": v("ACTC_rt"),
            "phaseoutStart": s("CTC_ps"),
            "phaseoutRate": v("CTC_prt"),
            "otherDependentCredit": v("ODC_c"),
        },
        "amt": {
            "exemption": s("AMT_em"),
            "exemptionPhaseoutStart": s("AMT_em_ps"),
            "exemptionPhaseoutRate": v("AMT_prt"),
            "rate1": v("AMT_rt1"),
            "rate2": _num(float(v("AMT_rt1")) + float(v("AMT_rt2_addon"))),
            "rate2Threshold": s("AMT_brk1"),
            # taxcalc 6.9.0 dropped the AMT_em_pe parameter; the end of the MFS phase-out is now computed
            # as AMT_em_ps + AMT_em / AMT_prt (calcfunctions.AMT, MFS special rule).
            "mfsExemptionZeroAboveAmti": _num(
                float(s("AMT_em_ps")["mfs"]) + float(s("AMT_em")["mfs"]) / float(v("AMT_prt"))),
        },
        "niit": {"rate": v("NIIT_rt"), "threshold": s("NIIT_thd")},
        "socialSecurityBenefits": {
            "threshold1": s("SS_thd1"), "threshold2": s("SS_thd2"),
            "rate1": v("SS_percentage1"), "rate2": v("SS_percentage2"),
        },
        "payroll": {
            "oasdiWageBase": v("SS_Earnings_c"),
            "oasdiRateEmployee": v("FICA_ss_trt_employee"),
            "oasdiRateEmployer": v("FICA_ss_trt_employer"),
            "medicareRateEmployee": v("FICA_mc_trt_employee"),
            "medicareRateEmployer": v("FICA_mc_trt_employer"),
            "additionalMedicareRate": v("AMEDT_rt"),
            "additionalMedicareThreshold": s("AMEDT_ec"),
            "secaNetEarningsFloor": v("SECA_Earnings_deminimus"),
        },
        "qbi": {
            "rate": v("PT_qbid_rt"),
            "taxableIncomeThreshold": s("PT_qbid_taxinc_thd"),
            "phaseInRange": s("PT_qbid_taxinc_gap"),
            "minimumDeduction": v("PT_qbid_min_ded"),
            "minimumDeductionQbiFloor": v("PT_qbid_min_qbi"),
        },
        "eitc": {
            "maxCredit": dict(zip(eitc_keys, v("EITC_c"))),
            "phaseInRate": dict(zip(eitc_keys, v("EITC_rt"))),
            "phaseOutRate": dict(zip(eitc_keys, v("EITC_prt"))),
            "phaseOutStart": dict(zip(eitc_keys, v("EITC_ps"))),
            "phaseOutStartJointAddon": dict(
                zip(eitc_keys, v("EITC_ps_addon_MarriedJ"))),
            "investmentIncomeLimit": v("EITC_InvestIncome_c"),
            "childlessMinAge": v("EITC_MinEligAge"),
            "childlessMaxAge": v("EITC_MaxEligAge"),
            "mfsEligibleInTaxcalc": v("EITC_sep_filers_elig"),
        },
    }


# --------------------------------------------------------------------------
# Running taxcalc
# --------------------------------------------------------------------------

OUT_VARS = [
    "c00100", "c02500", "standard", "c04470", "senior_deduction", "qbided",
    "c04800", "taxbc", "c09600", "niit", "c07220", "odc", "c11070", "eitc",
    "iitax", "payrolltax", "ptax_was", "ptax_er_p", "ptax_er_s", "setax",
    "ptax_amc", "c05800", "c07100", "c09200", "othertaxes", "refund",
    "c62100", "c18300", "c19200", "c19700", "c21060", "c03260", "c02900",
    "earned", "ymod", "c01000", "c05200", "combined",
]


def r2(x) -> float:
    x = round(float(x) + 0.0, 2)
    return 0.0 if x == 0 else x


def run_year(households: list[dict], year: int):
    records = [to_taxcalc_record(i + 1, h["input"], year)
               for i, h in enumerate(households)]
    df = pd.DataFrame.from_records(records)
    pol = taxcalc.Policy()              # current law, no reform
    if not pol.start_year <= year <= pol.end_year:
        return None
    pol.set_year(year)
    recs = taxcalc.Records(data=df, start_year=year, gfactors=None,
                           weights=None, adjust_ratios=None,
                           exact_calculations=True)
    # taxcalc models imperfect EITC/ACTC take-up with a per-record uniform
    # random number; zero forces every eligible unit to claim its credits.
    recs.credit_claim_urn[:] = 0.0
    calc = taxcalc.Calculator(policy=pol, records=recs)
    assert calc.current_year == year, calc.current_year
    calc.calc_all()
    out = calc.dataframe(OUT_VARS)

    result = []
    for h, rec, (_, o) in zip(households, records, out.iterrows()):
        employee = o.ptax_was - o.ptax_er_p - o.ptax_er_s
        deduction = max(o.standard, o.c04470)
        expected = {
            "agi": r2(o.c00100),
            "taxableSocialSecurity": r2(o.c02500),
            "standardOrItemizedDeduction": r2(deduction),
            "seniorDeduction": r2(o.senior_deduction),
            "qbiDeduction": r2(o.qbided),
            "taxableIncome": r2(o.c04800),
            "regularTaxBeforeCredits": r2(o.taxbc),
            "amt": r2(o.c09600),
            "niit": r2(o.niit),
            "childTaxCreditNonrefundable": r2(o.c07220),
            "additionalChildTaxCredit": r2(o.c11070),
            "eitc": r2(o.eitc),
            "incomeTax": r2(o.iitax),
            "employeePayrollTax": r2(employee),
            "selfEmploymentTax": r2(o.setax),
            "additionalMedicareTax": r2(o.ptax_amc),
            "payrollTaxTaxcalcTotal": r2(o.payrolltax),
        }
        detail = {
            "itemizes": bool(o.c04470 > o.standard),
            "standardDeductionIfTaken": r2(o.standard),
            "itemizedDeductionsAfterLimits": r2(o.c04470),
            "itemizedDeductionsBeforeLimits": r2(o.c21060),
            "saltDeductedAfterCap": r2(o.c18300),
            "mortgageInterestDeducted": r2(o.c19200),
            "charityDeducted": r2(o.c19700),
            "deductibleHalfOfSeTax": r2(o.c03260),
            "netCapitalGainInAgi": r2(o.c01000),
            "provisionalIncomeYmod": r2(o.ymod),
            "earnedIncomeForCredits": r2(o.earned),
            "ordinaryScheduleTaxOnAllTaxableIncome": r2(o.c05200),
            "amtTaxableIncome": r2(o.c62100),
            "taxBeforeCreditsInclAmt": r2(o.c05800),
            "nonrefundableCreditsUsed": r2(o.c07100),
            "refundableCredits": r2(o.refund),
            "employerPayrollTax": r2(o.ptax_er_p + o.ptax_er_s),
            "ficaEmployeePlusEmployer": r2(o.ptax_was),
        }

        # internal consistency checks (fail loudly if taxcalc semantics move)
        assert abs(o.odc) < 1e-9, (h["id"], "unexpected other-dependent credit")
        assert abs(employee - o.ptax_was / 2.0) < 1e-6, h["id"]
        assert abs(o.payrolltax - (o.ptax_was + o.setax + o.ptax_amc)) < 1e-6, \
            h["id"]
        ident = (max(0.0, o.taxbc + o.c09600 - o.c07220) + o.niit
                 - o.eitc - o.c11070)
        assert abs(ident - o.iitax) < 1e-6, (h["id"], ident, o.iitax)
        assert abs(o.c07100 - o.c07220) < 1e-9, h["id"]
        assert abs(o.refund - (o.eitc + o.c11070)) < 1e-9, h["id"]

        tags = []
        e, inp = expected, h["input"]
        if e["amt"] > 0: tags.append("amt")                        # noqa: E701
        if e["niit"] > 0: tags.append("niit")                      # noqa: E701
        if e["eitc"] > 0: tags.append("eitc")                      # noqa: E701
        if e["additionalChildTaxCredit"] > 0: tags.append("actc")  # noqa: E701
        if e["childTaxCreditNonrefundable"] > 0: tags.append("ctc")  # noqa: E701
        if e["qbiDeduction"] > 0: tags.append("qbi")               # noqa: E701
        if e["seniorDeduction"] > 0: tags.append("senior-deduction")  # noqa: E701
        if e["selfEmploymentTax"] > 0: tags.append("se-tax")       # noqa: E701
        if e["additionalMedicareTax"] > 0: tags.append("addl-medicare")  # noqa: E701
        if detail["itemizes"]: tags.append("itemizes")             # noqa: E701
        if inp["socialSecurity"] > 0:
            frac = e["taxableSocialSecurity"] / inp["socialSecurity"]
            tags.append("ss-untaxed" if frac == 0 else
                        "ss-85pct-cap" if abs(frac - 0.85) < 1e-9 else
                        "ss-phase-in")
        if inp["itemized"]["charity"] > 0 and not detail["itemizes"]:
            tags.append("non-itemizer-charity")
        if inp["longTermGains"] + inp["shortTermGains"] < 0:
            tags.append("capital-loss")

        result.append({
            "id": h["id"],
            "group": h["group"],
            "description": h["description"],
            "notes": h["notes"],
            "tags": tags,
            "input": h["input"],
            "taxcalcInput": rec,
            "expected": expected,
            "taxcalcDetail": detail,
        })
    return pol, result


NOTES = """\
Oracle: PSL Tax-Calculator (taxcalc) under current-law policy (no reform), \
Records(exact_calculations=True), credit_claim_urn forced to 0 so every \
eligible unit claims EITC/ACTC (taxcalc otherwise models random non-take-up). \
All inputs are whole dollars; outputs are rounded to cents. taxcalc computes \
tax with the continuous rate schedules (no IRS Tax Table $50 bins) and does \
no whole-dollar rounding of intermediate lines.

MAPPING (expected field <- taxcalc variable): agi <- c00100; \
taxableSocialSecurity <- c02500; standardOrItemizedDeduction <- \
max(standard, c04470) (standard includes the 65+ additional amounts and, for \
non-itemizers with charity, the non-itemizer cash-charity deduction; it \
excludes the senior deduction); seniorDeduction <- senior_deduction; \
qbiDeduction <- qbided; taxableIncome <- c04800; regularTaxBeforeCredits <- \
taxbc (ordinary schedule + qualified-dividend/capital-gain worksheet, before \
AMT and credits); amt <- c09600; niit <- niit; childTaxCreditNonrefundable <- \
c07220; additionalChildTaxCredit <- c11070; eitc <- eitc (= c59660); \
incomeTax <- iitax; employeePayrollTax <- ptax_was - ptax_er_p - ptax_er_s; \
selfEmploymentTax <- setax; additionalMedicareTax <- ptax_amc; \
payrollTaxTaxcalcTotal <- payrolltax.

INCOME TAX: iitax = max(0, taxbc + c09600 - c07220) + niit - eitc - c11070 \
for these households (asserted at generation time). iitax can be negative \
(refundable credits). With taxcalc's default soi_iitax=false, iitax EXCLUDES \
self-employment tax and the 0.9% Additional Medicare Tax even though both sit \
on Form 1040 Schedule 2: taxcalc computes them inside othertaxes/c09200 and \
then shifts them out of iitax into payrolltax. NIIT and AMT stay in iitax.

PAYROLL TAX: taxcalc payrolltax = ptax_was + setax + ptax_amc, where ptax_was \
is employee PLUS employer OASDI (6.2% + 6.2% up to the wage base, per person) \
and Medicare HI (1.45% + 1.45%, uncapped) on wages. employeePayrollTax is the \
employee half only (6.2% OASDI to the wage base + 1.45% HI on each person's \
wages) and excludes Additional Medicare Tax and SE tax; the employer half is \
taxcalcDetail.employerPayrollTax. selfEmploymentTax is the full Schedule SE \
tax (12.4% OASDI on 92.35% of net SE income up to wage base minus that \
person's wages, plus 2.9% HI; zero when a person's 92.35% amount is under \
$400); half of it is deducted in AGI. additionalMedicareTax is Form 8959 \
(0.9% of combined wages plus net SE earnings over 200k/250k joint/125k MFS). \
The amount the household itself pays = employeePayrollTax + \
selfEmploymentTax + additionalMedicareTax = payrollTaxTaxcalcTotal - \
taxcalcDetail.employerPayrollTax.

See tests/validation/taxcalc/README.md for modelling differences (EITC \
included in incomeTax, MFS treatment, QBI, non-itemizer charity deduction, \
AMT add-backs, 2027 parameters being projections)."""


def build_fixture(year: int, households: list[dict], generated: str):
    res = run_year(households, year)
    if res is None:
        return None
    pol, hh = res
    tag_counts: dict[str, int] = {}
    group_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    for h in hh:
        group_counts[h["group"]] = group_counts.get(h["group"], 0) + 1
        fs = h["input"]["filingStatus"]
        status_counts[fs] = status_counts.get(fs, 0) + 1
        for t in h["tags"]:
            tag_counts[t] = tag_counts.get(t, 0) + 1
    last_known = int(taxcalc.Policy.LAST_KNOWN_YEAR)
    return {
        "meta": {
            "taxcalcVersion": taxcalc.__version__,
            "generated": generated,
            "seed": SEED,
            "year": year,
            "householdCount": len(hh),
            "includesObbba": True,
            "parametersAreProjected": year > last_known,
            "taxcalcLastKnownParameterYear": last_known,
            "policy": policy_snapshot(pol),
            "coverage": {
                "byFilingStatus": status_counts,
                "byGroup": group_counts,
                "byTag": dict(sorted(tag_counts.items())),
            },
            "notes": NOTES,
        },
        "households": hh,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--years", type=int, nargs="+", default=list(DEFAULT_YEARS))
    ap.add_argument("--out-dir", type=Path, default=FIXTURE_DIR)
    ap.add_argument("--check", action="store_true",
                    help="regenerate and compare with existing files "
                         "(ignoring meta.generated); write nothing")
    args = ap.parse_args(argv)

    generated = os.environ.get("FIXTURE_DATE") or _dt.date.today().isoformat()
    households = build_households(SEED)
    assert len(households) >= 220, len(households)
    rc = 0
    for year in args.years:
        fixture = build_fixture(year, households, generated)
        path = args.out_dir / f"taxcalc-{year}.json"
        if fixture is None:
            print(f"{year}: outside taxcalc policy years, skipped")
            continue
        if args.check:
            old = json.loads(path.read_text(encoding="utf-8"))
            old["meta"].pop("generated", None)
            new = json.loads(json.dumps(fixture))
            new["meta"].pop("generated", None)
            same = old == new
            print(f"{year}: {'up to date' if same else 'DIFFERS'} ({path})")
            rc |= 0 if same else 1
            continue
        args.out_dir.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(fixture, f, indent=1)
            f.write("\n")
        cov = fixture["meta"]["coverage"]
        print(f"{year}: wrote {len(fixture['households'])} households -> {path}")
        print(f"   by status: {cov['byFilingStatus']}")
        print(f"   by tag:    {cov['byTag']}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
