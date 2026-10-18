// Smoke test for the bundled language server: start server/dist/node/server.js,
// open a SAS document and request semantic tokens. Catches bundling problems
// (e.g. modules left external that aren't shipped in the VSIX).
import { spawn } from "child_process";

const serverPath = "./server/dist/node/server.js";
const server = spawn(process.execPath, [serverPath, "--stdio"]);
const fail = (message) => {
  console.error(`Language server smoke test failed: ${message}`);
  server.kill();
  process.exit(1);
};
const timer = setTimeout(() => fail("timed out"), 30000);

const send = (message) => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  server.stdin.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
};

const uri = "file:///smoke.sas";
let buffer = Buffer.alloc(0);
server.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const length = Number(
      /Content-Length: (\d+)/.exec(buffer.subarray(0, headerEnd))[1],
    );
    if (buffer.length < headerEnd + 4 + length) {
      return;
    }
    const message = JSON.parse(
      buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString(),
    );
    buffer = buffer.subarray(headerEnd + 4 + length);

    if (message.id === 1) {
      send({ method: "initialized", params: {} });
      send({
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "sas",
            version: 1,
            text: "data a; set sashelp.class; x = 1; run;\nproc print data=a; run;\n",
          },
        },
      });
      send({
        id: 2,
        method: "textDocument/semanticTokens/full",
        params: { textDocument: { uri } },
      });
    } else if (message.id === 2) {
      const count = message.result?.data?.length ?? 0;
      if (count === 0) {
        fail(`no semantic tokens returned (${JSON.stringify(message)})`);
      }
      console.log(`Language server OK: ${count / 5} semantic tokens`);
      clearTimeout(timer);
      server.kill();
    } else if (message.id !== undefined && message.method) {
      // Answer server->client requests (configuration, registration, ...)
      send({ id: message.id, result: null });
    }
  }
});
server.stderr.on("data", (data) => process.stderr.write(data));
server.on("exit", (code) => {
  if (code !== null && code !== 0) {
    fail(`server exited with code ${code}`);
  }
});

send({
  id: 1,
  method: "initialize",
  params: {
    processId: process.pid,
    rootUri: null,
    capabilities: {
      textDocument: {
        semanticTokens: {
          requests: { full: true },
          tokenTypes: [],
          tokenModifiers: [],
          formats: ["relative"],
        },
      },
    },
  },
});
