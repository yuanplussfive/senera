import { createRequire } from "node:module";
import { Temporal } from "@js-temporal/polyfill";
import type { AgentWorldCalendarProjection } from "./AgentWorldTypes.js";
import type { Solar } from "lunar-javascript";
import type { holiday as HolidayApi } from "@kang8/chinese-holidays";

const requireCjs = createRequire(import.meta.url);

// lunar-javascript is a ~800KB legacy CJS bundle; require it on first calendar
// projection instead of at module-evaluation time so idle processes skip it.
interface AgentCalendarModules {
  holiday: typeof HolidayApi;
  Solar: typeof Solar;
}

let calendarModules: AgentCalendarModules | undefined;

function loadCalendarModules(): AgentCalendarModules {
  calendarModules ??= {
    holiday: requireCjs("@kang8/chinese-holidays").holiday,
    Solar: requireCjs("lunar-javascript").Solar,
  };
  return calendarModules;
}

export function projectChineseWorldCalendar(date: Temporal.PlainDate, _timeZone: string): AgentWorldCalendarProjection {
  const { holiday, Solar } = loadCalendarModules();
  const jsDate = new Date(`${date.toString()}T12:00:00`);
  const lunarSummary = Solar.fromDate(jsDate).getLunar().toFullString();
  return {
    date: date.toString(),
    isHoliday: holiday.isHoliday(jsDate),
    isWorkday: holiday.isWorkday(jsDate),
    isPublicHoliday: holiday.isPublicHoliday(jsDate),
    isPublicWorkday: holiday.isPublicWorkday(jsDate),
    holidayName: holiday.publicHolidayName(jsDate),
    lunarSummary,
  };
}
