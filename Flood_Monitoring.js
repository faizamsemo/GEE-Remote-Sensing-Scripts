// Load the Bihar region using your custom polygon asset
var roi = table;

// Load Sentinel-1 SAR Image Collection (VV polarization) and clip to Bihar directly
var sentinel1 = ee.ImageCollection('COPERNICUS/S1_GRD')
                  .filterBounds(roi)
                  .filter(ee.Filter.eq('instrumentMode', 'IW'))
                  .filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING'))
                  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
                  .map(function(image) {
                    return image.select('VV').clip(roi);
                  });

// Create UI Elements for Date Selection
var panel = ui.Panel({style: {width: '350px'}});
panel.add(ui.Label('Analysis of Flood Using Sentinel-1, Sentinel-2, and Population in Rufiji Basin', {'fontSize': '20px', 'fontWeight': 'bold'}));
var preFloodStart = ui.Textbox({value: '2023-01-01'});
var preFloodEnd = ui.Textbox({value: '2023-01-10'});
var duringFloodStart = ui.Textbox({value: '2023-06-20'});
var duringFloodEnd = ui.Textbox({value: '2023-07-10'});

// Add Flood Dates Information
panel.add(ui.Label('Flood Events from Flood Observatory (2018 - 2021)', {},  'https://floodobservatory.colorado.edu/Archives/index.html'));
panel.add(ui.Label('2018-01-01 - 2018-03-07'));
panel.add(ui.Label('2020-10-12 - 2020-12-18'));
panel.add(ui.Label('2021-01-15 - 2021-05-21'));
panel.add(ui.Label('2022-08-07 - 2022-08-17'));
panel.add(ui.Label('2023-10-26 - 2023-12-09'));

// Add UI Elements to Map
panel.add(ui.Label('Pre-Flood Start Date (From 2018):', {'fontWeight': 'bold'}));
panel.add(preFloodStart);
panel.add(ui.Label('Pre-Flood End Date (From 2018):', {'fontWeight': 'bold'}));
panel.add(preFloodEnd);
panel.add(ui.Label('During-Flood Start Date (From 2018):', {'fontWeight': 'bold'}));
panel.add(duringFloodStart);
panel.add(ui.Label('During-Flood End Date (From 2018):', {'fontWeight': 'bold'}));
panel.add(duringFloodEnd);

// Add Credits with LinkedIn Link
panel.add(ui.Label('Credits: Faiza Msemo'));
panel.add(ui.Label('LinkedIn Profile', {}, 'https://www.linkedin.com/in/faiza-msemo-b882522b9?lipi=urn%3Ali%3Apage%3Ad_flagship3_profile_view_base_contact_details%3BZVMnrbUzSYiyeECAEZ6oCQ%3D%3D'));

// Add a Button to Apply the Date Selection
var applyButton = ui.Button('Apply Dates', function() {
  var preStart = ee.Date(preFloodStart.getValue());
  var preEnd = ee.Date(preFloodEnd.getValue());
  var duringStart = ee.Date(duringFloodStart.getValue());
  var duringEnd = ee.Date(duringFloodEnd.getValue());

  // Sentinel-1 Analysis
  var preFlood = sentinel1.filterDate(preStart, preEnd).median().clip(roi).select('VV');
  var duringFlood = sentinel1.filterDate(duringStart, duringEnd).median().clip(roi).select('VV');
  var duringFloodWater = duringFlood.lt(-13).selfMask();

  // Create the Custom RGB Composite using 1.5*VV for each band
  var rgbComposite = ee.Image.rgb(
    preFlood.multiply(1.5),   // Red: 1.5 * VV Before Flood
    duringFlood.multiply(1.5),// Green: 1.5 * VV During Flood
    duringFlood.multiply(1.5) // Blue: 1.5 * VV During Flood
  ).clip(roi);

  // Sentinel-2 False Infrared (NIR, Red, Green)
  var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
              .filterBounds(roi)
              .filterDate(preStart, duringEnd)
              .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 25))
              .map(function(image) {
                var cloudMask = image.select('SCL').neq(9).and(image.select('SCL').neq(10));
                return image.updateMask(cloudMask).clip(roi)
                        .select(['B8', 'B4', 'B3'], ['NIR', 'Red', 'Green']);
              });
  var preFloodS2 = s2.filterDate(preStart, preEnd).median();
  var duringFloodS2 = s2.filterDate(duringStart, duringEnd).median();

  // Population Data (WorldPop 2022)
  var population = ee.ImageCollection('WorldPop/GP/100m/pop')
                  .filterBounds(roi)
                  .select('population').median().clip(roi);

  Map.clear();
  Map.setOptions('SATELLITE');
  Map.centerObject(roi, 8);

  Map.addLayer(preFlood, {min: -25, max: 0, shown: false}, 'Pre-Flood VV (Sentinel-1)');
  Map.addLayer(duringFlood, {min: -25, max: 0, shown: false}, 'During-Flood VV (Sentinel-1)');
  Map.addLayer(rgbComposite, {min: [-25, -25, -25], max: [0, 0, 0], shown: false}, 'Custom RGB Composite (Sentinel-1)');

  Map.addLayer(preFloodS2, {bands: ['NIR', 'Red', 'Green'], min: 0, max: 3000, shown: false}, 'Pre-Flood (Sentinel-2)');
  Map.addLayer(duringFloodS2, {bands: ['NIR', 'Red', 'Green'], min: 0, max: 3000, shown: false}, 'During-Flood (Sentinel-2)');

  Map.addLayer(duringFloodWater, {palette: ['blue'], shown: true}, 'Flooded Area (Detected)');
  Map.addLayer(population, {min: 0, max: 300, palette: ['#d3daa7', 'green', 'yellow', 'orange', 'red'], shown: false}, 'Population (WorldPop 2022)');

});

panel.add(applyButton);
ui.root.insert(0, panel);