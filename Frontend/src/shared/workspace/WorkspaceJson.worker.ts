self.onmessage = (event: MessageEvent<string>): void => {
  try {
    const data: unknown = JSON.parse(event.data);
    self.postMessage({ ok: true, data });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
