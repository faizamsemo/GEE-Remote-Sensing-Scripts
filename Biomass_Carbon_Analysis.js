// ==========================================
// Congo Basin — Tree Height, Biomass & Carbon Analysis (GEE)
// ==========================================
//
// Notes:
// - Height source: NASA/JPL global_forest_canopy_height_2005
// - Biomass estimate uses a simple empirical model: AGB = coeff * height^exp
//   -> This is illustrative. Replace coeff & exp with a published regional allometry if available.
// - Carbon fraction (CF) default = 0.47 (typical for woody AGB).
// - Reductions use coarse scale (500 m) to avoid timeouts for large AOI.
// ==========================================

// ------------------------
// AOI: Congo Basin countries (FAO GAUL level0)
// ------------------------
var countries = ee.FeatureCollection("FAO/GAUL/2015/level0");
var basinCountries = countries.filter(ee.Filter.inList('ADM0_NAME', [
  'Democratic Republic of the Congo',
  'Republic of the Congo',
  'Gabon',
  'Cameroon',
  'Central African Republic',
  'Equatorial Guinea'
]));

// Use geometry to avoid heavy union operations
var aoi = basinCountries.geometry();
Map.centerObject(aoi, 5);

// Load canopy height dataset (NASA/JPL, 2020)
var canopy = ee.Image("NASA/JPL/global_forest_canopy_height_2005");

// Scale values (divide by 2.5 to get meters) and clip to AOI
var canopyHeight = canopy.divide(2.5).clip(aoi).rename('height');

// Visualization parameters
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
Map.addLayer(canopyHeight, visParams, 'Canopy Height (m)');

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
var classified = canopyHeight.lt(bins[0]).multiply(0);
for (var i = 0; i < bins.length; i++) {
  var lower = (i === 0) ? 0 : bins[i-1];
  var upper = bins[i];
  var classImg = canopyHeight.gte(lower).and(canopyHeight.lt(upper)).multiply(i);
  classified = classified.where(classImg.eq(i), i);
}
// Last class (>20)
classified = classified.where(canopyHeight.gte(20), bins.length);

// Compute area per class (km²)
var areaImage = ee.Image.pixelArea().divide(1e6);
var areas = areaImage.addBands(classified).reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: 'class'
  }),
  geometry: basinCountries.geometry(),
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


// BUILD LEGEND (vertical)

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


var chartFeatures = ee.FeatureCollection(
  labels.map(function(label, i) {
    return ee.Feature(null, {
      'Range': label,
      'Area_km2': getArea(i),
      'Color': visParams.palette[i]
    });
  })
);

// Build chart
var chart = ui.Chart.feature.byFeature(chartFeatures, 'Range', 'Area_km2')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Congo Basin - Tree Canopy Area by Height Range',
    hAxis: {title: 'Height Range (m)'},
    vAxis: {title: 'Area (km²)', format: 'short'},
    legend: {position: 'none'},
    colors: visParams.palette
  });

// Add chart panel
var chartPanel = ui.Panel({style: {position: 'top-right', padding: '8px'}});
chartPanel.add(chart);
Map.add(chartPanel);


// ------------------------
// Height -> AGB (user adjustable)
// ------------------------
// Default illustrative allometry parameters:
// AGB (Mg/ha) = coeff * height^exp
// Note: those units must be consistent. Here we'll compute AGB in Mg / pixel (converted to Mg/ha afterwards).
var coeff = 0.1;    // example coefficient — REPLACE with published value for Congo if available
var exp = 2.0;      // example exponent
var carbonFraction = 0.47; // fraction of biomass that is carbon

// Compute estimated AGB per pixel (Mg / m^2). We'll produce AGB in Mg / ha then convert to Mg per pixel via pixelArea.
var agb_per_m2 = canopyHeight.expression(
  'c * pow(h, e)',
  {c: coeff, h: canopyHeight.select('height'), e: exp}
).rename('agb_m2'); // Mg per m^2 (if coeff/exponent produce Mg/m2). Interpret carefully.

// Convert to Mg per hectare for display & mapping convenience:
var agb_mgha = agb_per_m2.multiply(10000).rename('agb_Mg_per_ha'); // Mg / ha

// For mapping, we'll also create an image of AGB in Mg/ha
var agbVis = {min: 0, max: 300, palette: ['#ffffe5','#ffd59a','#ff8c6b','#e34a33','#b30000']};
Map.addLayer(agb_mgha.clip(aoi), agbVis, 'Estimated AGB (Mg/ha)');

// ------------------------
// 4) Carbon = AGB * carbonFraction
// ------------------------
var carbon_mgha = agb_mgha.multiply(carbonFraction).rename('carbon_Mg_per_ha');
var carbonVis = {min: 0, max: 140, palette: ['#f7fcf5','#c7e9c0','#74c476','#238b45','#00441b']};
Map.addLayer(carbon_mgha.clip(aoi), carbonVis, 'Estimated Carbon (Mg C / ha)');

// ------------------------
// Summary statistics (coarse reductions to avoid timeouts)
// ------------------------
var pixelArea_m2 = ee.Image.pixelArea();
var pixelArea_ha = pixelArea_m2.divide(10000); // hectares per pixel

// Compute AGB per pixel (Mg) and Carbon per pixel (Mg C)
var agb_per_pixel_Mg = agb_mgha.multiply(pixelArea_ha).rename('agb_Mg_pixel');
var carbon_per_pixel_Mg = carbon_mgha.multiply(pixelArea_ha).rename('carbon_Mg_pixel');

// Use a coarse scale for global reductions to avoid timeouts
var reduceScale = 500;  // meters

// Total AGB (Mg) across AOI
var agg = agb_per_pixel_Mg.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: aoi,
  scale: reduceScale,
  maxPixels: 1e13
});
var totalAGB_Mg = ee.Number(agg.get('agb_Mg_pixel')).divide(1e6); // convert Mg -> Tg (million Mg) or show as million Mg? adjust
// We'll print in million Mg (Mm)
var totalAGB_Mg_million = ee.Number(agg.get('agb_Mg_pixel')).divide(1e6);

// Total Carbon (Mg C)
var aggC = carbon_per_pixel_Mg.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: aoi,
  scale: reduceScale,
  maxPixels: 1e13
});
var totalC_Mg_million = ee.Number(aggC.get('carbon_Mg_pixel')).divide(1e6);

// Print summaries
print('--- Parameters used ---');
print('AGB model: AGB = coeff * height^exp', 'coeff', coeff, 'exp', exp, 'carbon fraction', carbonFraction);
print('Reduce scale (m):', reduceScale);
print('Total estimated AGB (million Mg):', totalAGB_Mg_million);
print('Total estimated Carbon (million Mg C):', totalC_Mg_million);

// ------------------------
// Area by height bins (and AGB summary per bin)
// ------------------------
var bins = [0, 5, 10, 15, 20, 25, 30, 100];
var labels = ['0-5','5-10','10-15','15-20','20-25','25-30','>30'];

// Create a classified height map using our bins (integer codes 1..n)
var heightClass = ee.Image(0).clip(aoi);
for (var i = 0; i < bins.length; i++) {
  var lower = (i === 0) ? 0 : bins[i-1];
  var upper = bins[i];
  var mask = canopyHeight.gte(lower).and(canopyHeight.lt(upper));
  heightClass = heightClass.where(mask, i+1);
}
heightClass = heightClass.where(canopyHeight.gte(30), bins.length); // last bin

// Stack area & AGB per pixel for reductions
var statsImage = pixelArea_ha.addBands(agb_per_pixel_Mg).addBands(carbon_per_pixel_Mg).addBands(heightClass.rename('hclass'));

// Reduce with group to get area & sums per class
var groups = statsImage.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 3, // index of 'hclass' band in the addBands order: 0=area_ha,1=agb,2=carbon,3=hclass
    groupName: 'class'
  }),
  geometry: aoi,
  scale: reduceScale,
  maxPixels: 1e13
});

var groupsList = ee.List(groups.get('groups'));
var binFeatures = groupsList.map(function(g){
  g = ee.Dictionary(g);
  var cls = ee.Number(g.get('class')).toInt();
  var area_ha = ee.Number(g.get('sum')); // sum corresponds to area_ha: because group applied to full stack ordering must be verified
  // NOTE: Because of the way group works we must carefully compute sums separately: safer approach is computing per-class masks
  return ee.Feature(null, {'class': cls, 'sum': g.get('sum')});
});

// Safer: compute per-bin area, agb, carbon using masks in a loop (coarse but clearer)
var binFeaturesList = [];
for (var b = 0; b < labels.length; b++) {
  (function(i){
    var lower = (i === 0) ? 0 : bins[i-1];
    var upper = bins[i];
    var mask = canopyHeight.gte(lower).and(canopyHeight.lt(upper));
    var areaSum = pixelArea_ha.updateMask(mask).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: reduceScale,
      maxPixels: 1e13
    }).get('area');
    // areaSum might be null if band name not 'area' — compute explicitly from pixelArea_ha
    var areaSumGood = pixelArea_ha.updateMask(mask).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: reduceScale,
      maxPixels: 1e13
    }).get('area');
    var agbSum = agb_per_pixel_Mg.updateMask(mask).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: reduceScale,
      maxPixels: 1e13
    }).get('agb_Mg_pixel');
    var carbonSum = carbon_per_pixel_Mg.updateMask(mask).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: reduceScale,
      maxPixels: 1e13
    }).get('carbon_Mg_pixel');

    binFeaturesList.push(ee.Feature(null, {
      'height_bin': labels[i],
      'area_ha': ee.Number(areaSumGood).divide(1),         // hectares
      'agb_Mg': ee.Number(agbSum),
      'carbon_MgC': ee.Number(carbonSum
      )
    }));
  })(b);
}

// Convert to FeatureCollection
var binFC = ee.FeatureCollection(binFeaturesList);

// Print bin table (server-side table object will display in console)
print('AGB & Carbon by height bin (some values may be null if no pixels):', binFC);

// ------------------------
// Charts: AGB distribution by bin (small summary chart)
// ------------------------
var chart = ui.Chart.feature.byFeature(binFC, 'height_bin', ['agb_Mg'])
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Estimated AGB (Mg) by Height Bin',
    hAxis: {title: 'Height bin (m)'},
    vAxis: {title: 'Total AGB (Mg)'},
    legend: {position: 'none'}
  });
print(chart);

// ------------------------
// Legends (height / agb / carbon)
// ------------------------
function makeLegend(titleText, palette, labelsLocal) {
  var legend = ui.Panel({style:{position:'bottom-right', padding:'8px 12px', backgroundColor:'rgba(255,255,255,0.9)'}});
  legend.add(ui.Label(titleText, {fontWeight:'bold', fontSize:'14px'}));
  for (var i = 0; i < labelsLocal.length; i++) {
    var colorBox = ui.Label({style:{backgroundColor: palette[i], padding:'8px', margin:'0 6px 0 0', border:'1px solid #ccc'}});
    var label = ui.Label(labelsLocal[i], {fontSize:'12px'});
    var row = ui.Panel([colorBox, label], ui.Panel.Layout.Flow('horizontal'));
    legend.add(row);
  }
  return legend;
}


var agbPalette = ['#ffffe5','#ffd59a','#ff8c6b','#e34a33','#b30000'];
var agbLabels = ['low','moderate','high','very high','extreme'];
var legend = makeLegend('Estimated AGB (Mg/ha)', agbPalette, agbLabels);
Map.add(legend);

// ------------------------
// Exports: tables to Drive
// ------------------------
// Export total summary as a small feature collection
var totals = ee.Feature(null, {
  'total_agb_Mg': agg.get('agb_Mg_pixel'),
  'total_carbon_Mg': aggC.get('carbon_Mg_pixel'),
  'coeff': coeff,
  'exp': exp,
  'carbon_fraction': carbonFraction
});
Export.table.toDrive({
  collection: ee.FeatureCollection([totals]),
  description: 'CongoBasin_AGB_Carbon_Summary',
  fileFormat: 'CSV'
});

// Export bin table
Export.table.toDrive({
  collection: binFC,
  description: 'CongoBasin_AGB_By_HeightBin',
  fileFormat: 'CSV'
});

// (Optional) Export raster AGB & Carbon as GeoTIFFs (commented out — large exports may take time)
// To enable, uncomment and adjust scale & region as needed.
// Export.image.toDrive({
//   image: agb_mgha.clip(aoi).float(),
//   description: 'CongoBasin_AGB_Mg_per_ha',
//   scale: 250,
//   region: aoi,
//   maxPixels: 1e13,
//   fileFormat: 'GeoTIFF'
// });
// Export.image.toDrive({
//   image: carbon_mgha.clip(aoi).float(),
//   description: 'CongoBasin_Carbon_Mg_per_ha',
//   scale: 250,
//   region: aoi,
//   maxPixels: 1e13,
//   fileFormat: 'GeoTIFF'
// });

// ------------------------
// Final prints / diagnostics
// ------------------------
print('Map layers: Canopy Height, Estimated AGB, Estimated Carbon');
print('Remember: AGB model here is illustrative. Replace coeff & exp with published regional model for accurate biomass estimates.');

var snazzy = require("users/aazuspan/snazzy:styles");
snazzy.addStyle("https://snazzymaps.com/style/15/subtle-grayscale", "Greyscale");

