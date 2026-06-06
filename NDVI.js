// Define the cloud masking function using the QA60 band
function cloudMask(image) {
  var qa = image.select('QA60');
  // Bits 10 and 11 are clouds and cirrus, respectively.
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;
  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
      .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return image.updateMask(mask);
}

// Defining the region of interest (ROI)
var roi = table;

// Set the year for NDVI analysis
var year = 2019;

// Load and process Sentinel 2A Surface Reflectance image
var S2_collection = ee.ImageCollection("COPERNICUS/S2_SR") // Use the SR collection
  .filterDate('2019-01-01', '2019-12-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
  .filterBounds(roi)
  .map(cloudMask) // Apply cloud masking
  .median()
  .clip(roi);

// Calculate NDVI: (NIR - RED) / (NIR + RED)
var ndvi = S2_collection.normalizedDifference(['B8', 'B4']).rename('NDVI');

// Classify NDVI values based on user-defined ranges
var classifiedNDVI = ndvi.expression(
  "(b('NDVI') >= 0.6) ? 3" +        // Healthy vegetation
  " : (b('NDVI') >= 0.2) ? 2" +     // Sparse vegetation
  " : (b('NDVI') >= 0) ? 1" +       // Bareland
  " : 0",                          // Water
  {}
).rename('NDVI_Class'); // Add NDVI class

// Mask NDVI values < 0
var maskedNDVI = classifiedNDVI.updateMask(ndvi.gt(-1));

// Add layers to the map
Map.centerObject(roi, 10);
Map.addLayer(ndvi, {min: 0, max: 1, palette: ['blue', 'white', 'green']}, 'NDVI 2019');
Map.addLayer(maskedNDVI, {min: 0, max: 3, palette: ['blue', '#d62a1d', '#98BF64', 'green']}, 'Classified NDVI 2019');

// Create a legend
var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px'
  }
});

// Create legend title
var legendTitle = ui.Label({
  value: 'Classified NDVI Legend',
  style: {
    fontWeight: 'bold',
    fontSize: '16px',
    margin: '0 0 4px 0',
    padding: '0'
  }
});
legend.add(legendTitle);

// Define legend categories and colors
var palette = ['blue', '#d62a1d', '#98BF64', 'green'];
var names = ['Water', 'Bareland', 'Sparse Vegetation', 'Healthy Vegetation'];

// Add each category to the legend
for (var i = 0; i < palette.length; i++) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: palette[i],
      padding: '8px',
      margin: '0 0 4px 0'
    }
  });

  var description = ui.Label({
    value: names[i],
    style: {
      margin: '0 0 4px 6px'
    }
  });

  var legendRow = ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow('horizontal')
  });

  legend.add(legendRow);
}

// Add the legend to the map
Map.add(legend);

// Export the classified NDVI result to Google Drive
Export.image.toDrive({
  image: maskedNDVI,
  description: 'NDVI_Class_2019',
  folder: 'NDVI_Analysis',
  region: roi,
  crs: 'EPSG:32737',
  scale: 10, // Sentinel-2 resolution
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});
