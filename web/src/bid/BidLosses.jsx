import React, { useMemo, useState } from "react";
import LossChain from "../rtc/LossChain";
import { Section, nf, pf } from "../rtc/ui";
import * as E from "../rtc/engine";
import { lossFactorsOf, resourceProfiles } from "./model";

const KINDS = [
  { id: "solar", title: "Solar", heading: "From the panels to the billing meter" },
  { id: "wind", title: "Wind", heading: "From the turbines to the billing meter" },
  { id: "bess", title: "Battery", heading: "From the battery to the billing meter" },
];

/**
 * The losses on the way to the 220 kV billing meter, technology by technology: the Round the
 * clock tab's loss chain (rtc/LossChain.jsx) on the bid's state. Each technology's stages to the
 * 33 kV bus, its own transformer among them, with the point where its CUF (the battery: its round
 * trip) is measured; then the 33/220 kV power transformer and the 220 kV line, shared. Changing a
 * loss clears the sizing, as any other input does.
 */
export default function BidLosses({ state, setState, hourly = null, index = "3.1" }) {
  const on = KINDS.filter((k) => state.sources[k.id]);
  const [pick, setPick] = useState(on[0]?.id || "solar");
  const kind = on.some((k) => k.id === pick) ? pick : on[0]?.id;
  const { src } = state;
  const profiles = useMemo(() => resourceProfiles(state),
    // the profiles depend on the CUFs, the DC:AC, the uploads and the monthly redraw only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src.solar.cuf, src.solar.dcAc, src.wind.cuf, state.solarUpload, state.windUpload, state.solarMonthScale, state.windMonthScale]);
  if (!state.losses || !kind) return null;
  const l = state.losses;
  const lf = lossFactorsOf(state);
  const sized = Boolean(state.lp?.sizes);
  const capOf = (id) => {
    const mw = src[id]?.capacity?.mw;
    return Number.isFinite(mw) && mw > 0 ? mw : 100;
  };
  const sizes = sized
    ? state.lp.sizes
    : { solarMw: capOf("solar"), windMw: capOf("wind"), bessMw: capOf("bess"), bessMwh: capOf("bess") * (Number(src.bess.duration) || 4) };
  // the battery's year-1 discharge at the 33 kV bus, from the sizing's hourly dispatch (shown at the meter)
  const discharged = hourly?.discharge ? hourly.discharge.reduce((a, b) => a + b, 0) / (hourly.atMeter || 1) : 0;
  const shim = {
    inputs: { ...l, solarDcAc: src.solar.dcAc || 1, lossPct: 0 },
    bess: { rte: src.bess.rte ?? E.DEFAULT_BESS.rte },
  };
  const patch = (_section, values) => setState((s) => ({ ...s, losses: { ...s.losses, ...values }, lp: null }));
  const meta = KINDS.find((k) => k.id === kind);
  return (
    <Section index={index} title="Losses to the billing meter" note={`Every part with its loss, each technology's transformer included · reaches the meter: ${pf(lf.meter, 2)} of the 33 kV bus`}>
      <p className="rtc-note">
        Pick where each CUF is measured: the stages above that point are already in it, the ones below are applied. The battery's round trip is
        applied from where it is quoted, both ways. The 33/220 kV power transformer and the 220 kV line are shared by every source.
        {sized ? " Energies are the sized plant's, year 1." : ` Energies are for ${nf(sizes.solarMw, 0)} MW until the plant is sized.`}
      </p>
      <div className="bid-choice bid-loss-kinds" role="tablist" data-testid="bid-loss-kinds">
        {on.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={k.id === kind} className={k.id === kind ? "active" : ""} onClick={() => setPick(k.id)} data-testid={`bid-loss-kind-${k.id}`}>
            {k.title}
          </button>
        ))}
      </div>
      <div className="chapter-group" data-testid="bid-losses">
        <div className="chapter-group-head"><span>{meta.heading}</span><small>Every part with its loss · year 1</small></div>
        <LossChain kind={kind} state={shim} patch={patch} sizes={sizes} sim={{ dischargeMWh: discharged }} measured="CUF"
          foot={`Year-1 ${meta.title.toLowerCase()} output at each point, before curtailment and the battery; HiGHS then decides what is sent to the meter, and the tender's floors are checked there.`}
          cf={kind === "solar" ? profiles.solarCf : kind === "wind" ? profiles.windCf : undefined} />
      </div>
    </Section>
  );
}
