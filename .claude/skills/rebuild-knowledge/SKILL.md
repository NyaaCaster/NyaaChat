---
name: rebuild-knowledge
description: Rebuild the NyaaChat knowledge base backend Docker image and restart its container, independently of the frontend and shared-server. Use whenever knowledge backend code, its Dockerfile, or docker-compose.knowledge.yml changes. Runs rebuild-knowledge.py — a cross-platform Python script that works on Windows, Linux, and macOS.
---

# rebuild-knowledge

重新编译并重启知识库后端（nyaachat-knowledge，端口 5108）。与前端和共享后端相互独立。

## 执行方式

```
python rebuild-knowledge.py
```

无缓存重建: `python rebuild-knowledge.py --no-cache`

## 验证

构建后访问 `http://<host>:3095/api/knowledge/health` → `{ "ok": true, "db": "ok" }`
