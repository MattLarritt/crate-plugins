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

// shims/crate-player.js
var { usePlayer, playable } = window.crateHost.player;

// shims/crate-api.js
var { get, post, put, del } = window.crateHost.api;

// plugins/intelligent-shuffle/client/api.ts
var plan = (count, exclude, afterTrackId) => post("/api/ishuffle/plan", { count, exclude, afterTrackId });
var vote = (trackId, direction) => post("/api/ishuffle/vote", { trackId, direction });
var moodNow = () => get("/api/ishuffle/mood");
var resetMood = () => post("/api/ishuffle/reset", {});
var saveMoodPlaylist = (name) => post("/api/ishuffle/save-playlist", { name });
var sayToDj = (text) => post("/api/ishuffle/say", { text });

// plugins/intelligent-shuffle/client/session.ts
var active = false;
var expectedSource = "";
var played = /* @__PURE__ */ new Set();
var version = 0;
var listeners = /* @__PURE__ */ new Set();
var bump = () => {
  version++;
  for (const fn of listeners) fn();
};
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getVersion() {
  return version;
}
function isActive() {
  return active;
}
function startSession(source) {
  active = true;
  expectedSource = source;
  played.clear();
  bump();
}
function stopSession() {
  if (!active) return;
  active = false;
  bump();
}
function sessionSource() {
  return expectedSource;
}
function notePlayed(trackId) {
  played.add(trackId);
}
function playedIds() {
  return [...played];
}

// shims/jsx-runtime.js
var rt = window.crateHost.jsxRuntime;
var jsx = rt.jsx;
var jsxs = rt.jsxs;
var Fragment2 = rt.Fragment;

// plugins/intelligent-shuffle/client/panel.tsx
var SOURCE = "Intelligent Shuffle";
var TAIL = 5;
function IntelligentShufflePanel({ onClose, say }) {
  const p = usePlayer();
  useSyncExternalStore(subscribe, getVersion);
  const [mood, setMood] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saying, setSaying] = useState("");
  const active2 = isActive();
  useEffect(() => {
    void moodNow().then((r) => setMood(r.mood)).catch(() => setMood(null));
  }, []);
  const next = p.queue[p.index + 1] ?? null;
  const redeal = useCallback(async () => {
    const exclude = [...playedIds(), ...p.current ? [p.current.trackId] : []];
    const r = await plan(TAIL, exclude, p.current?.trackId);
    p.replaceUpcoming(r.tracks);
  }, [p]);
  const voteOn = (trackId, direction) => {
    setBusy(true);
    void vote(trackId, direction).then(async (r) => {
      setMood(r.mood);
      const what = [
        r.applied.artist,
        ...r.applied.genres.slice(0, 2),
        ...r.applied.era ? [r.applied.era] : [],
        ...r.applied.energy ? [`${r.applied.energy} energy`] : []
      ].join(", ");
      say("good", direction === "more" ? `More like: ${what}` : `Less like: ${what}`);
      if (direction === "less") await redeal();
    }).catch((e) => say("bad", e.message)).finally(() => setBusy(false));
  };
  const start = (seed) => {
    setBusy(true);
    void (async () => {
      if (seed && p.current) await vote(p.current.trackId, "more").then((r2) => setMood(r2.mood));
      const exclude = p.current ? [p.current.trackId] : [];
      const r = await plan(seed || p.current ? TAIL : TAIL + 1, exclude, p.current?.trackId);
      if (!r.tracks.length) {
        say("bad", "nothing to play \u2014 is your library empty?");
        return;
      }
      if (p.current) {
        startSession(p.source);
        p.replaceUpcoming(r.tracks);
      } else {
        startSession(SOURCE);
        p.play(r.tracks, 0, SOURCE);
      }
    })().catch((e) => say("bad", e.message)).finally(() => setBusy(false));
  };
  return /* @__PURE__ */ jsxs("div", { className: "ispanel", children: [
    /* @__PURE__ */ jsxs("div", { className: "ishead", children: [
      /* @__PURE__ */ jsxs("div", { className: "words", children: [
        /* @__PURE__ */ jsx("div", { className: "t", children: "Intelligent Shuffle" }),
        /* @__PURE__ */ jsx("div", { className: "s muted", children: active2 ? "listening to your votes" : "a DJ that learns the room" })
      ] }),
      active2 && /* @__PURE__ */ jsx("button", { className: "btn sec sm", onClick: () => stopSession(), children: "Stop" }),
      /* @__PURE__ */ jsx("button", { className: "btn sec sm", onClick: onClose, children: "Close" })
    ] }),
    !active2 && /* @__PURE__ */ jsxs("div", { className: "isstart", children: [
      /* @__PURE__ */ jsxs("p", { children: [
        "Two buttons, that\u2019s the whole thing: ",
        /* @__PURE__ */ jsx("strong", { children: "more like this" }),
        " or",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "less like this" }),
        " on whatever is playing. Yes leans the coming songs toward this vibe; no steers away and re-deals the queue. Votes fade over a few hours, so it follows tonight\u2019s mood, not last week\u2019s."
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "isstartrow", children: [
        p.current && /* @__PURE__ */ jsx("button", { className: "btn", disabled: busy, onClick: () => start(true), children: "Start from this song" }),
        /* @__PURE__ */ jsx("button", { className: "btn sec", disabled: busy, onClick: () => start(false), children: p.current ? "Start fresh" : "Start shuffling" })
      ] })
    ] }),
    active2 && /* @__PURE__ */ jsxs("div", { className: "isbody", children: [
      p.current && /* @__PURE__ */ jsxs("div", { className: "isnow", children: [
        /* @__PURE__ */ jsx("div", { className: "k muted", children: "Now playing" }),
        /* @__PURE__ */ jsx("div", { className: "t", children: p.current.title }),
        /* @__PURE__ */ jsxs("div", { className: "s muted", children: [
          p.current.artistName,
          p.current.albumTitle ? ` \xB7 ${p.current.albumTitle}` : ""
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "isbig", children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              className: "isyes",
              disabled: busy,
              onClick: () => voteOn(p.current.trackId, "more"),
              children: [
                /* @__PURE__ */ jsx("span", { className: "mark", children: "\u2191" }),
                "More like this"
              ]
            }
          ),
          /* @__PURE__ */ jsxs(
            "button",
            {
              className: "isno",
              disabled: busy,
              onClick: () => voteOn(p.current.trackId, "less"),
              children: [
                /* @__PURE__ */ jsx("span", { className: "mark", children: "\u2193" }),
                "Less like this"
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "isnext muted", children: next ? /* @__PURE__ */ jsxs(Fragment2, { children: [
        /* @__PURE__ */ jsx("span", { className: "k", children: "Up next" }),
        " ",
        next.title,
        " \u2014 ",
        next.artistName
      ] }) : /* @__PURE__ */ jsx("span", { className: "k", children: "finding what's next\u2026" }) }),
      mood && (mood.into.length > 0 || mood.outOf.length > 0) && /* @__PURE__ */ jsxs("div", { className: "ismood", children: [
        mood.into.length > 0 && /* @__PURE__ */ jsxs("div", { className: "isrow", children: [
          /* @__PURE__ */ jsx("span", { className: "k muted", children: "Leaning into" }),
          mood.into.map((e) => /* @__PURE__ */ jsx("span", { className: "ischip in", children: e.label }, `${e.kind}:${e.label}`))
        ] }),
        mood.outOf.length > 0 && /* @__PURE__ */ jsxs("div", { className: "isrow", children: [
          /* @__PURE__ */ jsx("span", { className: "k muted", children: "Steering away" }),
          mood.outOf.map((e) => /* @__PURE__ */ jsx("span", { className: "ischip out", children: e.label }, `${e.kind}:${e.label}`))
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "isactions", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              className: "btn sec sm",
              disabled: busy,
              onClick: () => {
                setBusy(true);
                void saveMoodPlaylist().then((r) => say("good", `Saved "${r.name}" \u2014 it keeps dealing this vibe`)).catch((e) => say("bad", e.message)).finally(() => setBusy(false));
              },
              children: "Save as playlist"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              className: "btn sec sm",
              disabled: busy,
              onClick: () => {
                void resetMood().then(() => {
                  setMood({ into: [], outOf: [] });
                  say("good", "Mood cleared \u2014 open mind");
                });
              },
              children: "Forget the mood"
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs(
        "form",
        {
          className: "issay",
          onSubmit: (e) => {
            e.preventDefault();
            const text = saying.trim();
            if (!text || busy) return;
            setBusy(true);
            void sayToDj(text).then((r) => {
              setMood(r.mood);
              setSaying("");
              say("good", r.summary);
            }).catch((e2) => say("bad", e2.message)).finally(() => setBusy(false));
          },
          children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                value: saying,
                onChange: (e) => setSaying(e.target.value),
                placeholder: "Tell the DJ: \u201C90s and heavier, no ballads\u201D",
                maxLength: 300,
                disabled: busy
              }
            ),
            /* @__PURE__ */ jsx("button", { className: "btn sec sm", disabled: busy || !saying.trim(), children: "Say" })
          ]
        }
      )
    ] })
  ] });
}

// plugins/intelligent-shuffle/client/service.tsx
function IntelligentShuffleService() {
  const p = usePlayer();
  useSyncExternalStore(subscribe, getVersion);
  const fetching = useRef(false);
  const currentId = p.current?.trackId ?? 0;
  useEffect(() => {
    if (isActive() && currentId) notePlayed(currentId);
  }, [currentId]);
  useEffect(() => {
    if (isActive() && p.source !== sessionSource()) stopSession();
  }, [p.source]);
  const remaining = p.queue.length - p.index - 1;
  useEffect(() => {
    if (!isActive() || remaining >= 3 || fetching.current) return;
    fetching.current = true;
    const queued = p.queue.map((t) => t.trackId);
    const lastQueued = p.queue[p.queue.length - 1]?.trackId;
    void plan(5, [...playedIds(), ...queued], lastQueued).then((r) => {
      if (isActive() && r.tracks.length) p.enqueue(r.tracks);
    }).catch(() => {
    }).finally(() => {
      fetching.current = false;
    });
  }, [remaining, p]);
  return null;
}

// shims/crate-icons.js
var { Svg } = window.crateHost.icons;

// plugins/intelligent-shuffle/client/icon.tsx
function IconIntelligentShuffle(p) {
  return /* @__PURE__ */ jsxs(Svg, { ...p, stroke: true, children: [
    /* @__PURE__ */ jsx("path", { d: "M16.5 4.5 20 7l-3.5 2.5" }),
    /* @__PURE__ */ jsx("path", { d: "M20 7h-2.6a4.2 4.2 0 0 0-3.45 1.82l-.8 1.18" }),
    /* @__PURE__ */ jsx("path", { d: "M16.5 14.5 20 17l-3.5 2.5" }),
    /* @__PURE__ */ jsx("path", { d: "M20 17h-2.6a4.2 4.2 0 0 1-3.45-1.82l-.55-.8" }),
    /* @__PURE__ */ jsx("path", { d: "M4 7h1.1a4.2 4.2 0 0 1 3.45 1.82l.45.66" }),
    /* @__PURE__ */ jsx("path", { d: "M4 17h1.1a4.2 4.2 0 0 0 3.45-1.82l.45-.66" }),
    /* @__PURE__ */ jsx(
      "path",
      {
        d: "M6.8 10.4l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z",
        fill: "currentColor",
        stroke: "none"
      }
    )
  ] });
}

// plugins/intelligent-shuffle/client/index.tsx
var intelligentShuffleUi = {
  id: "intelligent-shuffle",
  playbar: {
    title: "Intelligent Shuffle",
    icon: IconIntelligentShuffle,
    Panel: IntelligentShufflePanel
  },
  Service: IntelligentShuffleService
};
var index_default = intelligentShuffleUi;
export {
  index_default as default
};
