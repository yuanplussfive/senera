export type WeatherToolArguments = {
  // 城市、地区、地址、邮编或国家地区组合，例如 北京、上海浦东、Tokyo、New York。
  location: string;

  // 查询天数。1 表示当前天气；2-7 返回当前天气和逐日预报。
  days?: number;

  // 返回语言；默认使用插件配置，例如 zh 或 en。
  language?: string;

  // 请求超时；通常不需要填写。
  timeoutMs?: number;
};
