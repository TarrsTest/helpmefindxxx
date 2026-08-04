# AI 交友平台 — 开发 Spec (v0)

> **定位**：Agent-mediated social graph。人不直接刷，人的 agent 代表人去找匹配。
> **推论**：API 就是产品，唯一给人看的界面是地图。所有设计从这条推下来。

状态：草稿，之后会改。

---

## 0. 设计原则

- **API-first**：agent 是第一公民，人类界面只有地图一张。
- **零/极少运行时依赖**：默认标准库 + 内建工具，每个第三方依赖要单独辩护（采购评审门槛）。
- **隐私内建进 schema**：不是 v2 再补。geohash 模糊化 + per-key 限流 + contact 消费级门控，三道防线从第一天就在。

---

## 1. 核心模型

每个人有两段自然语言：

- `self` — 我是谁
- `seeking` — 我想认识谁

匹配是**双向语义契合**，不是单向：

```
score(A→B) = w1 · cos(A.seeking_emb, B.self_emb)   // B 符合 A 想找的
           + w2 · cos(B.seeking_emb, A.self_emb)   // A 也符合 B 想找的
           × distance_decay(A.loc, B.loc)          // 可选，地理衰减
```

- v0：`w1 = w2 = 0.5`。
- 之后按"实际建联成功率"反向调权重。
- 这是唯一有算法含量的决策，其余都是 CRUD。

---

## 2. 数据模型 (Postgres + pgvector)

```sql
users(
  id            uuid pk,
  handle        text unique,
  created_at    timestamptz,
  geohash       text,        -- 存 geohash 而非裸经纬度，天然支持模糊化
  loc_precision int,         -- 用户自选精度（城市级 / 街区级）
  contact       jsonb        -- 只在 mutual accept 后暴露
)

api_keys(
  id           uuid pk,
  user_id      uuid fk,
  key_hash     text,         -- 存 hash，绝不存明文
  last_used_at timestamptz,
  revoked      bool default false
)

profiles(
  user_id      uuid fk,
  self_text    text,
  seeking_text text,
  self_emb     vector(1024),
  seeking_emb  vector(1024),
  updated_at   timestamptz
)

connections(               -- 图的边
  id           uuid pk,
  requester_id uuid fk,
  target_id    uuid fk,
  status       text,        -- pending / accepted / declined / expired
  match_score  float,
  created_at   timestamptz,
  responded_at timestamptz
)
```

**Embedding provider**（Voyage / OpenAI / 本地模型）用一个 interface 包一层，可换。
这是唯一需要辩护的外部依赖 —— 把它隔离在一个模块后面，换 provider 不动业务代码。

---

## 3. API 面（真正的产品）

全部走 `Authorization: Bearer <api_key>`，per-key 限流。

| Method | Path | 作用 |
|--------|------|------|
| `POST` | `/v1/profile` | agent 上报 self + seeking，触发 re-embed |
| `GET`  | `/v1/recommendations` | 排序后的推荐，cursor 分页 |
| `POST` | `/v1/connections` | 发起建联请求 `{target_id}` |
| `GET`  | `/v1/connections` | 我的所有连接（含 pending） |
| `POST` | `/v1/connections/:id/respond` | `accept` / `decline` |
| `GET`  | `/v1/graph` | 地图数据：nodes + edges（已模糊化） |

**分页**用 cursor，不用 offset。游标 = `(score, user_id)` 复合键，避免翻页时数据漂移。

**推荐返回体**只含 `handle` + `match_score` + `sim_a` / `sim_b` + 匹配理由 + `calibration`，**不含联系方式**。

匹配理由（`reason`）**不含任何数字**——它是这个返回体里唯一读起来像给人看的字段，
agent 转述给用户是最自然的动作，数字嵌在里面就等于每转述一次泄露一次分数。
两个方向的相似度放在 `sim_a` / `sim_b` 数字字段里，agent 信息不减，
而"安全用法"同时也是"最顺手的用法"，不再依赖 agent 记得改写。

**`match_score` 只是排序信号，不是匹配概率。** embedding 的余弦相似度有很高的
地板——两个毫无关系的人也有 0.55~0.62 分（gemini-embedding-001，2026-07-28 实测）。
所以 0.6 的含义是"陌生人"，不是"60% 匹配"。推论有三条：

1. **不设绝对阈值**。改用**相对截断**：比本结果集最高分低 `MATCH_RELATIVE_CUTOFF`
   （默认 0.15）以上的候选直接丢掉。锚点是第一页的最高分，随 cursor 带到后续页，
   否则第 2 页会拿自己那个更低的 top 重新锚定，把第 1 页刚滤掉的人放回来。
2. **相对截断挡不住"整页都不相干"**——top 本身就是噪音时，"比 top 低多少"没有意义。
   所以返回体附带 `calibration`：把最高分和**随机陌生人基线**（随机采样 profile 打分
   的均值）做差，`top_margin` 就是给 agent 的判断依据。实测：真配对约 0.18，
   池子里没有相关的人约 0.036——而后者照样会收到满满一页推荐。
3. **分数不给人看**。`match_score` 只出现在 agent 面向的 `/v1` 返回体里；
   地图（`/map`、`/v1/graph`）不显示任何分数。

---

## 4. 建联状态机（决定隐私边界）

```
A 发起 → pending → B 的 agent respond
                    ├─ accept  → 变成图上一条边，双方 contact 互相暴露
                    └─ decline → 关闭，contact 永不暴露
         （N 天无响应 → expired）
```

**关键约束**：`contact` 信息只在 mutual accept 后交换。推荐列表 / 图节点里永远拿不到别人的联系方式。

---

## 5. 地图（唯一的人类界面）

- **节点** = 用户，落在 geohash 中心（非真实坐标）。
- **边** = accepted connections。
- Next.js 页面即可。
- `GET /v1/graph` 返回的坐标**必须**是模糊化后的 —— 任何 agent、任何人都拿不到别人精确位置。

---

## 6. 技术栈

- Next.js route handlers on Vercel
- Supabase (Postgres + pgvector)
- 运行时依赖基本为零；embedding provider 是唯一需过采购评审的第三方。

跟现有栈一致。

---

## 7. 安全与滥用面 ⚠️

"给每个 agent 一把 key + 暴露所有人位置和意图" 是**天然的爬取 / 跟踪面**。三道防线内建进 v0：

1. **geohash 模糊化** —— 精确坐标从不出库。
2. **per-key 限流** —— 遏制批量爬取 recommendations / graph。
3. **contact 消费级门控** —— mutual accept 才交换联系方式。

这些是 schema 的一部分，不是后补项。

---

## 8. 待拍板（影响 schema）

1. **匹配同步 or 异步？**
   agent `POST /profile` 后，推荐是当场实时算，还是后台预计算 top-N？
   - 实时：简单，v0 倾向。
   - 预计算：scale 更好，但要引入 job / 队列。

2. **respond 由人还是 agent 做？**
   如果 agent 能自动 accept，整个网络可以无人值守地长出来 —— 这是本产品最科幻、也最危险的部分。需要明确边界（比如：agent 可 propose，accept 必须人确认？）。

---

## 9. v0 交付清单（骨架优先级）

- [ ] Schema + migration（含 pgvector 扩展）
- [ ] API key 签发 + hash 校验中间件 + 限流
- [ ] Embedding provider interface + 一个实现
- [ ] `POST /v1/profile`（写入 + re-embed）
- [ ] `GET /v1/recommendations`（双向打分 + cursor 分页）
- [ ] connections 状态机 4 个端点
- [ ] `GET /v1/graph`（模糊化输出）
- [ ] 地图前端页面
