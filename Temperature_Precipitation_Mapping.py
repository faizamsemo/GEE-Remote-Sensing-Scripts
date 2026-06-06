# ============================================
# BIVARIATE MAP (Temp × Precip) — TerraClimate
# Period: 2015-01 to 2025-12
# AOI: your uploaded SHP (Australia)
# Palette: SAME as example (Oranges/Blues + mixblend)
# ============================================
0)from google.colab import drive
drive.mount('/content/drive')
1) Install + imports
!pip -q install geopandas shapely rasterio xarray netCDF4 matplotlib pyproj requests
import numpy as np
import geopandas as gpd
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import rasterio
from rasterio.features import geometry_mask
import requests

2) Define your study area
import os, zipfile, glob
ZIP_PATH = "/content/drive/MyDrive/Shapefiles & Data/Australia.zip" # <-- change to your 
uploaded zip name
with zipfile.ZipFile(ZIP_PATH, 'r') as z:
 z.extractall("/content/aoi_shp")
shp_files = glob.glob("/content/aoi_shp/**/*.shp", recursive=True)
assert len(shp_files) > 0, "No .shp found in the zip."
SHP_PATH = shp_files[0]
print("Using:", SHP_PATH)
aoi = gpd.read_file(SHP_PATH).to_crs("EPSG:4326")
# Dissolve to one geometry (important for masking)
aoi_geom = aoi.unary_union
# Bounds for subsetting TerraClimate download
minx, miny, maxx, maxy = aoi.total_bounds
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = float(minx), float(miny), float(maxx), 
float(maxy)
print("AOI bounds:", (LON_MIN, LAT_MIN, LON_MAX, LAT_MAX))

3) Download TerraClimate subsets (ppt, tmin, tmax)
BASE = 
"http://thredds.northwestknowledge.net:8080/thredds/ncss/agg_terraclimate_{var}_1958_Curren
tYear_GLOBE.nc"
def download_terraclimate(var, out_nc):
 params = {
 "var": var,
 "south": LAT_MIN,
 "north": LAT_MAX,
 "west": LON_MIN,
 "east": LON_MAX,
 "disableProjSubset": "on",
 "addLatLon": "true",
 "horizStride": 1,
 "accept": "netcdf"
 }
 url = BASE.format(var=var)
 r = requests.get(url, params=params, timeout=180)
 r.raise_for_status()
 with open(out_nc, "wb") as f:
 f.write(r.content)
 return out_nc
ppt_nc = download_terraclimate("ppt", "ppt.nc")
tmin_nc = download_terraclimate("tmin", "tmin.nc")
tmax_nc = download_terraclimate("tmax", "tmax.nc")
print("Downloaded:", ppt_nc, tmin_nc, tmax_nc)

4) Load + compute climatology for a period
START = "2015-01-01"
END = "2025-12-31"
ppt = xr.open_dataset(ppt_nc)["ppt"].sel(time=slice(START, END))
tmin = xr.open_dataset(tmin_nc)["tmin"].sel(time=slice(START, END))
tmax = xr.open_dataset(tmax_nc)["tmax"].sel(time=slice(START, END))
temp = (tmin + tmax) / 2.0
ppt_mean = ppt.mean("time", skipna=True) # ppt (mm/month) average over months in 2015–
2025
temp_mean = temp.mean("time", skipna=True) # temp (°C) average over months in 2015–2025
lats = ppt_mean["lat"].values
lons = ppt_mean["lon"].values

5) Mask to the AOI boundary (so the raster clips to your study area)
# Raster transform for the subset grid
transform = rasterio.transform.from_bounds(
 west=float(lons.min()), south=float(lats.min()),
 east=float(lons.max()), north=float(lats.max()),
 width=ppt_mean.shape[1], height=ppt_mean.shape[0]
)
mask = geometry_mask(
 geometries=[aoi_geom],
 out_shape=ppt_mean.shape,
 transform=transform,
 invert=True # True inside AOI
)
ppt_m = np.where(mask, ppt_mean.values, np.nan).astype(np.float32)
temp_m = np.where(mask, temp_mean.values, np.nan).astype(np.float32)
# Decide correct origin based on latitude order
origin = "upper" if lats[0] > lats[-1] else "lower"
extent = [float(lons.min()), float(lons.max()),
 float(lats.min()), float(lats.max())]
 
#6) Build a bivariate quantile index (n×n classes)
def quantile_edges(arr, n=5):
 v = arr[np.isfinite(arr)]
 qs = np.quantile(v, np.linspace(0, 1, n+1))
 # ensure strictly increasing edges
 qs2 = [qs[0]]
 for x in qs[1:]:
 qs2.append(max(x, qs2[-1] + 1e-9))
 return np.array(qs2)
n = 5
ppt_edges = quantile_edges(ppt_m, n)
temp_edges = quantile_edges(temp_m, n)
def bin_index(arr, edges):
 # returns 0..n-1
 b = np.digitize(arr, edges[1:-1], right=True)
 b = np.clip(b, 0, n-1)
 return b
ppt_bin = bin_index(ppt_m, ppt_edges)
temp_bin = bin_index(temp_m, temp_edges)
bivar = (temp_bin * n + ppt_bin).astype(np.float32)
bivar[~np.isfinite(ppt_m) | ~np.isfinite(temp_m)] = np.nan

7) Create a blended blue–orange bivariate palette (like the example)
import numpy as np
import matplotlib.colors as mcolors
# D3 ColorBrewer schemes (exact 6-class lists), then slice(0, -1) => 5 colors
# Matches: d3.schemeOranges[n+1].slice(0,-1) and d3.schemeBlues[n+1].slice(0,-1)
ORANGES_6 = ["#feedde", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801"]
BLUES_6 = ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"]
n = 5
oranges = ORANGES_6[:n]
blues = BLUES_6[:n]
def hex_to_rgb255(h):
 h = h.lstrip("#")
 return np.array([int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)], dtype=np.float32)
def rgb255_to_hex(rgb):
 rgb = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
 return "#{:02x}{:02x}{:02x}".format(rgb[0], rgb[1], rgb[2])
# Exact Observable mixblend logic
def mixblend(a_hex, b_hex):
 a = hex_to_rgb255(a_hex) # blue
 b = hex_to_rgb255(b_hex) # orange
 l = min(250.0, float(b.sum()))
 a = a * (b / l)
 return rgb255_to_hex(a)
# d3.cross(blues, oranges).map(mixblend) => blue varies first, then orange
palette = [mixblend(a, b) for a in blues for b in oranges]
cmap = mcolors.ListedColormap(palette)

8) Plot map + legend (same style)
from mpl_toolkits.axes_grid1.inset_locator import inset_axes
# --- A2 landscape at 300 dpi ---
A2_W_IN, A2_H_IN = 23.39, 16.54 # inches (319×214 mm)
DPI = 300
origin = "upper" if lats[0] > lats[-1] else "center"
extent = [float(lons.min()), float(lons.max()),
 float(lats.min()), float(lats.max())]
fig = plt.figure(figsize=(A2_W_IN, A2_H_IN), dpi=DPI)
ax = plt.axes()
# Main map (no axes like the example)
ax.imshow(bivar, origin=origin, extent=extent, cmap=cmap, vmin=0, vmax=n*n-1)
ax.set_axis_off()
# White boundaries (if your SHP has multiple polygons/states it will show internal borders)
aoi.boundary.plot(ax=ax, color="white", linewidth=0.8)
# Title (optional; comment out to match the example even closer)
ax.set_title("Australia (2015–2025) — Bivariate: Temperature & Precipitation",
 fontsize=28, fontweight="bold", pad=18)
# --- Legend (square, same colors). If you want the diamond rotation, see note below. ---
leg = inset_axes(ax, width="40%", height="40%", loc="center left", borderpad=2.0)
grid = np.arange(n*n).reshape(n, n)
# Make legend orientation match Observable: y reversed
leg.imshow(grid, origin="lower", cmap=cmap, vmin=0, vmax=n*n-1)
leg.set_xticks([]); leg.set_yticks([])
for s in leg.spines.values():
 s.set_visible(False)
leg.text(0.5, -0.12, "Temperature →", ha="center", va="top",
 transform=leg.transAxes, fontsize=18, fontweight="bold")
leg.text(-0.12, 0.5, "← Precipitation ", ha="right", va="center", rotation=90,
 transform=leg.transAxes, fontsize=18, fontweight="bold")
# Save A2
out_png = "/content/drive/MyDrive/Faiza Msemo _Map/Australia_bivariate_A2_300dpi.png"
plt.savefig(out_png, dpi=DPI, bbox_inches="tight", facecolor="white")
plt.show()
print("Saved:", out_png)