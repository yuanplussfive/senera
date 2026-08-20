---
name: weather-forecast
description: Query current weather and forecasts for a city, region, address, postal code, or coordinates. Use for temperature, rain, humidity, wind, sunrise, sunset, and future weather questions that require current provider data. 适用于查询城市、地区、地址或坐标的实时天气、天气预报、温度、降雨、湿度、风力和日出日落。
metadata:
  senera:
    recommended-tools:
      - mcp__weather__forecast
---

# Weather Forecast

Use `mcp__weather__forecast` for current observations and forecasts.

- Preserve the user's location wording in `location`.
- Set `days` only when the requested horizon is clear.
- Use the returned observation and forecast as the source of truth.
- State when the provider does not return a requested field.
