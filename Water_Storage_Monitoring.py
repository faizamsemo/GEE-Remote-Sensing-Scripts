Global Surface Water Storage Monitoring & Anomaly Detection using GRACE 
Dataset in GEE Python.txt
# Global Surface Water Storage Monitoring & Anomaly Detection using GRACE 
Dataset in GEE Python

# 1. Core imports and small install
import ee # imports the Google Earth Engine Python 
client library
import geemap # imports geemap, a wrapper to display 
interactive maps
import xarray as xr # imports xarray, a library for labeled 
multi-dimensional array (great for time/lat/lon data)
!pip install --quiet xee
import xee # xarray + xee to convert a server-side 
ImageCollection into a local xarray. Dataset for plotting/analysis
import matplotlib.pyplot as plt

# 2. Earth Engine Authentication & Initialization
ee.Authenticate() # Authenticates your session so code can call 
the EE servers.
ee.Initialize(
 project='ee-terraspatial82u',
 opt_url='https://earthengine-highvolume.googleapis.com' # used when you 
expect larger data transfers from EE
)
# 3. Create an Interactive Map Setup
viz_map = geemap.Map(basemap='SATELLITE')
viz_map

# 4. Capture the last drawn feature on the map as the region of interest 
(ROI)
draw_region = viz_map.draw_last_feature.geometry()
draw_region

# 5. Extract Country Boundary Polygon for Selected Point or ROI
target_country = (
 ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
 .filterBounds(draw_region)
 .geometry()
)
viz_map.addLayer(target_country, {}, 'Selected Country')

# 6. Import Monthly Mass Grids Version 04 - Global Mascon Dataset & Apply 
Preprocessing
grace_series = (
 ee.ImageCollection("NASA/GRACE/MASS_GRIDS_V04/MASCON_CRI")
 .filterDate('2003-01-01', '2024-01-01')
 .select("lwe_thickness")
 .map(lambda img: img.clip(target_country)
 .copyProperties(img, img.propertyNames()))
)
grace_series

# 7. Convert the Earth Engine ImageCollection (GRACE Collection) to an xarray 
Dataset using xarray+ee engine
# Will convert the Earth Engine collection to a local xarray.Dataset for easy 
time-series operations and plotting.
xr_set = xr.open_dataset(
 grace_series,
 engine='ee',
 crs='EPSG:4326',
 geometry=target_country,
 scale=1
)
# Uses xarray’s open_dataset with engine 'ee' (provided by xee) 
# to convert the Earth Engine ImageCollection s2_tc into an xarray.Dataset. 
# This pulls pixel values from the server into memory as labeled arrays 
# with coordinates (time, lat, lon) or (time, y, x) depending on engine 
behavior.

# 8. Ensure time is sorted 
xr_set = xr_set.sortby('time')
# xr_ds.sortby('time') sorts the dataset along the time coordinate so the 
time dimension is in chronological order.

# 9. Calculate Monthly Mean Calculation
monthly_stack = xr_set.groupby("time.month").mean("time")
monthly_stack
monthly_stack.lwe_thickness.plot.contourf(
 x='lon',
 y='lat',
 col='month',
 cmap='turbo_r',
 robust=True,
 col_wrap=4,
 levels=22
)

# 10. Calculate Annual Mean Calculation
yearly_stack = xr_set.resample(time='Y').mean("time")
yearly_stack
yearly_stack.lwe_thickness.plot.contourf(
 x='lon',
 y='lat',
 col='time', # create separate columns/panels for each 
month/time step
 robust=True, # scales colors by robust percentiles (less 
sensitive to outliers).
 cmap='turbo_r', # chooses the colormap (turbo_r is turbo 
reversed). You can change it.
 col_wrap=5, # col_wrap=5 — wrap facets so there are at 
most 6 panels per row (useful for many months).
 levels=22 # sets the number of contour levels for the 
filled contour

# 11. Calculate Water Storage Anomaly Computation
long_term_avg = yearly_stack.mean('time')
storage_anomaly = yearly_stack - long_term_avg
storage_anomaly.lwe_thickness.plot.contourf(
 x='lon',
 y='lat',
 col='time', # create separate columns/panels for each 
month/time step
 col_wrap=5, # col_wrap=5 — wrap facets so there are at 
most 6 panels per row (useful for many months).
 cmap='turbo_r', # chooses the colormap (turbo_r is turbo 
reversed). You can change it.
 robust=True, # scales colors by robust percentiles (less 
sensitive to outliers).
 levels=22 # sets the number of contour levels for the 
filled contour 
)

# 12. Save anomaly figure
plt.savefig("grace_storage_anomaly.png", dpi=350, bbox_inches="tight")
print("Water storage anomaly map saved successfully!")
# 13. Time series Plot Mean LWE Thickness Over Time
time_series = xr_set['lwe_thickness'].mean(dim=['lat', 'lon'])
plt.figure(figsize=(12, 6))
time_series.plot(marker='o', linestyle='-')
plt.title('Mean LWE Thickness Over Time')
plt.xlabel('Date')
plt.ylabel('LWE Thickness (cm)')
plt.grid(True)
plt.tight_layout()
plt.show()