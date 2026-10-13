# Glacier card data sources (archived)

This text used to render as a footer note at the bottom of the glacier
data sheet (`frontend/src/components/DataSheet.jsx`, the panel that opens
when you click a glacier point on the map). It was removed from the UI on
2026-10-01 to keep the card shorter and more focused on the Density/Details
tabs (see [`GLACIER_MASS_BALANCE_DENSITY.md`](GLACIER_MASS_BALANCE_DENSITY.md)),
but is kept here in case it's needed again -- as a citation for a report,
or to restore it to the UI.

## Exact text that was removed

> Source: World Glacier Monitoring Service (WGMS) Fluctuations of Glaciers
> Database. Elevation/volume change from Hugonnet et al. (2021), Nature 592,
> 726–731. 2020–26 figures are from WGMS's Annual Mass-Change Estimates
> (Dussaillant et al. 2025, ESSD), which temporally downscales the same
> satellite elevation-change record with in-situ field measurements rather
> than re-measuring it directly. Glacier ID {id}.

(`{id}` was the glacier's own `p.id` property, filled in per glacier. The
second sentence, on Dussaillant et al. 2025, only appeared for glaciers that
had a 2020–2026 recent-period update.) A further sentence, added alongside
the density-estimate feature, was removed in the same change:

> Mass balance (est.) and mass change (est.) apply a standard ice density of
> 850 kg/m³ (Huss, 2013) to the elevation change rate above -- an estimate,
> not a direct density measurement.

That density-assumption citation is still documented in full in
[`GLACIER_MASS_BALANCE_DENSITY.md`](GLACIER_MASS_BALANCE_DENSITY.md) --
removing it from the UI didn't remove it from the project, just from the card.

## Full citations

- World Glacier Monitoring Service (WGMS). *Fluctuations of Glaciers Database.*
- Hugonnet, R. et al. (2021). "Accelerated global glacier mass loss in the
  early twenty-first century." *Nature* 592, 726–731.
- Dussaillant, I. et al. (2025). WGMS Annual Mass-Change Estimates (AMCE), in
  *Earth System Science Data* (ESSD).
- Huss, M. (2013). "Density assumptions for converting geodetic glacier
  volume change to mass change." *The Cryosphere* 7, 877–887.
