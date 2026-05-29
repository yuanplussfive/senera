export type WeatherToolArguments = {
  // 城市、地区或地址文本，例如 Shanghai、Beijing、New York。
  // 和 latitude/longitude 二选一；如果提供经纬度，可以省略。
  location?: string

  // 纬度，范围 -90..90；必须和 longitude 同时提供。
  latitude?: number

  // 经度，范围 -180..180；必须和 latitude 同时提供。
  longitude?: number

  // IANA 时区；默认 "auto"。
  timezone?: string

  // 温度单位；默认 "celsius"。
  temperatureUnit?: "celsius" | "fahrenheit"

  // 整数。天气接口请求超时，范围 1000..9000；默认 8000。
  timeoutMs?: number
}
