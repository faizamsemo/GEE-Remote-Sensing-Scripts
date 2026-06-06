# ============================================================
# CROP PRODUCTIVITY PROXY ANALYSIS USING MODIS NPP PRODUCT
# MODIS MOD17A3HGF NPP + MODIS MCD12Q1 Cropland Mask
# Author: Faiza Msemo
# Platform: Google Colab
# ============================================================
# ------------------------------------------------------------
# 1. INSTALL REQUIRED PACKAGES
# ------------------------------------------------------------
!pip install -U geemap xee pymannkendall pyhomogeneity rioxarray netCDF4 -q

# ------------------------------------------------------------
# 2. IMPORT LIBRARIES
# ------------------------------------------------------------
import ee
import geemap
import xarray as xr
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import pymannkendall as mk
import pyhomogeneity as hg

# ------------------------------------------------------------
# 3. AUTHENTICATE AND INITIALIZE GOOGLE EARTH ENGINE
# ------------------------------------------------------------
ee.Authenticate()
ee.Initialize(
 project='ee-faizamsemo', # Replace with your own GEE project if needed
 opt_url='https://earthengine-highvolume.googleapis.com'
)

# ------------------------------------------------------------
# 4. CREATE INTERACTIVE MAP AND DRAW REGION OF INTEREST
# ------------------------------------------------------------
Map = geemap.Map()
Map

# ------------------------------------------------------------
# 5. GET DRAWN REGION OF INTEREST SAFELY
# ------------------------------------------------------------
# Make sure you draw a POLYGON on the map before running this cell
if Map.user_roi is not None:
 roi = Map.user_roi
else:
 roi = Map.draw_last_feature.geometry()
# Convert ROI to a valid Earth Engine geometry
roi = ee.Geometry(roi)
# Fix: Ensure roi_bounds coordinates are within [-180, 180]
# by transforming the geometry to EPSG:4326 with an error margin.
roi_bounds = roi.transform('EPSG:4326', 1).bounds()
print("ROI selected successfully.")
print(roi_bounds.getInfo())

# ------------------------------------------------------------
# 6. DEFINE ANALYSIS PERIOD
# ------------------------------------------------------------
start_year = 2001
end_year = 2025 # This means data from 2001 up to available annual MODIS data before 2025
start_date = f'{start_year}-01-01'
end_date = f'{end_year}-01-01'

# ------------------------------------------------------------
# 7. LOAD MODIS LAND COVER AND EXTRACT CROPLAND CLASS
# ------------------------------------------------------------
# MCD12Q1 LC_Type1 uses IGBP classification.
# Class 12 = Croplands.
cropland_mask = (
 ee.ImageCollection("MODIS/061/MCD12Q1")
 .filterDate(start_date, end_date)
 .select('LC_Type1')
 .map(lambda img: img.eq(12)
 .rename('cropland')
 .copyProperties(img, ['system:time_start']))
)
print("Cropland mask collection prepared.")

# ------------------------------------------------------------
# 8. LOAD MODIS ANNUAL NPP PRODUCT
# ------------------------------------------------------------
# MOD17A3HGF provides annual NPP.
# Scale factor for Npp band = 0.0001.
npp = (
 ee.ImageCollection("MODIS/061/MOD17A3HGF")
 .filterDate(start_date, end_date)
 .select('Npp')
)
print("MODIS NPP collection loaded.")

# ------------------------------------------------------------
# 9. LINK NPP WITH ANNUAL CROPLAND MASK
# ------------------------------------------------------------
# Each annual NPP image is masked using the corresponding annual cropland class.
cropland_npp = (
 npp.linkCollection(cropland_mask, 'cropland')
 .map(lambda img: img.select('Npp')
 .multiply(0.0001)
 .rename('Npp')
 .updateMask(img.select('cropland'))
 .copyProperties(img, ['system:time_start']))
)
print("Cropland NPP collection created.")
print("Number of annual images:", cropland_npp.size().getInfo())

# ------------------------------------------------------------
# 10. CALCULATE ANNUAL MEAN CROPLAND NPP USING EARTH ENGINE
# ------------------------------------------------------------
# This replaces the xarray/xee method completely.
def annual_mean_npp(img):
 year = ee.Date(img.get('system:time_start')).get('year')
 mean_dict = img.reduceRegion(
 reducer=ee.Reducer.mean(),
 geometry=roi_bounds,
 scale=500,
 maxPixels=1e13,
 bestEffort=True
 )
 return ee.Feature(None, {
 'year': year,
 'mean_cropland_npp': mean_dict.get('Npp')
 })
annual_npp_fc = cropland_npp.map(annual_mean_npp)
print("Annual mean cropland NPP feature collection created.")

# ------------------------------------------------------------
# 11. CONVERT EARTH ENGINE FEATURE COLLECTION TO PANDAS DATAFRAME
# ------------------------------------------------------------
annual_npp_list = annual_npp_fc.getInfo()['features']
records = []
for feature in annual_npp_list:
 props = feature['properties']
 records.append({
 'year': props['year'],
 'mean_cropland_npp': props['mean_cropland_npp']
 })
df = pd.DataFrame(records)
df = df.dropna()
df = df.sort_values('year').reset_index(drop=True)
print(df)

# ------------------------------------------------------------
# 12. PLOT ANNUAL MEAN CROPLAND NPP TIME SERIES
# ------------------------------------------------------------
plt.figure(figsize=(10, 5))
plt.plot(df['year'], df['mean_cropland_npp'], marker='o')
plt.xlabel('Year')
plt.ylabel('Mean Cropland NPP')
plt.title('Annual Mean Cropland NPP from MODIS')
plt.grid(True)
plt.show()
df.to_csv('annual_mean_cropland_npp.csv', index=False)
print("CSV exported: annual_mean_cropland_npp.csv")

# ------------------------------------------------------------
# 13. MANN-KENDALL TREND TEST
# ------------------------------------------------------------
npp_series = df['mean_cropland_npp'].values
mk_test = mk.original_test(npp_series)
print("MANN-KENDALL TREND TEST RESULT")
print("--------------------------------")
print("Trend:", mk_test.trend)
print("Significant trend:", mk_test.h)
print("p-value:", mk_test.p)
print("Z-score:", mk_test.z)
print("Tau:", mk_test.Tau)
print("Sen's slope:", mk_test.slope)
print("Intercept:", mk_test.intercept)

# ------------------------------------------------------------
# 14. PETTITT CHANGE POINT TEST
# ------------------------------------------------------------
pettitt_test = hg.pettitt_test(npp_series)
print("PETTITT CHANGE POINT TEST RESULT")
print("--------------------------------")
print(pettitt_test)

# ------------------------------------------------------------
# 15. PLOT TIME SERIES WITH SEN'S SLOPE TREND LINE
# ------------------------------------------------------------
years = df['year'].values
slope = mk_test.slope
intercept = mk_test.intercept
trend_line = intercept + slope * np.arange(len(years))
plt.figure(figsize=(10, 5))
plt.plot(years, npp_series, marker='o', label='Annual Mean Cropland NPP')
plt.plot(years, trend_line, linestyle='--', label="Sen's Slope Trend Line")
plt.xlabel('Year')
plt.ylabel('Mean Cropland NPP')
plt.title('Trend of Annual Mean Cropland NPP')
plt.grid(True)
plt.legend()
plt.show()

# ------------------------------------------------------------
# 16. PREPARE IMAGE COLLECTION FOR PIXEL-WISE SEN'S SLOPE
# ------------------------------------------------------------
# Earth Engine's sensSlope reducer requires two bands:
# x = time/year
# y = NPP
def add_year_band(img):
 year = ee.Date(img.get('system:time_start')).get('year')
 year_img = ee.Image.constant(year).rename('year').toFloat()
 npp_img = img.select('Npp').rename('npp').toFloat()
 return year_img.addBands(npp_img).copyProperties(img, ['system:time_start'])
npp_with_year = cropland_npp.map(add_year_band)
print("Year band added to NPP collection.")

# ------------------------------------------------------------
# 17. MULTI-YEAR FULL AOI NPP PANEL MAPS
# ------------------------------------------------------------
# This displays complete NPP over the whole AOI, like your reference image.
# It does NOT use the cropland mask.
import math
import requests
import numpy as np
import matplotlib.pyplot as plt
from PIL import Image
from io import BytesIO
from matplotlib.colors import Normalize
from matplotlib import cm

# ------------------------------------------------------------
# 17.1 DEFINE YEARS TO DISPLAY
# ------------------------------------------------------------
years = list(range(2001, 2025))
print("Years to plot:", years)
print("Number of years:", len(years))

# ------------------------------------------------------------
# 17.2 GET AOI EXTENT
# ------------------------------------------------------------
roi_info = roi_bounds.getInfo()
coords = roi_info['coordinates'][0]
lons = [pt[0] for pt in coords]
lats = [pt[1] for pt in coords]
xmin = min(lons)
xmax = max(lons)
ymin = min(lats)
ymax = max(lats)
roi_display = ee.Geometry.Rectangle(
 [xmin, ymin, xmax, ymax],
 proj='EPSG:4326',
 geodesic=False
)
extent = [xmin, xmax, ymin, ymax]
print("AOI extent:", extent)

# ------------------------------------------------------------
# 17.3 VISUALIZATION SETTINGS
# ------------------------------------------------------------
# For full NPP map, use a wider range.
# You can adjust max_npp if the map appears too bright or too dark.
min_npp = 0
max_npp = 1.5
palette = [
 '313695', # dark blue
 '4575b4',
 '74add1',
 'abd9e9',
 'e0f3f8',
 'ffffbf',
 'fee090',
 'fdae61',
 'f46d43',
 'd73027',
 'a50026' # dark red
]
ncols = 6
nrows = math.ceil(len(years) / ncols)
fig, axes = plt.subplots(
 nrows=nrows,
 ncols=ncols,
 figsize=(18, 3.2 * nrows)
)
axes = axes.flatten()

# ------------------------------------------------------------
# 17.4 CREATE PANEL MAPS
# ------------------------------------------------------------
for i, year in enumerate(years):
 ax = axes[i]
 print(f"Processing year: {year}")
 # Select full NPP image for the year
 img = (
 npp
 .filter(ee.Filter.calendarRange(year, year, 'year'))
 .first()
 )
 # Apply scale factor and rename
 img = (
 ee.Image(img)
 .select('Npp')
 .multiply(0.0001)
 .rename('Npp')
 )
 # Render thumbnail from Earth Engine
 url = img.getThumbURL({
 'region': roi_display,
 'min': min_npp,
 'max': max_npp,
 'palette': palette,
 'dimensions': 700,
 'format': 'png'
 })
 response = requests.get(url)
 image = Image.open(BytesIO(response.content)).convert("RGBA")
 ax.imshow(
 image,
 extent=extent,
 origin='upper'
 )
 ax.set_xlim(xmin, xmax)
 ax.set_ylim(ymin, ymax)
 ax.set_title(f"time = {year}-01-01", fontsize=9)
 ax.tick_params(labelsize=7)
 if i % ncols == 0:
 ax.set_ylabel("lat", fontsize=8)
 else:
 ax.set_ylabel("")
 if i >= (nrows - 1) * ncols:
 ax.set_xlabel("lon", fontsize=8)
 else:
 ax.set_xlabel("")
# Hide empty panels if any
for j in range(len(years), len(axes)):
 axes[j].axis('off')
 
# ------------------------------------------------------------
# 17.5 ADD COLORBAR
# ------------------------------------------------------------
cbar_ax = fig.add_axes([0.92, 0.15, 0.015, 0.7])
cmap = cm.get_cmap('turbo')
norm = Normalize(vmin=min_npp, vmax=max_npp)
sm = cm.ScalarMappable(norm=norm, cmap=cmap)
sm.set_array([])
cbar = fig.colorbar(sm, cax=cbar_ax)
cbar.set_label("MODIS NPP", fontsize=10)
plt.suptitle(
 "Annual Spatial Distribution of MODIS-Derived NPP",
 fontsize=16,
 y=0.995
)
plt.tight_layout(rect=[0, 0, 0.9, 0.97])
plt.show()
cropland_npp
npp
roi_bounds
df

# ------------------------------------------------------------
# 18. MULTI-YEAR PANEL MAPS OF CROP NPP
# ------------------------------------------------------------
# Full AOI shown in light gray
# Crop NPP shown in color only on cropland pixels
import math
import requests
import matplotlib.pyplot as plt
from PIL import Image
from io import BytesIO
from matplotlib.colors import Normalize
from matplotlib import cm
# Years to display
years = list(range(2001, 2025))
print("Years to plot:", years)
print("Number of years:", len(years))
# Get AOI extent
roi_info = roi_bounds.getInfo()
coords = roi_info['coordinates'][0]
lons = [pt[0] for pt in coords]
lats = [pt[1] for pt in coords]
xmin = min(lons)
xmax = max(lons)
ymin = min(lats)
ymax = max(lats)
roi_display = ee.Geometry.Rectangle(
 [xmin, ymin, xmax, ymax],
 proj='EPSG:4326',
 geodesic=False
)
extent = [xmin, xmax, ymin, ymax]
print("AOI extent:", extent)
# Visualization settings
min_npp = 0
max_npp = 1.5
crop_palette = [
 '313695',
 '4575b4',
 '74add1',
 'abd9e9',
 'e0f3f8',
 'ffffbf',
 'fee090',
 'fdae61',
 'f46d43',
 'd73027',
 'a50026'
]
# Layout
ncols = 6
nrows = math.ceil(len(years) / ncols)
fig, axes = plt.subplots(
 nrows=nrows,
 ncols=ncols,
 figsize=(18, 3.2 * nrows)
)
axes = axes.flatten()
for i, year in enumerate(years):
 ax = axes[i]
 print(f"Processing year: {year}")
 # Full NPP for background (light gray base)
 full_img = (
 npp
 .filter(ee.Filter.calendarRange(year, year, 'year'))
 .first()
 )
 full_img = (
 ee.Image(full_img)
 .select('Npp')
 .multiply(0.0001)
 .rename('Npp')
 )
 # Crop NPP for overlay
 crop_img = (
 cropland_npp
 .filter(ee.Filter.calendarRange(year, year, 'year'))
 .first()
 )
 crop_img = ee.Image(crop_img).select('Npp')
 # Gray background showing full AOI vegetation pattern
 base_vis = full_img.visualize(
 min=min_npp,
 max=max_npp,
 palette=['f2f2f2', 'd9d9d9', 'bdbdbd']
 )
 # Colored crop NPP overlay
 crop_vis = crop_img.visualize(
 min=min_npp,
 max=max_npp,
 palette=crop_palette
 )
 # Blend background + crop NPP
 final_vis = base_vis.blend(crop_vis)
 # Thumbnail
 url = final_vis.getThumbURL({
 'region': roi_display,
 'dimensions': 700,
 'format': 'png'
 })
 response = requests.get(url)
 image = Image.open(BytesIO(response.content)).convert("RGBA")
 ax.imshow(
 image,
 extent=extent,
 origin='upper'
 )
 ax.set_xlim(xmin, xmax)
 ax.set_ylim(ymin, ymax)
 ax.set_title(f"time = {year}-01-01", fontsize=9)
 ax.tick_params(labelsize=7)
 if i % ncols == 0:
 ax.set_ylabel("lat", fontsize=8)
 else:
 ax.set_ylabel("")
 if i >= (nrows - 1) * ncols:
 ax.set_xlabel("lon", fontsize=8)
 else:
 ax.set_xlabel("")
# Hide empty panels
for j in range(len(years), len(axes)):
 axes[j].axis('off')
# Colorbar for crop NPP
cbar_ax = fig.add_axes([0.92, 0.15, 0.015, 0.7])
cmap = cm.get_cmap('turbo')
norm = Normalize(vmin=min_npp, vmax=max_npp)
sm = cm.ScalarMappable(norm=norm, cmap=cmap)
sm.set_array([])
cbar = fig.colorbar(sm, cax=cbar_ax)
cbar.set_label("Crop NPP", fontsize=10)
plt.suptitle(
 "Annual Spatial Distribution of Cropland MODIS-Derived NPP",
 fontsize=16,
 y=0.995
)
plt.tight_layout(rect=[0, 0, 0.9, 0.97])
plt.show()