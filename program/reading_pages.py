"""Serve annotation-enabled views without rewriting archived source files."""
import html, json, hashlib
from pathlib import Path
from fastapi.responses import HTMLResponse

BOOT='<script src="/app/global_notes.js" defer></script>'

def readable_response(path,root):
    suffix=path.suffix.lower()
    boot='<meta name="research-source-sha" content="'+hashlib.sha256(path.read_bytes()).hexdigest()+'">'+BOOT
    if suffix=='.html':
        text=path.read_text(encoding='utf-8-sig')
        # Place before body end; scripts are served locally and use the same write protections.
        point=text.lower().rfind('</body>')
        return HTMLResponse(text[:point]+boot+text[point:] if point>=0 else text+boot)
    if suffix not in ('.pdf','.txt','.md','.json','.csv'):return None
    title=path.name
    if suffix=='.pdf':
        from pypdf import PdfReader
        try:
            reader=PdfReader(path)
            parts=[]
            for i,page in enumerate(reader.pages,1):
                text=page.extract_text(extraction_mode='layout', layout_mode_strip_rotated=False) or ''
                parts.append(f'<section id="page-{i}"><h2>第 {i} 页</h2><pre>{html.escape(text) if text.strip() else "本页没有可提取文字，请查看原文件；扫描图片尚未进行OCR。"}</pre></section>')
            content=''.join(parts)
        except Exception:
            content='<p>暂时无法提取PDF文字，请通过上方入口查看原文件。</p>'
        note='PDF文字阅读视图保留页码。公式、表格与多栏顺序请对照原文件；未进行OCR。'
    else:
        content='<pre>'+html.escape(path.read_text(encoding='utf-8-sig',errors='replace'))+'</pre>'
        note='文本阅读视图。'
    return HTMLResponse('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+html.escape(title)+'</title><style>body{font:16px/1.7 system-ui;margin:30px auto;max-width:1100px;padding:0 24px;background:#f6f8fb;color:#223}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:20px}a{color:#176968}</style><body><a href="/app/">科研工作台</a> · <a href="?raw=true" target="_blank">查看原文件</a><h1>'+html.escape(title)+'</h1><p>'+note+'</p><main>'+content+'</main>'+boot+'</body></html>')
