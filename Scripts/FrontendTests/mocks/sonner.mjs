const calls = [];

function record(variant) {
  return (title, options) => {
    calls.push({ variant, title, options });
  };
}

export const toast = {
  error: record("error"),
  info: record("info"),
  message: record("message"),
  success: record("success"),
  warning: record("warning"),
};

export function Toaster() {
  return null;
}

export function clearTestToastCalls() {
  calls.length = 0;
}

export function readTestToastCalls() {
  return calls;
}
