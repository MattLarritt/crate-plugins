// shims/react.js
var React = window.crateHost.React;
var Children = React.Children;
var Component = React.Component;
var Fragment = React.Fragment;
var createContext = React.createContext;
var createElement = React.createElement;
var forwardRef = React.forwardRef;
var isValidElement = React.isValidElement;
var memo = React.memo;
var useCallback = React.useCallback;
var useContext = React.useContext;
var useEffect = React.useEffect;
var useId = React.useId;
var useLayoutEffect = React.useLayoutEffect;
var useMemo = React.useMemo;
var useReducer = React.useReducer;
var useRef = React.useRef;
var useState = React.useState;
var useSyncExternalStore = React.useSyncExternalStore;
var useTransition = React.useTransition;

// shims/crate-api.js
var { get, post, put, del } = window.crateHost.api;

// plugins/chords/client/api.ts
var chords = (trackId) => get(`/api/track/${trackId}/chords`);
var saveChords = (trackId, body) => put(`/api/track/${trackId}/chords`, { body });
var deleteChords = (trackId) => del(`/api/track/${trackId}/chords`);
var myChords = () => get("/api/chords");

// plugins/chords/client/chordshapes.ts
var NOTE = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11
};
var OPEN_STRINGS = [4, 9, 2, 7, 11, 4];
var ALIAS = {
  "": "",
  maj: "",
  major: "",
  M: "",
  m: "m",
  min: "m",
  minor: "m",
  "-": "m",
  "7": "7",
  dom7: "7",
  m7: "m7",
  min7: "m7",
  "-7": "m7",
  maj7: "maj7",
  M7: "maj7",
  ma7: "maj7",
  "\u0394": "maj7",
  "\u03947": "maj7",
  sus: "sus4",
  sus4: "sus4",
  sus2: "sus2",
  "6": "6",
  maj6: "6",
  M6: "6",
  m6: "m6",
  min6: "m6",
  "9": "9",
  dom9: "9"
};
function parseChordName(name) {
  const m = /^([A-G](?:#|b)?)(.*)$/.exec(name.trim());
  if (!m) return null;
  const root = NOTE[m[1]];
  if (root === void 0) return null;
  let rest = m[2] ?? "";
  let bass = null;
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    const b = NOTE[rest.slice(slash + 1).trim()];
    bass = b === void 0 ? null : b;
    rest = rest.slice(0, slash);
  }
  const written = rest.trim().replace(/°/, "dim").replace(/^\+$/, "aug");
  const quality = ALIAS[written] ?? ALIAS[written.toLowerCase()] ?? written;
  return { root, quality, bass };
}
var OPEN = {
  C: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  C7: { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  Cadd9: { frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  D: { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  D7: { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 3, 1, 2] },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1] },
  Dm7: { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  Dsus2: { frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  Em7: { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
  Esus4: { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0] },
  F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 1, 0, 0, 0, 2] },
  A: { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  A7: { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 3, 1, 2, 0] },
  Asus2: { frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  B7: { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] }
};
var MOVABLE = {
  "": { e: [0, 2, 2, 1, 0, 0], a: [-1, 0, 2, 2, 2, 0] },
  m: { e: [0, 2, 2, 0, 0, 0], a: [-1, 0, 2, 2, 1, 0] },
  "7": { e: [0, 2, 0, 1, 0, 0], a: [-1, 0, 2, 0, 2, 0] },
  m7: { e: [0, 2, 0, 0, 0, 0], a: [-1, 0, 2, 0, 1, 0] },
  maj7: { e: [0, 2, 1, 1, 0, 0], a: [-1, 0, 2, 1, 2, 0] },
  sus4: { e: [0, 2, 2, 2, 0, 0], a: [-1, 0, 2, 2, 3, 0] },
  sus2: { a: [-1, 0, 2, 2, 0, 0] },
  "6": { a: [-1, 0, 2, 2, 2, 2] },
  m6: { a: [-1, 0, 2, 2, 1, 2] },
  "9": { a: [-1, 0, 2, 0, 2, 2] }
};
var ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];
function atFret(shape, fret, family) {
  return {
    frets: shape.map((f) => f === -1 ? -1 : f + fret),
    // Fingering for a barre is the same everywhere, but only the barre finger is worth
    // asserting; the rest depends on the hand.
    fingers: shape.map(() => 0),
    label: fret === 0 ? "open" : `${family} shape, barre ${ORD[fret] ?? `fret ${fret}`} fret`
  };
}
var SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function shapesFor(name) {
  const out = [];
  const parsedFirst = parseChordName(name);
  const open = OPEN[name.trim()] ?? (parsedFirst ? OPEN[SHARP[parsedFirst.root] + parsedFirst.quality] ?? OPEN[FLAT[parsedFirst.root] + parsedFirst.quality] : void 0);
  if (open) {
    out.push({
      frets: open.frets,
      fingers: open.fingers ?? open.frets.map(() => 0),
      label: open.frets.some((f) => f === 0) ? "open" : "first position"
    });
  }
  const parsed = parsedFirst;
  if (!parsed) return out;
  const movable = MOVABLE[parsed.quality];
  if (!movable) return out;
  const eFret = (parsed.root - OPEN_STRINGS[0] + 12) % 12;
  const aFret = (parsed.root - OPEN_STRINGS[1] + 12) % 12;
  const cands = [];
  if (movable.e) cands.push(atFret(movable.e, eFret, "E"));
  if (movable.a) cands.push(atFret(movable.a, aFret, "A"));
  cands.sort((x, y) => Math.max(...x.frets) - Math.max(...y.frets));
  for (const c of cands) {
    if (out.some((o) => o.frets.join() === c.frets.join())) continue;
    out.push(c);
  }
  return out;
}
function fromUg(variants, limit = 5) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const v of variants) {
    if (v.frets.length !== 6) continue;
    const frets = [...v.frets].reverse();
    const key = frets.join();
    if (seen.has(key)) continue;
    seen.add(key);
    const lowest = Math.min(...frets.filter((f) => f > 0));
    out.push({
      frets,
      fingers: [...v.fingers].reverse(),
      label: frets.some((f) => f === 0) ? "open" : Number.isFinite(lowest) && lowest > 0 ? `${ORD[lowest] ?? `fret ${lowest}`} fret` : ""
    });
    if (out.length >= limit) break;
  }
  return out;
}
var UKE_OPEN = [7, 0, 4, 9];
var UKE_TONES = {
  "": { tones: [0, 4, 7] },
  m: { tones: [0, 3, 7] },
  "7": { tones: [0, 4, 7, 10], omit: [7] },
  m7: { tones: [0, 3, 7, 10], omit: [7] },
  maj7: { tones: [0, 4, 7, 11], omit: [7] },
  sus4: { tones: [0, 5, 7] },
  sus2: { tones: [0, 2, 7] },
  "6": { tones: [0, 4, 7, 9] },
  m6: { tones: [0, 3, 7, 9] },
  "9": { tones: [0, 2, 4, 7, 10], omit: [7] },
  add9: { tones: [0, 2, 4, 7], omit: [7] },
  dim: { tones: [0, 3, 6] },
  dim7: { tones: [0, 3, 6, 9] },
  aug: { tones: [0, 4, 8] }
};
function ukeShapesFor(name) {
  const parsed = parseChordName(name);
  if (!parsed) return [];
  const spec = UKE_TONES[parsed.quality];
  if (!spec) return [];
  const tones = new Set(spec.tones.map((t) => (parsed.root + t) % 12));
  const required = new Set(
    spec.tones.filter((t) => !(spec.omit ?? []).includes(t)).map((t) => (parsed.root + t) % 12)
  );
  const found = /* @__PURE__ */ new Map();
  for (let base = 0; base <= 9; base++) {
    const options = UKE_OPEN.map(() => {
      const o = [0];
      for (let f = Math.max(base, 1); f <= base + 3; f++) o.push(f);
      return o;
    });
    for (const f0 of options[0])
      for (const f1 of options[1])
        for (const f2 of options[2])
          for (const f3 of options[3]) {
            const frets = [f0, f1, f2, f3];
            const notes = frets.map((f, i) => (UKE_OPEN[i] + f) % 12);
            if (!notes.every((n) => tones.has(n))) continue;
            if (![...required].every((r) => notes.includes(r))) continue;
            const key = frets.join(",");
            if (found.has(key)) continue;
            const fretted = frets.filter((f) => f > 0);
            const maxF = Math.max(0, ...fretted);
            const span = fretted.length ? maxF - Math.min(...fretted) : 0;
            const opens = frets.filter((f) => f === 0).length;
            found.set(key, { frets, score: maxF * 10 + span * 3 - opens });
          }
    if (found.size >= 10) break;
  }
  return [...found.values()].sort((a, b) => a.score - b.score).slice(0, 4).map(({ frets }) => {
    const maxF = Math.max(...frets);
    return {
      frets,
      // Derived shapes carry no fingering: a wrong finger number teaches a wrong habit,
      // and the Diagram simply draws unnumbered dots for zeros.
      fingers: [0, 0, 0, 0],
      label: maxF <= 3 ? "open" : `${ORD[Math.min(...frets.filter((f) => f > 0))] ?? "up the neck"} fret`
    };
  });
}

// shims/crate-logo.js
var { WORDMARK } = window.crateHost.logo;

// shims/jsx-runtime.js
var rt = window.crateHost.jsxRuntime;
var jsx = rt.jsx;
var jsxs = rt.jsxs;
var Fragment2 = rt.Fragment;

// plugins/chords/client/panel.tsx
var COMPACT_QUERY = "(max-width: 820px)";
var GAP = 28;
var FLOOR_FONT = 8;
var MOBILE_MAX_FONT = 12.5;
var TUCK_AFTER = 28;
var MAX_COLUMNS = 8;
var COMFORT_FONT = 13;
var MIN_FONT = 10.5;
var MAX_FONT = 15;
var SIZE_STEPS = [
  { label: "Smallest", mult: 0.72 },
  { label: "Smaller", mult: 0.85 },
  { label: "Normal", mult: 1 },
  { label: "Larger", mult: 1.18 },
  { label: "Largest", mult: 1.4 }
];
var NORMAL_SIZE = 2;
var PREFS_KEY = "crate.chords.view";
var DEFAULT_PREFS = { cols: 0, size: NORMAL_SIZE, strip: "top", instrument: "guitar" };
function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw);
    return {
      // Clamped on the way in: a stored value from an older build, or one somebody edited by
      // hand, must not be able to produce a layout with zero or ninety columns.
      cols: Math.min(Math.max(Number(v.cols) || 0, 0), MAX_COLUMNS),
      size: Math.min(Math.max(Number(v.size) ?? NORMAL_SIZE, 0), SIZE_STEPS.length - 1),
      strip: v.strip === "left" || v.strip === "off" ? v.strip : "top",
      instrument: v.instrument === "ukulele" ? "ukulele" : "guitar"
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
function writePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
  }
}
function useCompact() {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(COMPACT_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, []);
  return compact;
}
var chRatio = 0;
function charRatio() {
  if (chRatio) return chRatio;
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-family:var(--mono)";
  probe.textContent = "0".repeat(50);
  document.body.appendChild(probe);
  chRatio = probe.getBoundingClientRect().width / 5e3 || 0.6;
  probe.remove();
  return chRatio;
}
function widthOf(blocks) {
  let w = 0;
  for (const b of blocks) {
    if (b.kind === "line") {
      w = Math.max(w, b.lyric.length);
      for (const c of b.chords) w = Math.max(w, c.col + c.name.length);
    } else if (b.kind === "tab") {
      for (const l of b.lines) w = Math.max(w, l.length);
    } else if (b.kind === "text") {
      w = Math.max(w, b.text.length);
    }
  }
  return w;
}
function Diagram({ shape, size = 50 }) {
  const played = shape.frets.filter((f) => f > 0);
  const lowest = played.length ? Math.min(...played) : 1;
  const highest = played.length ? Math.max(...played) : 1;
  const FRETS = 4;
  const start = highest <= FRETS ? 1 : Math.max(1, Math.min(lowest, highest - FRETS + 1));
  const openNut = start === 1;
  const w = size;
  const h = size * 1.3;
  const padX = w * 0.14;
  const padTop = size * 0.3;
  const padBottom = size * 0.06;
  const strings = shape.frets.length;
  const gridW = w - padX * 2;
  const gridH = h - padTop - padBottom;
  const stringGap = gridW / (strings - 1);
  const fretGap = gridH / FRETS;
  return /* @__PURE__ */ jsxs("svg", { className: "cdiagram", viewBox: `0 0 ${w} ${h}`, width: w, height: h, "aria-hidden": true, children: [
    /* @__PURE__ */ jsx(
      "line",
      {
        x1: padX,
        y1: padTop,
        x2: padX + gridW,
        y2: padTop,
        className: openNut ? "nut" : "fret"
      }
    ),
    Array.from({ length: FRETS }, (_, i) => /* @__PURE__ */ jsx(
      "line",
      {
        x1: padX,
        y1: padTop + fretGap * (i + 1),
        x2: padX + gridW,
        y2: padTop + fretGap * (i + 1),
        className: "fret"
      },
      `f${i}`
    )),
    Array.from({ length: strings }, (_, i) => /* @__PURE__ */ jsx(
      "line",
      {
        x1: padX + stringGap * i,
        y1: padTop,
        x2: padX + stringGap * i,
        y2: padTop + gridH,
        className: "string"
      },
      `s${i}`
    )),
    !openNut && /* @__PURE__ */ jsx("text", { x: padX - 2, y: padTop + fretGap * 0.7, className: "cfret", textAnchor: "end", children: start }),
    shape.frets.map((f, i) => {
      const x = padX + stringGap * i;
      if (f === -1) {
        return /* @__PURE__ */ jsx("text", { x, y: padTop - size * 0.08, className: "cmark", textAnchor: "middle", children: "\xD7" }, i);
      }
      if (f === 0) {
        return /* @__PURE__ */ jsx("circle", { cx: x, cy: padTop - size * 0.15, r: size * 0.06, className: "copen" }, i);
      }
      const row = f - start;
      if (row < 0 || row >= FRETS) return null;
      const finger = shape.fingers[i] ?? 0;
      return /* @__PURE__ */ jsxs("g", { children: [
        /* @__PURE__ */ jsx("circle", { cx: x, cy: padTop + fretGap * (row + 0.5), r: size * 0.08, className: "cdot" }),
        finger > 0 && /* @__PURE__ */ jsx(
          "text",
          {
            x,
            y: padTop + fretGap * (row + 0.5) + size * 0.035,
            className: "cfinger",
            textAnchor: "middle",
            children: finger
          }
        )
      ] }, i);
    })
  ] });
}
function voicings(name, imported, instrument) {
  if (instrument === "ukulele") return ukeShapesFor(name);
  const ug = imported[name];
  if (ug?.length) return fromUg(ug);
  return shapesFor(name);
}
function peekAt(name, el) {
  const r = el.getBoundingClientRect();
  return { name, left: r.left, top: r.top, bottom: r.bottom };
}
function Blocks({
  blocks,
  onPeek
}) {
  return /* @__PURE__ */ jsx(Fragment2, { children: blocks.map((b, i) => {
    if (b.kind === "section") {
      return /* @__PURE__ */ jsx("div", { className: "csection", children: b.label }, i);
    }
    if (b.kind === "gap") return /* @__PURE__ */ jsx("div", { className: "cgap" }, i);
    if (b.kind === "text") {
      return /* @__PURE__ */ jsx("div", { className: "ctext", children: b.text }, i);
    }
    if (b.kind === "tab") {
      return /* @__PURE__ */ jsx("pre", { className: "ctab", children: b.lines.join("\n") }, i);
    }
    return /* @__PURE__ */ jsxs("div", { className: "cline", children: [
      b.chords.length > 0 && /* @__PURE__ */ jsx("div", { className: "cchords", children: b.chords.map(
        (c, j) => c.deco ? /* @__PURE__ */ jsx("span", { className: "cdeco", style: { left: `${c.col}ch` }, children: c.name }, j) : (
          /*
           * Hover, not click. Looking up a shape is a glance, and a glance should not
           * cost two clicks (one to open, one to dismiss) while both hands are on the
           * guitar. Still a button so that a keyboard and a touch screen can both
           * reach it — focus and tap show the same card.
           */
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "cchord",
              style: { left: `${c.col}ch` },
              onMouseEnter: (e) => onPeek(peekAt(c.name, e.currentTarget)),
              onMouseLeave: () => onPeek(null),
              onFocus: (e) => onPeek(peekAt(c.name, e.currentTarget)),
              onBlur: () => onPeek(null),
              onClick: (e) => {
                e.stopPropagation();
                onPeek(peekAt(c.name, e.currentTarget));
              },
              children: c.name
            },
            j
          )
        )
      ) }),
      b.lyric !== "" && /* @__PURE__ */ jsx("div", { className: "clyric", children: b.lyric })
    ] }, i);
  }) });
}
function Segments({
  value,
  options,
  onPick
}) {
  return /* @__PURE__ */ jsx("div", { className: "cseg", children: options.map((o) => /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      className: value === o.v ? "on" : "",
      title: o.title,
      onClick: () => onPick(o.v),
      children: o.label
    },
    o.v
  )) });
}
function Stepper({
  label,
  canDown,
  canUp,
  onDown,
  onUp,
  onLabel,
  labelTitle,
  down = "\u2212",
  up = "+"
}) {
  return /* @__PURE__ */ jsxs("div", { className: "cstep", children: [
    /* @__PURE__ */ jsx("button", { type: "button", disabled: !canDown, onClick: onDown, title: "Less", children: down }),
    onLabel ? /* @__PURE__ */ jsx("button", { type: "button", className: "lbl", onClick: onLabel, title: labelTitle, children: label }) : /* @__PURE__ */ jsx("span", { children: label }),
    /* @__PURE__ */ jsx("button", { type: "button", disabled: !canUp, onClick: onUp, title: "More", children: up })
  ] });
}
function ChordPanel({
  trackId,
  title,
  artistName,
  onClose,
  say
}) {
  const [data, setData] = useState("loading");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [peek, setPeek] = useState(null);
  const [showPreamble, setShowPreamble] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);
  const compact = useCompact();
  const [tucked, setTucked] = useState(false);
  const lastScroll = useRef(0);
  const viewportRef = useRef(null);
  const flowRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const change = (patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePrefs(next);
      return next;
    });
  };
  useEffect(() => {
    setData("loading");
    setEditing(false);
    setPage(0);
    setPeek(null);
    setShowPreamble(false);
    let dead = false;
    chords(trackId).then((d) => {
      if (dead) return;
      setData(d);
      setDraft(d.body);
      if (!d.body) setEditing(true);
    }).catch(() => {
      if (!dead) {
        setData({ body: "", sourceUrl: "", shapes: {}, tuning: "", capo: "", parsed: null });
      }
    });
    return () => {
      dead = true;
    };
  }, [trackId]);
  const parsed = data === "loading" ? null : data.parsed;
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setBox({ w: Math.max(el.clientWidth - padX, 0), h: Math.max(el.clientHeight - padY, 0) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [editing, data === "loading"]);
  const layout = useMemo(() => {
    const chars = parsed ? Math.max(widthOf(parsed.blocks), 20) : 40;
    const mult = SIZE_STEPS[prefs.size]?.mult ?? 1;
    if (!box.w) return { colW: 0, font: 13 * mult, wanted: prefs.cols || 1 };
    const ratio = charRatio();
    const fitFont = (c) => (box.w - GAP * (c - 1)) / c / (chars * ratio);
    if (compact) {
      const fit = Math.max(fitFont(1), FLOOR_FONT);
      return { colW: 0, font: Math.min(fit, MOBILE_MAX_FONT), wanted: 1 };
    }
    let wanted = prefs.cols;
    if (!wanted) {
      wanted = 1;
      for (let c = MAX_COLUMNS; c >= 1; c--) {
        if (fitFont(c) >= COMFORT_FONT) {
          wanted = c;
          break;
        }
      }
    }
    const font = Math.min(Math.max(fitFont(wanted), MIN_FONT), MAX_FONT) * mult;
    const share = (box.w - GAP * (wanted - 1)) / wanted;
    return { colW: Math.max(share, chars * ratio * font), font, wanted };
  }, [box.w, parsed, prefs.cols, prefs.size, compact]);
  const [stride, setStride] = useState(0);
  const [actualCols, setActualCols] = useState(1);
  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    if (compact) {
      setStride(0);
      setPages(1);
      setActualCols(1);
      setPage(0);
      return;
    }
    const step = flow.clientWidth + GAP;
    const total = Math.max(1, Math.ceil((flow.scrollWidth + GAP) / Math.max(step, 1)));
    setStride(step);
    setPages(total);
    setActualCols(
      layout.colW > 0 ? Math.max(1, Math.floor((flow.clientWidth + GAP) / (layout.colW + GAP))) : 1
    );
    setPage((p) => Math.min(p, total - 1));
  }, [parsed, layout, box.h, box.w, showPreamble, compact]);
  useEffect(() => {
    if (editing || compact) return;
    const onKey = (e) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        setPage((p) => Math.min(p + 1, pages - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        setPage((p) => Math.max(p - 1, 0));
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, pages, onClose, compact]);
  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveChords(trackId, draft);
      setData(saved);
      setDraft(saved.body);
      setEditing(false);
      setPage(0);
      if (saved.imported) {
        say("good", `Imported ${saved.imported.song} \u2014 ${saved.imported.artist}`);
      } else if (saved.body) {
        say("good", "Chords saved");
      }
    } catch (err) {
      say("bad", err.message);
    } finally {
      setSaving(false);
    }
  };
  const shapes = data === "loading" ? {} : data.shapes;
  const peekShapes = peek ? voicings(peek.name, shapes, prefs.instrument) : [];
  const strip = (where) => parsed && parsed.chords.length > 0 ? /* @__PURE__ */ jsxs("div", { className: `cstrip ${where}`, children: [
    /* @__PURE__ */ jsx("div", { className: "cinstr", role: "group", "aria-label": "Diagram instrument", children: ["guitar", "ukulele"].map((inst) => /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: prefs.instrument === inst ? "on" : "",
        onClick: () => change({ instrument: inst }),
        children: inst === "guitar" ? "Guitar" : "Uke"
      },
      inst
    )) }),
    parsed.chords.map((name) => {
      const v = voicings(name, shapes, prefs.instrument);
      return /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: "cstripitem",
          title: v.length > 1 ? `${v.length} voicings` : v[0]?.label,
          onMouseEnter: (e) => setPeek(peekAt(name, e.currentTarget)),
          onMouseLeave: () => setPeek(null),
          onFocus: (e) => setPeek(peekAt(name, e.currentTarget)),
          onBlur: () => setPeek(null),
          children: [
            /* @__PURE__ */ jsx("span", { className: "n", children: name }),
            v[0] ? /* @__PURE__ */ jsx(Diagram, { shape: v[0] }) : /* @__PURE__ */ jsx("span", { className: "cnodiagram", children: "?" })
          ]
        },
        name
      );
    })
  ] }) : null;
  return /* @__PURE__ */ jsxs("div", { className: "chordpanel", children: [
    /* @__PURE__ */ jsxs("div", { className: "chordhead", children: [
      /* @__PURE__ */ jsx("svg", { className: "chordlogo", viewBox: `0 0 ${WORDMARK.w} ${WORDMARK.h}`, role: "img", "aria-label": "Crate", children: /* @__PURE__ */ jsx("path", { fill: "currentColor", fillRule: "evenodd", d: WORDMARK.d }) }),
      /* @__PURE__ */ jsxs("div", { className: "words", children: [
        /* @__PURE__ */ jsx("div", { className: "t", children: title }),
        /* @__PURE__ */ jsxs("div", { className: "s muted", children: [
          artistName,
          data !== "loading" && data.tuning ? ` \xB7 ${data.tuning}` : "",
          data !== "loading" && data.capo ? ` \xB7 capo ${data.capo}` : ""
        ] })
      ] }),
      data !== "loading" && data.sourceUrl && !editing && // Where an import came from, credited and reachable. The tabber wrote this.
      /* @__PURE__ */ jsx(
        "a",
        {
          className: "csource muted",
          href: data.sourceUrl,
          target: "_blank",
          rel: "noreferrer noopener",
          children: "Ultimate Guitar"
        }
      ),
      !editing && /* @__PURE__ */ jsx("button", { className: "btn sec sm", onClick: () => setEditing(true), children: "Edit" }),
      editing && data !== "loading" && data.body && /* @__PURE__ */ jsx(
        "button",
        {
          className: "btn sec sm",
          onClick: () => {
            setDraft(data.body);
            setEditing(false);
          },
          children: "Cancel"
        }
      ),
      editing && /* @__PURE__ */ jsx("button", { className: "btn sm", disabled: saving, onClick: () => void save(), children: saving ? "Saving\u2026" : "Save" }),
      /* @__PURE__ */ jsx("button", { className: "btn sec sm", onClick: onClose, children: "Close" })
    ] }),
    data === "loading" && /* @__PURE__ */ jsx("div", { className: "spinner", children: "Looking up your chords\u2026" }),
    editing && data !== "loading" && /* @__PURE__ */ jsxs("div", { className: "chordedit", children: [
      /* @__PURE__ */ jsx("p", { className: "muted sm", children: "Type the chords above the words, or paste an Ultimate Guitar link on the first line and save \u2014 it will be fetched and formatted. Only you can see this." }),
      /* @__PURE__ */ jsx(
        "textarea",
        {
          className: "chordbox",
          value: draft,
          spellCheck: false,
          placeholder: "https://tabs.ultimate-guitar.com/tab/\u2026\n\nor type it yourself:\n\n[Verse 1]\nC              G\nSitting here with nothing to say\n",
          onChange: (e) => setDraft(e.target.value)
        }
      ),
      data.body && /* @__PURE__ */ jsx(
        "button",
        {
          className: "btn sec sm cdelete",
          onClick: () => {
            setDraft("");
            void (async () => {
              await deleteChords(trackId).catch(() => {
              });
              setData({
                body: "",
                sourceUrl: "",
                shapes: {},
                tuning: "",
                capo: "",
                parsed: null
              });
              say("good", "Chord sheet removed");
            })();
          },
          children: "Delete this sheet"
        }
      )
    ] }),
    !editing && parsed && /* @__PURE__ */ jsxs(Fragment2, { children: [
      /* @__PURE__ */ jsxs("div", { className: `chordtuck${tucked ? " tucked" : ""}`, children: [
        (compact || prefs.strip === "top") && strip("top"),
        parsed.preamble.length > 0 && /* @__PURE__ */ jsxs("div", { className: "cpreamble", children: [
          /* @__PURE__ */ jsx("button", { className: "btn sec sm", onClick: () => setShowPreamble((s) => !s), children: showPreamble ? "Hide the tabber\u2019s notes" : "About this tab" }),
          showPreamble && /* @__PURE__ */ jsx(
            "div",
            {
              className: "cpreamblebody",
              style: { fontSize: `${Math.max(layout.font, 11)}px` },
              children: /* @__PURE__ */ jsx(Blocks, { blocks: parsed.preamble, onPeek: setPeek })
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "chordmain", children: [
        !compact && prefs.strip === "left" && strip("left"),
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "chordviewport",
            ref: viewportRef,
            onScroll: (e) => {
              if (!compact) return;
              const y = e.currentTarget.scrollTop;
              const was = lastScroll.current;
              lastScroll.current = y;
              if (y <= TUCK_AFTER) setTucked(false);
              else if (y > was + 4) setTucked(true);
              else if (y < was - 12) setTucked(false);
            },
            children: /* @__PURE__ */ jsx(
              "div",
              {
                className: "chordflow",
                ref: flowRef,
                style: {
                  // Width, not count — see the note on `layout`. Neither applies on a phone,
                  // which is one plain column that scrolls.
                  columnWidth: !compact && layout.colW ? `${layout.colW}px` : void 0,
                  columnGap: GAP,
                  fontSize: `${layout.font}px`,
                  transform: compact ? void 0 : `translateX(-${page * stride}px)`
                },
                children: /* @__PURE__ */ jsx(Blocks, { blocks: parsed.blocks, onPeek: setPeek })
              }
            )
          }
        )
      ] }),
      !compact && /* @__PURE__ */ jsxs("div", { className: "chordfoot", children: [
        /* @__PURE__ */ jsxs("div", { className: "ctools", children: [
          /* @__PURE__ */ jsx(
            Segments,
            {
              value: prefs.strip,
              options: [
                { v: "top", label: "Top", title: "Chord shapes across the top" },
                { v: "left", label: "Left", title: "Chord shapes down the left" },
                { v: "off", label: "Off", title: "No chord shapes" }
              ],
              onPick: (v) => change({ strip: v })
            }
          ),
          /* @__PURE__ */ jsx(
            Segments,
            {
              value: prefs.instrument,
              options: [
                { v: "guitar", label: "Guitar", title: "Guitar chord diagrams" },
                { v: "ukulele", label: "Ukulele", title: "Ukulele chord diagrams (GCEA)" }
              ],
              onPick: (v) => change({ instrument: v })
            }
          ),
          /* @__PURE__ */ jsx(
            Stepper,
            {
              label: SIZE_STEPS[prefs.size]?.label ?? "Normal",
              down: "A\u2212",
              up: "A+",
              canDown: prefs.size > 0,
              canUp: prefs.size < SIZE_STEPS.length - 1,
              onDown: () => change({ size: prefs.size - 1 }),
              onUp: () => change({ size: prefs.size + 1 })
            }
          ),
          /* @__PURE__ */ jsx(
            Stepper,
            {
              label: prefs.cols === 0 ? `Auto (${actualCols})` : `${prefs.cols} column${prefs.cols === 1 ? "" : "s"}${// Say so when the ask could not be met, rather than quietly showing
              // a different number of columns than the one on the button.
              actualCols !== prefs.cols ? ` \u2192 ${actualCols}` : ""}`,
              canDown: (prefs.cols || actualCols) > 1,
              canUp: (prefs.cols || actualCols) < MAX_COLUMNS,
              onDown: () => change({ cols: Math.max((prefs.cols || actualCols) - 1, 1) }),
              onUp: () => change({ cols: Math.min((prefs.cols || actualCols) + 1, MAX_COLUMNS) }),
              onLabel: prefs.cols === 0 ? void 0 : () => change({ cols: 0 }),
              labelTitle: "Back to automatic"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "cpager", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              className: "btn sec sm",
              disabled: page === 0,
              onClick: () => setPage((p) => Math.max(p - 1, 0)),
              children: "\u2039 Back"
            }
          ),
          /* @__PURE__ */ jsx("span", { className: "muted sm", children: pages > 1 ? `Page ${page + 1} of ${pages}` : "One page" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              className: "btn sec sm",
              disabled: page >= pages - 1,
              onClick: () => setPage((p) => Math.min(p + 1, pages - 1)),
              children: "Next \u203A"
            }
          )
        ] })
      ] })
    ] }),
    peek && /* @__PURE__ */ jsxs(
      "div",
      {
        className: "cpeek",
        style: {
          left: Math.min(Math.max(peek.left - 8, 8), Math.max(window.innerWidth - 380, 8)),
          // Below the chord normally, above it when there is no room below.
          ...peek.bottom + 190 < window.innerHeight ? { top: peek.bottom + 6 } : { bottom: window.innerHeight - peek.top + 6 }
        },
        children: [
          /* @__PURE__ */ jsx("div", { className: "t", children: peek.name }),
          peekShapes.length === 0 ? /* @__PURE__ */ jsx("div", { className: "muted sm", children: "No diagram for this one \u2014 a guessed shape would be worse than none." }) : /* @__PURE__ */ jsx("div", { className: "cvrow", children: peekShapes.map((s, i) => /* @__PURE__ */ jsxs("div", { className: "cvitem", children: [
            /* @__PURE__ */ jsx(Diagram, { shape: s, size: 58 }),
            /* @__PURE__ */ jsx("div", { className: "muted sm", children: s.label })
          ] }, i)) })
        ]
      }
    )
  ] });
}

// shims/crate-player.js
var { usePlayer, playable } = window.crateHost.player;

// shims/crate-plugins.js
var { requestPanel } = window.crateHost.plugins;

// plugins/chords/client/pane.tsx
function ChordSheetsPane({ say }) {
  const p = usePlayer();
  const [sheets, setSheets] = useState("loading");
  const load = useCallback(() => {
    myChords().then((r) => setSheets(r.sheets)).catch((e) => {
      setSheets([]);
      say("bad", e.message);
    });
  }, [say]);
  useEffect(load, [load]);
  if (sheets === "loading") return /* @__PURE__ */ jsx("div", { className: "spinner", children: "Finding what you have written\u2026" });
  if (!sheets.length) {
    return /* @__PURE__ */ jsx("p", { className: "muted", children: "Nothing yet. Play a song, press the guitar on the player, and either type the chords or paste an Ultimate Guitar link. Only you can see what you write." });
  }
  return /* @__PURE__ */ jsx("div", { className: "sheetlist", children: sheets.map((s) => /* @__PURE__ */ jsxs("div", { className: "sheetrow", children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "words",
        title: "Play this and open the chords",
        onClick: () => {
          requestPanel("chords");
          p.play(
            [
              {
                trackId: s.trackId,
                title: s.title,
                artistName: s.artistName,
                albumTitle: s.albumTitle,
                durationS: s.durationS
              }
            ],
            0,
            "your chord sheets"
          );
        },
        children: [
          /* @__PURE__ */ jsx("span", { className: "t", children: s.title }),
          /* @__PURE__ */ jsxs("span", { className: "s muted", children: [
            s.artistName,
            s.sourceUrl ? " \xB7 from Ultimate Guitar" : " \xB7 your own notes",
            ` \xB7 ${s.lines} line${s.lines === 1 ? "" : "s"}`
          ] })
        ]
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        className: "btn sec sm",
        title: "Delete this sheet",
        onClick: () => {
          void deleteChords(s.trackId).then(() => {
            say("good", `Removed your chords for ${s.title}`);
            load();
          }).catch((e) => say("bad", e.message));
        },
        children: "Delete"
      }
    )
  ] }, s.trackId)) });
}

// shims/crate-icons.js
var { Svg } = window.crateHost.icons;

// plugins/chords/client/icon.tsx
function IconGuitar(p) {
  return /* @__PURE__ */ jsx(Svg, { ...p, stroke: true, children: /* @__PURE__ */ jsxs("g", { transform: "rotate(-30 12 12)", children: [
    /* @__PURE__ */ jsx("path", { d: "M12 8.8C14.1 8.8 15.4 10.1 15.4 11.7C15.4 13.1 14 13.7 14 15C14 16.4 16.5 17.3 16.5 19C16.5 20.5 14.4 21.5 12 21.5C9.6 21.5 7.5 20.5 7.5 19C7.5 17.3 10 16.4 10 15C10 13.7 8.6 13.1 8.6 11.7C8.6 10.1 9.9 8.8 12 8.8Z" }),
    /* @__PURE__ */ jsx("path", { d: "M12 8.9V4.1" }),
    /* @__PURE__ */ jsx("path", { d: "M10.1 3.2H13.9" }),
    /* @__PURE__ */ jsx("circle", { cx: "12", cy: "11.7", r: "1.3", fill: "currentColor", stroke: "none" })
  ] }) });
}

// plugins/chords/client/index.tsx
var chordsUi = {
  id: "chords",
  playbar: {
    title: "Chords and notes",
    icon: IconGuitar,
    Panel: ChordPanel
  },
  profile: {
    label: "Chords & notes",
    hint: "what you have written down",
    Pane: ChordSheetsPane
  }
};
var index_default = chordsUi;
export {
  index_default as default
};
