// ==========================================
// 🌳 TREE CANOPY HEIGHT OVER CONGO BASIN
// ==========================================

// 1. Load country boundaries (FAO GAUL dataset)
var countries = ee.FeatureCollection("FAO/GAUL/2015/level0");

// 2. Select countries that make up the Congo Basin
var basinCountries = countries.filter(ee.Filter.inList('ADM0_NAME', 
  ['Democratic Republic of the Congo', 
   'Republic of the Congo', 
   'Gabon', 
   'Cameroon', 
   'Central African Republic', 
   'Equatorial Guinea']
));

// 3. Merge them into a single AOI
var congoBasin = basinCountries.union();

// 4. Load canopy height dataset (NASA/JPL, 2005)
var canopy = ee.Image("NASA/JPL/global_forest_canopy_height_2005");

// 5. Scale values (divide by 2.5 to get meters) and clip to AOI
var actualHeight = canopy.divide(2.5).clip(congoBasin);

// 6. Visualization parameters
var visParams = {
  min: 0,
  max: 20,
  palette: [
    '#000000', // 0–2
    '#1a0033', // 2–5
    '#f8d572', // 5–8
    '#004d66', // 8–12
    '#006666', // 12–15
    '#009966', // 15–18
    '#33cc66', // 18–20
    '#66ff33'  // >20
  ]
};

// 7. Add canopy height layer to map
Map.centerObject(congoBasin, 5);
Map.addLayer(actualHeight, visParams, 'Congo Basin Canopy Height (m)');
Map.addLayer(congoBasin, {color: 'green'}, 'Congo Basin Boundary');

// ==========================================
// LEGEND + AREA CALCULATION
// ==========================================

// Define ranges (in meters)
var bins = [0, 2, 5, 8, 12, 15, 18, 20];
var labels = [
  '0–2 m',
  '2–5 m',
  '5–8 m',
  '8–12 m',
  '12–15 m',
  '15–18 m',
  '18–20 m',
  '>20 m'
];

// Classify canopy into bins
var classified = actualHeight.lt(bins[0]).multiply(0);
for (var i = 0; i < bins.length; i++) {
  var lower = (i === 0) ? 0 : bins[i-1];
  var upper = bins[i];
  var classImg = actualHeight.gte(lower).and(actualHeight.lt(upper)).multiply(i);
  classified = classified.where(classImg.eq(i), i);
}
// Last class (>20)
classified = classified.where(actualHeight.gte(20), bins.length);

// Compute area per class (km²)
var areaImage = ee.Image.pixelArea().divide(1e6);
var areas = areaImage.addBands(classified).reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: 'class'
  }),
  geometry: congoBasin.geometry(),
  scale: 1000,
  maxPixels: 1e13
});

// Convert groups to dictionary {class: area}
var groups = ee.List(areas.get('groups'));
var areaDict = ee.Dictionary(
  groups.map(function(g) {
    g = ee.Dictionary(g);
    return [ee.Number(g.get('class')).format(), g.get('sum')];
  }).flatten()
);

// Function to get area by class index
function getArea(index) {
  return ee.Number(areaDict.get(ee.Number(index).format(), 0));
}

// ==========================================
// LEGEND PANEL
// ==========================================
var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    maxHeight: '400px'
  }
});

legend.add(ui.Label({
  value: 'Tree Canopy Height (m)',
  style: {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '0 0 8px 0',
    textAlign: 'center'
  }
}));

// Add ranges with area
for (var i = 0; i < labels.length; i++) {
  var row = ui.Panel({
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: {margin: '0 0 4px 0'}
  });

  // Color box
  row.add(ui.Label({
    style: {
      backgroundColor: visParams.palette[i],
      padding: '8px',
      margin: '0 6px 0 0',
      border: '1px solid #ccc'
    }
  }));

  // Label with area
  var areaText = ee.String(labels[i])
    .cat(' : ')
    .cat(getArea(i).format('%.2f'))
    .cat(' km²');

  row.add(ui.Label({
    value: areaText.getInfo(),
    style: {fontSize: '12px'}
  }));

  legend.add(row);
}
Map.add(legend);

// ==========================================
// BAR CHART WITH MATCHING COLORS
// ==========================================
var chartFeatures = ee.FeatureCollection(
  labels.map(function(label, i) {
    return ee.Feature(null, {
      'Range': label,
      'Area_km2': getArea(i),
      'Color': visParams.palette[i]
    });
  })
);

// Build chart with exact legend colors
var chart = ui.Chart.feature.byFeature(chartFeatures, 'Range', 'Area_km2')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Congo Basin - Tree Canopy Area by Height Range',
    hAxis: {title: 'Height Range (m)'},
    vAxis: {title: 'Area (km²)', format: 'short'},
    legend: {position: 'none'},
    colors: visParams.palette  // 👈 ensures chart matches legend colors
  });

// Add chart panel
var chartPanel = ui.Panel({style: {position: 'top-right', padding: '8px'}});
chartPanel.add(chart);
Map.add(chartPanel);

// ==========================================
// OPTIONAL: ADD CUSTOM MAP STYLE
// ==========================================
var snazzy = require("users/aazuspan/snazzy:styles");
snazzy.addStyle("https://snazzymaps.com/style/15/subtle-grayscale", "Greyscale");
