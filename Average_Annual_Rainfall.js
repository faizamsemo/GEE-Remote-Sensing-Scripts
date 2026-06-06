// ============================================================
// AVERAGE ANNUAL RAINFALL (CHIRPS) USING SHAPEFILE ROI
// Smooth map style for  1995–2025
// ============================================================

// ---------------------------
// 1. IMPORT YOUR SHAPEFILE
// ---------------------------
// Replace this with your imported shapefile variable from GEE Assets.
// Example after importing in Code Editor:
// var roi_fc = ee.FeatureCollection("users/your_username/your_shapefile");

// Example placeholder:
var roi_fc = table;   // use your imported shapefile variable name here
var roi = roi_fc.geometry();

Map.centerObject(roi, 9);

// ---------------------------
// 2. DEFINE PERIOD
// ---------------------------
// Exact 30 years:
var startDate = '1995-01-01';
var endDate   = '2025-12-31';

// If you really want up to 2025 inclusive, that becomes 31 years:
// var startDate = '1995-01-01';
// var endDate   = '2025-12-31';

// ---------------------------
// 3. LOAD CHIRPS DAILY
// ---------------------------
var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterBounds(roi)
  .filterDate(startDate, endDate)
  .select('precipitation');

// ---------------------------
// 4. COMPUTE TOTAL AND MEAN ANNUAL RAINFALL
// ---------------------------
var totalRain = chirps.sum();

var nYears = ee.Number(
  ee.Date(endDate).difference(ee.Date(startDate), 'year')
);

var meanAnnualRain = totalRain.divide(nYears)
  .clip(roi)
  .rename('mean_annual_rainfall');

// ---------------------------
// 5. SMOOTH FOR CARTOGRAPHIC DISPLAY
// ---------------------------
// Keep original for analysis, smooth copy for map display
var smoothRain = meanAnnualRain.convolve(
  ee.Kernel.gaussian({
    radius: 2,
    sigma: 1.5,
    units: 'pixels',
    normalize: true
  })
);

// ---------------------------
// 6. CALCULATE MIN/MAX INSIDE ROI
// ---------------------------
var stats = meanAnnualRain.reduceRegion({
  reducer: ee.Reducer.minMax(),
  geometry: roi,
  scale: 5566,
  maxPixels: 1e13
});

print('Original rainfall min/max (mm/year):', stats);

// ---------------------------
// 7. VISUALIZATION
// ---------------------------
// You can adjust min/max after checking printed stats
var vis = {
  min: 600,
  max: 1400,
  palette: [
    '#f7fbff',
    '#deebf7',
    '#c6dbef',
    '#9ecae1',
    '#6baed6',
    '#4292c6',
    '#2171b5',
    '#08519c',
    '#08306b'
  ]
};

Map.addLayer(smoothRain, vis, 'Average Annual Rainfall (Smooth)');
Map.addLayer(meanAnnualRain, vis, 'Average Annual Rainfall (Original)', false);

// ROI boundary
var outline = ee.Image().byte().paint({
  featureCollection: roi_fc,
  color: 1,
  width: 2
});
Map.addLayer(outline, {palette: ['black']}, 'ROI Boundary');

// ---------------------------
// 8. OPTIONAL: MAP TITLE
// ---------------------------
print('Average annual rainfall pattern from CHIRPS:', startDate, 'to', endDate);

// ---------------------------
// 9. EXPORT SMOOTH MAP
// ---------------------------
Export.image.toDrive({
  image: smoothRain,
  description: 'Average_Annual_Rainfall_CHIRPS_Smoothed',
  folder: 'RRWH',
  fileNamePrefix: 'avg_annual_rainfall_chirps_smooth_1995_2025',
  region: roi,
  scale: 5566,
  maxPixels: 1e13
});

// ---------------------------
// 10. EXPORT ORIGINAL MAP
// ---------------------------
Export.image.toDrive({
  image: meanAnnualRain,
  description: 'Average_Annual_Rainfall_CHIRPS_Original',
  folder: 'RRWH',
  fileNamePrefix: 'avg_annual_rainfall_chirps_original_1995_2025',
  region: roi,
  scale: 5566,
  maxPixels: 1e13
});