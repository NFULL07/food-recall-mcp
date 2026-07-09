import './env.js';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { start as startCache, stats } from './mfds/cache.js';
import { PORT } from './mfds/config.js';

function newServer() {
  const server = new McpServer(
    { name: 'sikjajae-recall-check', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );
  registerTools(server);
  return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// PlayMCP: Stateless MCP 서버 권장 (no session)
app.post('/mcp', async (req, res) => {
  const server = newServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp] error', e);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  }
});

// Stateless: GET/DELETE 는 지원하지 않는다
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Stateless server.' },
    id: null,
  });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

// health: 서버가 살아있으면 항상 200(배포 플랫폼의 헬스체크 통과용).
// 데이터 적재 여부는 응답 본문의 ready/records 로 표시한다.
app.get('/health', (_req, res) => {
  res.json(stats());
});

async function main() {
  console.log('[boot] 회수 데이터 적재 시도 (실패해도 서버는 기동, 백그라운드 재시도)…');
  await startCache(); // 데이터가 없어도 서버 기동을 막지 않는다
  app.listen(PORT, () => console.log(`[boot] listening on :${PORT}  POST /mcp`));
}

main().catch((e) => {
  console.error('[boot] 실패:', e.message);
  process.exit(1);
});
