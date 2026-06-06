/**************************************************************
 * SCRIPT 3: LANDSAT 5 + LANDSAT 8 — TWO YEARS, INDEPENDENT TRAINING
 * Cross-sensor example:
 *   2010 (L5) -> 2015 (L8)
 **************************************************************/

// ==============================
// 0) SETTINGS
// ==============================
var roiFc0 = ee.FeatureCollection(table);
var roiFc  = ee.FeatureCollection([ee.Feature(roiFc0.union().geometry())]); // dissolve
var roi    = roiFc.geometry();

Map.setOptions('SATELLITE');
Map.centerObject(roi, 10);
Map.addLayer(roiFc.style({color: 'red', fillColor: '00000000', width: 2}), {}, 'Admin boundary (ROI)');

var YEAR1 = 2010; // Landsat 5
var YEAR2 = 2015; // Landsat 8

var START_MONTH = 8, START_DAY = 1;
var END_MONTH   = 10, END_DAY  = 31;
var WIDE_YEARS = 1;

var SCALE = 30;
var TILE_SCALE = 8;
var SEED = 42;
var MAX_PER_CLASS = 1200;
var N_TREES = 200;
var classProp = 'class';

var classNames   = ['Built-up', 'Cropland', 'Forest', 'Degraded surface', 'Sand river'];
var classPalette = ['#c30000', '#ffd54f', '#228B22', '#b8b8b8', '#4acef7'];
var nClasses = classNames.length;

var bands = ['BLUE','GREEN','RED','NIR','SWIR1','SWIR2','NDVI','MNDWI','NDMI','BSI','NDBI'];

var aoiOutline = ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(roi)]), 1, 2);
Map.addLayer(aoiOutline, {palette:['000000']}, 'AOI', true);

// ==============================
// 1) TRAINING ASSET MAP
// ==============================
var trainingAssets = {
  2010: {
    builtup: Builtup_2010,
    cropland: Cropland_2010,
    forest: Forest_2010,
    degraded: Degraded_2010,
    sandriver: Sandriver_2010
  },
  2015: {
    builtup: Builtup_2015,
    cropland: Cropland_2015,
    forest: Forest_2015,
    degraded: Degraded_2015,
    sandriver: Sandriver_2015
  }
};

// ==============================
// 2) MASKS
// ==============================
function maskLStrict(img) {
  var qa = img.select('QA_PIXEL');
  var radsat = img.select('QA_RADSAT');
  var dilated = qa.bitwiseAnd(1 << 1).neq(0);
  var cloud   = qa.bitwiseAnd(1 << 3).neq(0);
  var shadow  = qa.bitwiseAnd(1 << 4).neq(0);
  var snow    = qa.bitwiseAnd(1 << 5).neq(0);
  var mask = dilated.or(cloud).or(shadow).or(snow).not().and(radsat.eq(0));
  return img.updateMask(mask);
}

function maskLRelaxed(img) {
  var qa = img.select('QA_PIXEL');
  var radsat = img.select('QA_RADSAT');
  var cloud  = qa.bitwiseAnd(1 << 3).neq(0);
  var shadow = qa.bitwiseAnd(1 << 4).neq(0);
  var snow   = qa.bitwiseAnd(1 << 5).neq(0);
  var mask = cloud.or(shadow).or(snow).not().and(radsat.eq(0));
  return img.updateMask(mask);
}

// ==============================
// 3) SCALE + INDICES
// ==============================
function scaleAndIndexL5(img) {
  var sr = img.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'])
    .multiply(0.0000275).add(-0.2)
    .rename(['BLUE','GREEN','RED','NIR','SWIR1','SWIR2']);

  var ndvi  = sr.normalizedDifference(['NIR','RED']).rename('NDVI');
  var mndwi = sr.normalizedDifference(['GREEN','SWIR1']).rename('MNDWI');
  var ndmi  = sr.normalizedDifference(['NIR','SWIR1']).rename('NDMI');
  var ndbi  = sr.normalizedDifference(['SWIR1','NIR']).rename('NDBI');

  var bsi = sr.expression(
    '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
    {
      SWIR1: sr.select('SWIR1'),
      RED: sr.select('RED'),
      NIR: sr.select('NIR'),
      BLUE: sr.select('BLUE')
    }
  ).rename('BSI');

  return sr.addBands([ndvi, mndwi, ndmi, bsi, ndbi]).select(bands);
}

function scaleAndIndexL8(img) {
  var sr = img.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
    .multiply(0.0000275).add(-0.2)
    .rename(['BLUE','GREEN','RED','NIR','SWIR1','SWIR2']);

  var ndvi  = sr.normalizedDifference(['NIR','RED']).rename('NDVI');
  var mndwi = sr.normalizedDifference(['GREEN','SWIR1']).rename('MNDWI');
  var ndmi  = sr.normalizedDifference(['NIR','SWIR1']).rename('NDMI');
  var ndbi  = sr.normalizedDifference(['SWIR1','NIR']).rename('NDBI');

  var bsi = sr.expression(
    '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
    {
      SWIR1: sr.select('SWIR1'),
      RED: sr.select('RED'),
      NIR: sr.select('NIR'),
      BLUE: sr.select('BLUE')
    }
  ).rename('BSI');

  return sr.addBands([ndvi, mndwi, ndmi, bsi, ndbi]).select(bands);
}

// ==============================
// 4) COMPOSITES
// ==============================
function buildCompositeL5(startDate, endDate, maskFn, cloudLimit) {
  return ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lte('CLOUD_COVER', cloudLimit))
    .map(maskFn)
    .map(scaleAndIndexL5)
    .median()
    .clip(roi);
}

function buildCompositeL8(startDate, endDate, maskFn, cloudLimit) {
  return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lte('CLOUD_COVER', cloudLimit))
    .map(maskFn)
    .map(scaleAndIndexL8)
    .median()
    .clip(roi);
}

function compositeL5_HoleFilled(year) {
  var start = ee.Date.fromYMD(year, START_MONTH, START_DAY);
  var end   = ee.Date.fromYMD(year, END_MONTH, END_DAY).advance(1, 'day');

  var strict  = buildCompositeL5(start, end, maskLStrict, 70);
  var relaxed = buildCompositeL5(start, end, maskLRelaxed, 85);
  var wide = buildCompositeL5(
    ee.Date.fromYMD(year - WIDE_YEARS, 8, 1),
    ee.Date.fromYMD(year + WIDE_YEARS, 10, 31).advance(1, 'day'),
    maskLRelaxed, 90
  );

  var filled = strict.unmask(relaxed).unmask(wide);
  var localFill = filled.focalMean({radius: 2, units: 'pixels', iterations: 1});
  return filled.unmask(localFill).clip(roi).select(bands);
}

function compositeL8_HoleFilled(year) {
  var start = ee.Date.fromYMD(year, START_MONTH, START_DAY);
  var end   = ee.Date.fromYMD(year, END_MONTH, END_DAY).advance(1, 'day');

  var strict  = buildCompositeL8(start, end, maskLStrict, 70);
  var relaxed = buildCompositeL8(start, end, maskLRelaxed, 85);
  var wide = buildCompositeL8(
    ee.Date.fromYMD(year - WIDE_YEARS, 8, 1),
    ee.Date.fromYMD(year + WIDE_YEARS, 10, 31).advance(1, 'day'),
    maskLRelaxed, 90
  );

  var filled = strict.unmask(relaxed).unmask(wide);
  var localFill = filled.focalMean({radius: 2, units: 'pixels', iterations: 1});
  return filled.unmask(localFill).clip(roi).select(bands);
}

// ==============================
// 5) TRAINING FC PER YEAR
// ==============================
function safeFC(fc) {
  return ee.FeatureCollection(fc).filterBounds(roi);
}

function getTrainingFC(year) {
  var assets = trainingAssets[year];

  var trBuiltup  = safeFC(assets.builtup).map(function(f){ return f.set(classProp, 1); });
  var trCropland = safeFC(assets.cropland).map(function(f){ return f.set(classProp, 2); });
  var trForest   = safeFC(assets.forest).map(function(f){ return f.set(classProp, 3); });
  var trDegraded = safeFC(assets.degraded).map(function(f){ return f.set(classProp, 4); });
  var trSand     = safeFC(assets.sandriver).map(function(f){ return f.set(classProp, 5); });

  return trBuiltup.merge(trCropland).merge(trForest).merge(trDegraded).merge(trSand);
}

// ==============================
// 6) AREA BY CLASS
// ==============================
var areaM2 = ee.Image.pixelArea().rename('area');

function areaByClassFC(classifiedImg, yearLabel) {
  var total = ee.Number(areaM2.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: roi,
    scale: SCALE,
    maxPixels: 1e13,
    tileScale: TILE_SCALE
  }).get('area'));

  var feats = ee.List.sequence(1, nClasses).map(function(c) {
    c = ee.Number(c);
    var a = ee.Number(areaM2.updateMask(classifiedImg.eq(c)).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: roi,
      scale: SCALE,
      maxPixels: 1e13,
      tileScale: TILE_SCALE
    }).get('area'));

    return ee.Feature(null, {
      Year: yearLabel,
      ClassID: c,
      Class: ee.List(classNames).get(c.subtract(1)),
      Area_km2: a.divide(1e6),
      Percent: a.divide(total).multiply(100)
    });
  });

  return ee.FeatureCollection(feats);
}

// ==============================
// 7) TRAIN, VALIDATE, CLASSIFY ONE YEAR
// ==============================
function balanceByClass(fc, classValues, perClass, seed) {
  return ee.FeatureCollection(classValues.iterate(function(c, acc) {
    c = ee.Number(c);
    acc = ee.FeatureCollection(acc);
    var subset = fc.filter(ee.Filter.eq(classProp, c))
      .randomColumn('r', seed)
      .sort('r')
      .limit(perClass);
    return acc.merge(subset);
  }, ee.FeatureCollection([])));
}

function trainAndAssessYear(image, year, sensorTag) {
  var trainingFC = getTrainingFC(year);

  var samples = image.sampleRegions({
    collection: trainingFC,
    properties: [classProp],
    scale: SCALE,
    geometries: true,
    tileScale: 4
  }).filter(ee.Filter.notNull(bands.concat([classProp])));

  var hist = ee.Dictionary(samples.aggregate_histogram(classProp));
  var valuesList = ee.List(hist.values());
  var minCount = ee.Number(
    ee.Algorithms.If(valuesList.size().gt(0), valuesList.reduce(ee.Reducer.min()), 0)
  );
  var perClass = minCount.min(MAX_PER_CLASS).toInt();

  print(sensorTag + ' ' + year + ' raw sample histogram', hist);
  print(sensorTag + ' ' + year + ' balancing per class', perClass);

  var balanced = balanceByClass(samples, ee.List.sequence(1, nClasses), perClass, SEED);

  var split = balanced.randomColumn('rand', SEED);
  var trainFC = split.filter(ee.Filter.lt('rand', 0.85));
  var validFC = split.filter(ee.Filter.gte('rand', 0.15));

  var rf = ee.Classifier.smileRandomForest({
    numberOfTrees: N_TREES,
    minLeafPopulation: 3,
    bagFraction: 0.7,
    seed: SEED
  }).train({
    features: trainFC,
    classProperty: classProp,
    inputProperties: bands
  });

  var predValid = validFC.classify(rf);
  var cm = predValid.errorMatrix(classProp, 'classification');

  print(sensorTag + ' ' + year + ' Confusion Matrix', cm);
  print(sensorTag + ' ' + year + ' Overall Accuracy', cm.accuracy());
  print(sensorTag + ' ' + year + ' Kappa', cm.kappa());
  print(sensorTag + ' ' + year + ' Producer Accuracy', cm.producersAccuracy());
  print(sensorTag + ' ' + year + ' Consumer Accuracy', cm.consumersAccuracy());

  var accuracyFC = ee.FeatureCollection([
    ee.Feature(null, {
      Sensor: sensorTag,
      Year: year,
      ValidationSamples: validFC.size(),
      OverallAccuracy: cm.accuracy(),
      Kappa: cm.kappa(),
      ProducerAccuracy: ee.String(cm.producersAccuracy()),
      ConsumerAccuracy: ee.String(cm.consumersAccuracy())
    })
  ]);

  return {
    classified: image.classify(rf).rename('LULC_' + year),
    accuracy: accuracyFC
  };
}

// ==============================
// 8) RUN BOTH YEARS
// ==============================
var img1 = compositeL5_HoleFilled(YEAR1);
var img2 = compositeL8_HoleFilled(YEAR2);

var result1 = trainAndAssessYear(img1, YEAR1, 'L5');
var result2 = trainAndAssessYear(img2, YEAR2, 'L8');

var cls1 = result1.classified;
var cls2 = result2.classified;

Map.addLayer(cls1, {min:1, max:nClasses, palette:classPalette}, 'LULC ' + YEAR1, true);
Map.addLayer(cls2, {min:1, max:nClasses, palette:classPalette}, 'LULC ' + YEAR2, true);

// ==============================
// 9) AREA TABLES
// ==============================
var area1 = areaByClassFC(cls1, YEAR1);
var area2 = areaByClassFC(cls2, YEAR2);

print('Area ' + YEAR1, area1);
print('Area ' + YEAR2, area2);

// ==============================
// 10) CHANGE DETECTION
// ==============================
var changeCode = cls1.multiply(10).add(cls2).rename('Change_' + YEAR1 + '_' + YEAR2);
Map.addLayer(changeCode.randomVisualizer(), {}, 'Change ' + YEAR1 + '_' + YEAR2, true);

function transitionTable(fromImg, toImg, fromYear, toYear) {
  var feats = ee.List.sequence(1, nClasses).map(function(fromC) {
    fromC = ee.Number(fromC);
    return ee.List.sequence(1, nClasses).map(function(toC) {
      toC = ee.Number(toC);
      var mask = fromImg.eq(fromC).and(toImg.eq(toC));
      var a = ee.Number(areaM2.updateMask(mask).reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: roi,
        scale: SCALE,
        maxPixels: 1e13,
        tileScale: TILE_SCALE
      }).get('area'));

      return ee.Feature(null, {
        FromYear: fromYear,
        ToYear: toYear,
        FromID: fromC,
        FromClass: ee.List(classNames).get(fromC.subtract(1)),
        ToID: toC,
        ToClass: ee.List(classNames).get(toC.subtract(1)),
        TransitionCode: fromC.multiply(10).add(toC),
        Area_km2: a.divide(1e6)
      });
    });
  }).flatten();

  return ee.FeatureCollection(feats);
}

var transitionFC = transitionTable(cls1, cls2, YEAR1, YEAR2);
print('Transitions ' + YEAR1 + ' to ' + YEAR2, transitionFC);

// ==============================
// 11) EXPORTS
// ==============================
var outFolder = 'L5_L8_LULC_' + YEAR1 + '_' + YEAR2;
var accuracyAll = result1.accuracy.merge(result2.accuracy);

Export.image.toDrive({
  image: cls1.toInt16(),
  description: 'LULC_' + YEAR1,
  folder: outFolder,
  region: roi,
  scale: SCALE,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: cls2.toInt16(),
  description: 'LULC_' + YEAR2,
  folder: outFolder,
  region: roi,
  scale: SCALE,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.table.toDrive({
  collection: area1,
  description: 'Area_' + YEAR1,
  folder: outFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: area2,
  description: 'Area_' + YEAR2,
  folder: outFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: transitionFC,
  description: 'Transitions_' + YEAR1 + '_' + YEAR2,
  folder: outFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: accuracyAll,
  description: 'Accuracy_' + YEAR1 + '_' + YEAR2,
  folder: outFolder,
  fileFormat: 'CSV'
});