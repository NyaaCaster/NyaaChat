/**
 * T2I Agent API — calls the ext-host endpoint to generate an English image
 * prompt via the deployer-paid LLM. The frontend sends ONLY messages; the
 * API key, base URL, and model are injected server-side from process.env.
 *
 * @see ext-host/src/server.js  proxyT2iAgent
 */

export async function fetchT2iAgentPrompt(
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/ext-host/t2i-agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `T2I agent error (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("T2I agent returned an empty prompt");
  }

  return content.trim();
}
