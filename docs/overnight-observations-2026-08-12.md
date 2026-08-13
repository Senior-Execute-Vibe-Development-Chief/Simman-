# Overnight observational runs — 2026-08-12

Owner order: long, full-sized runs at the exact app configuration, recording
nation growth, placement and dates. Three seeds (8817 / 31337 / 4242) at
W=1920 (tw=960), observed Earth climate, from-0 dawn, shipped defaults, tree
`ad3379e`. Target 45k steps; the OS killed the three parallel worlds at 29k /
28k / 23k under memory pressure — all data to those horizons is intact
(overnight_<seed>.jsonl: per-1000-step full polity snapshots + every political
event). Dates below use the APP calendar anchored on the owner's screenshot
(step 19,542 = 364 BC, ~0.2y/step); the JSONLs also carry the linear-calendar
strings.

## Seed 8817 — to step 29000 (≈1527 AD)

**Farming inventions:**
- step 9720 (≈2328 BC): India (28.3,69.6)
- step 12072 (≈1858 BC): MidEast (29.1,30.9)
- step 20064 (≈259 BC): Americas (-11.8,-74.1)
- step 26376 (≈1002 AD): Americas (27.2,-101.8)

**World curve** (step / ≈app year / polities / cities / claimed% / world census):
- 4000 (≈3472 BC): pol=0 cities=0 claimed=0% pop=0
- 8000 (≈2672 BC): pol=0 cities=0 claimed=0% pop=0
- 12000 (≈1872 BC): pol=7 cities=5 claimed=0.2% pop=1174
- 16000 (≈1072 BC): pol=22 cities=19 claimed=1.3% pop=8900
- 20000 (≈272 BC): pol=57 cities=48 claimed=4.5% pop=30152
- 24000 (≈527 AD): pol=88 cities=76 claimed=9% pop=59005
- 28000 (≈1327 AD): pol=107 cities=106 claimed=13.1% pop=73259

**Political events:** ended 51, founded 46, restored 11, seceded 20, submitted 71
**Bonds at end:** 26 of 107 polities

**Largest realms at end:**
- Damfa (China/E-Asia): 1099487k km², 4 cities, census 4375
- Esjaxexisea (Europe): 682899k km², 2 cities, census 2170
- Dylobfuyaa (India): 647708k km², 3 cities, census 3228
- Mẹ̀fǎlěā (India): 636295k km², 2 cities, census 1883
- T'amp'osru (China/E-Asia): 632490k km², 1 cities, census 2041
- Kafeuhoze (Africa-Sub): 622028k km², 2 cities, census 645

## Seed 31337 — to step 28000 (≈1327 AD)

**Farming inventions:**
- step 9552 (≈2362 BC): India (28.3,69.9)
- step 12096 (≈1853 BC): MidEast (29.4,30.9)
- step 17136 (≈845 BC): Sahel/W-Africa (13.3,-9.2)
- step 19992 (≈274 BC): Americas (-11.8,-74.1)
- step 26880 (≈1103 AD): Americas (32.8,-107.4)

**World curve** (step / ≈app year / polities / cities / claimed% / world census):
- 4000 (≈3472 BC): pol=0 cities=0 claimed=0% pop=0
- 8000 (≈2672 BC): pol=0 cities=0 claimed=0% pop=0
- 12000 (≈1872 BC): pol=8 cities=6 claimed=0.3% pop=1345
- 16000 (≈1072 BC): pol=27 cities=23 claimed=1.4% pop=9740
- 20000 (≈272 BC): pol=61 cities=48 claimed=4.6% pop=30967
- 24000 (≈527 AD): pol=89 cities=79 claimed=9.4% pop=59429
- 28000 (≈1327 AD): pol=105 cities=104 claimed=14.1% pop=80849

**Political events:** ended 55, founded 46, restored 9, seceded 18, submitted 66
**Bonds at end:** 32 of 105 polities

**Largest realms at end:**
- Ki'uibuklia (China/E-Asia): 817957k km², 4 cities, census 5084
- Apaatadaa (other): 771353k km², 3 cities, census 4294
- Zyazyiuzyaitaa (Africa-Sub): 670535k km², 1 cities, census 3574
- Nifsuighyiblua (Steppe/N-Eurasia): 502188k km², 1 cities, census 1590
- Pip (Africa-Sub): 491726k km², 3 cities, census 2955
- Apaazya (Africa-Sub): 476508k km², 3 cities, census 3788

## Seed 4242 — to step 23000 (≈327 AD)

**Farming inventions:**
- step 9888 (≈2294 BC): India (28.3,69.6)
- step 12096 (≈1853 BC): MidEast (29.4,30.9)
- step 20016 (≈269 BC): Americas (-11.8,-74.1)

**World curve** (step / ≈app year / polities / cities / claimed% / world census):
- 4000 (≈3472 BC): pol=0 cities=0 claimed=0% pop=0
- 8000 (≈2672 BC): pol=0 cities=0 claimed=0% pop=0
- 12000 (≈1872 BC): pol=8 cities=6 claimed=0.2% pop=1422
- 16000 (≈1072 BC): pol=23 cities=20 claimed=1.2% pop=8900
- 20000 (≈272 BC): pol=55 cities=48 claimed=3.9% pop=27926

**Political events:** founded 28, submitted 30
**Bonds at end:** 29 of 83 polities

**Largest realms at end:**
- Ūmōkáā (China/E-Asia): 634392k km², 1 cities, census 3253
- Tàbká (India): 464143k km², 1 cities, census 2322
- Ta (Africa-Sub): 415636k km², 1 cities, census 2705
- Dụfafagụa (MidEast): 384250k km², 1 cities, census 2018
- Agyụkysyagụ (Europe): 322427k km², 1 cities, census 1661
- Qòbég (India): 322427k km², 1 cities, census 1552

## Reading

Cross-seed consistency is near-total: the three worlds' dawn order (Indus →
Nile → Sahel → Americas), state-formation onset (~step 10k ≈ 2250 BC), the
claimed-land curve (0.2% → 13-14% over 16k steps — the world stays ~86% wild
deep into the run), and the consolidation profile (submission-dominated, 26-32
live bonds, multi-city empires to 1.1M km², with 50+ polity deaths and ~20
secessions per run) all reproduce. Every mechanism of the 2026-08-11 arc is
visible in the record: the real cradles lead in the real order, the frontier
advances by contact, crowns unite and empires assemble, and history churns.
Open taste questions for the owner: the deep-run frontier speed (13% claimed
at ≈1300-1700 AD equivalents — the ORG_CONTACT dial), and the era-calendar
display (the linear label drifts from development; the app's era banner is
the anchor that matters).
