/**************************************************************
 * LULC (Landsat 8 only) — Landsat 8 C2 L2 SR — 5-CLASS RF
 * HOLE-FILLED COMPOSITE (Strict -> Relaxed -> Wide window)
 * AOI outline only (black, no fill)
 *
 * Classes (IDs):
 *  1 Water, 2 Mangrove, 3 Shrubs, 4 Sand, 5 Built-up
 *
 * EXPORTS ADDED (what you requested):
 *  - Export LULC raster (GeoTIFF)
 *  - Export RGB composite image (GeoTIFF)
 *  - Export all-classes area table (CSV: km2 + percent)
 *  - Export per-pixel class image as int (GeoTIFF)
 * Author: Faiza Msemo
 **************************************************************/

// ------------------------------
// 0) SETTINGS
// ------------------------------
var roi = ee.FeatureCollection(table).geometry();

Map.setOptions('SATELLITE');
Map.centerObject(roi, 9);

// AOI outline only (black, no fill)
var aoiFC = ee.FeatureCollection([ee.Feature(roi)]);
var aoiOutlineImg = ee.Image().byte().paint({
  featureCollection: aoiFC,
  color: 1,
  width: 2
});
Map.addLayer(aoiOutlineImg, {palette: ['000000']}, 'AOI (outline only)', true);

// Target year (Landsat 8 available from 2013+)
var YEAR = 2025;

// Window inside year
var START_MONTH = 1, START_DAY = 1;
var END_MONTH   = 12, END_DAY  = 31;

// Hole-fill fallback window around year (±1). Increase to 2 if still gaps.
var WIDE_YEARS = 1;

// Controls
var SCALE = 30;
var TILE_SCALE = 16;

var SEED = 42;
var MAX_PER_CLASS = 1500;

var N_TREES = 300;
var classProp = 'class';

// Classes
var classNames   = ['Water','Mangrove','Shrubs','Sand','Built-up'];
var classPalette = ['#1E90FF','#006400','#7FFF00','#d1c1bd','#c30000'];
var nClasses     = classNames.length;

// Predictor bands
var bandsForClassification = [
  'B1','B2','B3','B4','B5','B6','B7',
  'NDVI','MNDWI','NDMI','BSI'
];

print('Year:', YEAR);
print('Predictors:', bandsForClassification);

// ------------------------------
// 1) Mask functions (Landsat 8 C2 L2)
// ------------------------------
function maskL8Strict(img) {
  var qa = img.select('QA_PIXEL');
  var radsat = img.select('QA_RADSAT');

  var dilated = qa.bitwiseAnd(1 << 1).neq(0);
  var cloud   = qa.bitwiseAnd(1 << 3).neq(0);
  var shadow  = qa.bitwiseAnd(1 << 4).neq(0);
  var snow    = qa.bitwiseAnd(1 << 5).neq(0);

  var mask = dilated.or(cloud).or(shadow).or(snow).not().and(radsat.eq(0));
  return img.updateMask(mask);
}

function maskL8Relaxed(img) {
  var qa = img.select('QA_PIXEL');
  var radsat = img.select('QA_RADSAT');

  var cloud  = qa.bitwiseAnd(1 << 3).neq(0);
  var shadow = qa.bitwiseAnd(1 << 4).neq(0);
  var snow   = qa.bitwiseAnd(1 << 5).neq(0);

  var mask = cloud.or(shadow).or(snow).not().and(radsat.eq(0));
  return img.updateMask(mask);
}

// ------------------------------
// 2) Scale + indices (L8 SR)
// ------------------------------
function scaleAndIndexL8(img) {
  var sr = img.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
    .multiply(0.0000275).add(-0.2)
    .rename(['B2','B3','B4','B5','B6','B7']);

  var b1 = img.select('SR_B1')
    .multiply(0.0000275).add(-0.2)
    .rename('B1');

  sr = b1.addBands(sr);

  var ndvi  = sr.normalizedDifference(['B5','B4']).rename('NDVI');   // NIR, RED
  var mndwi = sr.normalizedDifference(['B3','B6']).rename('MNDWI');  // GREEN, SWIR1
  var ndmi  = sr.normalizedDifference(['B5','B6']).rename('NDMI');   // NIR, SWIR1

  var bsi = sr.expression(
    '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
    {SWIR1: sr.select('B6'), RED: sr.select('B4'), NIR: sr.select('B5'), BLUE: sr.select('B2')}
  ).rename('BSI');

  return sr.addBands([ndvi, mndwi, ndmi, bsi]);
}

// ------------------------------
// 3) Composite builder (L8)
// ------------------------------
function buildCompositeL8(startDate, endDate, maskFn, cloudLimit) {
  var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lte('CLOUD_COVER', cloudLimit))
    .map(maskFn)
    .map(scaleAndIndexL8);

  print('L8 count', startDate, 'to', endDate, ':', col.size());
  return col.median().clip(roi);
}

// ------------------------------
// 4) Hole-filled composite (L8)
// ------------------------------
function compositeL8_HoleFilled(year) {
  var start = ee.Date.fromYMD(year, START_MONTH, START_DAY);
  var end   = ee.Date.fromYMD(year, END_MONTH, END_DAY).advance(1, 'day');

  var strict  = buildCompositeL8(start, end, maskL8Strict, 70);
  var relaxed = buildCompositeL8(start, end, maskL8Relaxed, 85);

  var wideStart = ee.Date.fromYMD(year - WIDE_YEARS, 1, 1);
  var wideEnd   = ee.Date.fromYMD(year + WIDE_YEARS, 12, 31).advance(1, 'day');
  var wide = buildCompositeL8(wideStart, wideEnd, maskL8Relaxed, 90);

  var filled = strict.unmask(relaxed).unmask(wide);

  // Optional pinhole fill
  var localFill = filled.focalMean({radius: 2, units: 'pixels', iterations: 1});
  filled = filled.unmask(localFill).clip(roi);

  return filled.select(bandsForClassification);
}

var img = compositeL8_HoleFilled(YEAR);
print('Bands (filled):', img.bandNames());

// RGB (filled) for Landsat 8: R=B4, G=B3, B=B2
var rgbFilled = img.select(['B4','B3','B2']).rename(['R','G','B']);
Map.addLayer(rgbFilled, {min: 0, max: 0.3, gamma: 1.2}, 'RGB (Filled) ' + YEAR, false);

// ------------------------------
// 5) Training merge + display training layers
// ------------------------------
function safeFC(fc) { return ee.FeatureCollection(fc).filterBounds(roi); }

var trWater    = safeFC(Water);
var trMangrove = safeFC(Mangrove);
var trShrubs   = safeFC(Shrubs);
var trSand     = safeFC(Sand);
var trBuiltup  = safeFC(Builtup);

trWater    = trWater.map(function(f){ return f.set(classProp, 1); });
trMangrove = trMangrove.map(function(f){ return f.set(classProp, 2); });
trShrubs   = trShrubs.map(function(f){ return f.set(classProp, 3); });
trSand     = trSand.map(function(f){ return f.set(classProp, 4); });
trBuiltup  = trBuiltup.map(function(f){ return f.set(classProp, 5); });

Map.addLayer(trWater,    {color: classPalette[0]}, 'Training: Water', false);
Map.addLayer(trMangrove, {color: classPalette[1]}, 'Training: Mangrove', false);
Map.addLayer(trShrubs,   {color: classPalette[2]}, 'Training: Shrubs', false);
Map.addLayer(trSand,     {color: classPalette[3]}, 'Training: Sand', false);
Map.addLayer(trBuiltup,  {color: classPalette[4]}, 'Training: Built-up', false);

var training_points = trWater.merge(trMangrove).merge(trShrubs).merge(trSand).merge(trBuiltup);

print('Training features:', training_points.size());
print('Training histogram:', ee.Dictionary(training_points.aggregate_histogram(classProp)));

// ------------------------------
// 6) Sample + clean nulls
// ------------------------------
var samples = img.sampleRegions({
  collection: training_points,
  properties: [classProp],
  scale: SCALE,
  geometries: true,
  tileScale: 4
});

print('Raw samples:', samples.size());

var samplesClean = samples.filter(
  ee.Filter.notNull(bandsForClassification.concat([classProp]))
);

print('Clean samples:', samplesClean.size());
print('Clean histogram:', ee.Dictionary(samplesClean.aggregate_histogram(classProp)));

// ------------------------------
// 7) Balance samples by class
// ------------------------------
function balanceByClass(fc, classValues, perClass, seed) {
  classValues = ee.List(classValues);
  return ee.FeatureCollection(
    classValues.iterate(function(c, acc) {
      c = ee.Number(c);
      acc = ee.FeatureCollection(acc);

      var subset = fc.filter(ee.Filter.eq(classProp, c))
        .randomColumn('r', seed)
        .sort('r')
        .limit(perClass);

      return acc.merge(subset);
    }, ee.FeatureCollection([]))
  );
}

var hist = ee.Dictionary(samplesClean.aggregate_histogram(classProp));
var valuesList = ee.List(hist.values());
var minCount = ee.Number(ee.Algorithms.If(valuesList.size().gt(0), valuesList.reduce(ee.Reducer.min()), 0));
var perClass = minCount.min(MAX_PER_CLASS).toInt();

print('Balancing per class =', perClass);

var classVals = ee.List.sequence(1, nClasses);
var samplesBalanced = balanceByClass(samplesClean, classVals, perClass, SEED);

print('Balanced samples total:', samplesBalanced.size());
print('Balanced histogram:', ee.Dictionary(samplesBalanced.aggregate_histogram(classProp)));

// ------------------------------
// 8) Train / Validation split
// ------------------------------
var withRand = samplesBalanced.randomColumn('rand', SEED);
var trainFC = withRand.filter(ee.Filter.lt('rand', 0.7));
var validFC = withRand.filter(ee.Filter.gte('rand', 0.7));

print('Train n:', trainFC.size());
print('Valid n:', validFC.size());

// ------------------------------
// 9) Train RF + validation metrics
// ------------------------------
var rf = ee.Classifier.smileRandomForest({
  numberOfTrees: N_TREES,
  minLeafPopulation: 3,
  bagFraction: 0.7,
  seed: SEED
}).train({
  features: trainFC,
  classProperty: classProp,
  inputProperties: bandsForClassification
});

var predValid = validFC.classify(rf);
var cm = predValid.errorMatrix({actual: classProp, predicted: 'classification'});

print('Confusion Matrix (valid):', cm);
print('Overall Accuracy:', cm.accuracy());
print('Kappa:', cm.kappa());
print('Producers Accuracy:', cm.producersAccuracy());
print('Users/Consumers Accuracy:', cm.consumersAccuracy());

// ------------------------------
// 10) Classify + LULC layer
// ------------------------------
var cls = img.classify(rf).rename('LULC_' + YEAR);
Map.addLayer(cls, {min: 1, max: nClasses, palette: classPalette}, 'LULC ' + YEAR, true);

// Optional: colorized visualization image (useful for export as map-style GeoTIFF)
var clsVis = cls.visualize({min: 1, max: nClasses, palette: classPalette});

// ------------------------------
// 11) Area by class (km² + %)
// ------------------------------
var areaM2 = ee.Image.pixelArea().rename('area_m2');

function areaByClassFC(classifiedImg, yearLabel) {
  var total = ee.Number(areaM2.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: roi,
    scale: SCALE,
    maxPixels: 1e13,
    tileScale: TILE_SCALE
  }).get('area_m2'));

  var feats = ee.List.sequence(1, nClasses).map(function(c) {
    c = ee.Number(c);
    var a = ee.Number(
      areaM2.updateMask(classifiedImg.eq(c)).reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: roi,
        scale: SCALE,
        maxPixels: 1e13,
        tileScale: TILE_SCALE
      }).get('area_m2')
    );

    var idx = c.subtract(1);
    return ee.Feature(null, {
      Year: yearLabel,
      ClassID: c,
      Class: ee.List(classNames).get(idx),
      Area_m2: a,
      Area_km2: a.divide(1e6),
      Percent: a.divide(total).multiply(100)
    });
  });

  return ee.FeatureCollection(feats);
}

var areaByClass = areaByClassFC(cls, YEAR);
print('Area by class ' + YEAR, areaByClass);

// Pie chart
var pie = ui.Chart.feature.byFeature({
  features: areaByClass,
  xProperty: 'Class',
  yProperties: ['Area_km2']
}).setChartType('PieChart')
  .setOptions({title: 'LULC ' + YEAR + ' – Area Share (km²)', legend: {position: 'right'}});
print(pie);

// ------------------------------
// 12) LEGEND (LULC + Training)
// ------------------------------
var legend = ui.Panel({style:{position:'bottom-left', padding:'8px 15px'}});
legend.add(ui.Label({value:'Legend (LULC + Training)', style:{fontWeight:'bold', fontSize:'15px'}}));

legend.add(ui.Label({value:'LULC classes', style:{fontWeight:'bold', margin:'6px 0 4px 0'}}));
for (var i = 0; i < nClasses; i++) {
  var row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal')});
  row.add(ui.Label('', {backgroundColor: classPalette[i], padding:'8px', margin:'0 6px 0 0'}));
  row.add(ui.Label((i + 1) + '. ' + classNames[i]));
  legend.add(row);
}

legend.add(ui.Label({value:'Training points/polygons', style:{fontWeight:'bold', margin:'8px 0 4px 0'}}));
for (var j = 0; j < nClasses; j++) {
  var row2 = ui.Panel({layout: ui.Panel.Layout.flow('horizontal')});
  row2.add(ui.Label('●', {color: classPalette[j], fontSize:'16px', margin:'0 8px 0 0'}));
  row2.add(ui.Label('Training: ' + classNames[j]));
  legend.add(row2);
}
Map.add(legend);

// ------------------------------
// 13) EXPORTS (ADDED/CLARIFIED)
// ------------------------------
var outFolder = 'GEE_L8_LULC_' + YEAR + '_5CLASS_HOLEFILLED';

// (A) Export LULC classified raster (integer classes 1..5)  ✅ "export LULC"
Export.image.toDrive({
  image: cls.toInt16(),
  description: 'L8_LULC_' + YEAR + '_INT',
  folder: outFolder,
  region: roi,
  scale: SCALE,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF',
  formatOptions: {cloudOptimized: true}
});

// (B) Export RGB filled composite image (GeoTIFF) ✅ "export image"
Export.image.toDrive({
  image: rgbFilled.toFloat(),
  description: 'L8_RGB_FILLED_' + YEAR,
  folder: outFolder,
  region: roi,
  scale: SCALE,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF',
  formatOptions: {cloudOptimized: true}
});

// (C) Export colorized LULC map (GeoTIFF; 3-band RGB) — optional but useful for reports
Export.image.toDrive({
  image: clsVis,
  description: 'L8_LULC_' + YEAR + '_VIS_RGB',
  folder: outFolder,
  region: roi,
  scale: SCALE,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

// (D) Export CSV table for ALL classes (km2 + percent) ✅ "export csv all classes km2"
Export.table.toDrive({
  collection: areaByClass,
  description: 'L8_AreaByClass_' + YEAR + '_ALLCLASSES_KM2',
  folder: outFolder,
  fileFormat: 'CSV'
});

// (E) Export validation predictions (CSV) — optional (kept)
Export.table.toDrive({
  collection: predValid,
  description: 'L8_ValidPred_' + YEAR,
  folder: outFolder,
  fileFormat: 'CSV'
});