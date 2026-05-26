# NyaaChat 反向代理推荐配置

> 适用范围：通过外层 nginx（或其他反代）将 NyaaChat 容器暴露到另一个域名/HTTPS 端点的部署方式

## 项目对反向代理的支持情况

NyaaChat **完全支持反向代理**。结论依据：

1. **前端全部使用相对路径** — `src/lib/searchApi.ts`、`src/lib/mcpApi.ts`、`src/lib/imageApi.ts` 通过 `/api/search`、`/api/mcp`、`/api/image-proxy/...` 同源访问，没有任何硬编码的 host/origin。CSP 中的 `default-src 'self'` 是相对当前页面 origin 计算的，反代后浏览器看到的就是外部域名，自动适配。
2. **内层 nginx (`nginx.conf:13`) 监听 `:3095` 且没有 `server_name`** — 任意 Host 头都能命中，不会因 Host 不匹配而被拒。
3. **Chat completion 是浏览器直连 LLM provider**（不走容器内 nginx，参见 commit `44956f7`），所以反代不会成为长请求的瓶颈。
4. **响应头不含会被反代破坏的绝对 URL**（无 `Location: http://...` 之类）。
5. **没有 WebSocket**，只有 `/api/mcp` 的 streamable-HTTP/SSE，内层已设置 `proxy_buffering off`（`nginx.conf:146`）。

## 推荐的外层 nginx 反代配置

```nginx
location / {
    proxy_pass http://<nyaachat-host>:3095;
    proxy_http_version 1.1;

    # 标准转发头
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;

    # /api/mcp 是 streamable-HTTP/SSE，必须关掉外层缓冲
    proxy_buffering         off;
    proxy_request_buffering off;
    proxy_set_header        Connection "";

    # 图片代理走 GET，不需要超长超时；MCP 响应内层已限到 60s
    proxy_connect_timeout 10s;
    proxy_send_timeout    120s;
    proxy_read_timeout    120s;

    proxy_redirect off;
}
```

## 注意事项

### CSP `frame-ancestors`

`nginx.conf:21` 中包含 `frame-ancestors 'none'` + `X-Frame-Options "DENY"`。这**仅影响 iframe 嵌入**，普通反向代理（直接以你的域名访问）不受影响。

如果你的部署是把 NyaaChat 放进 iframe 嵌入到另一个站点，需要：

- 把 `frame-ancestors 'none'` 改为 `frame-ancestors https://your-parent-domain.com`
- 把 `X-Frame-Options "DENY"` 改为 `X-Frame-Options "SAMEORIGIN"` 或直接删除（CSP `frame-ancestors` 优先级更高）

### HTTPS + 本地 Ollama 的混合内容限制

如果反代终端走 HTTPS，用户在设置里配置的本地 Ollama (`http://localhost:11434`) 会被浏览器的**混合内容策略**直接拦截。这是 HTTPS 通用限制，与 NyaaChat 无关。CSP 这边已显式放行了 `http://localhost:*` / `http://127.0.0.1:*`，所以从 CSP 角度没问题，问题只出在浏览器混合内容拦截。

解决方法（任选其一）：

- 用户改用 HTTP 访问反代地址
- 在浏览器站点设置里允许"不安全内容"
- 给 Ollama 也套一层本地 HTTPS（自签证书 + 用户信任）

### 端口与协议

- 容器对外暴露 `3095`（`docker-compose.yml:21`），反代上游写 `http://<host>:3095` 即可
- 不要把外层 nginx 的 `Host` 头硬编码成内层期望的某个值，内层不校验 Host
- TLS 终止建议在外层完成，内层保持 HTTP 即可

## 验证清单

部署后建议依次验证：

1. 访问根路径，SPA 正常加载（无 CSP 报错）
2. 设置面板的"测试连通性"按钮 — 验证 `/api/mcp/health`
3. 进行一次包含联网搜索的对话 — 验证 `/api/search`
4. 生成一张图片并刷新页面 — 验证 `/api/image-proxy/...` 缓存命中（`X-Cache-Status` 头）
5. 触发一次 MCP 工具调用 — 验证 streamable-HTTP/SSE 不被外层缓冲（响应是流式而非一次性返回）
