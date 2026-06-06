// Evapotranspiration and Crop Water Stress Monitoring Using MODIS Dataset in Google Earth Engine
// FINAL STABLE SCRIPT: Maps + Legends + YEARLY chart + Monthly climatology + 3D Pie charts
// Fixes included:
// 1) reduceRegion uses geometry:
// 2) ROI geometry transformed to MODIS projection (avoids SR-ORG:6974 vs EPSG:4326)
// 3) Avoids "Too many concurrent aggregations" by using YEARLY time series
// 4) Avoids "Memory capacity exceeded" by using coarse scale + minimal reductions
// 5) Adds system:time_start to yearlyIC so calendarRange works
// 6) Pie charts use safe property names (no '>', '–', etc.)

// --------------------
// 1) Define AOI
// --------------------
var locationCoordinates = ee.FeatureCollection(table);
var pointOfInterest = ee.FeatureCollection([ee.Feature(locationCoordinates.union().geometry())]); // dissolve
var aoi = pointOfInterest.geometry();

Map.centerObject(aoi, 10);
Map.addLayer(
  pointOfInterest.style({color: 'black', fillColor: '00000000', width: 2}),
  {},
  'Admin boundary (AOI)'
);

// --------------------
// 2) Basin ROI
// --------------------
var Basin = ee.FeatureCollection("WWF/HydroSHEDS/v1/Basins/hybas_5");
var roiBasin = Basin.filterBounds(pointOfInterest);
var roiGeom = roiBasin.geometry();

Map.centerObject(roiBasin, 6);
// Map.addLayer(roiBasin, {}, 'Basin ROI');

// --------------------
// 3) MODIS ET/PET (2015–2025)
// --------------------
var startYear = 2015;
var endYear   = 2025;

var startDate = startYear + '-01-01';
var endDate   = endYear + '-12-31';

var modisIC_raw = ee.ImageCollection("MODIS/061/MOD16A2GF")
  .select(['ET', 'PET'])
  .filterDate(startDate, endDate)
  .filterBounds(roiGeom);

// Transform ROI geometry to MODIS projection to avoid projection intersection errors
var modisProj = modisIC_raw.first().select('ET').projection();
roiGeom = roiGeom.transform(modisProj, 1);

// Build scaled ET/PET and CWSI per image
var withScaledAndCwsi = modisIC_raw.map(function(img){
  var et  = img.select('ET').multiply(0.1).rename('ET_mm');
  var pet = img.select('PET').multiply(0.1).rename('PET_mm');
  var cwsi = ee.Image(1).subtract(et.divide(pet.max(0.0001))).rename('CWSI');
  return ee.Image.cat([et, pet, cwsi]).copyProperties(img, ['system:time_start']);
});

// --------------------
// 4) Map layers: mean + summer
// --------------------
var meanEt   = withScaledAndCwsi.select('ET_mm').mean();
var summerEt = withScaledAndCwsi.select('ET_mm')
  .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .mean();

var meanCwsi   = withScaledAndCwsi.select('CWSI').mean();
var summerCwsi = withScaledAndCwsi.select('CWSI')
  .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .mean();

var etVis   = {min: 0, max: 100, palette: ['blue', 'green', 'yellow', 'red']};
var cwsiVis = {min: 0, max: 1, palette: ['green', 'yellow', 'red']};

Map.addLayer(meanEt.clip(roiGeom), etVis, 'Mean ET (2015-2025)', false);
Map.addLayer(summerEt.clip(roiGeom), etVis, 'Summer ET (Jun-Aug, 2015-2025)', true);

Map.addLayer(meanCwsi.clip(roiGeom), cwsiVis, 'Mean CWSI (2015-2025)', true);
Map.addLayer(summerCwsi.clip(roiGeom), cwsiVis, 'Summer CWSI (Jun-Aug, 2015-2025)', false);

// --------------------
// 5) Crop mask (optional)
// --------------------
var landCover = ee.ImageCollection("MODIS/061/MCD12Q1")
  .select('LC_Type1')
  .mode();

var cropArea = landCover.eq(12);
Map.addLayer(cropArea.clip(roiGeom), {palette: ['00FF00']}, 'Crop Areas (LC=12)', false);

// --------------------
// 6) Export Mean ET (optional)
// --------------------
Export.image.toDrive({
  image: meanEt.clip(roiGeom),
  description: 'Mean_ET_2015_2025',
  region: roiGeom,
  scale: 500,
  crs: meanEt.projection().crs(),
  maxPixels: 1e13,
  folder: 'evapotranspiration_analysis'
});

// --------------------
// LEGENDS
// --------------------
function addLegend(title, palette, minVal, maxVal, position) {
  var legend = ui.Panel({
    style: {position: position || 'bottom-left', padding: '8px 10px', backgroundColor: 'ffffffcc'}
  });

  legend.add(ui.Label({value: title, style: {fontWeight: 'bold', fontSize: '12px', margin: '0 0 6px 0'}}));

  var makeRow = function(color, label) {
    return ui.Panel([
      ui.Label('', {backgroundColor: color, padding: '8px', margin: '0 6px 0 0'}),
      ui.Label(label, {margin: '0', fontSize: '11px'})
    ], ui.Panel.Layout.Flow('horizontal'));
  };

  var n = palette.length;
  for (var i = 0; i < n; i++) {
    var from = minVal + (i * (maxVal - minVal) / n);
    var to   = minVal + ((i + 1) * (maxVal - minVal) / n);
    legend.add(makeRow(palette[i], from.toFixed(2) + ' to ' + to.toFixed(2)));
  }
  Map.add(legend);
}

addLegend('ET (mm)', ['blue', 'green', 'yellow', 'red'], 0, 100, 'bottom-left');
addLegend('CWSI (0-1)', ['green', 'yellow', 'red'], 0, 1, 'bottom-center');

// =====================================================
// CHART PANEL
// =====================================================
var chartPanel = ui.Panel({
  style: {position: 'top-right', width: '470px', padding: '8px', backgroundColor: 'ffffffcc'}
});
chartPanel.add(ui.Label('ET / PET / CWSI Charts', {fontWeight: 'bold', fontSize: '13px'}));
Map.add(chartPanel);

// =====================================================
// 7) YEARLY time series chart (low aggregation load)
// =====================================================
var years = ee.List.sequence(startYear, endYear);

var yearlyIC = ee.ImageCollection(years.map(function(y){
  y = ee.Number(y);
  var yStart = ee.Date.fromYMD(y, 1, 1);
  var yEnd   = yStart.advance(1, 'year');

  var img = withScaledAndCwsi
    .filterDate(yStart, yEnd)
    .mean()
    .set('year', y)
    .set('system:time_start', yStart.millis())
    .set('system:time_end', yEnd.millis());

  return img;
}));

var yearlyChart = ui.Chart.image.series({
  imageCollection: yearlyIC.select(['ET_mm', 'PET_mm', 'CWSI']),
  region: roiGeom,
  reducer: ee.Reducer.mean(),
  scale: 1000,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'YEARLY basin mean (2015-2025)',
  lineWidth: 2,
  pointSize: 4,
  vAxes: {0: {title: 'ET / PET (mm)'}, 1: {title: 'CWSI (0-1)'}},
  series: {0: {targetAxisIndex: 0}, 1: {targetAxisIndex: 0}, 2: {targetAxisIndex: 1}},
  legend: {position: 'bottom'}
});
chartPanel.add(yearlyChart);

// =====================================================
// 8) Monthly climatology (robust + low memory)
// =====================================================
var months = ee.List.sequence(1, 12);

var monthlyTable = ee.FeatureCollection(months.map(function(m){
  m = ee.Number(m);

  var img = withScaledAndCwsi
    .filter(ee.Filter.calendarRange(m, m, 'month'))
    .select(['ET_mm','PET_mm','CWSI'])
    .mean();

  // Use coarser scale + tileScale to avoid memory exceed
  var dict = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roiGeom,
    scale: 2000,
    bestEffort: true,
    tileScale: 16,
    maxPixels: 1e13
  });

  return ee.Feature(null, {
    month: m,
    ET_mm: dict.get('ET_mm'),
    PET_mm: dict.get('PET_mm'),
    CWSI: dict.get('CWSI')
  });
}));

var climChart = ui.Chart.feature.byFeature({
  features: monthlyTable,
  xProperty: 'month',
  yProperties: ['ET_mm', 'PET_mm', 'CWSI']
}).setChartType('LineChart')
.setOptions({
  title: 'Monthly climatology (mean by month, 2015-2025)',
  hAxis: {title: 'Month', gridlines: {count: 12}},
  vAxes: {0: {title: 'ET / PET (mm)'}, 1: {title: 'CWSI (0-1)'}},
  series: {0: {targetAxisIndex: 0}, 1: {targetAxisIndex: 0}, 2: {targetAxisIndex: 1}},
  lineWidth: 2,
  pointSize: 3,
  legend: {position: 'bottom'}
});
chartPanel.add(climChart);

// =====================================================
// 9) 3D PIE CHARTS (each uses ONE reduceRegion)
// =====================================================
function areaPieFromClassImage(classImg, title, labelPrefix) {
  var areaKm2 = ee.Image.pixelArea().divide(1e6).rename('area'); // km²
  var combo = areaKm2.addBands(classImg.rename('cls'));

  var stats = combo.reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'cls'}),
    geometry: roiGeom,
    scale: 2000,
    bestEffort: true,
    tileScale: 16,
    maxPixels: 1e13
  });

  var groups = ee.List(stats.get('groups'));

  var dict = ee.Dictionary(groups.iterate(function(item, acc){
    item = ee.Dictionary(item);
    var c = ee.Number(item.get('cls')).int();
    var a = ee.Number(item.get('sum'));
    var key = ee.String(labelPrefix).cat('_').cat(c.format()); // ET_1..ET_5
    return ee.Dictionary(acc).set(key, a);
  }, ee.Dictionary({})));

  var feature = ee.Feature(null, dict);

  var pie = ui.Chart.feature.byProperty(ee.FeatureCollection([feature]))
    .setChartType('PieChart')
    .setOptions({
      title: title,
      is3D: true,
      legend: {position: 'right'},
      sliceVisibilityThreshold: 0
    });

  chartPanel.add(pie);
}

// ET classes (1..5)
var etClass = meanEt.expression(
  "b('ET_mm') <= 20 ? 1" +
  ": b('ET_mm') <= 40 ? 2" +
  ": b('ET_mm') <= 60 ? 3" +
  ": b('ET_mm') <= 80 ? 4" +
  ": 5"
).rename('cls');
areaPieFromClassImage(etClass, '3D Pie: Area by Mean ET class (km2)', 'ET');

// CWSI classes (1..5)
var cwsiClass = meanCwsi.expression(
  "b('CWSI') <= 0.2 ? 1" +
  ": b('CWSI') <= 0.4 ? 2" +
  ": b('CWSI') <= 0.6 ? 3" +
  ": b('CWSI') <= 0.8 ? 4" +
  ": 5"
).rename('cls');
areaPieFromClassImage(cwsiClass, '3D Pie: Area by Mean CWSI class (km2)', 'CWSI');

// Cropland vs Non-cropland (one reduceRegion)
var areaKm2 = ee.Image.pixelArea().divide(1e6).rename('area');
var cropStats = areaKm2.addBands(cropArea.rename('crop')).reduceRegion({
  reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'crop'}),
  geometry: roiGeom,
  scale: 2000,
  bestEffort: true,
  tileScale: 16,
  maxPixels: 1e13
});

var cropGroups = ee.List(cropStats.get('groups'));
var cropDict = ee.Dictionary(cropGroups.iterate(function(item, acc){
  item = ee.Dictionary(item);
  var k = ee.Number(item.get('crop')).int();  // 0 or 1
  var a = ee.Number(item.get('sum'));
  var key = ee.String('Crop_').cat(k.format()); // Crop_1 / Crop_0
  return ee.Dictionary(acc).set(key, a);
}, ee.Dictionary({})));

var cropFeature = ee.Feature(null, cropDict);
var cropPie = ui.Chart.feature.byProperty(ee.FeatureCollection([cropFeature]))
  .setChartType('PieChart')
  .setOptions({
    title: '3D Pie: Cropland (1) vs Non-cropland (0) area (km2)',
    is3D: true,
    legend: {position: 'right'},
    sliceVisibilityThreshold: 0
  });
chartPanel.add(cropPie);

// --------------------
// MAP TITLE
// --------------------
var titlePanel = ui.Panel({
  style: {position: 'top-center', padding: '8px 12px', backgroundColor: 'ffffffcc'}
});

titlePanel.add(ui.Label({
  value: 'Evapotranspiration and Crop Water Stress Monitoring (2015–2025)',
  style: {fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0', textAlign: 'center'}
}));

titlePanel.add(ui.Label({
  value: 'Dataset: MODIS MOD16A2GF (ET, PET) | CWSI = 1 − (ET / PET)',
  style: {fontSize: '12px', margin: '0', textAlign: 'center'}
}));

Map.add(titlePanel);

// =====================
// ET & CWSI ANIMATION PREVIEW IN GEE CONSOLE (ui.Thumbnail)
// =====================

// ---- AOI (use your table)
var locationCoordinates = ee.FeatureCollection(table);
var pointOfInterest = ee.FeatureCollection([ee.Feature(locationCoordinates.union().geometry())]);
var aoi = pointOfInterest.geometry();

Map.centerObject(aoi, 8);
Map.addLayer(pointOfInterest.style({color: 'black', fillColor: '00000000', width: 2}), {}, 'AOI', true);

// ---- Time range
var startYear = 2015;
var endYear   = 2025;

// ---- Load MODIS
var modis = ee.ImageCollection("MODIS/061/MOD16A2GF")
  .select(['ET','PET'])
  .filterDate(startYear + '-01-01', endYear + '-12-31')
  .filterBounds(aoi);

// ---- Build YEARLY composites (stable, fewer frames)
var years = ee.List.sequence(startYear, endYear);

var yearly = ee.ImageCollection(years.map(function(y){
  y = ee.Number(y);
  var start = ee.Date.fromYMD(y, 1, 1);
  var end   = start.advance(1, 'year');

  var ic = modis.filterDate(start, end);

  var et  = ic.select('ET').mean().multiply(0.1).rename('ET_mm');
  var pet = ic.select('PET').mean().multiply(0.1).rename('PET_mm');
  var cwsi = ee.Image(1).subtract(et.divide(pet.max(0.0001))).rename('CWSI');

  return ee.Image.cat([et, cwsi])
    .clip(aoi)
    .set('year', y)
    .set('system:time_start', start.millis());
}));

// ---- Visualization
var etVis   = {min: 0, max: 100, palette: ['blue','green','yellow','red']};
var cwsiVis = {min: 0, max: 1, palette: ['green','yellow','red']};

// ---- Convert to RGB frames for thumbnail animation
var etRGB = yearly.map(function(img){
  return img.select('ET_mm').visualize(etVis)
    .set('system:time_start', img.get('system:time_start'));
});

var cwsiRGB = yearly.map(function(img){
  return img.select('CWSI').visualize(cwsiVis)
    .set('system:time_start', img.get('system:time_start'));
});

// ---- Thumbnail parameters
var thumbParams = {
  region: aoi,
  dimensions: 600,
  framesPerSecond: 2,
  crs: 'EPSG:4326'
};

// ---- Print animated thumbnails (correct API form)
print(
  'ET Animation (Annual Mean, 2015–2025)',
  ui.Thumbnail({
    image: etRGB,
    params: thumbParams,
    style: {stretch: 'horizontal'}
  })
);

print(
  'CWSI Animation (Annual Mean, 2015–2025)',
  ui.Thumbnail({
    image: cwsiRGB,
    params: thumbParams,
    style: {stretch: 'horizontal'}
  })
);

// ===============================
// BUILD ANIMATION FRAMES (FOR EXPORT)
// ===============================

// Create ET frames (RGB images)  ✅ FIX: select ET_mm
var etFrames = yearly.map(function(img){
  return img.select('ET_mm')                 // ✅ correct band name
    .visualize(etVis)
    .clip(aoi)
    .set('system:time_start', img.get('system:time_start'));
});

// Create CWSI frames (RGB images)
var cwsiFrames = yearly.map(function(img){
  return img.select('CWSI')
    .visualize(cwsiVis)
    .clip(aoi)
    .set('system:time_start', img.get('system:time_start'));
});



var exportRegion = aoi.bounds();

var exportRegion = aoi.bounds();

Export.video.toDrive({
  collection: etFrames,
  description: 'ET_Animation_Annual_2015_2025',
  fileNamePrefix: 'ET_Animation_Annual_2015_2025',
  folder: 'GEE_Exports',
  region: exportRegion,
  dimensions: 640,        // controls output size
  framesPerSecond: 1,
  maxPixels: 1e13
});

Export.video.toDrive({
  collection: cwsiFrames,
  description: 'CWSI_Animation_Annual_2015_2025',
  fileNamePrefix: 'CWSI_Animation_Annual_2015_2025',
  folder: 'GEE_Exports',
  region: exportRegion,
  dimensions: 640,
  framesPerSecond: 1,
  maxPixels: 1e13
});


// --------------------
// Optional export (Mean CWSI)
// --------------------
/*
Export.image.toDrive({
  image: meanCwsi.clip(roiGeom),
  description: 'Mean_CWSI_2015_2025',
  region: roiGeom,
  scale: 500,
  maxPixels: 1e13,
  folder: 'evapotranspiration_analysis'
});
*/
