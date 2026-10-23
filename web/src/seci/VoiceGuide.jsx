import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Mic, MicOff, Pause, Play, RotateCcw, Send, Volume2, VolumeX, X } from "lucide-react";
import { fillBenchmarks, missingInputs } from "../bid/model";
import { HELP, buildScript, explainFinance, explainResults, financeOf, parseCommand, parseYesNo, questionText } from "./voice";

const Recognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;

/** The browser's voice: an Indian English voice when there is one. */
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find((v) => v.lang === "en-IN") || voices.find((v) => /^en-GB/.test(v.lang)) || voices.find((v) => /^en/.test(v.lang)) || null;
}

/** Speak a text sentence by sentence (long utterances are cut off in some browsers). */
function speakText(text, { muted, cancelled }) {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  if (muted() || !synth) return Promise.resolve();
  const sentences = String(text).match(/[^.!?]+[.!?]*/g) || [String(text)];
  return sentences.reduce((p, sentence) => p.then(() => new Promise((resolve) => {
    if (cancelled() || muted()) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(sentence.trim());
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "en-IN";
    u.rate = 1.02;
    // some browsers never report the end (no audio device, a long utterance): carry on after the
    // time the sentence would take at a slow pace
    const safety = setTimeout(resolve, 1500 + sentence.length * 90);
    u.onend = () => { clearTimeout(safety); resolve(); };
    u.onerror = () => { clearTimeout(safety); resolve(); };
    synth.speak(u);
  })), Promise.resolve());
}

/**
 * The voice guide of the SECI RTC tender tab: explains the tender's key conditions, asks for each
 * input in turn (spoken or typed answers), sizes the plant and explains the results. Answers are
 * understood by voice.js; nothing is recorded or sent anywhere but the browser's own speech
 * recognition.
 */
export default function VoiceGuide({ state, setState, terms, goto, sizing }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("idle"); // idle | speaking | listening | waiting | working
  const [caption, setCaption] = useState("");
  const [log, setLog] = useState([]);
  const [muted, setMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(true);
  const [typed, setTyped] = useState("");
  const [micError, setMicError] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;
  const termsRef = useRef(terms);
  termsRef.current = terms;
  const tokenRef = useRef(0); // each step of the guide; a newer one cancels an older one's speech
  const recRef = useRef(null);
  const optsRef = useRef({ muted, handsFree });
  optsRef.current = { muted, handsFree };
  const micUsable = Boolean(Recognition) && (typeof window === "undefined" || window.isSecureContext);
  const script = useMemo(() => buildScript(state), [state.sources]); // eslint-disable-line react-hooks/exhaustive-deps
  const scriptRef = useRef(script);
  scriptRef.current = script;

  const note = useCallback((who, text) => setLog((l) => [...l.slice(-60), { who, text }]), []);

  const stopListening = useCallback(() => {
    try { recRef.current?.abort(); } catch { /* not listening */ }
    recRef.current = null;
  }, []);

  const halt = useCallback(() => {
    tokenRef.current += 1;
    stopListening();
    window.speechSynthesis?.cancel();
  }, [stopListening]);

  useEffect(() => () => halt(), [halt]);

  const answerRef = useRef(null);

  const listen = useCallback(() => {
    if (!micUsable) { setPhase("waiting"); return; }
    stopListening();
    const rec = new Recognition();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let final = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setTyped(final || interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setMicError("The microphone is blocked: allow it in the browser, or type your answers.");
    };
    rec.onend = () => {
      recRef.current = null;
      if (final.trim()) { setTyped(""); answerRef.current?.(final.trim()); } else setPhase((p) => (p === "listening" ? "waiting" : p));
    };
    recRef.current = rec;
    setPhase("listening");
    try { rec.start(); } catch { setPhase("waiting"); }
  }, [micUsable, stopListening]);

  /** Say a text (caption and log too); resolves false if a newer step took over. */
  const speak = useCallback(async (text) => {
    const token = ++tokenRef.current;
    stopListening();
    window.speechSynthesis?.cancel();
    setCaption(text);
    note("guide", text);
    setPhase("speaking");
    await speakText(text, { muted: () => optsRef.current.muted, cancelled: () => tokenRef.current !== token });
    return tokenRef.current === token;
  }, [note, stopListening]);

  const highlight = useCallback((target) => {
    document.querySelectorAll(".voice-target").forEach((el) => el.classList.remove("voice-target"));
    if (!target) return;
    setTimeout(() => {
      const el = document.querySelector(`[data-voice="${target}"]`);
      if (el) { el.classList.add("voice-target"); el.scrollIntoView?.({ block: "center", behavior: "smooth" }); }
    }, 350);
  }, []);

  /** Go to an item of the script and play it. */
  const run = useCallback(async (i) => {
    const items = scriptRef.current;
    if (i >= items.length) {
      await speak("That is the end of the guide. You can change any input on screen and size again, or download the Excel model and the bid pack.");
      setPhase("idle");
      return;
    }
    const at = Math.max(0, i);
    const item = items[at];
    setIdx(at);
    if (item.step) goto(item.step);
    highlight(item.target || null);
    const s = stateRef.current;
    if (item.kind === "say") {
      if (await speak(item.say)) run(at + 1);
      return;
    }
    if (item.kind === "results") {
      if (!s.lp) {
        if (await speak("The plant is not sized yet. Say next to skip the results, or back to size it.")) { setPhase("waiting"); if (optsRef.current.handsFree) listen(); }
        return;
      }
      if (await speak(explainResults(s))) run(at + 1);
      return;
    }
    if (item.kind === "finance") {
      if (await speak(explainFinance(s, financeOf(s, termsRef.current)))) run(at + 1);
      return;
    }
    const text = item.kind === "yesno" ? item.ask : questionText(item, s);
    if (await speak(text)) {
      setPhase("waiting");
      if (optsRef.current.handsFree) listen();
    }
  }, [goto, highlight, listen, speak]);

  /** Size the plant from the guide: fill what is missing first when the bidder agrees. */
  const sizeNow = useCallback(async (i) => {
    const s = stateRef.current;
    const missing = missingInputs(s, termsRef.current);
    if (missing.length) {
      if (await speak(`${missing.length} input${missing.length > 1 ? "s are" : " is"} still empty, for example ${missing[0]}. Say benchmark to fill them with industry values, or back to enter them.`)) {
        setPhase("waiting");
        if (optsRef.current.handsFree) listen();
      }
      return;
    }
    if (!(await speak("Sizing now. HiGHS is working through every hour of the modelled years; I will explain the result when it is done."))) return;
    setPhase("working");
    const token = tokenRef.current;
    const lp = await sizing.startSizing();
    if (tokenRef.current !== token) return;
    if (!lp) {
      if (await speak("The sizing did not finish: see the message on the Size step. Say repeat to try again.")) setPhase("waiting");
      return;
    }
    run(i + 1);
  }, [listen, run, sizing, speak]);

  const answer = useCallback(async (text) => {
    const items = scriptRef.current;
    const item = items[idx];
    note("you", text);
    const cmd = parseCommand(text);
    if (cmd === "stop") { halt(); setPhase("idle"); setCaption("Paused. Press play to carry on."); return; }
    if (cmd === "back") { run(Math.max(0, idx - 1)); return; }
    if (cmd === "repeat") { if (item?.onYes === "size" && phase === "waiting") sizeNow(idx); else run(idx); return; }
    if (cmd === "help") { if (await speak(HELP)) { setPhase("waiting"); if (optsRef.current.handsFree) listen(); } return; }
    if (!item) return;
    if (item.onYes === "size" && cmd === "benchmark") {
      setState((s) => fillBenchmarks(s, termsRef.current));
      if (await speak("Done: every empty input now has its benchmark.")) setTimeout(() => sizeNow(idx), 50);
      return;
    }
    if (cmd === "skip" || ["say", "results", "finance"].includes(item.kind)) { run(idx + 1); return; }
    if (item.kind === "yesno") {
      const yes = cmd === "benchmark" ? true : parseYesNo(text);
      if (yes === null) { if (await speak("Please say yes or no.")) { setPhase("waiting"); if (optsRef.current.handsFree) listen(); } return; }
      if (!yes) { if (item.onNo) setState((s) => item.onNo(s, termsRef.current)); run(idx + 1); return; }
      if (item.onYes === "size") { sizeNow(idx); return; }
      setState((s) => item.onYes(s, termsRef.current));
      if (await speak(item.id === "fill" ? "Done. I will read each value as we go; say next to keep it." : "Done.")) run(idx + 1);
      return;
    }
    let value;
    let fromBenchmark = false;
    if (cmd === "benchmark") {
      if (item.benchmark === null || item.benchmark === undefined) { if (await speak("There is no benchmark for this one. Give a value, or say skip.")) { setPhase("waiting"); if (optsRef.current.handsFree) listen(); } return; }
      value = item.benchmark;
      fromBenchmark = true;
    } else {
      value = item.read(text);
    }
    if (value === null || value === undefined) {
      if (await speak("Sorry, I did not catch a value I can use. Say it again, or say skip.")) { setPhase("waiting"); if (optsRef.current.handsFree) listen(); }
      return;
    }
    setState((s) => item.set(s, value, fromBenchmark));
    const said = item.current ? item.current(item.set(stateRef.current, value, fromBenchmark)) : String(value);
    if (await speak(`Set to ${said}.`)) run(idx + 1);
  }, [halt, idx, listen, note, phase, run, setState, sizeNow, speak]);
  answerRef.current = answer;

  function start() {
    setOpen(true);
    setLog([]);
    setMicError("");
    run(0);
  }

  const total = script.length;
  const current = script[idx];
  if (!open) {
    return (
      <button type="button" className="voice-fab" onClick={start} data-testid="voice-start">
        <Volume2 size={16} /> Voice guide
      </button>
    );
  }
  return (
    <aside className="voice-panel" aria-label="Voice guide" data-testid="voice-panel">
      <header>
        <strong><Volume2 size={14} /> Voice guide · {idx + 1} of {total}</strong>
        <button type="button" className="rtc-icon-btn" onClick={() => { halt(); setOpen(false); setPhase("idle"); highlight(null); }} aria-label="Close the guide"><X size={14} /></button>
      </header>
      <div className="voice-progress"><i style={{ width: `${((idx + 1) / total) * 100}%` }} /></div>
      <p className={`voice-say ${phase === "speaking" ? "speaking" : ""}`} aria-live="polite" data-testid="voice-caption">{caption}</p>
      {phase === "listening" && <p className="rtc-note">Listening… {typed && <em>{typed}</em>}</p>}
      {phase === "working" && <p className="rtc-note">Sizing… the log is on the Size step.</p>}
      <div className="voice-controls">
        <button type="button" className="secondary" onClick={() => run(idx - 1)} disabled={idx === 0} aria-label="Back"><ChevronLeft size={14} /></button>
        {phase === "idle"
          ? <button type="button" className="secondary" onClick={() => run(idx)} data-testid="voice-play"><Play size={14} /> Play</button>
          : <button type="button" className="secondary" onClick={() => { halt(); setPhase("idle"); }}><Pause size={14} /> Pause</button>}
        <button type="button" className="secondary" onClick={() => run(idx)} aria-label="Repeat"><RotateCcw size={14} /></button>
        <button type="button" className="secondary" onClick={() => run(idx + 1)} data-testid="voice-next" aria-label="Next"><ChevronRight size={14} /></button>
        {micUsable && (
          <button type="button" className={`secondary voice-mic ${phase === "listening" ? "listening" : ""}`} onClick={() => (phase === "listening" ? stopListening() : (window.speechSynthesis?.cancel(), listen()))} data-testid="voice-mic">
            {phase === "listening" ? <MicOff size={14} /> : <Mic size={14} />} {phase === "listening" ? "Stop" : "Speak"}
          </button>
        )}
        <button type="button" className="secondary" onClick={() => setMuted((v) => { if (!v) window.speechSynthesis?.cancel(); return !v; })} aria-label={muted ? "Unmute" : "Mute"} data-testid="voice-mute">{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
        {micUsable && (
          <label className="rtc-note"><input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} /> listen after each question</label>
        )}
      </div>
      <form className="voice-type" onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (!t) return; setTyped(""); stopListening(); answer(t); }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={current?.kind === "say" ? "next, back, repeat…" : "Type an answer, or next / benchmark"} data-testid="voice-input" aria-label="Your answer" />
        <button type="submit" className="primary" data-testid="voice-send"><Send size={14} /></button>
      </form>
      {!micUsable && <p className="voice-note" data-testid="voice-no-mic">{Recognition ? "Spoken answers need a secure (HTTPS) page; type your answers here." : "This browser has no speech recognition; type your answers here."}</p>}
      {micError && <p className="voice-note">{micError}</p>}
      <div className="voice-log" data-testid="voice-log">
        {log.map((l, i) => <p key={i} className={l.who === "you" ? "you" : ""}>{l.text}</p>)}
      </div>
    </aside>
  );
}
