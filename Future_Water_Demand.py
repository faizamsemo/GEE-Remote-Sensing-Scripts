# ============================================================
# FUTURE WATER STRESS BIVARIATE MAP
# Demand vs Supply / Availability
# Boundary Digitized Directly in Python from Satellite Image
# ============================================================
# ------------------------------------------------------------
# INSTALL REQUIRED PACKAGES
# ------------------------------------------------------------
# Run this only once if packages are not installed
# In Google Colab or Jupyter, uncomment and run:
# !pip install geopandas pandas matplotlib requests shapely ipyleaflet mapclassify
# ============================================================
# STEP 1. IMPORT LIBRARIES
# ============================================================
import os
import json
import requests
import pandas as pd
import geopandas as gpd
import matplotlib.pyplot as plt
from ipyleaflet import Map, DrawControl, basemaps, basemap_to_tiles
# ============================================================
# STEP 2. CREATE OUTPUT FOLDER
# ============================================================
output_folder = "future_water_stress_outputs"
os.makedirs(output_folder, exist_ok=True)
boundary_file = os.path.join(output_folder, "study_area.geojson")
# ============================================================
# STEP 3. DRAW STUDY AREA BOUNDARY FROM SATELLITE IMAGE
# ============================================================
# Change these coordinates to the approximate centre of your study area.
# Example below is central Tanzania.
center_lat = -6.3690
center_lon = 34.8888
zoom_level = 7
# Create satellite basemap
satellite_layer = basemap_to_tiles(basemaps.Esri.WorldImagery)
# Create interactive map
m = Map(
 center=(center_lat, center_lon),
 zoom=zoom_level,
 layers=(satellite_layer,),
 scroll_wheel_zoom=True
)
# Create draw control
draw_control = DrawControl()
# Allow polygon drawing only
draw_control.polygon = {
 "shapeOptions": {
 "color": "red",
 "weight": 3,
 "fillColor": "red",
 "fillOpacity": 0.20
 }
}
# Disable other drawing tools
draw_control.rectangle = {}
draw_control.circle = {}
draw_control.circlemarker = {}
draw_control.polyline = {}
draw_control.marker = {}
# Store drawn polygon
drawn_features = []
def handle_draw(target, action, geo_json):
 """
 Stores the study area boundary drawn by the user.
 """
 if action == "created":
 drawn_features.clear()
 drawn_features.append(geo_json)
 print("Study area boundary added.")
 elif action == "deleted":
 drawn_features.clear()
 print("Study area boundary deleted.")
draw_control.on_draw(handle_draw)
m.add_control(draw_control)
m
# ============================================================
# STEP 4. SAVE DRAWN STUDY AREA BOUNDARY AS GEOJSON
# ============================================================
if len(drawn_features) == 0:
 raise ValueError("No boundary has been drawn. Please draw a polygon first.")
study_area_geojson = {
 "type": "FeatureCollection",
 "features": drawn_features
}
with open(boundary_file, "w") as f:
 json.dump(study_area_geojson, f)
print(f"Study area boundary saved successfully: {boundary_file}")
# ============================================================
# STEP 5. LOAD AND CHECK THE DRAWN STUDY AREA BOUNDARY ONLY
# ============================================================
import geopandas as gpd
import matplotlib.pyplot as plt
study_area = gpd.read_file(boundary_file)
# Ensure WGS84 coordinate system
study_area = study_area.to_crs(epsg=4326)
# Dissolve into one polygon
study_area = study_area.dissolve()
print("Study area boundary loaded successfully.")
print("CRS:", study_area.crs)
print("Number of boundary features:", len(study_area))
fig, ax = plt.subplots(figsize=(8, 8))
study_area.plot(
 ax=ax,
 facecolor="lightblue",
 edgecolor="red",
 linewidth=2,
 alpha=0.4
)
ax.set_title("Drawn Study Area Boundary Only")
ax.set_axis_off()
plt.show()
# ============================================================
# STEP 6. DOWNLOAD FULL AQUEDUCT FUTURE ANNUAL DATA
# Using OBJECTID batches with POST request
# ============================================================
import requests
import geopandas as gpd
import pandas as pd
import os
import time
aqueduct_url = (
 "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/"
 "aqueduct_water_risk/FeatureServer/0/query"
)
def get_object_ids(url):
 """
 Get all OBJECTIDs from the ArcGIS FeatureServer layer.
 """
 params = {
 "where": "1=1",
 "returnIdsOnly": "true",
 "f": "json"
 }
 response = requests.get(url, params=params)
 response.raise_for_status()
 data = response.json()
 if "objectIds" not in data:
 print(data)
 raise ValueError("OBJECTIDs were not returned by the ArcGIS service.")
 object_ids = sorted(data["objectIds"])
 print("Total OBJECTIDs found:", len(object_ids))
 return object_ids
def download_arcgis_by_objectids(url, batch_size=250):
 """
 Download ArcGIS FeatureServer records using objectIds and POST.
 This avoids URL-length errors.
 """
 object_ids = get_object_ids(url)
 all_features = []
 for start in range(0, len(object_ids), batch_size):
 batch_ids = object_ids[start:start + batch_size]
 batch_ids_text = ",".join(map(str, batch_ids))
 payload = {
 "objectIds": batch_ids_text,
 "outFields": "*",
 "returnGeometry": "true",
 "outSR": "4326",
 "f": "geojson"
 }
 response = requests.post(url, data=payload)
 if response.status_code != 200:
 print("Failed batch:", start, "to", start + batch_size)
 print("Status code:", response.status_code)
 print(response.text[:500])
 response.raise_for_status()
 data = response.json()
 features = data.get("features", [])
 if len(features) == 0:
 print("Warning: empty batch from", start, "to", start + batch_size)
 all_features.extend(features)
 print(f"Downloaded {len(all_features)} of {len(object_ids)} features")
 time.sleep(0.1)
 if len(all_features) == 0:
 raise ValueError("No features were downloaded.")
 gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:4326")
 return gdf
aqueduct = download_arcgis_by_objectids(aqueduct_url, batch_size=250)
print("Aqueduct future annual data downloaded successfully.")
print("Total features downloaded:", len(aqueduct))
print("CRS:", aqueduct.crs)
print("\nAvailable columns:")
for col in aqueduct.columns:
 print(col)
# ============================================================
# STEP 7. REPAIR GEOMETRIES AND CLIP AQUEDUCT DATA
# ============================================================
import geopandas as gpd
import matplotlib.pyplot as plt
from shapely.validation import make_valid
import os
# ------------------------------------------------------------
# 7.1 Ensure same CRS
# ------------------------------------------------------------
study_area = study_area.to_crs(epsg=4326)
aqueduct = aqueduct.to_crs(epsg=4326)
print("Original Aqueduct features:", len(aqueduct))
print("Study area features:", len(study_area))
print("\nStudy area bounds:")
print(study_area.total_bounds)
print("\nAqueduct bounds:")
print(aqueduct.total_bounds)
# ------------------------------------------------------------
# 7.2 Repair invalid geometries
# ------------------------------------------------------------
def repair_geometries(gdf):
 """
 Repairs invalid geometries using shapely make_valid().
 Removes empty and null geometries.
 Keeps only polygon and multipolygon geometries.
 """
 gdf = gdf.copy()
 # Remove null geometries
 gdf = gdf[gdf.geometry.notnull()]
 # Repair invalid geometries
 gdf["geometry"] = gdf["geometry"].apply(make_valid)
 # Remove empty geometries
 gdf = gdf[~gdf.geometry.is_empty]
 # Explode geometry collections/multipolygons where needed
 gdf = gdf.explode(index_parts=False).reset_index(drop=True)
 # Keep only polygons
 gdf = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
 # Final buffer(0) cleanup
 gdf["geometry"] = gdf.buffer(0)
 # Remove any empty geometry after buffer
 gdf = gdf[~gdf.geometry.is_empty]
 return gdf
study_area_clean = repair_geometries(study_area)
aqueduct_clean = repair_geometries(aqueduct)
print("\nAfter geometry repair:")
print("Aqueduct features:", len(aqueduct_clean))
print("Study area features:", len(study_area_clean))
print("Invalid Aqueduct geometries remaining:", (~aqueduct_clean.is_valid).sum())
print("Invalid study area geometries remaining:", (~study_area_clean.is_valid).sum())
# ------------------------------------------------------------
# 7.3 Dissolve study area into one polygon
# ------------------------------------------------------------
study_area_clean = study_area_clean.dissolve().reset_index(drop=True)
# Use union_all instead of deprecated unary_union
study_geom = study_area_clean.geometry.union_all()
# ------------------------------------------------------------
# 7.4 Select Aqueduct features intersecting the study area first
# ------------------------------------------------------------
aqueduct_intersecting = aqueduct_clean[aqueduct_clean.intersects(study_geom)].copy()
print("\nAqueduct features intersecting drawn boundary:", len(aqueduct_intersecting))
if len(aqueduct_intersecting) == 0:
 raise ValueError(
 "No Aqueduct features intersect the drawn polygon. "
 "Check whether the polygon was drawn in the correct location."
 )
# ------------------------------------------------------------
# 7.5 Clip Aqueduct data to the drawn boundary
# ------------------------------------------------------------
aqueduct_clip = gpd.clip(
 aqueduct_intersecting,
 study_area_clean,
 keep_geom_type=True
)
# Remove empty geometries after clipping
aqueduct_clip = aqueduct_clip[
 aqueduct_clip.geometry.notnull() &
 (~aqueduct_clip.geometry.is_empty)
].copy()
print("Aqueduct features after clipping:", len(aqueduct_clip))
if len(aqueduct_clip) == 0:
 raise ValueError(
 "Clipping produced zero features. "
 "The boundary may be too small or geometry repair changed the shape."
 )
# ------------------------------------------------------------
# 7.6 Plot clipped result
# ------------------------------------------------------------
fig, ax = plt.subplots(figsize=(10, 10))
aqueduct_clip.plot(
 ax=ax,
 color="lightblue",
 edgecolor="grey",
 linewidth=0.25
)
study_area_clean.boundary.plot(
 ax=ax,
 color="red",
 linewidth=2
)
ax.set_title("Aqueduct Data Clipped Inside Drawn Study Area")
ax.set_axis_off()
plt.show()
# ------------------------------------------------------------
# 7.7 Save clipped output
# ------------------------------------------------------------
clipped_file = os.path.join(
 output_folder,
 "aqueduct_future_annual_clipped.geojson"
)
aqueduct_clip.to_file(clipped_file, driver="GeoJSON")
print("Clipped data saved successfully:")
print(clipped_file)
# ============================================================
# STEP 8. PRINT ALL COLUMN NAMES CLEARLY
# ============================================================
print("Total columns:", len(aqueduct_clip.columns))
print("\nAvailable columns:\n")
for col in aqueduct_clip.columns:
 print(col)
# ============================================================
# STEP 8A. FIND POSSIBLE FUTURE WATER DEMAND / SUPPLY COLUMNS
# ============================================================
cols = list(aqueduct_clip.columns)
print("Columns containing 2080:")
for col in cols:
 if "2080" in col.lower():
 print(col)
print("\nColumns containing bau:")
for col in cols:
 if "bau" in col.lower():
 print(col)
print("\nColumns possibly related to demand / withdrawal:")
for col in cols:
 text = col.lower()
 if any(k in text for k in ["demand", "withdraw", "ww", "use"]):
 print(col)
print("\nColumns possibly related to supply / availability:")
for col in cols:
 text = col.lower()
 if any(k in text for k in ["supply", "availability", "available", "ba", "water"]):
 print(col)
demand_col = "PUT_ACTUAL_DEMAND_COLUMN_NAME_HERE"
supply_col = "PUT_ACTUAL_SUPPLY_COLUMN_NAME_HERE"
# ============================================================
# STEP 8B. SELECT DEMAND AND SUPPLY COLUMNS
# ============================================================
# Business-as-usual scenario, 2080 period
# 2080 represents the future window around 2065–2095
demand_col = "bau80_ww_x_r" # Water withdrawal / demand
supply_col = "bau80_ba_x_r" # Blue water availability / supply
# Check selected columns
if demand_col not in aqueduct_clip.columns:
 raise ValueError(f"Demand column not found: {demand_col}")
if supply_col not in aqueduct_clip.columns:
 raise ValueError(f"Supply column not found: {supply_col}")
print("Selected demand column:", demand_col)
print("Selected supply column:", supply_col)
print("\nDemand sample values:")
print(aqueduct_clip[demand_col].head())
print("\nSupply sample values:")
print(aqueduct_clip[supply_col].head())
print("\nDemand summary:")
print(aqueduct_clip[demand_col].describe())
print("\nSupply summary:")
print(aqueduct_clip[supply_col].describe())
# ============================================================
# STEP 9. CLEAN DEMAND AND SUPPLY DATA
# ============================================================
import pandas as pd
import numpy as np
gdf = aqueduct_clip.copy()
# Convert selected columns to numeric
gdf[demand_col] = pd.to_numeric(gdf[demand_col], errors="coerce")
gdf[supply_col] = pd.to_numeric(gdf[supply_col], errors="coerce")
# Remove missing values
gdf = gdf.dropna(subset=[demand_col, supply_col])
# Remove infinite values
gdf = gdf[
 np.isfinite(gdf[demand_col]) &
 np.isfinite(gdf[supply_col])
].copy()
print("Valid records after cleaning:", len(gdf))
if len(gdf) < 3:
 raise ValueError("Not enough valid records for bivariate classification.")
print("\nDemand summary:")
print(gdf[demand_col].describe())
print("\nSupply summary:")
print(gdf[supply_col].describe())
# ============================================================
# STEP 10. CLASSIFY DEMAND AND SUPPLY INTO THREE CLASSES
# ============================================================
# 0 = Low
# 1 = Medium
# 2 = High
def classify_three_groups(series):
 """
 Classifies values into three quantile-based classes.
 Ranking is used to avoid qcut errors caused by duplicate values.
 """
 ranked = series.rank(method="first")
 classified = pd.qcut(
 ranked,
 q=3,
 labels=[0, 1, 2]
 ).astype(int)
 return classified
gdf["demand_class"] = classify_three_groups(gdf[demand_col])
gdf["supply_class"] = classify_three_groups(gdf[supply_col])
# Bivariate class format: demand_supply
gdf["bivar_class"] = (
 gdf["demand_class"].astype(str) + "_" +
 gdf["supply_class"].astype(str)
)
print("Bivariate class counts:")
print(gdf["bivar_class"].value_counts().sort_index())
# ============================================================
# STEP 11. DEFINE BIVARIATE COLOR PALETTE
# ============================================================
bivar_colors = {
 "0_0": "#e8e2d5", # Low demand, low supply
 "1_0": "#d9a77c", # Medium demand, low supply
 "2_0": "#f06b1a", # High demand, low supply = high stress
 "0_1": "#b8d7d8", # Low demand, medium supply
 "1_1": "#9b929d", # Medium demand, medium supply
 "2_1": "#8d5f84", # High demand, medium supply
 "0_2": "#00a9c7", # Low demand, high supply = low stress
 "1_2": "#3d86c6", # Medium demand, high supply
 "2_2": "#2369ff" # High demand, high supply
}
gdf["map_color"] = gdf["bivar_class"].map(bivar_colors)
missing_colors = gdf[gdf["map_color"].isna()]
if len(missing_colors) > 0:
 raise ValueError(
 "Some bivariate classes have no assigned color: "
 f"{missing_colors['bivar_class'].unique()}"
 )
print("Color assignment completed.")
demand_col = "bau80_ww_x_r"
supply_col = "bau80_ba_x_r"
# ============================================================
# INSTALL CONTEXTILY FOR TERRAIN BASEMAP
# ============================================================
!pip install contextily
# ============================================================
# STEP 12. FINAL CLEAN MAP LAYOUT
# Title separated + clean legend + centered map
# ============================================================
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from matplotlib import transforms
# ------------------------------------------------------------
# 12.0 Clear previous figures
# ------------------------------------------------------------
plt.close("all")
# ------------------------------------------------------------
# 12.1 Final color palette
# ------------------------------------------------------------
bivar_colors = {
 "0_0": "#e8e1d7", # low demand, low availability
 "1_0": "#d9a47d",
 "2_0": "#f2872f", # high demand, low availability
 "0_1": "#bddbdd",
 "1_1": "#a78f98",
 "2_1": "#8778af",
 "0_2": "#18c8e8", # low demand, high availability
 "1_2": "#5fa6e8",
 "2_2": "#4d6df3" # high demand, high availability
}
gdf["map_color"] = gdf["bivar_class"].map(bivar_colors)
# ------------------------------------------------------------
# 12.2 Create figure
# ------------------------------------------------------------
fig = plt.figure(figsize=(15, 9), facecolor="black")
# Reserved map area.
# Left space is intentionally kept for the legend.
# Top space is intentionally kept for the title.
ax = fig.add_axes([0.26, 0.07, 0.68, 0.76])
ax.set_facecolor("black")
# ------------------------------------------------------------
# 12.3 Plot map
# ------------------------------------------------------------
gdf.plot(
 ax=ax,
 color=gdf["map_color"],
 edgecolor="#5a5a5a",
 linewidth=0.12,
 alpha=1.0
)
# ------------------------------------------------------------
# 12.4 Center map within its own axis
# ------------------------------------------------------------
xmin, ymin, xmax, ymax = gdf.total_bounds
data_w = xmax - xmin
data_h = ymax - ymin
cx = (xmin + xmax) / 2
cy = (ymin + ymax) / 2
fig_w, fig_h = fig.get_size_inches()
ax_pos = ax.get_position()
ax_ratio = (fig_w * ax_pos.width) / (fig_h * ax_pos.height)
data_ratio = data_w / data_h
pad_factor = 1.03
if data_ratio > ax_ratio:
 half_w = (data_w / 2) * pad_factor
 half_h = half_w / ax_ratio
else:
 half_h = (data_h / 2) * pad_factor
 half_w = half_h * ax_ratio
ax.set_xlim(cx - half_w, cx + half_w)
ax.set_ylim(cy - half_h, cy + half_h)
ax.set_aspect("equal")
ax.set_axis_off()
# ------------------------------------------------------------
# 12.5 Title area
# This is now outside the map axis, so it will not overlap the map
# ------------------------------------------------------------
fig.text(
 0.60, 0.965,
 "Future Water Stresses",
 ha="center",
 va="top",
 fontsize=26,
 color="white",
 fontweight="light",
 family="sans-serif"
)
fig.text(
 0.60, 0.915,
 "Demand vs Supply (2065 - 2095)",
 ha="center",
 va="top",
 fontsize=17,
 color="#d8d8d8",
 fontweight="light",
 family="sans-serif"
)
# ------------------------------------------------------------
# 12.6 Clean legend
# ------------------------------------------------------------
legend_ax = fig.add_axes([0.035, 0.25, 0.25, 0.42])
legend_ax.set_facecolor("black")
legend_ax.set_xlim(-3.4, 6.4)
legend_ax.set_ylim(-2.2, 5.4)
legend_ax.set_aspect("equal")
legend_ax.axis("off")
# Diamond grid
trans = transforms.Affine2D().rotate_deg_around(1.5, 1.5, 45) + legend_ax.transData
for d in range(3):
 for s in range(3):
 key = f"{d}_{s}"
 rect = Rectangle(
 (s, d),
 1,
 1,
 facecolor=bivar_colors[key],
 edgecolor="black",
 linewidth=0.25,
 transform=trans
 )
 legend_ax.add_patch(rect)
# ---------------- TOP LABEL ----------------
legend_ax.text(
 1.5, 5.05,
 "HIGH",
 ha="center",
 va="bottom",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 1.5, 4.74,
 "Demand for Water",
 ha="center",
 va="bottom",
 fontsize=7.5,
 color="#4d6df3",
 fontweight="bold"
)
legend_ax.text(
 1.5, 4.40,
 "LOW",
 ha="center",
 va="bottom",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 1.5, 4.09,
 "Water Availability",
 ha="center",
 va="bottom",
 fontsize=7.5,
 color="#4d6df3",
 fontweight="bold"
)
# ---------------- LEFT LABEL ----------------
legend_ax.text(
 -1.85, 2.12,
 "LOW",
 ha="center",
 va="center",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 -1.85, 1.78,
 "Demand for Water",
 ha="center",
 va="center",
 fontsize=7.0,
 color="#f2872f",
 fontweight="bold"
)
legend_ax.text(
 -1.85, 1.22,
 "LOW",
 ha="center",
 va="center",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 -1.85, 0.88,
 "Water Availability",
 ha="center",
 va="center",
 fontsize=7.0,
 color="#f2872f",
 fontweight="bold"
)
# ---------------- RIGHT LABEL ----------------
legend_ax.text(
 4.85, 2.12,
 "HIGH",
 ha="center",
 va="center",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 4.85, 1.78,
 "Demand for Water",
 ha="center",
 va="center",
 fontsize=7.0,
 color="#18c8e8",
 fontweight="bold"
)
legend_ax.text(
 4.85, 1.22,
 "HIGH",
 ha="center",
 va="center",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 4.85, 0.88,
 "Water Availability",
 ha="center",
 va="center",
 fontsize=7.0,
 color="#18c8e8",
 fontweight="bold"
)
# ---------------- BOTTOM LABEL ----------------
legend_ax.text(
 1.5, -0.78,
 "LOW",
 ha="center",
 va="top",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 1.5, -1.10,
 "Demand for Water",
 ha="center",
 va="top",
 fontsize=7.5,
 color="#bfbfbf",
 fontweight="bold"
)
legend_ax.text(
 1.5, -1.50,
 "HIGH",
 ha="center",
 va="top",
 fontsize=8.5,
 color="white",
 fontweight="bold"
)
legend_ax.text(
 1.5, -1.82,
 "Water Availability",
 ha="center",
 va="top",
 fontsize=7.5,
 color="#bfbfbf",
 fontweight="bold"
)
# ------------------------------------------------------------
# 12.7 Bottom-right label
# ------------------------------------------------------------
fig.text(
 0.94, 0.105,
 "Future Annual",
 ha="right",
 va="center",
 fontsize=15,
 color="white",
 alpha=0.95,
 family="sans-serif"
)
fig.text(
 0.94, 0.078,
 "AQUEDUCT 4.0",
 ha="right",
 va="center",
 fontsize=8.5,
 color="#cfcfcf",
 alpha=0.92,
 family="sans-serif"
)
plt.show()
# ============================================================
# STEP 13. SAVE FINAL MAP
# ============================================================
png_output = os.path.join(output_folder, "future_water_stress_final_corrected.png")
pdf_output = os.path.join(output_folder, "future_water_stress_final_corrected.pdf")
fig.savefig(
 png_output,
 dpi=300,
 bbox_inches="tight",
 facecolor=fig.get_facecolor()
)
fig.savefig(
 pdf_output,
 dpi=300,
 bbox_inches="tight",
 facecolor=fig.get_facecolor()
)
print("Final corrected map saved successfully:")
print("PNG:", png_output)
print("PDF:", pdf_output)