Dust Risk Mapping using Machine Learning Technique 
#1. Mount Drive 
from google.colab import drive
drive.mount('/content/drive')

#2.Core Imports 
!pip install --upgrade xee
!pip install -U geemap
import ee

#3.Earth Engine Authentication & Initialization 
ee.Authenticate()
ee.Initialize(
 project = 'ee-faizamsemo',
 opt_url = 'https://earthengine-highvolume.googleapis.com'
)

#4.Create an Interactive Map Setup 
import geemap
viz_map = geemap.Map(basemap='SATELLITE')
viz_map

# 5. Capture the last drawn feature on the map as the region of interest (ROI) 
roi = viz_map.draw_last_feature.geometry()
roi

# 6.Define study period and monthly time list 
time_start = ee.Date('2020')
time_end = ee.Date('2021')
time_dif = time_end.difference(time_start, 'month').round()
time_list = ee.List.sequence(0, ee.Number(time_dif).subtract(1)).map(
 lambda x: time_start.advance(x, 'month')
)

# Step 7: Load MODIS AOD data 
aod = (
 ee.ImageCollection("MODIS/061/MCD19A2_GRANULES")
 .filterDate(time_start, time_end)
 .select(['Optical_Depth_055'], ['aod'])
 .filter(ee.Filter.eq('SATELLITE', 'T'))
 .filterBounds(roi)
)

# Step 8: Function to convert image collection into monthly mean images 
def monthly(date, col):
 start_date = ee.Date(date)
 end_date = start_date.advance(1, 'month')
 col_img = col.filterDate(start_date, end_date).mean()
 col_size = ee.Number(col_img.bandNames().size())
 return col_img.set('system:time_start', start_date.millis()).set('band_size', col_size)
 
# Step 9: Create monthly AOD collection 
aod_monthly = ee.ImageCollection(
 time_list.map(lambda x: monthly(x, aod))
)

# Step 10: Load TerraClimate data 
terra = (
 ee.ImageCollection("IDAHO_EPSCOR/TERRACLIMATE")
 .filterDate(time_start, time_end)
 .select('pr', 'soil', 'vs', 'tmmn', 'tmmx')
)

# Step 11: Create monthly TerraClimate collection 
terra_monthly = ee.ImageCollection(
 time_list.map(lambda x: monthly(x, terra))
)

# Step 12: Load MODIS NDVI data 
ndvi = (
 ee.ImageCollection("MODIS/061/MOD13Q1")
 .filterDate(time_start, time_end)
 .select(['NDVI'], ['ndvi'])
)

# Step 13: Create monthly NDVI collection 
ndvi_monthly = ee.ImageCollection(
 time_list.map(lambda x: monthly(x, ndvi))
)

# Step 14: Combine all monthly predictor collections 
collection = aod_monthly.combine(terra_monthly).combine(ndvi_monthly)

# Step 15: Create land/water mask from land cover 
mask = (
 ee.ImageCollection("MODIS/061/MCD12Q1")
 .filterDate(time_start, time_end)
 .select('LC_Type1')
 .mode()
 .eq(17)
 .Not()
 .rename('water_mask')
)

# Step 16: Convert water mask to xarray dataset 
import xarray as xr
ds_mask = xr.open_dataset(
 mask,
 engine='ee',
 crs='EPSG:4326',
 geometry=roi,
 scale=0.1
)
ds_mask = ds_mask.squeeze('time').drop_vars('time') * 1

# Step 17: Plot water mask 
ds_mask.water_mask.plot(
 x='lon',
 y='lat'
)

# Step 18: Convert predictor collection to xarray dataset 
ds = xr.open_dataset(
 collection,
 engine='ee',
 crs='EPSG:4326',
 geometry=roi,
 scale=0.1
)
ds = ds.sortby('time') * 1
 
# Step 19: Apply water mask 
import numpy as np
# Reindex ds_mask to align with ds's coordinates
ds_mask_aligned = ds_mask.reindex_like(ds, method='nearest')
ds = xr.where(ds_mask_aligned.water_mask == 0, np.nan, ds)

# Step 20: Define dust presence/absence based on AOD threshold 
ds['dust'] = ((ds.aod * 0.001) >= 0.5).astype(int)

# Step 21: Inspect final dataset 
ds

# Step 22: Plot dust occurrence maps
ds.dust.plot(
 x='lon',
 y='lat',
 col='time',
 col_wrap=6
)

# Step 23: Plot AOD maps 
ds.aod.plot(
 x='lon',
 y='lat',
 col='time',
 robust=True,
 col_wrap=6
)

# Step 24: Convert dataset to dataframe and remove missing values 
df = ds.to_dataframe().dropna()
df

# Step 25: Split data into predictors and target 
from sklearn.model_selection import train_test_split
x = df[['ndvi', 'pr', 'soil', 'vs', 'tmmn', 'tmmx']]
y = df['dust']
x_train, x_test, y_train, y_test = train_test_split(
 x, y, test_size=0.2, random_state=42
)

# Step 26: Train Logistic Regression model 
from sklearn.linear_model import LogisticRegression
model = LogisticRegression(max_iter=1000)
model.fit(x_train, y_train)
 
# Step 27: Make predictions 
y_pred = model.predict(x_test)
y_prob = model.predict_proba(x_test)

# Step 28: Evaluate classification performance
from sklearn.metrics import classification_report, roc_auc_score
class_rep = classification_report(y_test, y_pred)
print(class_rep)
roc = roc_auc_score(y_test, y_prob[:, 1])
print(roc)

# Step 29: Predict risk probability for the full dataset 
df['risk'] = model.predict_proba(
 df[['ndvi', 'pr', 'soil', 'vs', 'tmmn', 'tmmx']]
)[:, 1]

# Step 30: Convert dataframe back to xarray 
dfx = df.to_xarray().sortby(['time', 'lat', 'lon'])
dfx

# Step 31: Calculate mean risk over time 
risk = (dfx.risk * 1000).mean(dim='time')

# Step 32: Plot average dust risk map
risk.plot(
 x='lon',
 y='lat',
 robust=True
)

# Step 33: Plot monthly dust risk maps 
dfx.risk.plot(
 x='lon',
 y='lat',
 col='time',
 col_wrap=6,
 robust=True
)