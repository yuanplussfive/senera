const C0ControlCharacterLimit = 0x1f;
const DeleteControlCharacter = 0x7f;

export function createTerminalInputScheduler(send: (input: string) => void): {
  push: (input: string) => void;
  discard: () => void;
} {
  let buffered = "";
  let frame = 0;
  const discard = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
    buffered = "";
  };
  const flush = (): void => {
    const value = buffered;
    discard();
    if (value) send(value);
  };
  return {
    push: (input) => {
      if (containsControlCharacter(input)) {
        flush();
        send(input);
      } else {
        buffered += input;
        if (!frame) frame = requestAnimationFrame(flush);
      }
    },
    discard,
  };
}

function containsControlCharacter(input: string): boolean {
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code <= C0ControlCharacterLimit || code === DeleteControlCharacter) return true;
  }
  return false;
}
