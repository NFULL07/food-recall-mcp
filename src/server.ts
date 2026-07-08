import './env.js';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { start as startCache, isReady, getSnapshot } from './mfds/cache.js';
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

app.get('/health', (_req, res) => {
  if (!isReady()) return res.status(503).json({ ready: false });
  const s = getSnapshot();
  res.json({
    ready: true,
    records: s.records.length,
    sources: s.sources,
    loadedAt: s.loadedAt.toISOString(),
  });
});

async function main() {
  console.log('[boot] 회수 데이터 적재 중…');
  await startCache(); // 도구 호출 경로에서 외부 API를 부르지 않기 위해 기동 시 전량 적재
  app.listen(PORT, () => console.log(`[boot] listening on :${PORT}  POST /mcp`));
}

main().catch((e) => {
  console.error('[boot] 실패:', e.message);
  process.exit(1);
});
