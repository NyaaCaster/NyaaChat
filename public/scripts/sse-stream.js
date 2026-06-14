// Shim for SillyTavern's public/scripts/sse-stream.js.

export function getEventSourceStream() {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(""));
      controller.close();
    },
  });
}
