# 开发与发布

## 本地验证

Windows x64，标准 Python 3.13 x64；JavaScript 检查还需要 Node.js。

```powershell
python tools/fetch_wheels.py
python runtime.py install
.venv/Scripts/python.exe -m unittest discover -s tests -v
node tests/test_anchor.cjs
node --check program/static/app.js
node --check program/static/annotations.js
.venv/Scripts/python.exe tools/build_release.py
.venv/Scripts/python.exe tools/verify_release.py dist/ResearchWorkbench-1.3.0-beta.1-windows-x64.zip
```

`verify_release.py` 从指定 ZIP 解压到临时的中文/空格目录，用全新 venv 执行离线安装、启动、保存、导出、独立空库恢复、重启与停止；测试数据不会写回仓库示例。测试只使用 localhost。

## 构建约定

- `release-files.json` 是发布文件的明确允许清单。更新代码布局时同步它。
- `examples/site/` 只使用虚构数据；`site/`、缓存、日志、测试输出和个人记录不进入包。
- `dependencies.lock.json` 固定官方 URL、文件名、大小和 SHA256；pip 同时启用 `--require-hashes`。
- 原始第三方许可在 `third_party/licenses/`，未修改的 certifi 源包在 `third_party/sources/`。
- 构建快照只读取示例。ZIP 顺序和时间戳固定，同一份源码与依赖在同一构建环境中应生成相同文件。
- 先修改 `VERSION.txt` 和 `CHANGELOG.md`，生成包并验收；Release 标签、源代码与资产版本须一致。

## GitHub 自动检查

Windows 工作流会获取锁定依赖、运行测试与 JS 检查、构建并验证 ZIP。工作流只有读取仓库权限，不会自动创建公开 Release。发布包作为工作流产物供维护者检查。

首次公开发布应标为 Pre-release。源码仓库不存 wheel 或运行环境；离线依赖放在 Release ZIP 中。发布前核对源代码和 ZIP 不包含真实个人资料，并记录未验证的平台或浏览器路径。

GitHub 自动检查通过只代表对应运行器上的结果，不等于所有真实电脑都已验证。
