# ============================================================
# Population trend and growth rate from GHSL population data
# using a shapefile as the ROI
# ============================================================
import ee
import geemap
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
# ------------------------------------------------------------
# 1. Authenticate and initialize Earth Engine
# ------------------------------------------------------------
ee.Authenticate()
ee.Initialize(project='ee-faizamsemo') # replace with your project ID
# ------------------------------------------------------------
# 2. Input shapefile path
# Make sure .shp, .shx, .dbf, .prj are in same folder
# ------------------------------------------------------------
shp_path = r'/content/drive/MyDrive/Shapefiles & Data/Dar/Dar.shp' # change 
this path
# ------------------------------------------------------------
# 3. Convert shapefile to EE FeatureCollection
# ------------------------------------------------------------
# Install pycrs if not already installed, as it's often a dependency for 
geemap.shp_to_ee
roi_fc = geemap.shp_to_ee(shp_path)
roi = roi_fc.geometry()
# ------------------------------------------------------------
# 4. Load GHSL population dataset
# ------------------------------------------------------------
pop_ic = ee.ImageCollection("JRC/GHSL/P2023A/GHS_POP").filterBounds(roi)
# ------------------------------------------------------------
# 5. Add selected population layers to map
# GHSL usually comes in ~5-year steps
# ------------------------------------------------------------
Map = geemap.Map(basemap='SATELLITE')
Map.centerObject(roi, 10)
Map.addLayer(
 roi_fc.style(color='red', fillColor='00000000', width=2),
 {},
 'ROI'
)
vis_params = {
 'min': 0,
 'max': 500,
 'palette': ['000000', '0b3d91', '1d91c0', '41ab5d', 'fe9929', 'cc4c02']
}
# Convert collection to list for selecting images
pop_list = pop_ic.toList(pop_ic.size())
n_images = pop_ic.size().getInfo()
print(f"Number of GHSL population images found: {n_images}")
# Add all layers, but only turn on first/last by default if desired
for i in range(n_images):
 img = ee.Image(pop_list.get(i)).clip(roi)
 date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM￾dd').getInfo()
 Map.addLayer(img.select(0), vis_params, f'Population {date_str}', i == 0)
Map
# ------------------------------------------------------------
# 6. Function to compute total population inside ROI
# ------------------------------------------------------------
def pop_count(img):
 pop_sum = img.reduceRegion(
 reducer=ee.Reducer.sum(),
 geometry=roi,
 scale=100,
 maxPixels=1e13
 ).get('population_count')
 date = img.date().format('YYYY-MM-dd')
 return ee.Feature(None, {
 'date': date,
 'pop': pop_sum
 })
# ------------------------------------------------------------
# 7. Apply function across image collection
# ------------------------------------------------------------
pop_fc = pop_ic.map(pop_count)
# Bring results to Python
feature_list = pop_fc.toList(pop_fc.size()).getInfo()
dates = [f['properties']['date'] for f in feature_list]
pop_values = [f['properties']['pop'] for f in feature_list]
# ------------------------------------------------------------
# 8. Build DataFrame
# ------------------------------------------------------------
df = pd.DataFrame({
 'date': dates,
 'pop': pop_values
})
df['date'] = pd.to_datetime(df['date'])
df = df.sort_values('date').set_index('date')
# Clean values
df['pop'] = pd.to_numeric(df['pop'], errors='coerce')
df['pop'] = df['pop'].round(0)
# Previous population
df['previous_pop'] = df['pop'].shift(1)
# Percent change
df['change_percent'] = ((df['pop'] - df['previous_pop']) / df['previous_pop']) * 100
# Actual year interval
df['year_diff'] = df.index.to_series().diff().dt.days / 365.25
# Continuous annual growth rate
df['growth_rate'] = np.log(df['pop'] / df['previous_pop']) / df['year_diff']
print(df)
# Save outputs
df.to_csv('population_growth_results.csv')
import plotly.express as px
import plotly.graph_objects as go
# ------------------------------------------------------------
# 9. Standard 2D charts
# ------------------------------------------------------------
pop_df = df.reset_index().copy()
pop_df['year'] = pop_df['date'].dt.strftime('%Y')
fig = px.line(
 pop_df,
 x='year',
 y='pop',
 markers=True,
 title='Total Population in ROI'
)
fig.update_layout(
 xaxis_title='Year',
 yaxis_title='Population',
 template='plotly_white'
)
fig.show()
# ------------------------------------------------------------
# 10. 2D pie chart for population share by year
# ------------------------------------------------------------
pie_df = df.dropna(subset=['pop']).reset_index().copy()
pie_df['year'] = pie_df['date'].dt.strftime('%Y')
fig = px.pie(
 pie_df,
 names='year',
 values='pop',
 title='Population Share by Year'
)
fig.update_traces(textinfo='percent+label')
fig.show()
# ------------------------------------------------------------
# 11. 2D bar chart for percent change
# ------------------------------------------------------------
change_df = df.reset_index().copy()
change_df['year'] = change_df['date'].dt.strftime('%Y')
fig = px.bar(
 change_df,
 x='year',
 y='change_percent',
 title='Population Change (%)'
)
fig.update_traces(marker_color='orange')
fig.update_layout(
 xaxis_title='Year',
 yaxis_title='Percent Change',
 template='plotly_white'
)
fig.show()
# ------------------------------------------------------------
# 12. 2D bar chart for annual growth rate
# ------------------------------------------------------------
growth_df = df.reset_index().copy()
growth_df['year'] = growth_df['date'].dt.strftime('%Y')
fig = px.bar(
 growth_df,
 x='year',
 y='growth_rate',
 title='Annual Population Growth Rate'
)
fig.update_traces(marker_color='red')
fig.update_layout(
 xaxis_title='Year',
 yaxis_title='Growth Rate',
 template='plotly_white'
)
fig.show()