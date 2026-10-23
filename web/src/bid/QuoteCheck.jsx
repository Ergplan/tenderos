import React, { useMemo } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Stat, nf, pf } from "../rtc/ui";
import { quotedReturns } from "./quote";

const irrText = (v) => (Number.isFinite(v) ? pf(v, 2) : "none");

/**
 * The tariff the bidder will quote, against the tariff the model needs for the target equity IRR:
 * the equity and project IRR the quote earns, with a warning when it is below the target.
 * compact: the warning line only (under the bid forms' tariff field).
 */
export default function QuoteCheck({ state, terms, tariff, onChange = null, compact = false, testid = "quote-check" }) {
  const q = useMemo(() => quotedReturns(state, terms, tariff), [state, terms, tariff]);
  if (compact) {
    if (!q) return null;
    return (
      <div className={`quote-line ${q.status}`} data-testid={testid} role={q.status === "ok" ? undefined : "alert"}>
        {q.status === "ok" ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}
        <span>{q.message}</span>
      </div>
    );
  }
  return (
    <div className={`quote-check ${q?.status || ""}`} data-testid={testid}>
      <div className="rtc-grid rtc-grid-4">
        <label className="rtc-field" data-voice="quoteTariff">
          <div className="rtc-field-top"><span>Tariff you will quote</span><em>₹/kWh</em></div>
          <input type="number" step={0.01} min={0} value={tariff ?? ""} data-testid={`${testid}-input`} disabled={!onChange}
            onChange={(e) => onChange?.(e.target.value === "" ? null : Number(e.target.value))} />
          <small>{q ? `Model tariff for the target: ₹${nf(q.targetTariff, 3)}` : "Enter a tariff to see what it earns"}</small>
        </label>
        <Stat label="Equity IRR at this tariff" value={q ? irrText(q.equityIrr) : "–"} detail={q ? `target ${pf(q.targetEquityIrr, 2)}` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
        <Stat label="Project IRR at this tariff" value={q ? irrText(q.projectIrr) : "–"} detail={q ? `${irrText(q.targetProjectIrr)} at the target tariff` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
        <Stat label="Difference" value={q ? `${q.gap >= 0 ? "+" : "−"}₹${nf(Math.abs(q.gap), 3)}` : "–"} detail={q ? `${q.gap >= 0 ? "above" : "below"} the target tariff (${pf(Math.abs(q.gapPct), 1)})${Number.isFinite(q.minDscr) ? ` · min DSCR ${nf(q.minDscr, 2)}` : ""}` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
      </div>
      {q && q.status !== "ok" && (
        <div className="alert" data-testid={`${testid}-warning`}><TriangleAlert size={14} /> {q.message}{q.status === "loss" ? " The equity loses money at this tariff." : ""}</div>
      )}
    </div>
  );
}
