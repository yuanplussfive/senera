self.onmessage = (event: MessageEvent<string>): void => {
  // Dedicated-worker messages use an empty origin in browsers; when an origin
  // is provided, reject messages from a different document origin.
  if (event.origin && event.origin !== self.location.origin) return;
  try {
    const data: unknown = JSON.parse(event.data);
    self.postMessage({ ok: true, data });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
