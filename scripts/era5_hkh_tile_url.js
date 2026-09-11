// Run this in the GEE Code Editor: https://code.earthengine.google.com
// It prints a live XYZ tile URL for the HKH-cropped ERA5 monthly air temp layer.
// Copy the "Tile URL template" line from the Console and send it back.

var dataset = ee.ImageCollection('ECMWF/ERA5/MONTHLY');

// HKH study area boundary (actual region outline, not a bounding box)
var hkh = ee.FeatureCollection('projects/endless-gamma-379613/assets/HKH').geometry();

// Most recent available month in the collection
var latest = dataset.sort('system:time_start', false).first();
print('Layer date:', latest.date());

var visualization = {
  bands: ['mean_2m_air_temperature'],
  min: 250.0,
  max: 320.0,
  palette: [
    '000080', '0000d9', '4000ff', '8000ff', '0080ff', '00ffff',
    '00ff80', '80ff00', 'daff00', 'ffff00', 'fff500', 'ffda00',
    'ffb000', 'ffa400', 'ff4f00', 'ff2500', 'ff0a00', 'ff00ff',
  ]
};

var clipped = latest.clip(hkh);

Map.centerObject(hkh, 5);
Map.addLayer(clipped, visualization, 'ERA5 monthly mean 2m air temp (HKH)');

var mapid = clipped.getMap(visualization);
print('Tile URL template:', mapid.urlFormat);
