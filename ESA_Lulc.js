// Define AOI
var aoi = table;

// Load ESA WorldCover 2020
var lulc = ee.ImageCollection("ESA/WorldCover/v200")
             .filterDate('2021-01-01', '2021-12-31')
             .first()
             .clip(aoi);

// Visualization parameters
var visParams = {
  min: 10,
  max: 80,
  palette: ['006400', '7FFF00', '7FFFD4', '0000FF', '8A2BE2', 'A52A2A',  'FF7F50','a9a994']
};

// Add LULC layer
Map.centerObject(aoi, 10);
Map.addLayer(lulc, visParams, 'Clipped ESA LULC');

// Create legend
var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px'
  }
});

// Legend title
legend.add(ui.Label({
  value: 'ESA WorldCover Legend',
  style: {
    fontWeight: 'bold',
    fontSize: '16px',
    margin: '0 0 4px 0'
  }
}));

// Land cover classes and colors
var classNames = [
  'Tree cover',
  'Shrubland',
  'Grassland',
  'Cropland',
  'Built-up',
  'Bare / Sparse vegetation',
  'Permanent Water Bodies',
  
];

var classColors = [
  '006400', '7FFF00', '7FFFD4', '0000FF', '8A2BE2',  'A52A2A',  'FF7F50', 'a9a994'
];

// Add legend entries
for (var i = 0; i < classNames.length; i++) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: '#' + classColors[i],
      padding: '8px',
      margin: '0 0 4px 0'
    }
  });

  var description = ui.Label({
    value: classNames[i],
    style: { margin: '0 0 4px 6px' }
  });

  var row = ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow('horizontal')
  });

  legend.add(row);
}

// Add legend to map
Map.add(legend);

Export.image.toDrive({
  image: lulc.clip(aoi),
  description: 'ESA_LULC_Clipped',
  folder: 'Suitability Map of Ponds',
  fileNamePrefix: 'ESA_LULC',
  region: aoi,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

