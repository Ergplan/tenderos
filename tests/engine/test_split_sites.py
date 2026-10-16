"""Split sites in the sizing LP (Tender to Bid): solar and wind on separate sites, each with its
own battery; a battery charging from the other site's output pays a transmission charge and
loses a share of the energy sent."""
from __future__ import annotations

import numpy as np
import pytest

from engine.sizing import rtc_lp as M
from tests.engine.test_bid_lp import BESS0, FIN0
from tests.engine.test_rtc_lp import COSTS, _case

# each split-site solve takes 2 to 3 minutes: run with `make test-slow`
pytestmark = [pytest.mark.slow, pytest.mark.skipif(M.highspy is None, reason="highspy not installed")]

HOUR = np.arange(M.HOURS) % 24
PEAK = ((HOUR >= 18) & (HOUR < 22)).astype(float).tolist()


def _payload(sites=None, **extra):
    solar, wind, _ = _case()
    payload = {
        "ctx": {"demand": [100.0] * M.HOURS, "solarCf": solar.tolist(), "windCf": wind.tolist(), "plantMw": 100},
        "bess": BESS0, "costs": COSTS, "fin": FIN0, "dfrTarget": 0.0, "dfrBasis": "annual",
        # an evening peak the battery must serve, and an annual floor
        "compliance": [{"id": "annual", "target": 0.75, "hours": "all", "basis": "annual"},
                       {"id": "peak", "target": 0.9, "hours": "peak", "basis": "annual"}],
        "peakMask": PEAK, "tariffGuess": 6.0, "gapTol": 0.0005, "returnHourly": True, "returnLifetime": True,
    }
    if sites is not None:
        payload["sites"] = sites
    payload.update(extra)
    return payload


@pytest.fixture(scope="module")
def colocated():
    return M.solve(_payload())


@pytest.fixture(scope="module")
def free_wheeling():
    return M.solve(_payload({"split": True, "wheelingRsPerKwh": 0.0, "wheelingLossPct": 0.0}))


@pytest.fixture(scope="module")
def cheap():
    return M.solve(_payload({"split": True, "wheelingRsPerKwh": 0.2, "wheelingLossPct": 0.05}))


def test_split_off_is_the_colocated_model(colocated):
    off = M.solve(_payload({"split": False}))
    assert off["tariff"] == pytest.approx(colocated["tariff"], abs=1e-9)
    assert off["sizes"] == colocated["sizes"]
    assert off["model"] == colocated["model"]


def test_free_lossless_transmission_matches_one_colocated_battery(colocated, free_wheeling):
    # two batteries that charge from either site at no cost and no loss are as good as one
    assert free_wheeling["tariff"] == pytest.approx(colocated["tariff"], abs=0.003)
    z = free_wheeling["sizes"]
    assert z["bessMw"] == pytest.approx(z["bessSolarSiteMw"] + z["bessWindSiteMw"])
    assert z["bessMwh"] == pytest.approx(z["bessSolarSiteMwh"] + z["bessWindSiteMwh"])
    assert z["bessSolarSiteMwh"] == pytest.approx(4 * z["bessSolarSiteMw"], rel=1e-6), "each battery keeps the duration"
    assert free_wheeling["sites"]["split"] is True


def test_charges_and_losses_only_raise_the_tariff_and_cut_what_is_sent(free_wheeling, cheap):
    dear = M.solve(_payload({"split": True, "wheelingRsPerKwh": 3.0, "wheelingLossPct": 0.05}))
    tol = 0.003  # HiGHS gap tolerance and tie-breaking
    assert cheap["tariff"] >= free_wheeling["tariff"] - tol
    assert dear["tariff"] >= cheap["tariff"] - tol
    sent = lambda r: sum(row["wheeledMu"] for row in r["perYear"])  # noqa: E731
    assert sent(dear) <= sent(cheap) + 1e-6
    # at ₹3/kWh hardly anything is worth sending: each site charges its own battery
    assert sent(dear) <= 0.02 * max(1e-9, sum(row["deliveredMu"] for row in dear["perYear"]))
    for r in (cheap, dear):
        assert all(rule["met"] for row in r["perYear"] for rule in row["rules"]), "the tender floors still hold"


def test_energy_balance_of_each_site(cheap):
    r = cheap
    h = {k: np.asarray(v) for k, v in r["hourly"].items() if isinstance(v, list)}
    z = r["sizes"]
    tol = 0.02  # outputs are rounded to 0.01 MW
    # what reaches a battery is within its MW, and the energy sent arrives less the loss
    assert (h["chargeSolarSite"] <= z["bessSolarSiteMw"] + tol).all()
    assert (h["chargeWindSite"] <= z["bessWindSiteMw"] + tol).all()
    assert (h["dischargeSolarSite"] <= z["bessSolarSiteMw"] + tol).all()
    assert (h["dischargeWindSite"] <= z["bessWindSiteMw"] + tol).all()
    # charging uses no more of a site's output than it makes
    assert (h["sentToWindSite"] <= h["solar"] + tol).all()
    assert (h["sentToSolarSite"] <= h["wind"] + tol).all()
    # the generation given up for charging includes the energy lost on the way
    lost = 0.05 * (h["sentToSolarSite"] + h["sentToWindSite"])
    assert h["charge"] == pytest.approx(h["chargeSolarSite"] + h["chargeWindSite"] + lost, abs=0.05)
    assert h["discharge"] == pytest.approx(h["dischargeSolarSite"] + h["dischargeWindSite"], abs=0.02)
    year1 = r["perYear"][0]
    assert year1["wheeledMu"] == pytest.approx((h["sentToSolarSite"].sum() + h["sentToWindSite"].sum()) / 1000, rel=1e-3, abs=1e-3)
    assert year1["wheelLossMu"] == pytest.approx(0.05 * year1["wheeledMu"])
    assert all("wheeledMwh" in row for row in r["lifetime"])


@pytest.mark.parametrize("sites", [
    {"split": True, "wheelingLossPct": 0.03},
    {"split": True, "wheelingRsPerKwh": -1, "wheelingLossPct": 0.03},
    {"split": True, "wheelingRsPerKwh": 0.5},
    {"split": True, "wheelingRsPerKwh": 0.5, "wheelingLossPct": 0.6},
])
def test_split_sites_need_the_charge_and_the_loss(sites):
    with pytest.raises(M.LpInputError):
        M.solve(_payload(sites))
