# VeilCheck 测试数据策略

测试数据只使用合成值或许可明确的公开 OCR 数据集，不收集用户截图，不提交真实个人信息。

## 已纳入仓库

- `fixtures/synthetic-pii.json`：28 条确定性文本样本，覆盖固定格式、姓名/学号/地址等上下文字段及常见负样本。
- `fixtures/ocr-clean.svg`：包含三类敏感信息的合成 OCR 图片，用于浏览器端冒烟测试。
- `fixtures/transcript.svg`：合成中文成绩单，用于验证“敏感字段标签—对应内容”的 OCR 检测。
- `fixtures/privacy-sample.pdf`：两页合成英文 PDF，用于验证分页、跨页 OCR、安全重建和导出后文字层清除。
- `benchmark.test.mjs`：逐样本检查标签、误报、漏报以及脱敏后原值是否残留。

这些样本是为 VeilCheck 人工编写的合成数据，不代表任何真实人物或账户。

## 推荐的外部数据源

### SROIE

- 用途：扫描小票的 OCR、旋转、模糊、低对比度和复杂版面测试。
- 规模：约 1,000 张带标注的小票图片。
- 许可：社区整理版标注为 CC BY 4.0，可以在保留署名和 NOTICE 的前提下抽取测试子集。
- 地址：https://github.com/jsdnrs/ICDAR2019-SROIE

### FUNSD

- 用途：低质量扫描表单、文字框定位、键值对和复杂布局。
- 规模：199 张表单、约 30,000 个词级标注。
- 限制：原始数据仅限非商业、研究与教育用途，因此不直接打包进产品仓库。
- 地址：https://github.com/crcresearch/FUNSD

### Faker zh_CN

- 用途：按固定随机种子批量生成中文姓名、地址和电话号码，再叠加字体、缩放、压缩、遮挡等图像扰动。
- 地址：https://faker.readthedocs.io/en/master/locales/zh_CN.html

### Microsoft Presidio

- 用途：参考其合成 PII 数据生成与评估方法，并作为英文 PII 检测对照基线。
- 地址：https://microsoft.github.io/presidio/samples/

## 后续基准设计

1. 将测试分为 `clean`、`compressed`、`blurred`、`rotated`、`low-contrast` 五档。
2. 文本检测记录 precision、recall、F1；图片流程同时记录 OCR 字符错误率和遮挡框覆盖率。
3. 对手机、身份证、邮箱等高风险类别优先优化 recall，同时单独报告误报率。
4. 每次发布固定运行同一批样本，避免只展示成功案例。
