/************************************************************
SOIL WATER AVAILABILITY & AGRICULTURAL SUITABILITY
Programmer:  Faiza Msemo

OUTPUTS
- Root-zone soil water availability (RZAW, mm)
- Factor suitability maps
- Final agricultural suitability map
- Map title
- Legend for agricultural suitability
- Legend for soil water availability
- Summary statistics
- 3D pie chart
- Multi-series bar chart with class colors
- Line chart
- Exports

IMPORTANT
- Import or draw your AOI as "geometry"
- Optimized for very large AOI such as Africa
- Charts/statistics use coarse analysis scale
************************************************************/


/// ============================================================
// 1. STUDY AREA (ROBUST FOR GEOMETRY / FEATURECOLLECTION)
// ============================================================

// Always convert input to FeatureCollection → Geometry
var aoiFc = ee.FeatureCollection(table);
var aoi = aoiFc.geometry();

// Center map
Map.centerObject(aoi, 3);

// Safe AOI boundary for display
var aoiDisplay = aoi.simplify(5000);
Map.addLayer(aoiDisplay, {color: 'black'}, 'AOI Boundary', false);

// ============================================================
// 2. AOI MASK
// ============================================================
var aoiMask = ee.Image.constant(1).clip(aoi).selfMask();


// ============================================================
// 3. COMMON CRS AND SCALES
// ============================================================
var analysisCrs = 'EPSG:4326';
var exportScale = 250;     // final raster export
var statsScale  = 50000;   // Africa-wide stats/charts
var chartScale  = 50000;   // Africa-wide charts


// ============================================================
// 4. LOAD DATASETS
// ============================================================

// Soil water from SoilGrids 2.0
var fc  = ee.Image('ISRIC/SoilGrids250m/v2_0/wv0033');
var pwp = ee.Image('ISRIC/SoilGrids250m/v2_0/wv1500');

// Soil properties from OpenLandMap
var ph   = ee.Image('OpenLandMap/SOL/SOL_PH-H2O_USDA-4C1A2A_M/v02');
var soc  = ee.Image('OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02');
var sand = ee.Image('OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02');
var clay = ee.Image('OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02');

// DEM and slope
var dem = ee.Image('USGS/SRTMGL1_003');
var slope = ee.Terrain.slope(dem).rename('Slope_deg');

// CHIRPS rainfall
var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterBounds(aoi)
  .filterDate('2000-01-01', '2024-12-31');

print('CHIRPS image count:', chirps.size());


// ============================================================
// 5. DEPTH DEFINITIONS
// ============================================================
var waterLayers = [
  {label: '0_5cm',    band: 'val_0_5cm_mean',    thickness_mm: 50},
  {label: '5_15cm',   band: 'val_5_15cm_mean',   thickness_mm: 100},
  {label: '15_30cm',  band: 'val_15_30cm_mean',  thickness_mm: 150},
  {label: '30_60cm',  band: 'val_30_60cm_mean',  thickness_mm: 300},
  {label: '60_100cm', band: 'val_60_100cm_mean', thickness_mm: 400}
];

var topLayers = [
  {band: 'b0',  thickness_mm: 100},   // 0–10 cm
  {band: 'b10', thickness_mm: 200}    // 10–30 cm
];


// ============================================================
// 6. ROOT-ZONE AVAILABLE WATER (RZAW)
// ============================================================
var awcList = [];
var awmmList = [];

waterLayers.forEach(function(layer) {
  var fcLayer = fc.select(layer.band);
  var pwpLayer = pwp.select(layer.band);

  var awc = fcLayer.subtract(pwpLayer)
    .max(0)
    .rename('AWC_' + layer.label);

  var awmm = awc.multiply(layer.thickness_mm)
    .rename('AWmm_' + layer.label);

  awcList.push(awc);
  awmmList.push(awmm);
});

var awcStack = ee.Image.cat(awcList)
  .clip(aoi)
  .updateMask(aoiMask);

var awmmStack = ee.Image.cat(awmmList)
  .clip(aoi)
  .updateMask(aoiMask);

var rzaw = awmmStack.reduce(ee.Reducer.sum())
  .rename('RZAW_mm')
  .clip(aoi)
  .updateMask(aoiMask);


// ============================================================
// 7. DEPTH-WEIGHTED TOPSOIL PROPERTIES (0–30 cm)
// ============================================================
function weightedTop30(image, outName) {
  var weightedSum = ee.Image.constant(0);
  var totalThickness = 0;

  topLayers.forEach(function(layer) {
    weightedSum = weightedSum.add(
      image.select(layer.band).multiply(layer.thickness_mm)
    );
    totalThickness += layer.thickness_mm;
  });

  return weightedSum.divide(totalThickness)
    .rename(outName)
    .clip(aoi)
    .updateMask(aoiMask);
}

var sandTop_raw = weightedTop30(sand, 'Sand_raw');
var clayTop_raw = weightedTop30(clay, 'Clay_raw');
var phTop_raw   = weightedTop30(ph,   'pH_raw');
var socTop_raw  = weightedTop30(soc,  'SOC_raw');

// Scale conversions
var sandTop = sandTop_raw.rename('Sand_pct');
var clayTop = clayTop_raw.rename('Clay_pct');
var phTop   = phTop_raw.divide(10).rename('pH_top30');
var socTop  = socTop_raw.multiply(5).rename('SOC_gkg_top30');


// ============================================================
// 8. LONG-TERM MEAN ANNUAL RAINFALL
// ============================================================
var nYears = ee.Number(2024).subtract(2000).add(1);

var rainMean = chirps.sum()
  .divide(nYears)
  .rename('RainMean_mm')
  .clip(aoi)
  .updateMask(aoiMask);


// ============================================================
// 9. SLOPE
// ============================================================
var slopeDeg = slope
  .clip(aoi)
  .updateMask(aoiMask);


// ============================================================
// 10. FACTOR SUITABILITY CLASSES
// ============================================================
var s_water = rzaw.expression(
  "(x < 50) ? 1" +
  ": (x < 100) ? 2" +
  ": (x < 150) ? 3" +
  ": (x < 200) ? 4" +
  ": 5", {x: rzaw}
).rename('S_water')
 .clip(aoi)
 .updateMask(aoiMask);

var s_rain = rainMean.expression(
  "(x < 400) ? 1" +
  ": (x < 600) ? 2" +
  ": (x < 800) ? 3" +
  ": (x < 1200) ? 4" +
  ": 5", {x: rainMean}
).rename('S_rain')
 .clip(aoi)
 .updateMask(aoiMask);

var s_slope = slopeDeg.expression(
  "(x > 30) ? 1" +
  ": (x > 20) ? 2" +
  ": (x > 10) ? 3" +
  ": (x > 5) ? 4" +
  ": 5", {x: slopeDeg}
).rename('S_slope')
 .clip(aoi)
 .updateMask(aoiMask);

var s_ph = phTop.expression(
  "(x < 4.5 || x > 8.5) ? 1" +
  ": ((x >= 4.5 && x < 5.5) || (x > 8.0 && x <= 8.5)) ? 2" +
  ": ((x >= 5.5 && x < 6.0) || (x > 7.5 && x <= 8.0)) ? 3" +
  ": ((x >= 6.0 && x < 6.5) || (x > 7.0 && x <= 7.5)) ? 4" +
  ": 5", {x: phTop}
).rename('S_pH')
 .clip(aoi)
 .updateMask(aoiMask);

var s_soc = socTop.expression(
  "(x < 5) ? 1" +
  ": (x < 10) ? 2" +
  ": (x < 20) ? 3" +
  ": (x < 30) ? 4" +
  ": 5", {x: socTop}
).rename('S_SOC')
 .clip(aoi)
 .updateMask(aoiMask);

var s_texture = ee.Image().expression(
  "(sand > 80 || clay > 60) ? 1" +
  ": ((sand > 70 && sand <= 80) || (clay > 45 && clay <= 60)) ? 2" +
  ": ((sand > 55 && sand <= 70) || (clay > 35 && clay <= 45)) ? 3" +
  ": ((sand > 40 && sand <= 55) || (clay > 20 && clay <= 35)) ? 4" +
  ": 5",
  {
    sand: sandTop,
    clay: clayTop
  }
).rename('S_texture')
 .clip(aoi)
 .updateMask(aoiMask);


// ============================================================
// 11. FINAL WEIGHTED AGRICULTURAL SUITABILITY
// ============================================================
var w_water   = 0.30;
var w_rain    = 0.20;
var w_slope   = 0.15;
var w_ph      = 0.10;
var w_soc     = 0.10;
var w_texture = 0.15;

var finalScore = s_water.multiply(w_water)
  .add(s_rain.multiply(w_rain))
  .add(s_slope.multiply(w_slope))
  .add(s_ph.multiply(w_ph))
  .add(s_soc.multiply(w_soc))
  .add(s_texture.multiply(w_texture))
  .rename('FinalScore')
  .clip(aoi)
  .updateMask(aoiMask);

var finalSuitability = finalScore.expression(
  "(x < 1.5) ? 1" +
  ": (x < 2.5) ? 2" +
  ": (x < 3.5) ? 3" +
  ": (x < 4.5) ? 4" +
  ": 5", {x: finalScore}
).rename('AgriSuitability')
 .clip(aoi)
 .updateMask(aoiMask);


// ============================================================
// 12. DEBUG CHECKS
// ============================================================
print('RZAW band names:', rzaw.bandNames());
print('RainMean band names:', rainMean.bandNames());
print('Slope band names:', slopeDeg.bandNames());
print('pH band names:', phTop.bandNames());
print('SOC band names:', socTop.bandNames());
print('Texture band names:', s_texture.bandNames());
print('Final Suitability band names:', finalSuitability.bandNames());


// ============================================================
// 13. VISUALIZATION PARAMETERS
// ============================================================
var suitVis = {
  min: 1,
  max: 5,
  palette: ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641']
};

var waterVis = {
  min: 0,
  max: 250,
  palette: [
    '#a50026',
    '#d73027',
    '#f46d43',
    '#fdae61',
    '#fee08b',
    '#d9ef8b',
    '#a6d96a',
    '#66bd63',
    '#1a9850',
    '#006837'
  ]
};

var rainVis = {
  min: 300,
  max: 1400,
  palette: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b']
};

var slopeVis = {
  min: 0,
  max: 30,
  palette: ['#1a9850', '#91cf60', '#d9ef8b', '#fdae61', '#d73027']
};


// ============================================================
// 14. MAP DISPLAY
// ============================================================
Map.setOptions('TERRAIN');

Map.addLayer(rzaw, waterVis, 'Soil Water Availability (RZAW mm)', false);
Map.addLayer(rainMean, rainVis, 'Mean Annual Rainfall (mm)', false);
Map.addLayer(slopeDeg, slopeVis, 'Slope (degrees)', false);

Map.addLayer(s_water, suitVis, 'Suitability - Soil Water', false);
Map.addLayer(s_rain, suitVis, 'Suitability - Rainfall', false);
Map.addLayer(s_slope, suitVis, 'Suitability - Slope', false);
Map.addLayer(s_ph, suitVis, 'Suitability - pH', false);
Map.addLayer(s_soc, suitVis, 'Suitability - SOC', false);
Map.addLayer(s_texture, suitVis, 'Suitability - Texture', false);

Map.addLayer(finalSuitability, suitVis, 'Final Agricultural Suitability', true);

// simplified AOI only for display
var aoiDisplay = ee.Feature(aoi).simplify(5000);
Map.addLayer(aoiDisplay, {color: 'black'}, 'AOI Boundary', false);


// ============================================================
// 15. MAP TITLE
// ============================================================
var titlePanel = ui.Panel({
  style: {
    position: 'top-center',
    padding: '8px 15px',
    backgroundColor: 'rgba(255,255,255,0.85)'
  }
});

titlePanel.add(ui.Label({
  value: 'Soil Water Availability & Agricultural Suitability',
  style: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: 'black'
  }
}));

Map.add(titlePanel);


// ============================================================
// 16. LEGENDS
// ============================================================
var legendSuit = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.85)'
  }
});

legendSuit.add(ui.Label({
  value: 'Agricultural Suitability',
  style: {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '0 0 6px 0'
  }
}));

[
  {name: '1 Very Low', color: '#d7191c'},
  {name: '2 Low', color: '#fdae61'},
  {name: '3 Moderate', color: '#ffffbf'},
  {name: '4 High', color: '#a6d96a'},
  {name: '5 Very High', color: '#1a9641'}
].forEach(function(item) {
  var row = ui.Panel({
    widgets: [
      ui.Label('', {
        backgroundColor: item.color,
        padding: '8px',
        margin: '0 6px 4px 0'
      }),
      ui.Label(item.name, {margin: '0 0 4px 0'})
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
  legendSuit.add(row);
});
Map.add(legendSuit);

var legendWater = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.85)'
  }
});

legendWater.add(ui.Label({
  value: 'Soil Water Availability (mm)',
  style: {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '0 0 6px 0'
  }
}));

[
  {name: '< 50', color: '#a50026'},
  {name: '50 - 100', color: '#f46d43'},
  {name: '100 - 150', color: '#fee08b'},
  {name: '150 - 200', color: '#a6d96a'},
  {name: '> 200', color: '#006837'}
].forEach(function(item) {
  var row = ui.Panel({
    widgets: [
      ui.Label('', {
        backgroundColor: item.color,
        padding: '8px',
        margin: '0 6px 4px 0'
      }),
      ui.Label(item.name, {margin: '0 0 4px 0'})
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
  legendWater.add(row);
});
Map.add(legendWater);


// ============================================================
// 17. COARSE IMAGES FOR AFRICA-WIDE STATS
// ============================================================
function coarseImage(img, outName) {
  return img
    .reproject({
      crs: analysisCrs,
      scale: statsScale
    })
    .rename(outName)
    .clip(aoi)
    .updateMask(aoiMask);
}

var rzaw_coarse       = coarseImage(rzaw, 'RZAW_mm');
var rainMean_coarse   = coarseImage(rainMean, 'RainMean_mm');
var slopeDeg_coarse   = coarseImage(slopeDeg, 'Slope_deg');
var phTop_coarse      = coarseImage(phTop, 'pH_top30');
var socTop_coarse     = coarseImage(socTop, 'SOC_gkg_top30');
var sandTop_coarse    = coarseImage(sandTop, 'Sand_pct');
var clayTop_coarse    = coarseImage(clayTop, 'Clay_pct');
var finalScore_coarse = coarseImage(finalScore, 'FinalScore');

var s_water_coarse    = coarseImage(s_water, 'S_water');
var s_rain_coarse     = coarseImage(s_rain, 'S_rain');
var s_slope_coarse    = coarseImage(s_slope, 'S_slope');
var s_ph_coarse       = coarseImage(s_ph, 'S_pH');
var s_soc_coarse      = coarseImage(s_soc, 'S_SOC');
var s_texture_coarse  = coarseImage(s_texture, 'S_texture');

var finalSuitability_coarse = finalScore_coarse.expression(
  "(x < 1.5) ? 1" +
  ": (x < 2.5) ? 2" +
  ": (x < 3.5) ? 3" +
  ": (x < 4.5) ? 4" +
  ": 5", {x: finalScore_coarse}
).rename('AgriSuitability')
 .clip(aoi)
 .updateMask(aoiMask);


// ============================================================
// 18. SUMMARY STATISTICS
// ============================================================
var summaryImage = ee.Image.cat([
  rzaw_coarse,
  rainMean_coarse,
  slopeDeg_coarse,
  phTop_coarse,
  socTop_coarse,
  sandTop_coarse,
  clayTop_coarse,
  finalScore_coarse
]);

var summaryStats = summaryImage.reduceRegion({
  reducer: ee.Reducer.min()
    .combine({reducer2: ee.Reducer.max(), sharedInputs: true})
    .combine({reducer2: ee.Reducer.mean(), sharedInputs: true}),
  geometry: aoi,
  crs: analysisCrs,
  scale: statsScale,
  maxPixels: 1e13,
  bestEffort: true,
  tileScale: 16
});

print('Summary statistics:', summaryStats);


// ============================================================
// 19. AREA BY FINAL SUITABILITY CLASS
// ============================================================
var areaImage = ee.Image.pixelArea()
  .divide(10000)
  .rename('Area_ha')
  .reproject({
    crs: analysisCrs,
    scale: statsScale
  });

var classArea = areaImage.addBands(finalSuitability_coarse)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1,
      groupName: 'class'
    }),
    geometry: aoi,
    crs: analysisCrs,
    scale: statsScale,
    maxPixels: 1e13,
    bestEffort: true,
    tileScale: 16
  });

print('Area by final suitability class (ha):', classArea);


// ============================================================
// 20. BUILD CLASS DICTIONARY FOR CHARTS
// ============================================================
var groupList = ee.List(ee.Dictionary(classArea).get('groups', []));

var classDict = ee.Dictionary(
  groupList.iterate(function(item, acc) {
    item = ee.Dictionary(item);
    acc = ee.Dictionary(acc);
    return acc.set(
      ee.Number(item.get('class')).format(),
      item.get('sum')
    );
  }, ee.Dictionary({}))
);

print('Class dictionary:', classDict);


// ============================================================
// 21. SIMPLE AREA TABLE FOR PIE CHART / SUMMARY
// ============================================================
var areaChartFc = ee.FeatureCollection([
  ee.Feature(null, {
    class: 1,
    class_name: 'Very Low',
    value: ee.Number(classDict.get('1', 0))
  }),
  ee.Feature(null, {
    class: 2,
    class_name: 'Low',
    value: ee.Number(classDict.get('2', 0))
  }),
  ee.Feature(null, {
    class: 3,
    class_name: 'Moderate',
    value: ee.Number(classDict.get('3', 0))
  }),
  ee.Feature(null, {
    class: 4,
    class_name: 'High',
    value: ee.Number(classDict.get('4', 0))
  }),
  ee.Feature(null, {
    class: 5,
    class_name: 'Very High',
    value: ee.Number(classDict.get('5', 0))
  })
]);

print('Area chart feature collection:', areaChartFc);


// ============================================================
// 22. MEAN FACTOR SCORES FOR LINE CHART
// ============================================================
function meanValue(img, name) {
  var d = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: aoi,
    crs: analysisCrs,
    scale: chartScale,
    maxPixels: 1e13,
    bestEffort: true,
    tileScale: 16
  });

  return ee.Feature(null, {
    factor: name,
    mean_score: ee.Number(ee.Dictionary(d).values().get(0))
  });
}

var factorFc = ee.FeatureCollection([
  meanValue(s_water_coarse, 'Soil Water'),
  meanValue(s_rain_coarse, 'Rainfall'),
  meanValue(s_slope_coarse, 'Slope'),
  meanValue(s_ph_coarse, 'pH'),
  meanValue(s_soc_coarse, 'SOC'),
  meanValue(s_texture_coarse, 'Texture')
]);

print('Mean factor suitability scores:', factorFc);


// ============================================================
// 23. CHARTS
// ============================================================

// 3D pie chart with matching suitability colors
var pieChart = ui.Chart.feature.byFeature({
  features: areaChartFc.sort('class'),
  xProperty: 'class_name',
  yProperties: ['value']
})
.setChartType('PieChart')
.setOptions({
  title: '3D Pie Chart: Area by Final Suitability Class',
  is3D: true,
  pieSliceText: 'value',
  legend: {position: 'right'},
  slices: {
    0: {color: '#d7191c'},
    1: {color: '#fdae61'},
    2: {color: '#ffffbf'},
    3: {color: '#a6d96a'},
    4: {color: '#1a9641'}
  }
});

print(pieChart);

// multi-series colored bar chart
var barTable = ee.FeatureCollection([
  ee.Feature(null, {
    class_name: 'Very Low',
    very_low:  ee.Number(classDict.get('1', 0)),
    low:       0,
    moderate:  0,
    high:      0,
    very_high: 0
  }),
  ee.Feature(null, {
    class_name: 'Low',
    very_low:  0,
    low:       ee.Number(classDict.get('2', 0)),
    moderate:  0,
    high:      0,
    very_high: 0
  }),
  ee.Feature(null, {
    class_name: 'Moderate',
    very_low:  0,
    low:       0,
    moderate:  ee.Number(classDict.get('3', 0)),
    high:      0,
    very_high: 0
  }),
  ee.Feature(null, {
    class_name: 'High',
    very_low:  0,
    low:       0,
    moderate:  0,
    high:      ee.Number(classDict.get('4', 0)),
    very_high: 0
  }),
  ee.Feature(null, {
    class_name: 'Very High',
    very_low:  0,
    low:       0,
    moderate:  0,
    high:      0,
    very_high: ee.Number(classDict.get('5', 0))
  })
]);

print('Colored bar chart table:', barTable);

var barChart = ui.Chart.feature.byFeature({
  features: barTable,
  xProperty: 'class_name',
  yProperties: ['very_low', 'low', 'moderate', 'high', 'very_high']
})
.setChartType('ColumnChart')
.setOptions({
  title: 'Bar Chart: Area by Final Suitability Class',
  hAxis: {title: 'Suitability Class'},
  vAxis: {title: 'Area (ha)'},
  legend: {position: 'none'},
  isStacked: false,
  colors: ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641']
});

print(barChart);

// line chart
var lineChart = ui.Chart.feature.byFeature({
  features: factorFc,
  xProperty: 'factor',
  yProperties: ['mean_score']
})
.setChartType('LineChart')
.setOptions({
  title: 'Line Chart: Mean Suitability Score by Factor',
  hAxis: {title: 'Factor'},
  vAxis: {
    title: 'Mean Score',
    viewWindow: {min: 1, max: 5}
  },
  pointSize: 6,
  lineWidth: 2,
  legend: {position: 'none'}
});

print(lineChart);


// ============================================================
// 24. EXPORTS
// ============================================================
Export.image.toDrive({
  image: finalSuitability,
  description: 'Final_Agricultural_Suitability_Africa',
  folder: 'GEE_Exports',
  fileNamePrefix: 'Final_Agricultural_Suitability_Africa',
  region: aoi,
  scale: exportScale,
  maxPixels: 1e13
});

Export.image.toDrive({
  image: finalScore,
  description: 'Final_Agricultural_Suitability_Score_Africa',
  folder: 'GEE_Exports',
  fileNamePrefix: 'Final_Agricultural_Suitability_Score_Africa',
  region: aoi,
  scale: exportScale,
  maxPixels: 1e13
});

Export.image.toDrive({
  image: rzaw,
  description: 'Root_Zone_Soil_Water_Availability_Africa_mm',
  folder: 'GEE_Exports',
  fileNamePrefix: 'Root_Zone_Soil_Water_Availability_Africa_mm',
  region: aoi,
  scale: exportScale,
  maxPixels: 1e13
});

Export.table.toDrive({
  collection: areaChartFc,
  description: 'Suitability_Class_Area_Table_Africa',
  folder: 'GEE_Exports',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: factorFc,
  description: 'Mean_Factor_Scores_Table_Africa',
  folder: 'GEE_Exports',
  fileFormat: 'CSV'
});