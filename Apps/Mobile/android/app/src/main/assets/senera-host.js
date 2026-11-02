(() => {
  if (window !== window.top) return;
  const pending = new Map();
  const sockets = new Map();
  const documentId = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join("-");
  let sequence = 0;
  const request = (action, params = {}) =>
    new Promise((resolve, reject) => {
      const id = `${documentId}:${++sequence}`;
      pending.set(id, { resolve, reject });
      try {
        seneraNative.postMessage(JSON.stringify({ id, action, params }));
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  seneraNative.onmessage = ({ data }) => {
    const response = JSON.parse(data);
    if (response.kind === "socket.event") {
      const receive = sockets.get(response.id);
      if (response.event.type === "close") sockets.delete(response.id);
      if (receive) queueMicrotask(() => receive(response.event));
      return;
    }
    const operation = pending.get(response.id);
    if (!operation) return;
    pending.delete(response.id);
    if (response.ok) operation.resolve(response.result);
    else operation.reject(new Error(response.error));
  };
  window.__SENERA_MOBILE__ = Object.freeze({
    connectSocket: (url, receive) => {
      const socketId = `${documentId}:socket:${++sequence}`;
      sockets.set(socketId, receive);
      request("socket.open", { socketId, url }).catch((error) => {
        if (!sockets.delete(socketId)) return;
        receive({ type: "error", message: error.message });
        receive({ type: "close", code: 1006, reason: error.message, wasClean: false });
      });
      return {
        send: (data) => request("socket.send", { socketId, data }),
        close: (code, reason) => request("socket.close", { socketId, code, reason }),
      };
    },
    openExternal: (url) => request("external", { url }),
    download: (url, fileName) => request("download", { url, fileName }),
    openConnections: () => request("connections"),
    openBackgroundSettings: () => request("background.settings"),
    openWebClient: (url) => request("client", { url }),
    saveFile: async (blob, fileName) => {
      const { transferId } = await request("save.begin", { fileName, mime: blob.type });
      try {
        const chunkBytes = 64 * 1024;
        for (let offset = 0; offset < blob.size; offset += chunkBytes) {
          const bytes = new Uint8Array(await blob.slice(offset, offset + chunkBytes).arrayBuffer());
          const data = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
          await request("save.write", { transferId, data });
        }
        await request("save.finish", { transferId });
      } catch (error) {
        await request("save.abort", { transferId }).catch(() => {});
        throw error;
      }
    },
  });
  window.addEventListener("pagehide", () => {
    for (const operation of pending.values()) operation.reject(new Error("The document was closed."));
    pending.clear();
    sockets.clear();
  });
})();
