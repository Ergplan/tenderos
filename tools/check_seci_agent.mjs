// Checks for the SECI RTC bid agent (web/src/seci/agent.js): the tools run against a stand-in for
// the tab (the state, the steps shown, a sizing that returns a fixed plant), the guided order of
// questions, the tender lookup, and the GPT-Live event loop answering the backend's function calls.
// Run from the repository root:
//   node tools/check_seci_agent.mjs
import assert from "node:assert/strict";
import { AGENT_TOOLS, LiveEvents, agentInputs, createToolRunner, liveSessionConfig, nextQuestion, readValue, tenderLookup } from "../web/src/seci/agent.js";
import { DEFAULT_SETTINGS, seciTerms } from "../web/src/seci/terms.js";
import { defaultSeciState as defaultSeciStateForChecks } from "../web/src/seci/state.js";

// ---- a stand-in for the tab
let state = defaultSeciStateForChecks();
const shownSteps = [];
const highlighted = [];
const lp = {
  sizes: { solarMw: 610, windMw: 380, bessMw: 210, bessMwh: 840 }, tariff: 5.2, lowerBound: 5.1,
  perYear: [{ year: 1, rules: [{ id: "peak", basis: "block", hoursMet: 0.98, shortfallMu: 2, met: false }, { id: "offpeak", basis: "block", hoursMet: 1, shortfallMu: 0, met: true }], blockShortfallMu: 2 }],
  lifetime: Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 200 * 8760, deliveredMwh: 0.86 * 200 * 8760, exportMwh: 1.5e5, blockShortfallMwh: 2000 })),
};
let sized = 0;
const ctx = {
  getState: () => state,
  apply: (fn) => { state = fn(state); },
  getTerms: () => seciTerms(state.seci),
  goto: (step) => { shownSteps.push(step); state = { ...state, step }; },
  highlight: (t) => highlighted.push(t),
  runSizing: async () => { sized += 1; return lp; },
  stopSizing: () => {},
  getRun: () => null,
};
const run = createToolRunner(ctx);

// ---- the tool list the session gets
const names = AGENT_TOOLS.map((t) => t.name);
for (const n of ["get_status", "tender_lookup", "next_question", "set_input", "run_optimizer", "get_results", "get_financials", "check_tariff", "review_bid_forms"]) assert.ok(names.includes(n), n);
for (const t of AGENT_TOOLS) assert.equal(t.parameters.type, "object", t.name);
const session = liveSessionConfig({ backendModel: "gpt-6-luna", voice: "marin" });
assert.equal(session.model, "gpt-live-1");
assert.equal(session.delegation.type, "responses");
assert.equal(session.delegation.responses.tools.length, AGENT_TOOLS.length);
assert.equal(session.audio.output.voice, "marin");

// ---- the guided order: the bid first, then the planning choices
let q = await run("next_question", { keep: null, keep_rest: false });
assert.equal(q.key, "bidMw", JSON.stringify(q));
assert.ok(/megawatts/.test(q.question));
assert.equal(shownSteps.at(-1), "bid", "the agent shows the step it asks about");
assert.equal(highlighted.at(-1), "bidMw");

// ---- setting inputs as spoken: words, percent, choices, dates; and refusals that say why
assert.deepEqual(await run("set_input", { key: "bidMw", value: "two hundred" }), { ok: true, key: "bidMw", value: 200 });
let bad = await run("set_input", { key: "bidMw", value: 650 });
assert.equal(bad.ok, false);
assert.ok(/outside 50 to 500/.test(bad.error), bad.error);
assert.equal((await run("set_input", { key: "peakPlan", value: "evening" })).value, "Evening 18:00–24:00");
assert.equal(state.seci.peakPlan, "evening");
assert.equal((await run("set_input", { key: "ppaDate", value: "7 June 2026" })).value, "2026-06-07");
bad = await run("set_input", { key: "use.bess", value: "no" });
assert.ok(!bad.ok && /mandatory/.test(bad.error), bad.error);
bad = await run("set_input", { key: "solar.nonsense", value: 1 });
assert.ok(!bad.ok && /list_inputs/.test(bad.error));
assert.equal((await run("set_input", { key: "use.wind", value: true })).ok, true);

// fill the rest with benchmarks, then change one in percent
const filled = await run("use_benchmarks");
assert.ok(filled.ok && filled.filled > 5, JSON.stringify(filled));
assert.deepEqual(filled.stillMissing, []);
assert.equal((await run("set_input", { key: "wind.cuf", value: 35 })).value, 35);
assert.equal(state.src.wind.cuf, 0.35, "percent inputs take percent");
assert.equal(readValue(agentInputs(state).find((x) => x.key === "fin.targetEquityIrr"), "fourteen point five"), 0.145);
assert.equal((await run("set_input", { key: "solar.size", value: "auto" })).value, "auto");
assert.equal((await run("set_input", { key: "market.sell", value: "no" })).value, false);

// the guided walk: answered inputs are done, the next is asked with its current value
q = await run("next_question", { keep: null, keep_rest: false });
assert.equal(q.key, "shortfall", JSON.stringify(q));
assert.equal(q.current, "Pay the penalty");
q = await run("next_question", { keep: "shortfall", keep_rest: false });
assert.equal(q.key, "solar.cuf", "the benchmarks were accepted with use_benchmarks, so the walk goes on to each value");
assert.equal(q.benchmark, 25);
q = await run("next_question", { keep: null, keep_rest: true });
assert.ok(q.done, JSON.stringify(q));

// ---- the optimizer, the results, the financials
const sizedRes = await run("run_optimizer");
assert.ok(sizedRes.ok, JSON.stringify(sizedRes));
assert.equal(sized, 1);
assert.equal(sizedRes.plant.solarMw, 610);
assert.ok(/For 200 megawatts/.test(sizedRes.summary), sizedRes.summary);
assert.deepEqual(sizedRes.year1Floors[0], { floor: "peak", hoursMetPct: 98, shortfallMu: 2 });
assert.equal(sizedRes.dates.scsd, "2028-06-07");
assert.ok(shownSteps.includes("size"));
const fin = await run("get_financials");
assert.ok(fin.bidTariff > 0 && Math.abs(fin.equityIrrPct - 14) < 0.01 && fin.projectIrrPct > 0, JSON.stringify(fin));

// a change after sizing clears it and says so
const changed = await run("set_input", { key: "wind.capex", value: 6.8 });
assert.ok(changed.ok && /run the optimizer again/.test(changed.note), JSON.stringify(changed));
assert.equal(state.lp, null);
await run("run_optimizer");
assert.equal(sized, 2, "the optimizer runs again");

// ---- the tariff quoted: a low quote is warned with the IRRs it earns, and recorded
const target = (await run("get_financials")).bidTariff;
const low = await run("check_tariff", { tariff: Number((target - 0.6).toFixed(2)), record: true });
assert.equal(low.status, "below", JSON.stringify(low));
assert.ok(low.equityIrrPct < 14 && low.projectIrrPct < fin.projectIrrPct + 1e-9, JSON.stringify(low));
assert.ok(/below the/.test(low.message));
assert.equal(state.forms.tariff, Number((target - 0.6).toFixed(2)), "recorded as the tariff quoted");
const viaForm = await run("set_input", { key: "forms.tariff", value: Math.ceil(target * 100) / 100 });
assert.equal(viaForm.quote.status, "ok", JSON.stringify(viaForm));

// ---- the bid forms
const forms = await run("review_bid_forms");
assert.ok(forms.requiredStillEmpty.includes("Bidder's name"));
assert.ok(forms.checks.some((c) => c.check === "Net worth"));
assert.equal(shownSteps.at(-1), "forms");
assert.equal((await run("set_input", { key: "forms.bidder", value: "Acme Renewables Ltd" })).value, "Acme Renewables Ltd");
assert.equal(highlighted.at(-1), "form.bidder");

// ---- status
const st = await run("get_status");
assert.equal(st.optimizer, "sized");
assert.equal(st.bid.contractedMw, 200);
assert.equal(st.quote.status, "ok");

// ---- the tender, with document and page
const emd = tenderLookup("EMD")[0];
assert.equal(emd.id, "emd", JSON.stringify(emd));
assert.ok(emd.sources[0].page > 0 && emd.sources[0].document);
assert.ok(tenderLookup("peak hours").some((x) => x.id === "peakHours"));
assert.equal(tenderLookup("dfrOffpeak")[0].id, "dfrOffpeak", "an exact id returns that condition");
const none = await run("tender_lookup", { query: "zzzz qqqq" });
assert.deepEqual(none.matches, []);
assert.ok((await run("tender_brief")).conditions.length >= 5);

// ---- the event loop: a backend function call is run and answered, then the response continues
const sent = [];
const seen = { heard: "", said: "", tools: [] };
let toolRuns = 0;
const loop = new LiveEvents({
  send: (o) => sent.push(o),
  runTool: async (name, args) => { toolRuns += 1; return run(name, args); },
  on: { heard: (t) => { seen.heard += t; }, said: (t) => { seen.said += t; }, tool: (n) => seen.tools.push(n) },
});
await loop.handle(JSON.stringify({ type: "session.started", session: { id: "live_1" } }));
assert.ok(loop.ready);
await loop.handle({ type: "session.input_transcript.delta", delta: "make the bid ", start_ms: 0, end_ms: 400 });
await loop.handle({ type: "session.input_transcript.delta", delta: "two fifty", start_ms: 400, end_ms: 800 });
assert.equal(seen.heard, "make the bid two fifty");
await loop.handle({ type: "session.delegation.created", delegation: { id: "item_1", type: "delegation", target: "responses" } });
await loop.handle({ type: "response.event", delegation_id: "item_1", event: { type: "response.created", response: { id: "resp_1" } } });
await loop.handle({ type: "response.event", delegation_id: "item_1", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "call_9", name: "set_input", arguments: JSON.stringify({ key: "bidMw", value: 250 }) } } });
assert.equal(sent.length, 0, "results wait for the response to complete");
await loop.handle({ type: "response.event", delegation_id: "item_1", event: { type: "response.completed", response: { id: "resp_1", output: [] } } });
assert.equal(toolRuns, 1);
assert.equal(state.bid.baseMw, 250, "the spoken change reached the screen");
assert.equal(sent.length, 2);
assert.equal(sent[0].type, "response.item.create");
assert.equal(sent[0].item.type, "function_call_output");
assert.equal(sent[0].item.call_id, "call_9");
assert.deepEqual(JSON.parse(sent[0].item.output), { ok: true, key: "bidMw", value: 250, note: "The sizing was cleared: run the optimizer again for new results." });
assert.equal(sent[1].type, "response.create");
assert.notEqual(sent[0].event_id, sent[1].event_id);
assert.deepEqual(seen.tools, ["set_input"]);
// a response with no calls sends nothing
await loop.handle({ type: "response.event", delegation_id: "item_2", event: { type: "response.created", response: { id: "resp_2" } } });
await loop.handle({ type: "response.event", delegation_id: "item_2", event: { type: "response.completed", response: { id: "resp_2", output: [] } } });
assert.equal(sent.length, 2);
await loop.handle({ type: "session.output_transcript.delta", delta: "Done: 250 megawatts." });
assert.equal(seen.said, "Done: 250 megawatts.");
let closed = null;
loop.on.closed = (u) => { closed = u; };
await loop.handle({ type: "session.closed", usage: { seconds: 42 } });
assert.deepEqual(closed, { seconds: 42 });
assert.equal(loop.ready, false);

console.log(`SECI bid agent checks passed (${AGENT_TOOLS.length} tools, ${agentInputs(state).length} inputs; next after the bid: ${nextQuestion(defaultSeciStateForChecks(), seciTerms(DEFAULT_SETTINGS), new Set(["bidMw"])).key})`);
