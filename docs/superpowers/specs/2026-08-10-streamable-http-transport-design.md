# Design: Streamable HTTP Transport (MCP 2025-03, Mode B)

**Date:** 2026-08-10  
**Status:** Approved  
**Scope:** Server-side endpoint + client transport package

---

## Context

Mavio sudah punya MCP HTTP+SSE klasik (`GET /mcp/sse` + `POST /mcp?sid=<uuid>`). MCP spec 2025-03 memperkenalkan **Streamable HTTP** yang berbeda: session diidentifikasi via `Mcp-Session-Id` header, dan server bisa stream SSE langsung di response body POST (bukan hanya via channel GET terpisah).

Implementasi ini menambah Streamable HTTP sebagai transport tambahan tanpa mengubah endpoint lama.

---

## Architecture

### Server-side routing

```
POST /mcp  (no Mcp-Session-Id)  → RouterController   → initialize → respond + Mcp-Session-Id header
POST /mcp  + Mcp-Session-Id     → RouterController   → dispatch → reply SSE or JSON
GET  /mcp  + Mcp-Session-Id     → StreamableHttpController → open SSE push stream
DELETE /mcp + Mcp-Session-Id    → StreamableHttpController → terminate session
```

### Files baru

| File | Tujuan |
|---|---|
| `apps/server/src/streamable-http.controller.ts` | `GET /mcp` + `DELETE /mcp` |
| `apps/server/src/streamable-http.session-registry.ts` | Registry session keyed by `Mcp-Session-Id` |
| `packages/transport/src/streamable-http.ts` | Client transport |

### Files dimodifikasi

| File | Perubahan |
|---|---|
| `apps/server/src/router.controller.ts` | Deteksi `Mcp-Session-Id` header; handle streaming POST reply |
| `packages/core/src/index.ts` | Tambah `StreamableHttpTransportDescriptor` |
| `packages/transport/src/index.ts` | Register `StreamableHttpTransport` |
| `apps/server/src/app.module.ts` | Import `StreamableHttpController`, `StreamableHttpSessionRegistry` |

---

## Session Registry

```typescript
interface StreamableSession {
  sessionId: string;
  createdAt: number;
  pushStream: Response | null;  // GET /mcp SSE stream; null jika belum dibuka
  pendingNotifications: string[];  // buffer max 100 frame sebelum GET dibuka
}
```

- Key: `Mcp-Session-Id` (UUID v4, server-generated saat `initialize`)
- TTL: 24 jam; cleanup via `setInterval` setiap 1 jam
- `pushStream` bisa null — notifikasi di-buffer sampai GET dibuka

---

## POST /mcp Flow

### initialize (tanpa `Mcp-Session-Id` header)

1. Validate frame adalah `initialize` → 400 jika bukan
2. Dispatch ke `RouterService.handle()`
3. Registry buat session baru, generate `sessionId`
4. Response: header `Mcp-Session-Id: <sessionId>` + JSON body

### Subsequent POST (session ada)

1. Baca `Mcp-Session-Id` header → 404 jika tidak dikenal atau expired
2. Dispatch ke `RouterService.handle()`
3. Cek `Accept` header:
   - `text/event-stream` → set `Content-Type: text/event-stream`, kirim `event: message\ndata: <frame>\n\n`, tutup stream
   - else → reply JSON biasa (200)

---

## GET /mcp Flow

1. Baca `Mcp-Session-Id` → 404 jika tidak valid
2. Set SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`)
3. Simpan `Response` ke `session.pushStream`
4. Drain `session.pendingNotifications` ke stream
5. Ping keep-alive `": keep-alive\n\n"` setiap 15 detik
6. `req.on("close")` → set `pushStream = null`

---

## DELETE /mcp Flow

1. Baca `Mcp-Session-Id` → 404 jika tidak ada
2. End `pushStream` jika open
3. Hapus session dari registry
4. 200 empty body

---

## Client Transport

### `StreamableHttpTransportDescriptor`

```typescript
interface StreamableHttpTransportDescriptor {
  type: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  auth?: { type: "bearer"; secretRef: string } | { type: "none" };
}
```

### `StreamableHttpSession`

- `open()`: POST `initialize` frame ke `url`, baca `Mcp-Session-Id` dari response header, simpan sebagai `sessionId`
- `send(frame)`: POST ke `url` + header `Mcp-Session-Id` + `Accept: text/event-stream`; parse SSE response body untuk dapat reply frame; fallback parse JSON jika server reply `application/json`
- `close()`: DELETE ke `url` + `Mcp-Session-Id`

---

## Error Table

| Kondisi | Status |
|---|---|
| POST tanpa session, frame bukan `initialize` | 400 |
| `Mcp-Session-Id` tidak dikenal | 404 |
| Session expired (>24h) | 404 |
| RouterService error | 500 |

---

## Out of Scope

- Classic SSE (`GET /mcp/sse`, `POST /mcp?sid`) tidak berubah
- `SseSessionRegistry` tidak disentuh
- `RouterService` tidak berubah
- Server-initiated request (server→client MCP requests) tidak diimplementasi di phase ini
