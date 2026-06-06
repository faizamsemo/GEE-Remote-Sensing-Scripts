// ============================================================
// POPULATION DENSITY BY POLYGON - FINAL SIMPLE VERSION
// Use only after uploading a cleaned polygon-only shapefile
// ============================================================

var admin = table;   // cleaned polygon-only shapefile
Map.centerObject(admin, 9);

var year = 2020;

var popDensity = ee.ImageCollection('CIESIN/GPWv411/GPW_Population_Density')
  .filter(ee.Filter.calendarRange(year, year, 'year'))
  .first()
  .select('population_density');

Map.addLayer(
  popDensity.clip(admin.geometry()),
  {min: 0, max: 500},
  'GPW population density',
  false
);

var densityByAdmin = popDensity.reduceRegions({
  collection: admin,
  reducer: ee.Reducer.mean(),
  scale: 1000,
  tileScale: 4,
  maxPixelsPerRegion: 1e8
}).map(function(f) {
  return f.set('pop_dens', f.get('mean'));
});

densityByAdmin = densityByAdmin.filter(ee.Filter.notNull(['pop_dens']));

var classified = densityByAdmin.map(function(f) {
  var d = ee.Number(f.get('pop_dens'));

  var cls = ee.Number(
    ee.Algorithms.If(d.lte(50), 1,
      ee.Algorithms.If(d.lte(100), 2,
        ee.Algorithms.If(d.lte(500), 3, 4)
      )
    )
  );

  return f.set('class', cls);
});

// Do not print first(), aggregate_array(), or add styled layer.
// Just export.

Export.table.toDrive({
  collection: classified,
  description: 'Population_Density_Classified_2020_SHP',
  folder: 'RRWH_Predictors',
  fileFormat: 'SHP'
});

Export.table.toDrive({
  collection: classified,
  description: 'Population_Density_Classified_2020_CSV',
  folder: 'RRWH_Predictors',
  fileFormat: 'CSV'
});