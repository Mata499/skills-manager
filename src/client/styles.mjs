// Typography and card rhythm follow DSH's own settings pages: system UI stack,
// bold 26px section heading, 15px row names, 13px secondary copy, 12px meta.
export const styles = `
.skm-page{--skm-border:#0000001a;--skm-surface:#00000005;--skm-muted:#00000099;--skm-accent:#111;max-width:1000px;margin:0 auto;padding:8px 4px 32px;color:inherit;font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;box-sizing:border-box}
.skm-page *{box-sizing:border-box}
@media (prefers-color-scheme:dark){.skm-page{--skm-border:#ffffff1f;--skm-surface:#ffffff0f;--skm-muted:#ffffff8c;--skm-accent:#f5f5f5}}
.skm-header{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:4px 0 18px}
.skm-header h2{margin:0 0 6px;font-size:26px;line-height:1.3;font-weight:700;letter-spacing:-.01em}
.skm-header p{margin:0;font-size:14px;color:var(--skm-muted);max-width:52ch}
.skm-page button,.skm-page select,.skm-page input[type=search],.skm-page input[type=text]{font:inherit;color:inherit;background:transparent;border:1px solid var(--skm-border);border-radius:8px;padding:7px 12px}
.skm-page button{cursor:pointer;font-size:13px;font-weight:500;background:var(--skm-surface)}
.skm-page button:hover:not(:disabled){background:#00000010}
.skm-page button:disabled,.skm-page select:disabled{opacity:.45;cursor:default}
.skm-page :focus-visible{outline:2px solid #6d8eff;outline-offset:2px}
.skm-controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;margin:0 0 14px}
.skm-controls label{display:flex;flex:0 1 200px;width:200px;max-width:100%;min-width:0;flex-direction:column;gap:6px;font-size:13px;color:var(--skm-muted)}
.skm-controls select{width:100%;text-overflow:ellipsis}.skm-controls select,.skm-controls input{background:var(--skm-surface);color:inherit}
.skm-controls button{align-self:flex-end;white-space:nowrap}
.skm-stats{display:flex;flex-wrap:wrap;padding:0;margin:0 0 12px;border:1px solid var(--skm-border);border-radius:10px;background:var(--skm-surface);overflow:hidden}
.skm-stats>*{flex:1 1 auto;padding:12px 16px;font-size:14px;border-right:1px solid var(--skm-border)}
.skm-stats>*:last-child{border-right:0}
.skm-notice,.skm-error{margin:0 0 10px;padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.6;background:#f6b73c0f;border:1px solid #f6b73c40;overflow-wrap:anywhere}
.skm-error{background:#e5484d0f;border-color:#e5484d40}
.skm-muted{font-size:12px;color:var(--skm-muted);overflow-wrap:anywhere}
.skm-filters{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 12px}
.skm-filters input[type=search]{flex:1 1 260px;background:var(--skm-surface)}
.skm-filters select{background:var(--skm-surface);min-width:130px}
.skm-list{display:flex;flex-direction:column;gap:10px}
.skm-group{border:1px solid var(--skm-border);border-radius:12px;overflow:hidden;background:transparent}
.skm-group summary{display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;font-size:15px;font-weight:600;list-style:none;background:var(--skm-surface)}
.skm-group summary::-webkit-details-marker{display:none}
.skm-group summary::before{content:'▾';font-size:11px;opacity:.55;transition:transform .15s}
.skm-group:not([open]) summary::before{transform:rotate(-90deg)}
.skm-root{margin-left:auto;font-size:12px;font-weight:400;color:var(--skm-muted);overflow-wrap:anywhere;text-align:right}
.skm-row{display:flex;align-items:center;gap:16px;padding:12px 16px;border-top:1px solid var(--skm-border)}
.skm-copy{flex:1;min-width:0;overflow-wrap:anywhere}
.skm-name{padding:0!important;border:0!important;background:none!important;font-size:15px;font-weight:600;text-align:left;line-height:1.45}
.skm-name:hover{text-decoration:underline}
.skm-copy p{margin:2px 0 0;font-size:13px;color:var(--skm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skm-copy>span{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:6px;font-size:12px;color:var(--skm-muted);background:var(--skm-surface);white-space:nowrap}
.skm-toggle{display:flex;align-items:center;gap:8px;flex:none;font-size:12px;color:var(--skm-muted);white-space:nowrap;cursor:pointer}
.skm-toggle input{appearance:none;-webkit-appearance:none;position:relative;width:40px;height:22px;margin:0;border-radius:999px;background:#00000026;border:0;cursor:pointer;transition:background .15s}
.skm-toggle input::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #0003;transition:transform .15s}
.skm-toggle input:checked{background:var(--skm-accent)}
.skm-toggle input:checked::after{transform:translateX(18px)}
.skm-toggle input:disabled{opacity:.45;cursor:default}
.skm-empty{padding:36px 16px;text-align:center;font-size:13px;color:var(--skm-muted)}
.skm-dialog{width:min(820px,92vw);max-height:84vh;padding:24px;border:1px solid var(--skm-border);border-radius:14px;color:inherit;background:Canvas;font-family:inherit}
.skm-dialog::backdrop{background:#00000066}
.skm-dialog h3{margin:0 0 4px;font-size:18px;font-weight:700;padding-right:96px;overflow-wrap:anywhere}
.skm-dialog>button{float:right}
.skm-dialog pre{margin:16px 0 0;padding:14px;border-radius:10px;background:var(--skm-surface);white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:56vh;overflow:auto}
.skm-dialog[open]{display:block}
@media (max-width:640px){.skm-page{padding:0}.skm-header{flex-direction:column}.skm-header h2{font-size:22px}.skm-stats>*{flex-basis:50%;border-bottom:1px solid var(--skm-border)}.skm-toggle span{display:none}.skm-row{gap:10px;padding:12px}.skm-root{display:none}}
`;
