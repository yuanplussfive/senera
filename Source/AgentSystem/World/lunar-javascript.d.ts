declare module "lunar-javascript" {
  interface LunarDate {
    toFullString(): string;
  }

  interface SolarDate {
    getLunar(): LunarDate;
  }

  export class Solar {
    static fromDate(date: Date): SolarDate;
  }
}
