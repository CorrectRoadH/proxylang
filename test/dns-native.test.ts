import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { createServer as tcpServer } from "node:net";
import { once } from "node:events";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compileProfile, render, outbound } from "../src/index.js";
const exec = promisify(execFile);
const enabled = process.env.PROXYLANG_NATIVE_CHECK === "1";
for (const version of ["1.11.0", "1.12.0"]) {
  // @use-case docs/feature/target-compilation/use-case/build-targets.md
  test.skipIf(!enabled)(
    `sing-box ${version} portable DNS routes real DIRECT requests`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), "proxylang-dns-"));
      const sockets = [createSocket("udp4"), createSocket("udp4")];
      const observed: string[][] = [[], []];
      const web = createServer((_req, res) => res.end("portable-dns-ok"));
      let child: ReturnType<typeof spawn> | undefined;
      try {
        for (const [index, socket] of sockets.entries()) {
          socket.on("message", (packet, remote) => {
            let offset = 12;
            const labels: string[] = [];
            while (packet[offset]) {
              const size = packet[offset++]!;
              labels.push(packet.subarray(offset, offset + size).toString());
              offset += size;
            }
            offset++;
            const qtype = packet.readUInt16BE(offset);
            const questionEnd = offset + 4;
            observed[index]!.push(labels.join(".").toLowerCase());
            const header = Buffer.from(packet.subarray(0, 12));
            header.writeUInt16BE(0x8180, 2);
            header.writeUInt16BE(qtype === 1 ? 1 : 0, 6);
            header.writeUInt16BE(0, 8);
            header.writeUInt16BE(0, 10);
            const answer =
              qtype === 1
                ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 1])
                : Buffer.alloc(0);
            socket.send(
              Buffer.concat([header, packet.subarray(12, questionEnd), answer]),
              remote.port,
              remote.address,
            );
          });
          socket.bind(0, "127.0.0.1");
          await once(socket, "listening");
        }
        web.listen(0, "127.0.0.1");
        await once(web, "listening");
        const webPort = (web.address() as { port: number }).port;
        const reservation = tcpServer();
        reservation.listen(0, "127.0.0.1");
        await once(reservation, "listening");
        const port = (reservation.address() as { port: number }).port;
        await new Promise<void>((resolve) => reservation.close(() => resolve()));
        const result = compileProfile({
          target: {
            engine: "sing-box",
            platform: process.platform === "linux" ? "linux" : "macos",
            version,
          },
          proxies: [],
          groups: [],
          routes: [],
          fallback: outbound.direct,
          singBox: { mode: "standalone", listener: { port, resolver: "127.0.0.1" } },
          dns: [{ pattern: "*.EXAMPLE.test", server: "127.0.0.1" }],
        });
        assert.ok(result.ok && result.engine === "sing-box");
        const content = render(result.compilation, () => undefined)[0]!.content;
        const path = join(root, "config.json");
        await writeFile(path, content);
        const bin = resolve(`.cache/native/sing-box-${version}`);
        await exec(bin, ["check", "-c", path]);
        // Only replace external DNS socket ports: no privileged port 53 or public DNS needed.
        const config = JSON.parse(content);
        for (const [index, server] of config.dns.servers.entries()) {
          const dnsPort = sockets[index]!.address().port;
          if (version === "1.12.0") server.server_port = dnsPort;
          else server.address = `udp://127.0.0.1:${dnsPort}`;
        }
        await writeFile(path, JSON.stringify(config));
        let log = "";
        child = spawn(bin, ["run", "-c", path], { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout!.on("data", (chunk) => {
          log += chunk;
        });
        child.stderr!.on("data", (chunk) => {
          log += chunk;
        });
        const request = (host: string) =>
          exec("curl", [
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "2",
            "--proxytunnel",
            "--proxy",
            `http://127.0.0.1:${port}`,
            "--noproxy",
            "",
            `http://${host}:${webPort}/`,
          ]);
        let ready = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          if (child.exitCode !== null) throw new Error(log);
          try {
            const response = await request("a.example.test");
            assert.equal(response.stdout, "portable-dns-ok");
            ready = true;
            break;
          } catch {
            await delay(50);
          }
        }
        assert.ok(ready, log);
        for (const host of ["A.B.EXAMPLE.test", "example.test", "outside.test"])
          assert.equal((await request(host)).stdout, "portable-dns-ok");
        assert.ok(observed[1]!.includes("a.example.test"));
        assert.ok(observed[1]!.includes("a.b.example.test"));
        assert.ok(!observed[1]!.includes("example.test"));
        assert.ok(!observed[1]!.includes("outside.test"));
        assert.ok(observed[0]!.includes("example.test"));
        assert.ok(observed[0]!.includes("outside.test"));
      } finally {
        if (child && child.exitCode === null) {
          child.kill();
          await once(child, "exit");
        }
        for (const socket of sockets) socket.close();
        await new Promise<void>((resolve) => web.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
