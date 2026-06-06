// Define Region of Interest
var roi = table;
Map.centerObject(roi,8);

// Filter the collection for the VV product from the descending track
var collectionVV = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterDate('2023-10-01','2023-11-30')
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
    .filterBounds(roi)
    .select(['VV']);
print(collectionVV);

// Filter the collection for the VH product from the descending track
var collectionVH = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterDate('2023-10-01','2023-11-30')
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
    .filterBounds(roi)
    .select(['VH']);
print(collectionVH);
//Use the median reducer to obtain the median pixel value across the all years for each pixel.
var VV = collectionVV.median();
// Adding the VV layer to the map(Plot the median pixel values to the map view. Adjust the min and max visualisation parameters according to your chosen scene - us the inspectors to help you establish the value range.)
Map.addLayer(VV.clip(roi), {min: -14, max: -7}, 'VV');
//Calculate the VH layer and add it
var VH = collectionVH.median();
Map.addLayer(VH.clip(roi), {min: -20, max: -7}, 'VH');


// Import Sentinel-1 collection
var collection = ee.ImageCollection('COPERNICUS/S1_GRD');
// Filter Sentinel-1 collection for study area, date ranges and polarization components
var sCollection = collection
//filter by aoi and time
.filterBounds(roi)
.filterDate('2023-10-01','2023-11-30')
// Filter to get images with VV and VH dual polarization
.filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
.filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
// Filter to get images collected in interferometric wide swath mode.
.filter(ee.Filter.eq('instrumentMode', 'IW'));
// Also filter based on the orbit: descending or ascending mode
var desc = sCollection.filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'));
var asc = sCollection.filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING'));
// Inspect number of tiles returned after the search; we will use the one with more tiles
print("descending tiles ",desc.size());
print("ascending tiles ",asc.size());
// Also Inspect one file
print(asc.first());

// Create a composite from means at different polarizations and look angles.
var composite = ee.Image.cat([
asc.select('VH').mean(),
asc.select('VV').mean(),
desc.select('VH').mean()
]).focal_median().clip(roi); // Adjusted scale parameter here
// Display as a composite of polarization and backscattering characteristics.
Map.addLayer(composite, {min: -12, max: -7}, 'composite');

// Create Training Data
var training_points = Bareland.merge(Builtup).merge(Cropland).merge(TreeCover).merge(Shrubland).merge(Grassland);
print(training_points);

// This property stores the land cover labels as consecutive integers starting from one.
var properties = 'class';
var Bands_selection = ['VV', 'VH',];

// Overlay
var training = composite.select(Bands_selection).sampleRegions({
  collection: training_points,
  properties: ['class'],
  scale: 10, // Adjusted scale parameter here for higher resolution
});

print(training, "training");
Export.table.toAsset({
  collection: training,
  description: 'trainingasset',
  assetId: 'trainingasset'
});

// Splits: Training (75%) & Testing samples (25%).
var Total_samples = training.randomColumn('random');
var training_samples = Total_samples.filter(ee.Filter.lessThan('random', 0.75));
print(training_samples, "Training Samples");
var validation_samples = Total_samples.filter(ee.Filter.greaterThanOrEquals('random', 0.75));
print(validation_samples, "Validation Samples");

// Random Forest Classifier
var classifier = ee.Classifier.smileRandomForest(10).train({
  features: training_samples,
  classProperty: 'class',
  inputProperties: Bands_selection
});
var classified = composite.select(Bands_selection).classify(classifier);
// Define a palette for the classification.
var palette = [
  'c2440f', // Builtup (1)
  '2a870c', // TreeCover (2)
  'bca54f', // Cropland (3)
  'c8c1a3', // Bareland (4)
  'e8ed2a', // Shrubland(5)
  '15ed09', // Grassland(6)
];
Map.addLayer(classified, { min: 1, max: 6, palette: palette }, 'classification');

// Validation Classifier
var Validation_classifier = ee.Classifier.smileRandomForest(10).train({
  features: validation_samples,
  classProperty: 'class',
  inputProperties: Bands_selection
});

var confusionMatrix = ee.ConfusionMatrix(validation_samples.classify(Validation_classifier)
  .errorMatrix({
    actual: 'class',
    predicted: 'classification'
  }));

// Accuracy Assessment
print('Confusion matrix:', confusionMatrix);
print('Overall Accuracy:', confusionMatrix.accuracy());
print('Producers Accuracy:', confusionMatrix.producersAccuracy());
print('Consumers Accuracy:', confusionMatrix.consumersAccuracy());

// Export accuracy assessment metrics to CSV
var accuracyMetrics = ee.FeatureCollection([
  ee.Feature(null, {
    'Metric': 'Overall Accuracy',
    'Value': confusionMatrix.accuracy()
  }),
  ee.Feature(null, {
    'Metric': 'Producer Accuracy',
    'Value': confusionMatrix.producersAccuracy()
  }),
  ee.Feature(null, {
    'Metric': 'Consumer Accuracy',
    'Value': confusionMatrix.consumersAccuracy()
  }),
  ee.Feature(null, {
    'Metric': 'Confusion Matrix',
    'Value': confusionMatrix.array()
  })
]);

Export.table.toDrive({
  collection: accuracyMetrics,
  description: 'Accuracy_Metrics',
  folder: 'Sentinel1_Before',
  fileFormat: 'CSV'
});

// Export the clipped classified image to Google Drive
Export.image.toDrive({
  image: classified,
  description: 'Sentinel_1B_Classified',
  folder: 'Sentinel1_Before',
  scale: 10, // Adjusted scale parameter here for higher resolution
  fileFormat: 'GeoTIFF',
  formatOptions: {
    cloudOptimized: true
  },
  region: roi,
  maxPixels: 1e12 // Increased maxPixels value
});

// Export Sentinel-1 image to Google Drive
Export.image.toDrive({
  image: composite,
  description: 'Sentinel-1B',
  folder: 'Sentinel1_Before',
  scale: 10, // Adjusted scale parameter here for higher resolution
  maxPixels: 1e12, // Increased maxPixels value
  fileFormat: 'GeoTIFF'
});

// Calculate the area in square kilometers for each class
var areaImage = ee.Image.pixelArea().divide(1e6).addBands(classified);

// Function to calculate the area for each class
function calculateArea(classValue, className) {
  var area = areaImage.select('area').updateMask(classified.eq(classValue)).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: roi,
    scale: 10, // Adjusted scale parameter here for higher resolution
    maxPixels: 1e12
  }).get('area');
  return ee.Feature(null, { 'Class': className, 'Area_km2': area });
}

// Create a feature collection with the area information
var areaFeatures = ee.FeatureCollection([
  calculateArea(1, 'Builtup'),
  calculateArea(2, 'TreeCover'),
  calculateArea(3, 'Cropland'),
  calculateArea(4, 'Bareland'),
  calculateArea(5,'Shrubland'),
  calculateArea(6,'Grassland'),
]);

print(areaFeatures, 'Area in square kilometers');

// Export the area information to CSV
Export.table.toDrive({
  collection: areaFeatures,
  description: 'Land_Cover_Area',
  folder: 'Sentinel1_Before',
  fileFormat: 'CSV'
});



