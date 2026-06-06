/************************************************************
 * ANNUAL LAND SURFACE TEMPERATURE (LST) 2013–2023
 * Dataset: MODIS/061/MOD11A1  (LST_Day_1km)
 * Output: Annual mean LST (°C), charts + trend
 ************************************************************/

// ========================= 1) AOI =============================
var aoi = table.geometry();   // <-- replace 'table' if your AOI asset has a different name
Map.centerObject(aoi, 6);

// ========================= AOI OUTLINE ============================
var aoiOutline = ee.Image().byte().paint({
  featureCollection: aoi,
  color: 1,
  width: 3    // thickness of boundary
});

Map.addLayer(
  aoiOutline,
  {palette: 'black'},
  'AOI Boundary'
);

// ========================= 2) LOAD MODIS LST ==================
var modis = ee.ImageCollection('MODIS/061/MOD11A1')
  .select('LST_Day_1km')
  .filterBounds(aoi);

// ========================= 3) SCALE FUNCTION ==================
// Convert from Kelvin*0.02 to °C
var scaleLST = function (img) {
  return img
    .multiply(0.02)          // scale factor
    .subtract(273.15)        // Kelvin to °C
    .copyProperties(img, img.propertyNames());
};

// ========================= 4) ANNUAL LST IMAGES ===============
var startYear = 2013;
var endYear   = 2023;
var years     = ee.List.sequence(startYear, endYear);

var annualLST = ee.ImageCollection(
  years.map(function (y) {
    y = ee.Number(y);

    var yearImg = modis
      .filter(ee.Filter.calendarRange(y, y, 'year'))  // all days in that year
      .map(scaleLST)
      .mean()
      .clip(aoi)
      .rename('LST');   // constant band name

    var date = ee.Date.fromYMD(y, 1, 1);

    return yearImg.set({
      'year': y,
      'system:time_start': date.millis()
    });
  })
);

// ========================= 5) ADD ANNUAL LAYERS TO MAP ========
var vis = {
  min: 15,
  max: 45,
  palette: ['blue', 'cyan', '#f6fb08', '#ffb427', 'red']
};

years.getInfo().forEach(function (y) {
  var img = annualLST.filter(ee.Filter.eq('year', y)).first();
  Map.addLayer(img, vis, 'Annual LST ' + y);
});

// ========================= 6) LEGEND ===========================
var legend = ui.Panel({
  style: {position: 'bottom-left', padding: '8px 15px'}
});

legend.add(ui.Label({
  value: 'LST (°C)',
  style: {fontWeight: 'bold', fontSize: '14px'}
}));

var palette = ['blue', 'cyan', '#f6fb08', '#ffb427', 'red'];
var labels  = ['15°C', '22°C', '28°C', '35°C', '45°C'];

for (var i = 0; i < palette.length; i++) {
  var row = ui.Panel({
    widgets: [
      ui.Label({
        style: {
          backgroundColor: palette[i],
          padding: '8px',
          margin: '0 5px 0 0'
        }
      }),
      ui.Label(labels[i])
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
  legend.add(row);
}

Map.add(legend);

// ========================= 7) MAP TITLE ========================
var title = ui.Label({
  value: 'Annual Land Surface Temperature (2013–2023)',
  style: {
    position: 'top-center',
    fontSize: '20px',
    fontWeight: 'bold',
    padding: '10px'
  }
});
Map.add(title);

// ========================= 8) ANNUAL MEAN LST TABLE ===========
var annualStats = annualLST.map(function(img) {
  var year = ee.Number(img.get('year'));
  var meanLST = img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: aoi,
    scale: 1000,
    bestEffort: true
  }).get('LST');

  return ee.Feature(null, {
    'year': year,
    'LST': meanLST
  });
});

// Optional: inspect table
print('Annual mean LST FeatureCollection:', annualStats);

// ========================= 9) BAR CHART ========================
var lstBarChart = ui.Chart.feature.byFeature({
  features: annualStats,
  xProperty: 'year',
  yProperties: ['LST']
})
.setChartType('ColumnChart')
.setOptions({
  title: 'Annual Mean LST (°C) — 2013–2023 (Bar)',
  legend: {position: 'none'},
  hAxis: {title: 'Year', format: '####'},
  vAxis: {title: 'LST (°C)'},
  colors: ['red']
});

print('Bar chart: Annual mean LST', lstBarChart);

// ========================= 10) LINE CHART + TRENDLINE ==========
var lstLineChart = ui.Chart.feature.byFeature({
  features: annualStats,
  xProperty: 'year',
  yProperties: ['LST']
})
.setChartType('LineChart')
.setOptions({
  title: 'Annual Mean LST (°C) — 2013–2023 (Line + Trendline)',
  legend: {position: 'bottom'},
  hAxis: {title: 'Year', format: '####'},
  vAxis: {title: 'LST (°C)'},
  lineWidth: 3,
  pointSize: 6,
  series: {
    0: {color: 'blue'}
  },
  trendlines: {
    0: {
      type: 'linear',
      color: 'green',
      lineWidth: 2,
      opacity: 0.7,
      visibleInLegend: true
    }
  }
});

print('Line chart with trendline: Annual mean LST', lstLineChart);

// ========================= 11) NUMERIC TREND (°C/YEAR) =========
var fit = annualStats.reduceColumns({
  reducer: ee.Reducer.linearFit(),
  selectors: ['year', 'LST']
});

print('Trend slope (°C per year):', fit.get('scale'));
print('Intercept (°C at year 0):', fit.get('offset'));

// ========================= 12) ANIMATION (GIF-STYLE) ===========
/*
 * This creates an animated thumbnail.
 * The legend panel you already added stays visible in the UI
 * while the animation runs in the Console.
 */

// Visualize each annual LST as RGB image for animation
var annualRGB = annualLST.map(function(img) {
  return img.visualize(vis)
    .set('year', img.get('year'))
    .set('system:time_start', img.get('system:time_start'));
});

// Animation parameters
var gifParams = {
  region: aoi,
  dimensions: 600,
  framesPerSecond: 1,
  crs: 'EPSG:4326'
};

// Print years order (frames follow this order)
print('Animation years (frame order):', years);

// Animated thumbnail (you can right-click → Save image as GIF)
var thumbnail = ui.Thumbnail({
  image: annualRGB,
  params: gifParams,
  style: {width: '400px'}
});

print('LST Animation 2013–2023:', thumbnail);

// export a video to Drive instead:
 Export.video.toDrive({
 collection: annualRGB,
 description: 'LST_Animation_2013_2023',
 region: aoi,
 framesPerSecond: 1,
 scale: 1000
  });
 