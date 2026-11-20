# Research Workbench 1.2.0-beta.1

首个公开测试版：在本机阅读 Markdown、选中原文写批注、记录理解，整理已保存的疑问供手动与 AI 讨论。

## 安装

Windows x64，标准 CPython 3.13 x64。下载下方 `ResearchWorkbench-1.2.0-beta.1-windows-x64.zip`，完整解压，依次运行“首次安装.cmd”和“启动工作台.cmd”。包内有离线依赖，不含 Python 解释器。`Source code` 自动压缩包是源码，安装前需按 README 获取依赖。

## 数据和许可

只附虚构阅读示例与空白索引。笔记保存在本机 `site/07_个人记录`；JSON 导出不含正文与 PDF，完整迁移需同时保留 `site/`。项目自有代码使用 MIT；依赖许可、版权声明及 certifi 对应源包随离线 ZIP 提供。

## 已知范围

当前为测试版。外部网页和独立 PDF 划词批注、多人协作、云同步、嵌入式模型调用尚未实现。用户应自行备份重要内容。已在本机独立解压环境验证，第二台物理电脑的人工试用待补充。

校验文件 `.zip.sha256` 可用于核对下载完整性。源码测试与实际 ZIP 验收方法见 `docs/DEVELOPMENT.md`。
