import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export const jsonConfigFormMessages = {
  add: () => frontendMessage("config.form.add"),
  addRecord: () => frontendMessage("config.form.addRecord"),
  copy: () => frontendMessage("config.form.copy"),
  delete: () => frontendMessage("config.form.delete"),
  disabled: () => frontendMessage("config.form.disabled"),
  empty: () => frontendMessage("config.form.empty"),
  enabled: () => frontendMessage("config.form.enabled"),
  off: () => frontendMessage("config.form.off"),
  on: () => frontendMessage("config.form.on"),
  selectPlaceholder: () => frontendMessage("config.form.selectPlaceholder"),
  itemLabel: (label: string, index: number) => frontendMessage("config.validation.itemLabel", { label, index }),
  optionItemSuffix: (index: number) => frontendMessage("config.validation.optionItemSuffix", { index }),
  validation: {
    arrayExpected: (label: string) => frontendMessage("config.validation.arrayExpected", { label }),
    booleanExpected: (label: string) => frontendMessage("config.validation.booleanExpected", { label }),
    emptyRequired: (label: string) => frontendMessage("config.validation.emptyRequired", { label }),
    max: (label: string, max: number) => frontendMessage("config.validation.max", { label, max }),
    min: (label: string, min: number) => frontendMessage("config.validation.min", { label, min }),
    minLength: (label: string, minLength: number) =>
      frontendMessage("config.validation.minLength", { label, minLength }),
    maxLength: (label: string, maxLength: number) =>
      frontendMessage("config.validation.maxLength", { label, maxLength }),
    missingRequired: (label: string) => frontendMessage("config.validation.missingRequired", { label }),
    numberExpected: (label: string) => frontendMessage("config.validation.numberExpected", { label }),
    objectExpected: (label: string) => frontendMessage("config.validation.objectExpected", { label }),
    optionExpected: (label: string, suffix = "") =>
      frontendMessage("config.validation.optionExpected", { label, suffix }),
    stringExpected: (label: string) => frontendMessage("config.validation.stringExpected", { label }),
    tableExpected: (label: string) => frontendMessage("config.validation.tableExpected", { label }),
  },
} as const;
