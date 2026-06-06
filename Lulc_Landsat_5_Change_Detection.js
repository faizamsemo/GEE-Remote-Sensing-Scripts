/**************************************************************
 * FULL CLEAN SCRIPT — LULC + ACCURACY + AREA + CHANGE RASTER
 * LANDSAT 5
 * AUGUST–OCTOBER ONLY
 * 2000 -> 2005
 *
 * CLASSES:
 * 1 = Built-up
 * 2 = Cropland
 * 3 = Forest
 * 4 = Degraded surface
 * 5 = Sand river
 *
 * OUTPUTS:
 * 1. LULC 1995 raster
 * 2. LULC 2000 raster
 * 3. Accuracy table
 * 4. Area table
 * 5. Transition table
 * 6. Change analysis table
 * 7. Transition raster (11,12,...,55)
 * 8. Binary change raster (0=no change, 1=change)
 **************************************************************/

// ==============================
// 0) SETTINGS
// ==============================
var roiFc0 = ee.FeatureCollection(table);
var roiFc  = ee.FeatureCollection([ee.Feature(roiFc0.union().geometry())]);
var roi    = roiFc.geometry();

Map.setOptions('SATELLITE');
Map.centerObject(roi, 9);
Map.addLayer(
  roiFc.style({color: 'red', fillColor: '00000000', width: 2}),
  {},
  'ROI'
);

var YEAR1 = 2000;
var YEAR2 = 2005;

var SCALE = 30;
var SEED = 42;

// Proper split
var TRAIN_RATIO = 0.80;

// Sampling and RF
var MAX_PER_CLASS = 300;
var N_TREES = 300;

var SAMPLE_TILE_SCALE = 8;
var REDUCE_TILE_SCALE = 16;

var classProp = 'class';

var classNames = [
  'Built-up',
  'Cropland',
  'Forest',
  'Degraded surface',
  'Sand river'
];

var classPalette = [
  '#c30000', // Built-up
  '#ffd54f', // Cropland
  '#228B22', // Forest
  '#b8b8b8', // Degraded
  '#4acef7'  // Sand river
];

var nClasses = classNames.length;

var bands = [
  'BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2',
  'NDVI', 'MNDWI', 'NDMI', 'BSI', 'NDBI'
];


// ==============================
// 1) MASK + INDICES
// ==============================
function maskL5(img) {
  var qa = img.select('QA_PIXEL');
  var cloud = qa.bitwiseAnd(1 << 3).neq(0);
  var shadow = qa.bitwiseAnd(1 << 4).neq(0);
  var snow = qa.bitwiseAnd(1 << 5).neq(0);
  var radsat = img.select('QA_RADSAT').eq(0);

  return img
    .updateMask(cloud.or(shadow).or(snow).not())
    .updateMask(radsat);
}

function addBandsL5(img) {
  var sr = img.select(['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'])
    .multiply(0.0000275)
    .add(-0.2)
    .rename(['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2']);

  var ndvi = sr.normalizedDifference(['NIR', 'RED']).rename('NDVI');
  var mndwi = sr.normalizedDifference(['GREEN', 'SWIR1']).rename('MNDWI');
  var ndmi = sr.normalizedDifference(['NIR', 'SWIR1']).rename('NDMI');
  var ndbi = sr.normalizedDifference(['SWIR1', 'NIR']).rename('NDBI');

  var bsi = sr.expression(
    '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
    {
      SWIR1: sr.select('SWIR1'),
      RED: sr.select('RED'),
      NIR: sr.select('NIR'),
      BLUE: sr.select('BLUE')
    }
  ).rename('BSI');

  return sr.addBands([ndvi, mndwi, ndmi, ndbi, bsi]).select(bands);
}


// ==============================
// 2) AUGUST–OCTOBER COMPOSITE
// ==============================
function composite(year) {
  var startNarrow = ee.Date.fromYMD(year, 8, 1);
  var endNarrow   = ee.Date.fromYMD(year, 10, 31).advance(1, 'day');

  var startWide = ee.Date.fromYMD(year - 1, 8, 1);
  var endWide   = ee.Date.fromYMD(year + 1, 10, 31).advance(1, 'day');

  var colNarrow = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(startNarrow, endNarrow)
    .filter(ee.Filter.lte('CLOUD_COVER', 80))
    .map(maskL5)
    .map(addBandsL5);

  var colWide = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(startWide, endWide)
    .filter(ee.Filter.lte('CLOUD_COVER', 85))
    .map(maskL5)
    .map(addBandsL5);

  print('Images narrow ' + year, colNarrow.size());
  print('Images wide ' + year, colWide.size());

  var imgNarrow = ee.Image(colNarrow.median());
  var imgWide   = ee.Image(colWide.median());

  var img = imgNarrow.unmask(imgWide).clip(roi).select(bands);

  var valid = img.select('RED').reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: roi,
    scale: SCALE,
    maxPixels: 1e13,
    tileScale: REDUCE_TILE_SCALE,
    bestEffort: true
  });

  print('Valid pixels ' + year, valid);

  return img;
}


// ==============================
// 3) TRAINING DATA
// ==============================
function setClass(fc, value) {
  return ee.FeatureCollection(fc).map(function(f) {
    return f.set(classProp, value);
  });
}

function getTraining(year) {
  var A;

  if (year === 2000) {
    A = {
      b: Builtup_2000,
      c: Cropland_2000,
      f: Forest_2000,
      d: Degraded_2000,
      s: Sandriver_2000
    };
  } else {
    A = {
      b: Builtup_2005,
      c: Cropland_2005,
      f: Forest_2005,
      d: Degraded_2005,
      s: Sandriver_2005
    };
  }

  var b = setClass(A.b, 1).filterBounds(roi);
  var c = setClass(A.c, 2).filterBounds(roi);
  var f = setClass(A.f, 3).filterBounds(roi);
  var d = setClass(A.d, 4).filterBounds(roi);
  var s = setClass(A.s, 5).filterBounds(roi);

  return b.merge(c).merge(f).merge(d).merge(s);
}


// ==============================
// 4) CONFUSION METRICS
// ==============================
function metricsFromCM(cm, year) {
  var arr = ee.Array(cm.array());

  var diag = ee.List.sequence(0, nClasses - 1).map(function(i) {
    i = ee.Number(i);
    return ee.Number(arr.get([i, i]));
  });

  var rowSums = ee.List.sequence(0, nClasses - 1).map(function(i) {
    i = ee.Number(i);
    return ee.Number(
      ee.Array(arr.slice(0, i, i.add(1)))
        .reduce(ee.Reducer.sum(), [1])
        .get([0, 0])
    );
  });

  var colSums = ee.List.sequence(0, nClasses - 1).map(function(i) {
    i = ee.Number(i);
    return ee.Number(
      ee.Array(arr.slice(1, i, i.add(1)))
        .reduce(ee.Reducer.sum(), [0])
        .get([0, 0])
    );
  });

  var total = ee.Number(arr.reduce(ee.Reducer.sum(), [0, 1]).get([0, 0]));
  var correct = ee.Number(ee.Array(diag).reduce(ee.Reducer.sum(), [0]).get([0]));
  var oa = ee.Algorithms.If(total.gt(0), correct.divide(total), 0);

  var peNum = ee.Number(
    ee.List.sequence(0, nClasses - 1).map(function(i) {
      i = ee.Number(i);
      return ee.Number(rowSums.get(i)).multiply(ee.Number(colSums.get(i)));
    }).reduce(ee.Reducer.sum())
  );

  var pe = ee.Algorithms.If(total.gt(0), peNum.divide(total.multiply(total)), 0);

  var kappa = ee.Algorithms.If(
    ee.Number(1).subtract(pe).neq(0),
    ee.Number(oa).subtract(pe).divide(ee.Number(1).subtract(pe)),
    0
  );

  var producer = ee.List.sequence(0, nClasses - 1).map(function(i) {
    i = ee.Number(i);
    var d = ee.Number(diag.get(i));
    var r = ee.Number(rowSums.get(i));
    return ee.Algorithms.If(r.gt(0), d.divide(r), 0);
  });

  var consumer = ee.List.sequence(0, nClasses - 1).map(function(i) {
    i = ee.Number(i);
    var d = ee.Number(diag.get(i));
    var c = ee.Number(colSums.get(i));
    return ee.Algorithms.If(c.gt(0), d.divide(c), 0);
  });

  print('Confusion Matrix ' + year, arr);
  print('Overall Accuracy ' + year, oa);
  print('Kappa ' + year, kappa);
  print('Producer Accuracy ' + year, producer);
  print('Consumer Accuracy ' + year, consumer);

  return ee.Feature(null, {
    Year: year,
    OverallAccuracy: oa,
    Kappa: kappa,
    Producer_Builtup: producer.get(0),
    Producer_Cropland: producer.get(1),
    Producer_Forest: producer.get(2),
    Producer_Degraded: producer.get(3),
    Producer_Sandriver: producer.get(4),
    Consumer_Builtup: consumer.get(0),
    Consumer_Cropland: consumer.get(1),
    Consumer_Forest: consumer.get(2),
    Consumer_Degraded: consumer.get(3),
    Consumer_Sandriver: consumer.get(4)
  });
}


// ==============================
// 5) CLASS BALANCING
// ==============================
function getClassSamples(samples, classValue, maxCount) {
  var subset = samples
    .filter(ee.Filter.eq(classProp, classValue))
    .randomColumn('r', SEED + classValue)
    .sort('r');

  var count = subset.size();
  var n = ee.Number(count).min(maxCount).toInt();

  return subset.limit(n);
}

function buildBalancedSamples(samples, year) {
  var s1 = getClassSamples(samples, 1, MAX_PER_CLASS);
  var s2 = getClassSamples(samples, 2, MAX_PER_CLASS);
  var s3 = getClassSamples(samples, 3, MAX_PER_CLASS);
  var s4 = getClassSamples(samples, 4, MAX_PER_CLASS);
  var s5 = getClassSamples(samples, 5, MAX_PER_CLASS);

  print('Class 1 sample count ' + year, s1.size());
  print('Class 2 sample count ' + year, s2.size());
  print('Class 3 sample count ' + year, s3.size());
  print('Class 4 sample count ' + year, s4.size());
  print('Class 5 sample count ' + year, s5.size());

  return s1.merge(s2).merge(s3).merge(s4).merge(s5);
}


// ==============================
// 6) TRAIN + CLASSIFY
// ==============================
function classifyYear(img, year) {
  var training = getTraining(year);

  print('Training features ' + year, training.size());
  print('Training histogram ' + year, training.aggregate_histogram(classProp));

  var samples = img.sampleRegions({
    collection: training,
    properties: [classProp],
    scale: SCALE,
    geometries: false,
    tileScale: SAMPLE_TILE_SCALE
  }).filter(ee.Filter.notNull(bands.concat([classProp])));

  print('Samples ' + year, samples.size());
  print('Sample histogram ' + year, samples.aggregate_histogram(classProp));

  var balanced = buildBalancedSamples(samples, year);
  print('Balanced size ' + year, balanced.size());

  var split = balanced.randomColumn('rand', SEED);
  var train = split.filter(ee.Filter.lt('rand', 0.8));
  var valid = split.filter(ee.Filter.gte('rand', 0.8));

  print('Train ' + year, train.size());
  print('Valid ' + year, valid.size());

  var rf = ee.Classifier.smileRandomForest({
    numberOfTrees: N_TREES,
    minLeafPopulation: 2,
    bagFraction: 0.7,
    seed: SEED
  }).train({
    features: train,
    classProperty: classProp,
    inputProperties: bands
  });

  var pred = valid.classify(rf);
  var cm = pred.errorMatrix(classProp, 'classification');

  var acc = metricsFromCM(cm, year)
    .set('TrainingSamples', train.size())
    .set('ValidationSamples', valid.size());

  var classified = img.classify(rf).toByte();

  var classHist = classified.reduceRegion({
    reducer: ee.Reducer.frequencyHistogram(),
    geometry: roi,
    scale: SCALE,
    maxPixels: 1e13,
    tileScale: REDUCE_TILE_SCALE,
    bestEffort: true
  });

  print('Class histogram ' + year, classHist);

  return {
    image: classified,
    acc: acc
  };
}


// ==============================
// 7) AREA
// ==============================
function areaTable(img, year) {
  var classified = img.unmask(0).rename('class');
  var areaM2 = ee.Image.pixelArea().rename('area');

  var validMask = classified.gte(1).and(classified.lte(5));
  var totalClassifiedArea = ee.Number(
    areaM2.updateMask(validMask).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: roi,
      scale: SCALE,
      maxPixels: 1e13,
      tileScale: REDUCE_TILE_SCALE,
      bestEffort: true
    }).get('area', 0)
  );

  return ee.FeatureCollection(
    ee.List.sequence(1, 5).map(function(c) {
      c = ee.Number(c);

      var classArea = ee.Number(
        areaM2.updateMask(classified.eq(c)).reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: roi,
          scale: SCALE,
          maxPixels: 1e13,
          tileScale: REDUCE_TILE_SCALE,
          bestEffort: true
        }).get('area', 0)
      );

      var percent = ee.Algorithms.If(
        totalClassifiedArea.gt(0),
        classArea.divide(totalClassifiedArea).multiply(100),
        0
      );

      return ee.Feature(null, {
        Year: year,
        ClassID: c,
        ClassName: ee.List(classNames).get(c.subtract(1)),
        Area_km2: classArea.divide(1e6),
        Percent: percent
      });
    })
  );
}


// ==============================
// 8) TRANSITION TABLE
// LIGHT VERSION
// ==============================
function transitionTable(img1, img2, year1, year2) {
  var a = img1.unmask(0).rename('class1');
  var b = img2.unmask(0).rename('class2');
  var areaImg = ee.Image.pixelArea().rename('area');

  return ee.FeatureCollection(
    ee.List.sequence(1, 5).map(function(fromC) {
      fromC = ee.Number(fromC);

      return ee.List.sequence(1, 5).map(function(toC) {
        toC = ee.Number(toC);

        var mask = a.eq(fromC).and(b.eq(toC));

        var area = ee.Number(
          areaImg.updateMask(mask).reduceRegion({
            reducer: ee.Reducer.sum(),
            geometry: roi,
            scale: SCALE,
            maxPixels: 1e13,
            tileScale: 16,
            bestEffort: true
          }).get('area', 0)
        ).divide(1e6);

        return ee.Feature(null, {
          FromYear: year1,
          ToYear: year2,
          FromID: fromC,
          FromClass: ee.List(classNames).get(fromC.subtract(1)),
          ToID: toC,
          ToClass: ee.List(classNames).get(toC.subtract(1)),
          TransitionCode: fromC.multiply(10).add(toC),
          Area_km2: area
        });
      });
    }).flatten()
  );
}


// ==============================
// 9) CHANGE ANALYSIS TABLE
// ==============================
function changeTable(areaYear1, areaYear2, year1, year2) {
  var dict1 = ee.Dictionary(
    areaYear1.iterate(function(f, acc) {
      f = ee.Feature(f);
      return ee.Dictionary(acc).set(
        ee.Number(f.get('ClassID')).format(),
        ee.Number(f.get('Area_km2'))
      );
    }, ee.Dictionary({}))
  );

  var dict2 = ee.Dictionary(
    areaYear2.iterate(function(f, acc) {
      f = ee.Feature(f);
      return ee.Dictionary(acc).set(
        ee.Number(f.get('ClassID')).format(),
        ee.Number(f.get('Area_km2'))
      );
    }, ee.Dictionary({}))
  );

  return ee.FeatureCollection(
    ee.List.sequence(1, 5).map(function(c) {
      c = ee.Number(c);

      var a1 = ee.Number(dict1.get(c.format(), 0));
      var a2 = ee.Number(dict2.get(c.format(), 0));
      var net = a2.subtract(a1);

      var pctChange = ee.Algorithms.If(
        a1.neq(0),
        net.divide(a1).multiply(100),
        null
      );

      return ee.Feature(null, {
        FromYear: year1,
        ToYear: year2,
        ClassID: c,
        ClassName: ee.List(classNames).get(c.subtract(1)),
        Area_Year1_km2: a1,
        Area_Year2_km2: a2,
        NetChange_km2: net,
        PercentChange: pctChange
      });
    })
  );
}


// ==============================
// 10) CHANGE RASTERS
// ==============================
function buildChangeProducts(img1, img2) {
  var a = img1.unmask(0).rename('class1');
  var b = img2.unmask(0).rename('class2');

  var validMask = a.gte(1).and(a.lte(5)).and(b.gte(1)).and(b.lte(5));

  // Categorical transition raster: 11,12,...,55
  var changeTransition = a.multiply(10).add(b)
    .updateMask(validMask)
    .toInt16()
    .rename('change_transition');

  // Binary change raster: 0 = no change, 1 = change
  var changeBinary = a.neq(b)
    .updateMask(validMask)
    .toByte()
    .rename('change_binary');

  return {
    transition: changeTransition,
    binary: changeBinary
  };
}


// ==============================
// 11) RUN
// ==============================
var img1 = composite(YEAR1);
var img2 = composite(YEAR2);

var r1 = classifyYear(img1, YEAR1);
var r2 = classifyYear(img2, YEAR2);

var a1 = areaTable(r1.image, YEAR1);
var a2 = areaTable(r2.image, YEAR2);

print('Area ' + YEAR1, a1);
print('Area ' + YEAR2, a2);

var tr = transitionTable(r1.image, r2.image, YEAR1, YEAR2);
print('Transitions ' + YEAR1 + ' to ' + YEAR2, tr);

var ch = changeTable(a1, a2, YEAR1, YEAR2);
print('Change Analysis ' + YEAR1 + ' to ' + YEAR2, ch);

var changeProducts = buildChangeProducts(r1.image, r2.image);
var changeTransition = changeProducts.transition;
var changeBinary = changeProducts.binary;

print('Change transition raster codes: 11,12,...,55');
print('Binary change raster: 0 = no change, 1 = change');


// ==============================
// 12) MAP DISPLAY
// ==============================
Map.addLayer(r1.image, {
  min: 1,
  max: 5,
  palette: classPalette
}, 'LULC ' + YEAR1, false);

Map.addLayer(r2.image, {
  min: 1,
  max: 5,
  palette: classPalette
}, 'LULC ' + YEAR2, false);

// Binary change map
Map.addLayer(changeBinary, {
  min: 0,
  max: 1,
  palette: ['#1a9850', '#d73027']
}, 'Binary Change 2000-2005', true);

// Transition raster visualization
Map.addLayer(changeTransition, {
  min: 11,
  max: 55,
  palette: [
    '#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3',
    '#fdb462','#b3de69','#fccde5','#d9d9d9','#bc80bd',
    '#ccebc5','#ffed6f','#1f78b4','#33a02c','#e31a1c',
    '#ff7f00','#6a3d9a','#b15928','#a6cee3','#b2df8a',
    '#fb9a99','#fdbf6f','#cab2d6','#ffff99','#999999'
  ]
}, 'Transition Raster 2000-2005', false);


// ==============================
// 13) EXPORTS
// ==============================
Export.image.toDrive({
  image: r1.image,
  description: 'LULC_' + YEAR1 + '_AugOct',
  folder: 'LULC_Outputs',
  region: roi,
  scale: SCALE,
  maxPixels: 1e13
});

Export.image.toDrive({
  image: r2.image,
  description: 'LULC_' + YEAR2 + '_AugOct',
  folder: 'LULC_Outputs',
  region: roi,
  scale: SCALE,
  maxPixels: 1e13
});

// New exports
Export.image.toDrive({
  image: changeTransition,
  description: 'ChangeTransition_' + YEAR1 + '_' + YEAR2 + '_AugOct',
  folder: 'LULC_Outputs',
  region: roi,
  scale: SCALE,
  maxPixels: 1e13
});

Export.image.toDrive({
  image: changeBinary,
  description: 'ChangeBinary_' + YEAR1 + '_' + YEAR2 + '_AugOct',
  folder: 'LULC_Outputs',
  region: roi,
  scale: SCALE,
  maxPixels: 1e13
});

Export.table.toDrive({
  collection: ee.FeatureCollection([r1.acc, r2.acc]),
  description: 'Accuracy_' + YEAR1 + '_' + YEAR2 + '_AugOct',
  folder: 'LULC_Outputs',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: a1,
  description: 'Area_' + YEAR1 + '_AugOct',
  folder: 'LULC_Outputs',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: a2,
  description: 'Area_' + YEAR2 + '_AugOct',
  folder: 'LULC_Outputs',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: tr,
  description: 'Transitions_' + YEAR1 + '_' + YEAR2 + '_AugOct',
  folder: 'LULC_Outputs',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: ch,
  description: 'Change_' + YEAR1 + '_' + YEAR2 + '_AugOct',
  folder: 'LULC_Outputs',
  fileFormat: 'CSV'
});