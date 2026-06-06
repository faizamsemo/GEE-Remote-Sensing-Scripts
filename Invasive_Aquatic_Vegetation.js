// ============================================================================
// MAPPING POTENTIAL INVASIVE AQUATIC VEGETATION IN WINAM GULF, LAKE VICTORIA
// Using Sentinel-2 Surface Reflectance and Google Earth Engine
// ----------------------------------------------------------------------------
// Purpose:
// This script demonstrates how Sentinel-2 imagery can be used to map potential
// floating aquatic vegetation zones in Winam Gulf / Kisumu Bay, Lake Victoria.
//
// Important note:
// This is a remote sensing demonstration. The final output should be described
// as "potential invasive aquatic vegetation zones" unless field validation is
// conducted.
// ============================================================================


// ============================================================================
// 1. DEFINE STUDY AREA: WINAM GULF / KISUMU BAY, LAKE VICTORIA
// ============================================================================

// This AOI covers Winam Gulf and Kisumu Bay, Lake Victoria, Kenya.
// It is suitable for demonstrating aquatic vegetation mapping because floating
// invasive aquatic vegetation such as water hyacinth is commonly observed in
// this part of Lake Victoria.

var aoi = ee.Geometry.Polygon([
  [
    [34.55, -0.45],
    [35.20, -0.45],
    [35.20, -0.02],
    [34.55, -0.02],
    [34.55, -0.45]
  ]
]);

Map.centerObject(aoi, 10);
Map.addLayer(aoi, {color: 'yellow'}, 'Study Area: Winam Gulf / Kisumu Bay');


// ============================================================================
// 2. ADD MAP TITLE
// ============================================================================

var title = ui.Label({
  value: 'Mapping Potential Invasive Aquatic Vegetation in Winam Gulf, Lake Victoria',
  style: {
    position: 'top-center',
    fontWeight: 'bold',
    fontSize: '20px',
    padding: '10px',
    backgroundColor: 'white',
    color: 'black'
  }
});

Map.add(title);


// ============================================================================
// 3. DEFINE ANALYSIS PERIOD
// ============================================================================

// You may adjust the dates depending on cloud cover and visibility of vegetation.
// Dry-season or relatively cloud-free periods are usually better for presentation.

var startDate = '2015-01-01';
var endDate   = '2015-12-31';


// ============================================================================
// 4. LOAD SENTINEL-2 SURFACE REFLECTANCE DATA
// ============================================================================

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate(startDate, endDate)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 5));

print('Sentinel-2 images before cloud masking:', s2.size());


// ============================================================================
// 5. CLOUD MASKING FUNCTION USING SENTINEL-2 SCL BAND
// ============================================================================

// Sentinel-2 Scene Classification Layer codes:
// 3  = Cloud shadow
// 8  = Medium probability cloud
// 9  = High probability cloud
// 10 = Thin cirrus
// 11 = Snow or ice

function maskS2Clouds(image) {
  var scl = image.select('SCL');

  var mask = scl.neq(3)
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  return image.updateMask(mask)
    .copyProperties(image, ['system:time_start']);
}


// ============================================================================
// 6. CREATE MEDIAN COMPOSITE
// ============================================================================

var composite = s2
  .map(maskS2Clouds)
  .median()
  .clip(aoi);

print('Sentinel-2 median composite:', composite);


// ============================================================================
// 7. CALCULATE SPECTRAL INDICES
// ============================================================================

// NDVI: Detects green vegetation
// Formula: (NIR - Red) / (NIR + Red)

var ndvi = composite.normalizedDifference(['B8', 'B4'])
  .rename('NDVI');

// NDWI: Highlights water and wetness
// Formula: (Green - NIR) / (Green + NIR)

var ndwi = composite.normalizedDifference(['B3', 'B8'])
  .rename('NDWI');

// MNDWI: Improved water extraction, especially near built-up or mixed areas
// Formula: (Green - SWIR1) / (Green + SWIR1)

var mndwi = composite.normalizedDifference(['B3', 'B11'])
  .rename('MNDWI');

// NDMI: Moisture index
// Formula: (NIR - SWIR1) / (NIR + SWIR1)

var ndmi = composite.normalizedDifference(['B8', 'B11'])
  .rename('NDMI');

// Red-edge NDVI: Useful for dense and aquatic vegetation detection
// Formula: (NIR - Red Edge) / (NIR + Red Edge)

var reNDVI = composite.normalizedDifference(['B8', 'B5'])
  .rename('RE_NDVI');


// ============================================================================
// 8. CREATE WATER AND VEGETATION MASKS
// ============================================================================

// Water mask:
// MNDWI is used because it often separates open water better than NDWI.

var waterMask = mndwi.gt(0.10);

// Vegetation mask:
// Floating vegetation normally has positive NDVI.

var vegetationMask = ndvi.gt(0.25);

// Potential aquatic vegetation:
// Logic: vegetation signal occurring within water or wet surface environment.

var potentialAquaticVegetation = vegetationMask
  .and(waterMask.or(ndwi.gt(0.00)))
  .selfMask()
  .rename('Potential_Aquatic_Vegetation');

// Open water without aquatic vegetation.

var openWater = waterMask
  .and(potentialAquaticVegetation.unmask(0).neq(1))
  .selfMask()
  .rename('Open_Water');


// ============================================================================
// 9. SIMPLE CLASSIFICATION
// ============================================================================

// Class values:
// 0 = Other land/background
// 1 = Open water
// 2 = Potential invasive aquatic vegetation

var classified = ee.Image(0)
  .where(openWater.unmask(0).eq(1), 1)
  .where(potentialAquaticVegetation.unmask(0).eq(1), 2)
  .clip(aoi)
  .rename('Classification');


// ============================================================================
// 10. VISUALIZATION PARAMETERS
// ============================================================================

var trueColorVis = {
  bands: ['B4', 'B3', 'B2'],
  min: 0,
  max: 3000,
  gamma: 1.2
};

var falseColorVis = {
  bands: ['B8', 'B4', 'B3'],
  min: 0,
  max: 3000,
  gamma: 1.2
};

var ndviVis = {
  min: -0.5,
  max: 0.8,
  palette: ['blue', 'white', 'green']
};

var ndwiVis = {
  min: -0.5,
  max: 0.8,
  palette: ['brown', 'white', 'blue']
};

var mndwiVis = {
  min: -0.5,
  max: 0.8,
  palette: ['brown', 'white', 'cyan']
};

var classifiedVis = {
  min: 0,
  max: 2,
  palette: [
    'd9d9d9', // Other land/background
    '1f78b4', // Open water
    'e31a1c'  // Potential invasive aquatic vegetation
  ]
};


// ============================================================================
// 11. DISPLAY MAP LAYERS
// ============================================================================

Map.addLayer(composite, trueColorVis, 'Sentinel-2 True Color');
Map.addLayer(composite, falseColorVis, 'Sentinel-2 False Color', false);
Map.addLayer(ndvi, ndviVis, 'NDVI - Vegetation Index', false);
Map.addLayer(ndwi, ndwiVis, 'NDWI - Water Index', false);
Map.addLayer(mndwi, mndwiVis, 'MNDWI - Modified Water Index', false);
Map.addLayer(ndmi, {min: -0.5, max: 0.8, palette: ['brown', 'white', 'green']}, 'NDMI - Moisture Index', false);
Map.addLayer(reNDVI, {min: -0.5, max: 0.8, palette: ['purple', 'white', 'green']}, 'Red-edge NDVI', false);

Map.addLayer(openWater, {palette: ['1f78b4']}, 'Open Water');
Map.addLayer(potentialAquaticVegetation, {palette: ['e31a1c']}, 'Potential Invasive Aquatic Vegetation');
Map.addLayer(classified, classifiedVis, 'Final Classification');


// ============================================================================
// 12. CALCULATE AREA STATISTICS IN HECTARES
// ============================================================================

// Pixel area is converted from square metres to hectares.

var areaImage = ee.Image.pixelArea()
  .divide(10000)
  .rename('Area_ha')
  .addBands(classified);

var areaStats = areaImage.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: 'Class'
  }),
  geometry: aoi,
  scale: 10,
  maxPixels: 1e13
});

print('Raw area statistics by class in hectares:', areaStats);


// ============================================================================
// 13. CREATE READABLE AREA TABLE
// ============================================================================

var classNames = ee.Dictionary({
  0: 'Other land/background',
  1: 'Open water',
  2: 'Potential invasive aquatic vegetation'
});

var groups = ee.List(areaStats.get('groups'));

var areaTable = ee.FeatureCollection(groups.map(function(item) {
  item = ee.Dictionary(item);

  var classValue = ee.Number(item.get('Class')).format();
  var areaHa = ee.Number(item.get('sum'));

  return ee.Feature(null, {
    'Class_ID': classValue,
    'Class_Name': classNames.get(classValue),
    'Area_ha': areaHa
  });
}));

print('Readable area table:', areaTable);


// ============================================================================
// 14. ADD PERCENTAGE COVERAGE TO AREA TABLE
// ============================================================================

var totalAreaHa = ee.Number(areaTable.aggregate_sum('Area_ha'));

var areaTablePercent = areaTable.map(function(feature) {
  var areaHa = ee.Number(feature.get('Area_ha'));
  var percent = areaHa.divide(totalAreaHa).multiply(100);

  return feature.set({
    'Percentage': percent
  });
});

print('Area table with percentage coverage:', areaTablePercent);
print('Total mapped area in hectares:', totalAreaHa);


// ============================================================================
// 15. CREATE 3D PIE CHART SHOWING AREA COVERAGE IN PERCENTAGE
// ============================================================================

// Note:
// Google Earth Engine uses Google Charts. The option is3D:true may render as
// a 3D-style pie chart depending on the interface. If not, the percentage
// values remain correct and can be exported for 3D chart design in Excel or
// PowerPoint.

var pieChart = ui.Chart.feature.byFeature({
  features: areaTablePercent,
  xProperty: 'Class_Name',
  yProperties: ['Percentage']
})
.setChartType('PieChart')
.setOptions({
  title: 'Area Coverage by Class (%)',
  is3D: true,
  pieSliceText: 'percentage',
  slices: {
    0: {color: '#d9d9d9'},
    1: {color: '#1f78b4'},
    2: {color: '#e31a1c'}
  },
  legend: {
    position: 'right'
  },
  chartArea: {
    width: '85%',
    height: '80%'
  },
  fontSize: 12
});

print(pieChart);


// ============================================================================
// 16. CREATE COLUMN CHART SHOWING AREA IN HECTARES
// ============================================================================

var areaChart = ui.Chart.feature.byFeature({
  features: areaTablePercent,
  xProperty: 'Class_Name',
  yProperties: ['Area_ha']
})
.setChartType('ColumnChart')
.setOptions({
  title: 'Mapped Area by Class in Hectares',
  hAxis: {
    title: 'Class'
  },
  vAxis: {
    title: 'Area in hectares'
  },
  legend: {
    position: 'none'
  },
  fontSize: 12
});

print(areaChart);


// ============================================================================
// 17. ADD MAP LEGEND
// ============================================================================

var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px',
    backgroundColor: 'white'
  }
});

var legendTitle = ui.Label({
  value: 'Classification Legend',
  style: {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '0 0 6px 0',
    padding: '0'
  }
});

legend.add(legendTitle);

function makeLegendRow(color, name) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: color,
      padding: '8px',
      margin: '0 0 4px 0'
    }
  });

  var description = ui.Label({
    value: name,
    style: {
      margin: '0 0 4px 6px'
    }
  });

  return ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
}

legend.add(makeLegendRow('#d9d9d9', 'Other land/background'));
legend.add(makeLegendRow('#1f78b4', 'Open water'));
legend.add(makeLegendRow('#e31a1c', 'Potential invasive aquatic vegetation'));

Map.add(legend);


// ============================================================================
// 18. EXPORT FINAL CLASSIFICATION TO GOOGLE DRIVE
// ============================================================================

Export.image.toDrive({
  image: classified,
  description: 'Winam_Gulf_Potential_Aquatic_Vegetation_Classification',
  folder: 'GEE_Exports',
  fileNamePrefix: 'winam_gulf_potential_aquatic_vegetation_classification',
  region: aoi,
  scale: 10,
  maxPixels: 1e13
});


// ============================================================================
// 19. EXPORT AREA TABLE WITH PERCENTAGE COVERAGE TO GOOGLE DRIVE
// ============================================================================

Export.table.toDrive({
  collection: areaTablePercent,
  description: 'Winam_Gulf_Area_Statistics_Percentage',
  folder: 'GEE_Exports',
  fileNamePrefix: 'winam_gulf_area_statistics_percentage',
  fileFormat: 'CSV'
});


// ============================================================================
// 20. LINKEDIN INTERPRETATION NOTE
// ============================================================================

// Suggested wording for LinkedIn:
//
// This Google Earth Engine demonstration used Sentinel-2 imagery to map
// potential invasive aquatic vegetation in Winam Gulf, Lake Victoria.
// NDVI, NDWI, and MNDWI were used to separate open water from vegetation-covered
// water surfaces.
//
// The red zones represent potential aquatic vegetation, which may include
// invasive floating species such as water hyacinth. However, field validation
// is required before confirming species-level classification.
//
// This type of remote sensing workflow can support early detection, monitoring,
// and environmental management of invasive aquatic vegetation in lake and
// wetland ecosystems.
// ============================================================================