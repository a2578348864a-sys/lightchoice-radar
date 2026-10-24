# AMZ123 交付证据生成器补丁

新增文件：
- `scripts/amz123-evidence-shape.ts`：纯函数，负责元数据白名单、正文泄漏检测、诊断字段过滤和验收项判断。
- `scripts/generate-amz123-delivery-evidence.ts`：只读查询 PostgreSQL、探测 3000/3001、读取 `radar-ops status`，生成 JSON 交付证据。
- `tests/amz123-delivery-evidence.standalone.test.ts`：覆盖正文不泄漏、诊断字段白名单、Worker 状态判读及关键边界验收。

在最新 LightChoice Radar 仓库根目录放入对应文件后运行：

```powershell
node --env-file=.env scripts/generate-amz123-delivery-evidence.ts --expect-no-worker
```

默认输出到 `docs/radar/amz123-lead-collection-YYYY-MM-DD.json`（按北京时间命名）。如果当天证据文件已存在，会拒绝覆盖；确认需要重生成同名文件时再加 `--force`，或通过 `--out docs/radar/amz123-lead-collection-rerun.json` 指定新文件。如果需要验证其他基线，可传 `--baseline 3,2,20`，顺序固定为 `platform_policy,ads_policy,external_regulation`。

生成器只读数据库，不会启动/停止 Worker、抓取 AMZ123 页面、执行迁移或修改任何数据库行。它只读取正文是否为空及长度，不把 `body_text`、`body_html` 或原始 `raw` JSON 序列化进证据文件。关键检查失败时仍写出证据，并以退出码 2 提示验收未通过；采集/数据库错误以退出码 1 结束。

注意：此补丁基于对话中提供的最新 `CURRENT.md` 与证据 JSON，以及上传的项目 ZIP 中可见的数据库结构设计。上传 ZIP 是较旧快照，不包含第十八轮的 `amz123.ts` 和 `radar-ops.ts` 最新实现；因此本补丁没有声称已合入用户本机当前工作区，也未执行真实数据库验收。
