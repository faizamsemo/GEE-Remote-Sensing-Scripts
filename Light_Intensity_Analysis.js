// 1.Import DMSP-OLS Dataset
var dataset = ee.ImageCollection("NOAA/DMSP-OLS/NIGHTTIME_LIGHTS")
  .select('stable_lights')
  .map(function(img){
    return img.set('year', img.date().get('year'));
  });

// 2.Define years to visualize
var years = [1992, 1997, 2002, 2007, 2012]; 

// 3.Visualization Style
var style = {
  bands: ['stable_lights'],
  min: 0,
  max: 63,
  palette: ['black', 'white', 'orange', 'yellow', 'red']
};

// 4. Add Layers Year by Year 
years.forEach(function(year){
  var image = dataset
    .filter(ee.Filter.eq('year', year));
  Map.addLayer(image, style, 'DMSP-OLS - YEAR: ' + year);
});

// 5. Add Title
var title = ui.Label({
  value: 'Night Time Lights Intensity',
  style: {
    fontWeight: 'bold',
    fontSize: '20px',
    margin: '10px 5px'
  }
});

var panel = ui.Panel({
  widgets: [title],
  style: {position: 'top-center'}
});

Map.add(panel);

// 6. Create Legend with Radiance Values
var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px'
  }
});

legend.add(ui.Label({
  value: 'Light Intensity (Radiance Value)',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 6px 0'}
}));

var makeRow = function(color, label) {
  var colorBox = ui.Label('', {
    backgroundColor: color,
    padding: '8px',
    margin: '0 0 4px 0'
  });

  var description = ui.Label(label, {margin: '0 0 4px 6px'});
  return ui.Panel([colorBox, description], ui.Panel.Layout.Flow('horizontal'));
};

// 7. Updated labels with radiance value ranges
var palette = ['black', 'white', 'orange', 'yellow', 'red'];
var labels = [
  'No light (0)',
  'Low (1–15)',
  'Medium (16–30)',
  'High (31–47)',
  'Very High (48–63)'
];

for (var i = 0; i < palette.length; i++) {
  legend.add(makeRow(palette[i], labels[i]));
}

Map.add(legend);
