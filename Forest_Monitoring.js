// ================================
// 1. Load Hansen Data & Study Area
// ================================
var hansen = ee.Image("UMD/hansen/global_forest_change_2023_v1_11");

// Replace with your own shapefile
var studyArea = table;

var clipped = hansen.clip(studyArea);

var treeCover2000 = clipped.select('treecover2000');
var loss = clipped.select('loss');
var lossYear = clipped.select('lossyear');
var gain = clipped.select('gain');

var forestThreshold = 30;
var forest2000 = treeCover2000.gte(forestThreshold);
var forestLoss = forest2000.and(loss.eq(1));
var forestGain = gain.eq(1);

// Area calculation helper
var pixelArea = ee.Image.pixelArea().divide(10000);

// ========================
// 2. Map Layers
// ========================
var forest2000Vis = forest2000.updateMask(forest2000).visualize({palette: '006400'});
var forestLossVis = forestLoss.updateMask(forestLoss).visualize({palette: 'FF0000'});
var forestGainVis = forestGain.updateMask(forestGain).visualize({palette: 'F8D605'});

// ========================
// 3. UI Panels
// ========================

var title = ui.Label('🌲 Forest Change Monitoring (2000–2022)', {
  fontWeight: 'bold',
  fontSize: '20px',
  margin: '10px 5px'
});

var checkbox1 = ui.Checkbox('Show Forest 2000', true);
var checkbox2 = ui.Checkbox('Show Forest Loss', true);
var checkbox3 = ui.Checkbox('Show Forest Gain', true);

checkbox1.onChange(function(checked) {
  Map.layers().get(0).setShown(checked);
});
checkbox2.onChange(function(checked) {
  Map.layers().get(1).setShown(checked);
});
checkbox3.onChange(function(checked) {
  Map.layers().get(2).setShown(checked);
});

// Left panel
var controlPanel = ui.Panel({
  widgets: [title, checkbox1, checkbox2, checkbox3],
  style: {position: 'top-left', padding: '8px', width: '300px'}
});
ui.root.insert(0, controlPanel);

// Add map layers
Map.centerObject(studyArea, 9);
Map.addLayer(forest2000Vis, {}, 'Forest 2000');
Map.addLayer(forestLossVis, {}, 'Forest Loss');
Map.addLayer(forestGainVis, {}, 'Forest Gain');

// ========================
// 4. Time-Series Chart (Right Panel)
// ========================
var years = ee.List.sequence(1, 22);
var lossByYear = ee.FeatureCollection(
  years.map(function(y) {
    var year = ee.Number(y);
    var mask = lossYear.eq(year);
    var annualLoss = mask.multiply(pixelArea).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: studyArea,
      scale: 30,
      maxPixels: 1e13
    });
    return ee.Feature(null, {
      'year': year.add(2000),
      'loss_ha': annualLoss.get('lossyear')
    });
  })
);

var chart = ui.Chart.feature.byFeature(lossByYear, 'year', 'loss_ha')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Annual Forest Loss (ha)',
    hAxis: {title: 'Year'},
    vAxis: {title: 'Loss Area (ha)'},
    legend: {position: 'none'},
    colors: ['red']
  });

var chartPanel = ui.Panel({
  widgets: [chart],
  style: {position: 'top-right', width: '500px'}
});
ui.root.insert(1, chartPanel);

// ========================
// 5. Legend
// ========================
function makeLegendRow(color, name) {
  var colorBox = ui.Label('', {
    backgroundColor: color,
    padding: '8px',
    margin: '0 0 4px 0'
  });
  var description = ui.Label(name, {margin: '0 0 4px 6px'});
  return ui.Panel([colorBox, description], ui.Panel.Layout.Flow('horizontal'));
}

var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px'}});

legend.add(ui.Label('Legend', {fontWeight: 'bold'}));
legend.add(makeLegendRow('006400', 'Forest 2000'));
legend.add(makeLegendRow('FF0000', 'Forest Loss'));
legend.add(makeLegendRow('F8D605', 'Forest Gain'));

Map.add(legend);

// ========================
// 6. Export Options
// ========================
Export.image.toDrive({
  image: forestLoss.updateMask(forestLoss),
  description: 'Forest_Loss_Map',
  scale: 30,
  region: studyArea.geometry(),
  maxPixels: 1e13
});

Export.image.toDrive({
  image: forestGain.updateMask(forestGain),
  description: 'Forest_Gain_Map',
  scale: 30,
  region: studyArea.geometry(),
  maxPixels: 1e13
});
