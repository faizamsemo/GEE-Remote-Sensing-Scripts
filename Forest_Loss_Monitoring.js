// ==========================================
// 🌍 FOREST MONITORING DASHBOARD (OPTIMIZED)
// AOI: Congo Basin
// ==========================================

// 1. Load country boundaries (FAO GAUL dataset)
var countries = ee.FeatureCollection("FAO/GAUL/2015/level0");

// 2. Select countries in the Congo Basin
var basinCountries = countries.filter(ee.Filter.inList('ADM0_NAME', 
  ['Democratic Republic of the Congo', 
   'Republic of the Congo', 
   'Gabon', 
   'Cameroon', 
   'Central African Republic', 
   'Equatorial Guinea']
));

// 3. Merge into single AOI (geometry to avoid heavy union)
var aoi = basinCountries.geometry();

// ==========================================
// CANOPY HEIGHT (NASA/JPL 2005)
// ==========================================
var canopy = ee.Image("NASA/JPL/global_forest_canopy_height_2005");

// Convert to meters (scaled by 2.5)
var actualHeight = canopy.divide(2.5).clip(aoi).rename('height');

// Visualization parameters
var canopyVis = {
  min: 0, max: 20,
  palette: ['#000000','#1a0033','#f8d572','#004d66','#006666','#009966','#33cc66','#66ff33']
};
Map.addLayer(actualHeight, canopyVis, 'Canopy Height (m)');

// ==========================================
// HANSEN TREE COVER DATA
// ==========================================
var hansen = ee.Image("UMD/hansen/global_forest_change_2024_v1_12");
var treecover = hansen.select('treecover2000').clip(aoi);

var treeVis = {
  min: 0, max: 100,
  palette: ['#d9f0a3','#addd8e','#78c679','#31a354','#006837']
};
Map.addLayer(treecover, treeVis, 'Tree Cover Density (%)');

// Forest loss
var loss = hansen.select('loss').clip(aoi);
Map.addLayer(loss.updateMask(loss), {palette:'red'}, 'Forest Loss (2001-2024)');

// ==========================================
// MAP TITLE
// ==========================================
var title = ui.Label({
  value: '🌳 Congo Basin - Tree Canopy Height, Cover Density & Loss Analysis',
  style: {
    position: 'top-center',
    fontWeight: 'bold',
    fontSize: '20px',
    color: '#000000',
    textAlign: 'center',
    stretch: 'horizontal'
  }
});
Map.add(title);

// ==========================================
// CANOPY HEIGHT AREA CALCULATION (Bins)
// ==========================================
var bins = [0, 2, 5, 8, 12, 15, 18, 20];
var labels = ['0–2 m','2–5 m','5–8 m','8–12 m','12–15 m','15–18 m','18–20 m','>20 m'];

// Classify canopy into bins
var classified = ee.Image(0).clip(aoi);
for (var i = 0; i < bins.length; i++) {
  var lower = (i === 0) ? 0 : bins[i-1];
  var upper = bins[i];
  var classImg = actualHeight.gte(lower).and(actualHeight.lt(upper)).multiply(i+1);
  classified = classified.where(classImg, i+1);
}
classified = classified.where(actualHeight.gte(20), bins.length+1);

// Area image
var areaImage = ee.Image.pixelArea().divide(1e6); // km²

// Reduce region: area per class (use scale 500 for optimization)
var areas = areaImage.addBands(classified).reduceRegion({
  reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'class'}),
  geometry: aoi,
  scale: 500,
  maxPixels: 1e13
});

var groups = ee.List(areas.get('groups'));
var areaDict = ee.Dictionary(
  groups.map(function(g) {
    g = ee.Dictionary(g);
    return [ee.Number(g.get('class')).format(), g.get('sum')];
  }).flatten()
);

function getArea(index) {
  return ee.Number(areaDict.get(ee.Number(index).format(), 0));
}

// ==========================================
// LEGEND WITH AREA VALUES
// ==========================================
var canopyLegend = ui.Panel({
  style:{position:'bottom-left', padding:'8px 15px', backgroundColor:'rgba(255,255,255,0.9)'}
});
canopyLegend.add(ui.Label('Tree Canopy Height (m)', {fontWeight:'bold', fontSize:'14px'}));

for (var i=0; i<labels.length; i++) {
  var row = ui.Panel({layout: ui.Panel.Layout.Flow('horizontal')});
  row.add(ui.Label({style:{backgroundColor: canopyVis.palette[i], padding:'8px', margin:'0 6px 0 0', border:'1px solid #ccc'}}));
  var areaText = labels[i] + ' : ' + getArea(i+1).format('%.2f').getInfo() + ' km²';
  row.add(ui.Label(areaText, {fontSize:'12px'}));
  canopyLegend.add(row);
}
Map.add(canopyLegend);

// ==========================================
// LEGEND TREE COVER DENSITY (%)
// ==========================================
var densityLegend = ui.Panel({
  style:{position:'bottom-right', padding:'8px 15px', backgroundColor:'rgba(255,255,255,0.9)'}
});
densityLegend.add(ui.Label('Tree Cover Density (%)', {fontWeight:'bold', fontSize:'14px'}));

var densityLabels = ['0–20','20–40','40–60','60–80','80–100'];
for (var j=0; j<treeVis.palette.length; j++) {
  var row2 = ui.Panel({layout: ui.Panel.Layout.Flow('horizontal')});
  row2.add(ui.Label({style:{backgroundColor: treeVis.palette[j], padding:'8px', margin:'0 6px 0 0', border:'1px solid #ccc'}}));
  row2.add(ui.Label(densityLabels[j] + ' %', {fontSize:'12px'}));
  densityLegend.add(row2);
}
Map.add(densityLegend);

// ==========================================
// LEGEND FOREST LOSS
// ==========================================
var lossLegend = ui.Panel({
  style:{position:'bottom-center', padding:'8px 15px', backgroundColor:'rgba(255,255,255,0.9)'}
});
lossLegend.add(ui.Label('Forest Loss (2001–2024)', {fontWeight:'bold', fontSize:'14px'}));

var lossRow = ui.Panel({layout: ui.Panel.Layout.Flow('horizontal')});
lossRow.add(ui.Label({style:{backgroundColor: 'red', padding:'8px', margin:'0 6px 0 0', border:'1px solid #ccc'}}));
lossRow.add(ui.Label('Tree Cover Loss', {fontSize:'12px'}));
lossLegend.add(lossRow);
Map.add(lossLegend);

// ==========================================
// CHART: CANOPY HEIGHT AREA BY RANGE
// ==========================================
var chartFeatures = ee.FeatureCollection(
  labels.map(function(label, i) {
    return ee.Feature(null, {'Range': label, 'Area_km2': getArea(i+1)});
  })
);

var chart = ui.Chart.feature.byFeature(chartFeatures, 'Range', 'Area_km2')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Congo Basin - Tree Canopy Area by Height Range',
    hAxis: {title: 'Height Range (m)'},
    vAxis: {title: 'Area (km²)', format: 'short'},
    legend: {position: 'none'},
    colors: canopyVis.palette
  });
print(chart);

// ==========================================
// YEARLY FOREST LOSS TIME SERIES
// ==========================================
var years = ee.List.sequence(2001, 2024);
var lossYear = hansen.select('lossyear').clip(aoi);

var yearlyLoss = years.map(function(y){
  var singleYear = lossYear.eq(ee.Number(y).subtract(2000));
  var area = singleYear.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: aoi,
    scale: 500,
    maxPixels: 1e13
  }).get('lossyear');
  return ee.Feature(null, {'year': y, 'loss': ee.Number(area).divide(1e6)});
});
var lossFC = ee.FeatureCollection(yearlyLoss);

var lossChart = ui.Chart.feature.byFeature(lossFC, 'year', 'loss')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Forest Loss Over Time (2001–2024)',
    hAxis: {title: 'Year'},
    vAxis: {title: 'Loss Area (sq.km)'},
    colors: ['red']
});
print(lossChart);

// ==========================================
// LOSS VS CANOPY HEIGHT COMPARISON
// ==========================================

// Mask canopy with loss
var lossHeight = actualHeight.updateMask(loss);

// Classify loss canopy into bins
var lossClassified = ee.Image(0).clip(aoi);
for (var i = 0; i < bins.length; i++) {
  var lower = (i === 0) ? 0 : bins[i-1];
  var upper = bins[i];
  var classImg = lossHeight.gte(lower).and(lossHeight.lt(upper)).multiply(i+1);
  lossClassified = lossClassified.where(classImg, i+1);
}
lossClassified = lossClassified.where(lossHeight.gte(20), bins.length+1);

// Area lost per class
var lossAreas = areaImage.addBands(lossClassified).reduceRegion({
  reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'class'}),
  geometry: aoi,
  scale: 500,
  maxPixels: 1e13
});

var lossGroups = ee.List(lossAreas.get('groups'));
var lossDict = ee.Dictionary(
  lossGroups.map(function(g) {
    g = ee.Dictionary(g);
    return [ee.Number(g.get('class')).format(), g.get('sum')];
  }).flatten()
);

function getLoss(index) {
  return ee.Number(lossDict.get(ee.Number(index).format(), 0));
}

// Comparison chart
var compFeatures = ee.FeatureCollection(
  labels.map(function(label, i) {
    return ee.Feature(null, {
      'Range': label,
      'Total_Area_km2': getArea(i+1),
      'Loss_Area_km2': getLoss(i+1)
    });
  })
);

var compChart = ui.Chart.feature.byFeature(compFeatures, 'Range', ['Total_Area_km2','Loss_Area_km2'])
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Canopy Height vs. Forest Loss (2001–2024)',
    hAxis: {title: 'Height Range (m)'},
    vAxis: {title: 'Area (km²)', format: 'short'},
    colors: ['#33cc66','red'],
    series: {0:{targetAxisIndex:0},1:{targetAxisIndex:0}}
  });
print(compChart);

// ==========================================
// EXPORT RESULTS
// ==========================================

// Export canopy height areas
Export.table.toDrive({
  collection: chartFeatures,
  description: 'CongoBasin_CanopyHeight_Areas',
  fileFormat: 'CSV'
});

// Export yearly forest loss
Export.table.toDrive({
  collection: lossFC,
  description: 'CongoBasin_YearlyForestLoss',
  fileFormat: 'CSV'
});

// Export canopy vs loss comparison
Export.table.toDrive({
  collection: compFeatures,
  description: 'CongoBasin_CanopyVsLoss',
  fileFormat: 'CSV'
});

// ==========================================
// OPTIONAL: ADD CUSTOM MAP STYLE
// ==========================================
var snazzy = require("users/aazuspan/snazzy:styles");
snazzy.addStyle("https://snazzymaps.com/style/15/subtle-grayscale", "Greyscale");
