/**
 * `npm run shop:capture` -- a tiny HTTP listener that prints and saves the
 * next WooCommerce webhook delivery it receives, headers and body both, then
 * exits. Used once (per ticket #37) to record the fixture at
 * shop/fixtures/order-updated-processing.json; also handy standalone to
 * inspect a real payload while developing the webhook parser (#39).
 *
 * Usage: npm run shop:capture [-- --out <path>] [-- --port <n>]
 */
import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CAPTURE_PORT } from "./lib/config";

function parseArgs(argv: string[]): { port: number; out: string | null } {
  let port = CAPTURE_PORT;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--out") out = argv[++i];
  }
  return { port, out };
}

const { port, out } = parseArgs(process.argv.slice(2));

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body: unknown = rawBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // keep as raw string
    }

    const captured = {
      capturedAt: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    };

    console.log("--- Webhook received ---");
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body:", JSON.stringify(body, null, 2));

    if (out) {
      const path = resolve(out);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(captured, null, 2) + "\n", "utf8");
      console.log(`Saved to ${path}`);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true }));

    server.close(() => process.exit(0));
  });
});

server.listen(port, () => {
  console.log(`Listening for one webhook delivery on http://0.0.0.0:${port} ...`);
  console.log(
    "(WordPress reaches this via http://host.docker.internal:" + port + " -- see shop/README.md)",
  );
});
