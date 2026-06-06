// ============================================================
// DROUGHT RISK MAPPING USING RANDOM FOREST MODELLING
// Kenya | Google Earth Engine
// ============================================================

// ------------------------------
// 1. ROI
// ------------------------------
var roiFc = ee.FeatureCollection('projects/ee-faizamsemo/assets/Kenya');
var roi = roiFc.geometry();


// ------------------------------
// 2. RESET UI
// ------------------------------
ui.root.clear();

var map = ui.Map();
map.centerObject(roi, 6);

// Manual grayscale-like basemap using built-in styling
var grayscaleStyle = [
  {
    featureType: 'all',
    elementType: 'geometry',
    stylers: [{saturation: -100}, {lightness: 15}]
  },
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{visibility: 'off'}]
  },
  {
    featureType: 'transit',
    elementType: 'labels',
    stylers: [{visibility: 'off'}]
  },
  {
    featureType: 'road',
    elementType: 'labels.icon',
    stylers: [{visibility: 'off'}]
  },
  {
    featureType: 'administrative',
    elementType: 'labels.text.fill',
    stylers: [{color: '#484848'}]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{color: '#d6d6d6'}]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{color: '#2ba2ba'}]
  },
  {
    featureType: 'landscape',
    elementType: 'geometry',
    stylers: [{color: '#f2f2f2'}]
  }
];

map.setOptions('Grey', {Grey: grayscaleStyle});
map.addLayer(roi, {color: 'black'}, 'Kenya Boundary', true);


// ------------------------------
// 3. TITLE
// ------------------------------
var titlePanel = ui.Panel({
  style: {
    position: 'top-center',
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.9)'
  }
});

titlePanel.add(ui.Label({
  value: 'Drought Risk Mapping using Random Forest Modelling',
  style: {
    fontWeight: 'bold',
    fontSize: '22px',
    color: 'black'
  }
}));

map.add(titlePanel);


// ------------------------------
// 4. SIDE PANELS
// ------------------------------
var leftPanel = ui.Panel({
  style: {
    position: 'top-left',
    width: '360px',
    height: '520px',
    padding: '8px',
    backgroundColor: 'rgba(255,255,255,0.9)'
  }
});

var rightPanel = ui.Panel({
  style: {
    position: 'top-right',
    width: '360px',
    height: '520px',
    padding: '8px',
    backgroundColor: 'rgba(255,255,255,0.9)'
  }
});

map.add(leftPanel);
map.add(rightPanel);


// ------------------------------
// 5. LEGEND PANELS
// ------------------------------
var bottomLeftLegend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.9)'
  }
});

var bottomRightLegend = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.9)'
  }
});

map.add(bottomLeftLegend);
map.add(bottomRightLegend);


// ------------------------------
// 6. WATER MASK
// ------------------------------
var waterMask = ee.ImageCollection("MODIS/061/MCD12Q1")
  .mode()
  .select('LC_Type1')
  .neq(17);


// ------------------------------
// 7. TERRACLIMATE DATA
// ------------------------------
var startDate = '2014-01-01';
var endDate   = '2024-12-31';

var predictors = ['aet', 'pr', 'soil', 'tmmn', 'tmmx'];

var climate = ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE")
  .filterDate(startDate, endDate)
  .select(['aet', 'pr', 'soil', 'tmmn', 'tmmx', 'pdsi'])
  .map(function(img) {
    return img
      .updateMask(waterMask)
      .clip(roi)
      .set('system:time_start', img.get('system:time_start'))
      .set('year', img.date().get('year'))
      .set('month', img.date().get('month'));
  });

print('Climate collection:', climate);
print('Number of images:', climate.size());


// ------------------------------
// 8. TRAINING SAMPLES
// ------------------------------
var sampledFc = climate.map(function(img) {

  var drought = img.select('pdsi')
    .multiply(0.01)
    .lt(-2)
    .rename('drought');

  var img2 = img.select(predictors)
    .addBands(drought)
    .addBands(ee.Image.pixelLonLat());

  var samples = img2.sample({
    region: roi,
    scale: 10000,
    numPixels: 1500,
    seed: 42,
    geometries: true
  });

  return samples.map(function(f) {
    return f.set({
      year: img.get('year'),
      month: img.get('month'),
      date: ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
    });
  });

}).flatten();

sampledFc = sampledFc.filter(ee.Filter.notNull(
  predictors.concat(['drought', 'longitude', 'latitude'])
));

print('Total samples:', sampledFc.size());
print('Sample preview:', sampledFc.limit(5));


// ------------------------------
// 9. TRAIN / TEST SPLIT
// ------------------------------
var withRandom = sampledFc.randomColumn('random', 42);

var trainSet = withRandom.filter(ee.Filter.lt('random', 0.8));
var testSet  = withRandom.filter(ee.Filter.gte('random', 0.8));


// ------------------------------
// 10. RANDOM FOREST MODEL
// ------------------------------
var rf = ee.Classifier.smileRandomForest({
  numberOfTrees: 100,
  minLeafPopulation: 5,
  seed: 42
}).train({
  features: trainSet,
  classProperty: 'drought',
  inputProperties: predictors
});

var rfProb = ee.Classifier.smileRandomForest({
  numberOfTrees: 100,
  minLeafPopulation: 5,
  seed: 42
}).setOutputMode('PROBABILITY').train({
  features: trainSet,
  classProperty: 'drought',
  inputProperties: predictors
});


// ------------------------------
// 11. VALIDATION
// ------------------------------
var testClassified = testSet.classify(rf);
var confusionMatrix = testClassified.errorMatrix('drought', 'classification');

var oa = confusionMatrix.accuracy();
var kappa = confusionMatrix.kappa();


// ------------------------------
// 12. ROC + AUC
// ------------------------------
var testProb = testSet.classify(rfProb, 'probability');

var thresholds = ee.List.sequence(0, 1, 0.05);

var rocFc = ee.FeatureCollection(thresholds.map(function(th) {
  th = ee.Number(th);

  var predicted = testProb.map(function(f) {
    var prob = ee.Number(f.get('probability'));
    var pred = prob.gte(th);
    return f.set('pred', pred);
  });

  var TP = predicted.filter(ee.Filter.and(
    ee.Filter.eq('drought', 1),
    ee.Filter.eq('pred', 1)
  )).size();

  var TN = predicted.filter(ee.Filter.and(
    ee.Filter.eq('drought', 0),
    ee.Filter.eq('pred', 0)
  )).size();

  var FP = predicted.filter(ee.Filter.and(
    ee.Filter.eq('drought', 0),
    ee.Filter.eq('pred', 1)
  )).size();

  var FN = predicted.filter(ee.Filter.and(
    ee.Filter.eq('drought', 1),
    ee.Filter.eq('pred', 0)
  )).size();

  var tpr = ee.Algorithms.If(
    ee.Number(TP).add(FN).gt(0),
    ee.Number(TP).divide(ee.Number(TP).add(FN)),
    0
  );

  var fpr = ee.Algorithms.If(
    ee.Number(FP).add(TN).gt(0),
    ee.Number(FP).divide(ee.Number(FP).add(TN)),
    0
  );

  return ee.Feature(null, {
    threshold: th,
    TPR: tpr,
    FPR: fpr
  });
}));

var rocList = rocFc.sort('FPR').toList(rocFc.size());

var auc = ee.Number(ee.List.sequence(1, rocFc.size().subtract(1)).iterate(function(i, prev) {
  i = ee.Number(i);
  prev = ee.Number(prev);

  var p1 = ee.Feature(rocList.get(i.subtract(1)));
  var p2 = ee.Feature(rocList.get(i));

  var x1 = ee.Number(p1.get('FPR'));
  var x2 = ee.Number(p2.get('FPR'));
  var y1 = ee.Number(p1.get('TPR'));
  var y2 = ee.Number(p2.get('TPR'));

  return prev.add(x2.subtract(x1).multiply(y1.add(y2)).divide(2));
}, 0));

var rocChart = ui.Chart.feature.byFeature(
  rocFc.sort('FPR'),
  'FPR',
  ['TPR']
).setChartType('LineChart')
 .setOptions({
   title: 'ROC Curve',
   hAxis: {title: 'False Positive Rate'},
   vAxis: {title: 'True Positive Rate'},
   lineWidth: 2,
   pointSize: 4,
   legend: {position: 'none'}
 });


// ------------------------------
// 13. PREDICTION IMAGE
// ------------------------------
var predictorImage = climate.select(predictors)
  .median()
  .clip(roi);

var droughtClass = predictorImage
  .classify(rf)
  .rename('drought_class')
  .clip(roi);

var droughtProb = predictorImage
  .classify(rfProb)
  .rename('drought_probability')
  .clip(roi);


// ------------------------------
// 14. 5-CLASS RISK MAP
// ------------------------------
var droughtRisk5 = ee.Image(0)
  .where(droughtProb.gte(0.0).and(droughtProb.lte(0.2)), 1)
  .where(droughtProb.gt(0.2).and(droughtProb.lte(0.4)), 2)
  .where(droughtProb.gt(0.4).and(droughtProb.lte(0.6)), 3)
  .where(droughtProb.gt(0.6).and(droughtProb.lte(0.8)), 4)
  .where(droughtProb.gt(0.8).and(droughtProb.lte(1.0)), 5)
  .updateMask(droughtProb.mask())
  .clip(roi)
  .rename('risk5')
  .selfMask();


// ------------------------------
// 15. MAP DISPLAY
// ------------------------------
var probPalette = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'];

map.addLayer(
  droughtProb,
  {min: 0, max: 1, palette: probPalette},
  'Drought Probability',
  true
);

map.addLayer(
  droughtClass,
  {min: 0, max: 1, palette: ['#008000', '#ff0000']},
  'Binary Drought Class',
  false
);

map.addLayer(
  droughtRisk5,
  {min: 1, max: 5, palette: probPalette},
  '5 Class Risk',
  false
);


// ------------------------------
// 16. LEGENDS
// ------------------------------
function addLegendRow(panel, color, name) {
  var colorBox = ui.Label('', {
    backgroundColor: color,
    padding: '8px',
    margin: '0 0 4px 0'
  });

  var desc = ui.Label(name, {
    margin: '0 0 4px 6px'
  });

  panel.add(ui.Panel([colorBox, desc], ui.Panel.Layout.Flow('horizontal')));
}

// Binary legend
bottomLeftLegend.clear();
bottomLeftLegend.add(ui.Label({
  value: 'Binary Class Legend',
  style: {fontWeight: 'bold', fontSize: '14px'}
}));
addLegendRow(bottomLeftLegend, '#008000', '0 = Low / Non-Drought');
addLegendRow(bottomLeftLegend, '#ff0000', '1 = Drought');

// Probability / 5-class legend
bottomRightLegend.clear();
bottomRightLegend.add(ui.Label({
  value: 'Probability / 5-Class Legend',
  style: {fontWeight: 'bold', fontSize: '14px'}
}));

var gradient = ui.Thumbnail({
  image: ee.Image.pixelLonLat().select('latitude'),
  params: {
    bbox: [0, 0, 1, 0.1],
    dimensions: '220x20',
    format: 'png',
    min: 0,
    max: 1,
    palette: probPalette
  },
  style: {
    stretch: 'horizontal',
    margin: '8px 0px',
    maxHeight: '20px'
  }
});

bottomRightLegend.add(ui.Label('Probability scale', {fontWeight: 'bold'}));
bottomRightLegend.add(gradient);
bottomRightLegend.add(
  ui.Panel([
    ui.Label('0.0'),
    ui.Label('0.5', {stretch: 'horizontal', textAlign: 'center'}),
    ui.Label('1.0')
  ], ui.Panel.Layout.Flow('horizontal'))
);

bottomRightLegend.add(ui.Label('5-Class Risk', {
  fontWeight: 'bold',
  margin: '8px 0 4px 0'
}));
addLegendRow(bottomRightLegend, '#1a9850', '1 = Very Low');
addLegendRow(bottomRightLegend, '#91cf60', '2 = Low');
addLegendRow(bottomRightLegend, '#fee08b', '3 = Moderate');
addLegendRow(bottomRightLegend, '#fc8d59', '4 = High');
addLegendRow(bottomRightLegend, '#d73027', '5 = Very High');


// ------------------------------
// 17. ANNUAL DOR CHART
// ------------------------------
var years = ee.List.sequence(2014, 2024);

var annualFc = ee.FeatureCollection(years.map(function(y) {
  y = ee.Number(y);

  var yearly = climate.filter(ee.Filter.calendarRange(y, y, 'year'));

  var droughtOccurrenceRate = yearly.map(function(img) {
    return img.select('pdsi').multiply(0.01).lt(-2).rename('drought');
  }).mean();

  var val = droughtOccurrenceRate.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi,
    scale: 10000,
    maxPixels: 1e13
  }).get('drought');

  return ee.Feature(null, {
    year: y,
    dor: val
  });
}));

var annualChart = ui.Chart.feature.byFeature(
  annualFc, 'year', ['dor']
).setChartType('LineChart')
 .setOptions({
   title: 'Annual Drought Occurrence Rate (2014–2024)',
   titleTextStyle: {
     fontSize: 16,
     bold: true
   },
   hAxis: {
     title: 'Year',
     gridlines: {count: 6},
     textStyle: {fontSize: 11}
   },
   vAxis: {
     title: 'Drought Occurrence Rate',
     viewWindow: {min: 0, max: 1},
     gridlines: {count: 5},
     textStyle: {fontSize: 11}
   },
   lineWidth: 3,
   pointSize: 6,
   colors: ['#edf163'],
   backgroundColor: 'transparent',
   chartArea: {width: '85%', height: '70%'},
   legend: {position: 'none'}
 });

leftPanel.add(annualChart);


// ------------------------------
// 18. MONTHLY DOR CHART
// ------------------------------
var months = ee.List.sequence(1, 12);

var monthlyFc = ee.FeatureCollection(months.map(function(m) {
  m = ee.Number(m);

  var monthly = climate.filter(ee.Filter.calendarRange(m, m, 'month'));

  var droughtOccurrenceRate = monthly.map(function(img) {
    return img.select('pdsi').multiply(0.01).lt(-2).rename('drought');
  }).mean();

  var val = droughtOccurrenceRate.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi,
    scale: 10000,
    maxPixels: 1e13
  }).get('drought');

  return ee.Feature(null, {
    month: m,
    dor: val
  });
}));

var monthlyChart = ui.Chart.feature.byFeature(
  monthlyFc, 'month', ['dor']
).setChartType('ColumnChart')
 .setOptions({
   title: 'Mean Monthly Drought Occurrence Rate',
   titleTextStyle: {
     fontSize: 16,
     bold: true
   },
   hAxis: {
     title: 'Month',
     gridlines: {count: 12},
     textStyle: {fontSize: 11}
   },
   vAxis: {
     title: 'Drought Occurrence Rate',
     viewWindow: {min: 0, max: 1},
     gridlines: {count: 5},
     textStyle: {fontSize: 11}
   },
   colors: ['#68472c'],
   backgroundColor: 'transparent',
   chartArea: {width: '85%', height: '70%'},
   legend: {position: 'none'}
 });
 
leftPanel.add(ui.Label(''));
leftPanel.add(monthlyChart);


// ------------------------------
// 19. AREA COVERAGE PIE CHART
// ------------------------------
var areaImage = ee.Image.pixelArea().divide(1e6).addBands(droughtRisk5);

var areaStats = areaImage.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: 'class'
  }),
  geometry: roi,
  scale: 10000,
  maxPixels: 1e13
});

var groups = ee.List(areaStats.get('groups'));

var areaFc = ee.FeatureCollection(groups.map(function(item) {
  item = ee.Dictionary(item);

  var cls = ee.Number(item.get('class'));
  var area = ee.Number(item.get('sum'));

  var label = ee.String(
    ee.Algorithms.If(cls.eq(1), 'Very Low',
    ee.Algorithms.If(cls.eq(2), 'Low',
    ee.Algorithms.If(cls.eq(3), 'Moderate',
    ee.Algorithms.If(cls.eq(4), 'High', 'Very High'))))
  );

  return ee.Feature(null, {
    class_name: label,
    area_sqkm: area
  });
}));

print('Area coverage table:', areaFc);

var pieChart = ui.Chart.feature.byFeature(
  areaFc,
  'class_name',
  ['area_sqkm']
).setChartType('PieChart')
 .setOptions({
   title: 'Area Coverage by Risk Class',
   is3D: true,
   sliceVisibilityThreshold: 0
 });

rightPanel.add(pieChart);


// ------------------------------
// 20. MAP NOTE
// ------------------------------
leftPanel.add(ui.Label({
  value: 'Charts show the Drought Occurrence Rate derived from monthly PDSI values (PDSI < -2) for the period 2014–2024.',
  style: {
    margin: '10px 0 0 0',
    fontSize: '12px',
    color: '444444'
  }
}));


// ------------------------------
// 21. MODEL PERFORMANCE TO CONSOLE
// ------------------------------
print('================ MODEL PERFORMANCE ================');
print('Training samples:', trainSet.size());
print('Testing samples:', testSet.size());
print('Confusion Matrix:', confusionMatrix);
print('Overall Accuracy:', oa);
print('Kappa:', kappa);
print('ROC-AUC:', auc);
print('ROC Curve:', rocChart);

var rocChart = ui.Chart.feature.byFeature(
  rocFc.sort('FPR'),
  'FPR',
  ['TPR']
).setChartType('LineChart')
 .setOptions({
   title: 'ROC Curve',
   titleTextStyle: {
     fontSize: 16,
     bold: true
   },
   hAxis: {
     title: 'False Positive Rate',
     viewWindow: {min: 0, max: 1},
     gridlines: {count: 6},
     textStyle: {fontSize: 11}
   },
   vAxis: {
     title: 'True Positive Rate',
     viewWindow: {min: 0, max: 1},
     gridlines: {count: 6},
     textStyle: {fontSize: 11}
   },
   lineWidth: 3,
   pointSize: 5,
   colors: ['#fdae0b'],
   backgroundColor: 'transparent',
   chartArea: {width: '85%', height: '70%'},
   legend: {position: 'none'}
 });
print('===================================================');


// ------------------------------
// 22. SHOW MAP
// ------------------------------
ui.root.add(map);