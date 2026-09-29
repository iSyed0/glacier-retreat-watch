"""
The five time windows the whole app agrees on: four 5-year Hugonnet et al.
(2021) satellite epochs, plus one recent window backed by real (not
projected) data -- WGMS's Annual Mass-Change Estimates for glaciers
(`pRecent` in glaciers.geojson), ERA5-Land for temperature. "2020-2026" is
this app's label for that last window; the real data underlying it runs
through hydrological year 2025 (see the glacier-merge commit).

Centralized here (rather than defined once in trends.py and duplicated
or re-derived elsewhere) because trends.py, era5_periods.py, and the
glacier-merge script that writes trendP0..trendP4 into glaciers.geojson
all need the exact same five boundaries and must never drift apart.
"""

PERIODS = [(1999, 2004), (2004, 2009), (2009, 2014), (2014, 2019)]
PROJECTED_PERIOD = (2020, 2026)
ALL_PERIODS = PERIODS + [PROJECTED_PERIOD]
