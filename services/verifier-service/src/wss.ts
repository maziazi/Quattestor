/**
 * Real-time trigger over NOWNodes WSS (architecture doc §2.1 step E, §9.5).
 * Plain `eth_subscribe` over the WebSocket global (Node 22+) -- no
 * ethers.WebSocketProvider, no extra `ws` dependency. NOWNodes has no
 * webhook support for EVM chains (confirmed in doc §9.5), so this is the
 * only real-time mechanism available; everything else is request/response.
 */
export function subscribeLogs(
  wssUrl: string,
  filter: { address: string; topics?: (string | null)[] },
  onLog: (log: unknown) => void,
): WebSocket {
  const ws = new WebSocket(wssUrl);

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: ["logs", filter],
      }),
    );
  });

  ws.addEventListener("message", (event: MessageEvent) => {
    const msg = JSON.parse(String(event.data));
    if (msg.method === "eth_subscription") onLog(msg.params.result);
  });

  ws.addEventListener("error", (event: Event) => {
    console.error("[wss] error", event);
  });

  return ws;
}
