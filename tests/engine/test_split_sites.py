"""Split sites in the sizing LP: solar and wind on separate sites, each with its own battery, which
charges only from its own site (solar never charges the wind-site battery, nor wind the solar-site
battery). HiGHS decides how much battery goes on each site."""
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
def split():
    return M.solve(_payload({"split": True}))


def test_split_off_is_the_colocated_model(colocated):
    off = M.solve(_payload({"split": False}))
    assert off["tariff"] == pytest.approx(colocated["tariff"], abs=1e-9)
    assert off["sizes"] == colocated["sizes"]
    assert off["model"] == colocated["model"]


def test_each_battery_charges_from_its_own_site_only(split):
    r = split
    h = {k: np.asarray(v) for k, v in r["hourly"].items() if isinstance(v, list)}
    z = r["sizes"]
    tol = 0.02  # outputs are rounded to 0.01 MW
    # the solar-site battery charges from solar, the wind-site battery from wind, hour by hour
    assert (h["chargeSolarSite"] <= h["solar"] + tol).all()
    assert (h["chargeWindSite"] <= h["wind"] + tol).all()
    night = h["solar"] < 1e-6
    assert (h["chargeSolarSite"][night] <= tol).all(), "no solar, no charging at the solar site"
    calm = h["wind"] < 1e-6
    assert (h["chargeWindSite"][calm] <= tol).all(), "no wind, no charging at the wind site"
    assert not any(k.startswith("sentTo") for k in h), "nothing is sent between the sites"
    # each battery within its MW; the two together are the plant's battery
    for k, mw in (("chargeSolarSite", "bessSolarSiteMw"), ("dischargeSolarSite", "bessSolarSiteMw"), ("chargeWindSite", "bessWindSiteMw"), ("dischargeWindSite", "bessWindSiteMw")):
        assert (h[k] <= z[mw] + tol).all(), k
    assert h["charge"] == pytest.approx(h["chargeSolarSite"] + h["chargeWindSite"], abs=0.05)
    assert h["discharge"] == pytest.approx(h["dischargeSolarSite"] + h["dischargeWindSite"], abs=0.02)
    assert z["bessMw"] == pytest.approx(z["bessSolarSiteMw"] + z["bessWindSiteMw"])
    assert z["bessMwh"] == pytest.approx(z["bessSolarSiteMwh"] + z["bessWindSiteMwh"])
    assert r["sites"] == {"split": True}
    assert all("wheeledMu" not in row for row in r["perYear"]) and all("wheeledMwh" not in row for row in r["lifetime"])
    assert all(rule["met"] for row in r["perYear"] for rule in row["rules"]), "the tender floors still hold"


def test_separate_sites_cost_no_less_than_one_site(colocated, split):
    # one site lets the battery charge from both; separate sites can only cost as much or more
    assert split["tariff"] >= colocated["tariff"] - 0.003  # HiGHS gap tolerance and tie-breaking


def test_a_transmission_charge_from_an_older_request_is_ignored(split):
    old = M.solve(_payload({"split": True, "wheelingRsPerKwh": 2.0, "wheelingLossPct": 0.2}))
    assert old["tariff"] == pytest.approx(split["tariff"], abs=1e-9)
    assert old["sites"] == {"split": True}
