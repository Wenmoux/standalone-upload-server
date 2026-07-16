/**
 * [INPUT]: 依赖 Admin 构建产物、共享设计令牌，以及由控制面组合根注入的配置、鉴权和运行诊断能力
 * [OUTPUT]: 对外提供 createControlPanelPages，生成 Setup、状态、日志、成功页与 Admin 壳页面
 * [POS]: docker 控制面的纯页面渲染层，只把受信数据映射为 HTML，不读写配置或决定路由权限
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

function createControlPanelPages(options = {}) {
    const CONFIG_KEYS = options.configKeys || [];
    const DEFAULT_CONFIG_FILE = options.defaultConfigFile;
    const DEFAULT_RUNTIME_LOG_FILE = options.defaultRuntimeLogFile;
    const RESTART_DELAY_MS = options.restartDelayMs;
    const authCookie = options.authCookie;
    const authPath = options.authPath;
    const collectDiagnostics = options.collectDiagnostics;
    const collectStatus = options.collectStatus;
    const currentValues = options.currentValues;
    const designTokensCss = options.designTokensCss;
    const filterLogText = options.filterLogText;
    const htmlEscape = options.htmlEscape;
    const readLogTail = options.readLogTail;
    let adminIndexCache = { file: "", mtimeMs: 0, html: "" };

    function field({
        id,
        label,
        type = "text",
        value = "",
        placeholder = "",
        helper = "",
        required = false,
        wide = false,
        autocomplete = "",
        secret = false,
        generator = false
    }) {
        const toggle = secret ? `<button class="input-action" type="button" data-toggle-target="${id}">显示</button>` : "";
        const generate = generator ? `<button class="input-action" type="button" data-generate-target="${id}">生成</button>` : "";
        return `<label class="field ${wide ? "field-wide" : ""}" for="${id}">
          <span class="field-label">${htmlEscape(label)}${required ? '<b aria-hidden="true">*</b>' : ""}</span>
          <span class="input-wrap">
            <input id="${id}" name="${id}" type="${type}" ${required ? "required" : ""} ${autocomplete ? `autocomplete="${autocomplete}"` : ""} value="${htmlEscape(value)}" placeholder="${htmlEscape(placeholder)}">
            ${toggle}${generate}
          </span>
          ${helper ? `<span class="field-helper">${helper}</span>` : ""}
        </label>`;
    }

    function sharedStyles() {
        return `<style>${designTokensCss()}
        :root{--bg:var(--po18-bg);--surface:var(--po18-surface);--surface-2:var(--po18-surface-alt);--text:var(--po18-text);--muted:var(--po18-muted);--line:var(--po18-line);--primary:var(--po18-accent);--primary-dark:var(--po18-accent-dark);--success:var(--po18-success);--danger:var(--po18-danger);--warn:var(--po18-warning);--shadow:var(--po18-shadow);--radius:var(--po18-radius-lg)}
        *{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--po18-font-sans);letter-spacing:0}
        .topbar{position:sticky;top:0;z-index:2;min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 28px;background:rgba(255,255,255,.92);border-bottom:1px solid rgba(217,226,239,.92);backdrop-filter:saturate(140%) blur(14px)}
        .brand{display:flex;align-items:center;gap:12px;min-width:0}.mark{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#e8f0ff;color:var(--primary);font-weight:800;box-shadow:inset 0 0 0 1px #c8d9ff}.brand strong{display:block;font-size:16px;line-height:1.15}.brand span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
        .chip{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border-radius:999px;color:#285347;background:#e7f6ee;border:1px solid #c7ead5;font-size:13px;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:#16a34a}
        main{width:min(1120px,100%);margin:0 auto;padding:34px 20px 54px}.layout{display:grid;grid-template-columns:minmax(240px,310px) minmax(0,1fr);gap:22px;align-items:start}
        .summary,.panel,.success-card{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.summary{padding:22px;box-shadow:0 10px 28px rgba(15,23,42,.07)}
        h1{font-size:28px;line-height:1.18;margin:0 0 10px;font-weight:780}.lead{margin:0;color:var(--muted);line-height:1.72;font-size:14px}
        .path{margin-top:18px;padding:12px 13px;border-radius:10px;background:#eef4ff;color:#1e3a8a;border:1px solid #d5e3ff;word-break:break-all;font-family:"SFMono-Regular",Consolas,monospace;font-size:12px}
        .nav{display:grid;gap:8px;margin-top:18px}.nav a{display:flex;align-items:center;min-height:38px;padding:0 12px;border-radius:8px;color:#315071;text-decoration:none;font-weight:700;font-size:13px}.nav a:hover{background:#eef4ff;color:var(--primary)}
        .panel{overflow:hidden}.notice{margin:0;padding:14px 18px;border-bottom:1px solid var(--line);font-size:14px;line-height:1.5}.notice-ok{background:#effaf3;color:var(--success)}.notice-error{background:#fff1f2;color:var(--danger)}
        form{margin:0}.section{padding:22px 24px;border-top:1px solid var(--line)}.section:first-of-type{border-top:0}.section-head{margin:0 0 16px}.section-title{font-size:15px;font-weight:760;margin:0}.section-desc{margin:5px 0 0;color:var(--muted);font-size:13px;line-height:1.55}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field{display:block;min-width:0}.field-wide{grid-column:1/-1}.field-label{display:flex;gap:4px;align-items:center;min-height:22px;margin-bottom:7px;color:#26344d;font-size:13px;font-weight:700}.field-label b{color:var(--danger);font-weight:800}
        .input-wrap{display:flex;align-items:center;gap:8px}input{width:100%;min-height:46px;padding:11px 13px;border:1px solid #cbd6e5;border-radius:8px;background:var(--surface-2);color:var(--text);font:inherit;font-size:14px;outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}input:hover{border-color:#9fb3ce;background:#fff}input:focus{border-color:var(--primary);background:#fff;box-shadow:0 0 0 4px rgba(37,99,235,.12)}input::placeholder{color:#94a3b8}
        .input-action,.ghost-button{min-height:38px;border:1px solid #cbd6e5;border-radius:8px;background:#fff;color:#315071;padding:0 12px;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.input-action:hover,.ghost-button:hover{border-color:#8fb2e8;color:var(--primary)}
        .field-helper{display:block;margin-top:6px;color:var(--muted);font-size:12px;line-height:1.48}.import-area{width:100%;min-height:150px;padding:12px 13px;border:1px solid #cbd6e5;border-radius:8px;background:#f8fafc;color:#24324a;font:12px/1.55 "SFMono-Regular",Consolas,monospace;resize:vertical;outline:none}.import-area:focus{border-color:var(--primary);background:#fff;box-shadow:0 0 0 4px rgba(37,99,235,.12)}code{padding:2px 5px;border-radius:5px;background:rgba(15,23,42,.06);color:#1e293b;font-family:"SFMono-Regular",Consolas,monospace;font-size:11px}
        .inline-status{display:flex;align-items:center;gap:8px;min-height:28px;margin-top:10px;color:var(--muted);font-size:13px}.inline-status.ok{color:var(--success)}.inline-status.err{color:var(--danger)}
        .actions{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 24px 24px;background:#fbfcff;border-top:1px solid var(--line)}.actions small{color:var(--muted);line-height:1.45}
        .primary-button,button[type=submit]{min-height:44px;border:0;border-radius:8px;padding:0 18px;background:var(--primary);color:#fff;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 8px 18px rgba(37,99,235,.24);transition:transform .16s ease,box-shadow .16s ease,background .16s ease;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.primary-button:hover,button[type=submit]:hover{background:var(--primary-dark);box-shadow:0 11px 24px rgba(37,99,235,.28)}.primary-button:active,button[type=submit]:active{transform:translateY(1px)}
        .success-wrap{width:min(780px,100%);margin:0 auto}.success-card{padding:28px}.success-title{font-size:24px;margin:0 0 8px}.status-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}.status-box{border:1px solid var(--line);border-radius:10px;padding:14px;background:#fbfcff}.status-box.ok{border-color:#bbebce}.status-box.fail{border-color:#fecdd3}.status-box.optional-fail{border-color:#fed7aa;background:#fff7ed}.status-box.skip{border-color:#fde68a}.status-box strong{display:block;font-size:13px;margin-bottom:6px}.status-box span{display:block;color:var(--muted);font-size:13px;word-break:break-all}
        .countdown{font-weight:800;color:var(--primary)}.button-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}.logbox{margin:0;padding:16px;min-height:360px;max-height:620px;overflow:auto;background:#101827;color:#dbeafe;border-radius:10px;font:12px/1.55 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap}.diagbox{width:100%;min-height:220px;resize:vertical;margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;color:#24324a;font:12px/1.55 "SFMono-Regular",Consolas,monospace}.filter-row{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.filter-row a{min-height:34px;padding:0 11px;border:1px solid #cbd6e5;border-radius:8px;background:#fff;color:#315071;text-decoration:none;font-weight:700;font-size:12px;display:inline-flex;align-items:center}.filter-row a.active{background:#e8f0ff;border-color:#8fb2e8;color:var(--primary)}
        @media (max-width:880px){.layout{grid-template-columns:1fr}.summary{box-shadow:none}main{padding-top:22px}}@media (max-width:640px){.topbar{height:auto;align-items:flex-start;padding:14px 16px;flex-direction:column}.chip{white-space:normal}.grid,.status-grid{grid-template-columns:1fr}.section{padding:20px 16px}.actions{align-items:stretch;flex-direction:column;padding:18px 16px 20px}.input-wrap{align-items:stretch;flex-direction:column}.input-action,.ghost-button,button[type=submit],.primary-button{width:100%}}
        </style>`;
    }

    function pageShell({ title = "PO18 Reader Setup", chip = "受保护面板", body = "", auth = {} }) {
        const headers = auth.setCookie ? { "Set-Cookie": authCookie(auth.cookieToken || auth.token) } : {};
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEscape(title)}</title>${sharedStyles()}</head><body>
        <header class="topbar"><div class="brand"><div class="mark">P</div><div><strong>PO18 Reader Setup</strong><span>初始化与运行配置面板</span></div></div><div class="chip"><span class="dot"></span><span>${htmlEscape(chip)}</span></div></header>
        ${body}</body></html>`;
        return { html, headers };
    }

    function gatePage({ auth = {}, error = "" } = {}) {
        const body = `<main><div class="success-wrap"><section class="success-card">
          <h1 class="success-title">需要安装 Token</h1>
          <p class="lead">初始化和配置面板已保护。请在服务器执行 <code>docker logs po18-app</code>，复制日志里的 setup token，然后访问 <code>/setup?token=TOKEN</code>。</p>
          ${error ? `<p class="notice notice-error">${htmlEscape(error)}</p>` : ""}
          <form method="get" action="/setup" class="button-row" style="margin-top:22px">
            <input name="token" type="password" placeholder="setup token" autocomplete="off" required>
            <button type="submit">进入面板</button>
          </form>
        </section></div></main>`;
        return pageShell({ chip: "等待验证", body, auth });
    }

    function nav(token) {
        return `<nav class="nav">
          <a href="${authPath("/setup", token)}">配置</a>
          <a href="${authPath("/setup/admin", token)}">后台面板</a>
          <a href="${authPath("/setup/status", token)}">状态</a>
          <a href="${authPath("/setup/logs", token)}">日志</a>
          <a href="${authPath("/backup", token)}">导出安全配置</a>
          <a href="${authPath("/setup", token)}#import-config">导入配置</a>
        </nav>`;
    }

    function formPage({ configFile = DEFAULT_CONFIG_FILE, auth = {}, message = "", error = "" } = {}) {
        const values = currentValues(configFile);
        const token = auth.token || "";
        const backupLink = fsSync.existsSync(configFile)
            ? `<a class="ghost-button" href="${authPath("/backup", token)}">下载安全配置</a>`
            : "";
        const body = `<main><div class="layout">
          <aside class="summary">
            <h1>${fsSync.existsSync(configFile) ? "运行配置" : "部署前配置"}</h1>
            <p class="lead">配置 PostgreSQL、后台账号、Bot 和 WebDAV。保存后会写入持久化目录，并让容器重启进入最新配置。</p>
            <div class="path">${htmlEscape(configFile)}</div>
            ${nav(token)}
          </aside>
          <section class="panel" aria-label="安装配置表单">
            ${message ? `<p class="notice notice-ok">${htmlEscape(message)}</p>` : ""}
            ${error ? `<p class="notice notice-error">${htmlEscape(error)}</p>` : ""}
            <form id="setupForm" method="post" action="${authPath("/setup", token)}">
              <div class="section"><div class="section-head"><p class="section-title">安全</p><p class="section-desc">这个 Token 用于保护初始化面板、二次配置、状态和日志。可以重新生成；保存后请使用新 Token 访问面板。</p></div>
                <div class="grid">${field({ id: "PO18_SETUP_TOKEN", label: "Setup Token", value: values.PO18_SETUP_TOKEN, required: true, wide: true, secret: true, generator: true })}</div>
              </div>
              <div id="import-config" class="section"><div class="section-head"><p class="section-title">导入配置</p><p class="section-desc">支持导入从本面板下载的 <code>app.env</code>。可以先填入表单检查，也可以直接保存并重启服务。</p></div>
                <div class="grid">
                  <label class="field field-wide" for="configImportFile">
                    <span class="field-label">配置文件</span>
                    <input id="configImportFile" type="file" accept=".env,.txt,text/plain">
                    <span class="field-helper">只在浏览器本地读取文件内容；后端导入时只接收白名单配置项。</span>
                  </label>
                  <label class="field field-wide" for="configImportText">
                    <span class="field-label">配置内容</span>
                    <textarea id="configImportText" class="import-area" placeholder="把 app.env 内容粘贴到这里，或选择文件自动读取。"></textarea>
                  </label>
                  <div class="field field-wide"><div class="button-row"><button id="previewImport" class="ghost-button" type="button">填入表单</button><button id="submitImport" class="ghost-button" type="button">导入并重启</button><a class="ghost-button" href="${authPath("/backup", token)}">导出安全配置</a></div><span id="importResult" class="inline-status" role="status"></span></div>
                </div>
              </div>
              <div class="section"><div class="section-head"><p class="section-title">数据库</p><p class="section-desc">后端服务启动前必须能访问 PostgreSQL。保存前建议先测试一次。</p></div>
                <div class="grid">
                  ${field({ id: "PO18_PG_URL", label: "PostgreSQL 连接地址", value: values.PO18_PG_URL, placeholder: "postgres://po18:password@host:5432/po18", helper: "支持 <code>postgres://</code> 或 <code>postgresql://</code>。Docker 数据库可用容器名作为 host。", required: true, wide: true })}
                  <div class="field field-wide"><button id="testDb" class="ghost-button" type="button">测试数据库连接</button><span id="dbTestResult" class="inline-status" role="status"></span></div>
                </div>
              </div>
              <div class="section"><div class="section-head"><p class="section-title">后台账号</p><p class="section-desc">首次正式启动会使用这里的账号创建管理员。</p></div>
                <div class="grid">
                  ${field({ id: "PO18_UPLOAD_ADMIN_USER", label: "管理员账号", value: values.PO18_UPLOAD_ADMIN_USER, required: true, autocomplete: "username" })}
                  ${field({ id: "PO18_UPLOAD_ADMIN_PASSWORD", label: "管理员密码", type: "password", value: values.PO18_UPLOAD_ADMIN_PASSWORD, required: true, autocomplete: "new-password", secret: true })}
                  ${field({ id: "PO18_UPLOAD_SESSION_SECRET", label: "Session Secret", value: values.PO18_UPLOAD_SESSION_SECRET, required: true, wide: true, helper: "用于浏览器会话签名。建议使用自动生成值。", generator: true })}
                  ${field({ id: "PO18_UPLOAD_API_TOKEN", label: "上传写入 API Token", value: values.PO18_UPLOAD_API_TOKEN, required: true, wide: true, helper: "外部上传脚本调用写入接口时需要放到 X-Upload-Token 或 X-PO18-Upload-Token 请求头。", secret: true, generator: true })}
                  ${field({ id: "PO18_METRICS_TOKEN", label: "Prometheus Metrics Token", value: values.PO18_METRICS_TOKEN, required: true, wide: true, helper: "生产环境绑定非 localhost 时必填；访问 /metrics 需要 Authorization: Bearer Token。", secret: true, generator: true })}
                </div>
              </div>
              <div class="section"><div class="section-head"><p class="section-title">Bot</p><p class="section-desc">不使用 Bot 可以留空 Telegram Token；通信 Token 用于后端和 Bot 之间校验。</p></div>
                <div class="grid">
                  ${field({ id: "PO18_BOT_API_TOKEN", label: "服务端与 Bot 通信 Token", value: values.PO18_BOT_API_TOKEN, required: true, wide: true, generator: true })}
                  ${field({ id: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", type: "password", value: values.TELEGRAM_BOT_TOKEN, autocomplete: "off", secret: true })}
                  ${field({ id: "TELEGRAM_API_BASE", label: "Telegram API Base", value: values.TELEGRAM_API_BASE, placeholder: "https://api.telegram.org" })}
                  ${field({ id: "PO18_SHARE_API_URL", label: "公开分享/阅读器地址", value: values.PO18_SHARE_API_URL, placeholder: "http://服务器IP:3200", wide: true })}
                </div>
              </div>
              <div class="section"><div class="section-head"><p class="section-title">PikPak WebDAV</p><p class="section-desc">可选配置，用于 Bot 导出上传。</p></div>
                <div class="grid">
                  ${field({ id: "PIKPAK_WEBDAV_URL", label: "WebDAV URL", value: values.PIKPAK_WEBDAV_URL, wide: true })}
                  ${field({ id: "PIKPAK_WEBDAV_USERNAME", label: "用户名", value: values.PIKPAK_WEBDAV_USERNAME, autocomplete: "username" })}
                  ${field({ id: "PIKPAK_WEBDAV_PASSWORD", label: "密码", type: "password", value: values.PIKPAK_WEBDAV_PASSWORD, autocomplete: "current-password", secret: true })}
                  ${field({ id: "PIKPAK_WEBDAV_ROOT", label: "根目录", value: values.PIKPAK_WEBDAV_ROOT, wide: true })}
                </div>
              </div>
              <div class="actions"><small>保存后会退出当前进程，Docker 重启策略会拉起正式服务或最新配置。</small><span class="button-row">${backupLink}<button type="submit">保存配置并重启</button></span></div>
            </form>
          </section>
        </div></main>${formScript(authPath("/setup/test-db", token))}`;
        return pageShell({ body, auth });
    }

    function formScript(testUrl) {
        const importUrl = testUrl.replace("/setup/test-db", "/setup/import");
        return `<script>
        var importKeys=${JSON.stringify(CONFIG_KEYS)};
        function randomToken(bytes){var array=new Uint8Array(bytes||24);if(window.crypto&&window.crypto.getRandomValues){window.crypto.getRandomValues(array)}else{for(var i=0;i<array.length;i+=1)array[i]=Math.floor(Math.random()*256)}var binary="";for(var j=0;j<array.length;j+=1)binary+=String.fromCharCode(array[j]);return btoa(binary).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/g,"")}
        function decodeEnvValue(value){var text=String(value||"").trim();if((text[0]==='"'&&text[text.length-1]==='"')||(text[0]==="'"&&text[text.length-1]==="'"))text=text.slice(1,-1);return text.replace(/\\\\n/g,"\\n").replace(/\\\\"/g,'"').replace(/\\\\\\\\/g,"\\\\")}
        function parseEnvText(text){var result={};String(text||"").split(/\\r?\\n/).forEach(function(line){var trimmed=line.trim();if(!trimmed||trimmed[0]==="#")return;var match=trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);if(match&&importKeys.indexOf(match[1])!==-1)result[match[1]]=decodeEnvValue(match[2]||"")});if(result.BOT_TOKEN&&!result.TELEGRAM_BOT_TOKEN)result.TELEGRAM_BOT_TOKEN=result.BOT_TOKEN;return result}
        function applyImportValues(values){Object.keys(values||{}).forEach(function(key){if(key==="BOT_TOKEN")return;var input=document.getElementById(key);if(input){input.value=values[key]||"";input.dispatchEvent(new Event("input",{bubbles:true}))}})}
        document.querySelectorAll("[data-toggle-target]").forEach(function(button){button.addEventListener("click",function(){var input=document.getElementById(button.getAttribute("data-toggle-target"));if(!input)return;var visible=input.type==="text";input.type=visible?"password":"text";button.textContent=visible?"显示":"隐藏"})});
        document.querySelectorAll("[data-generate-target]").forEach(function(button){button.addEventListener("click",function(){var input=document.getElementById(button.getAttribute("data-generate-target"));if(!input)return;input.value=randomToken(24);input.dispatchEvent(new Event("input",{bubbles:true}))})});
        var importFile=document.getElementById("configImportFile");var importText=document.getElementById("configImportText");var importResult=document.getElementById("importResult");var previewImport=document.getElementById("previewImport");var submitImport=document.getElementById("submitImport");
        if(importFile&&importText){importFile.addEventListener("change",async function(){var file=importFile.files&&importFile.files[0];if(!file)return;try{importText.value=await file.text();if(importResult){importResult.className="inline-status ok";importResult.textContent="已读取 "+file.name}}catch(err){if(importResult){importResult.className="inline-status err";importResult.textContent=err.message||String(err)}}})}
        if(previewImport&&importText){previewImport.addEventListener("click",function(){try{var values=parseEnvText(importText.value);var keys=Object.keys(values).filter(function(key){return key!=="BOT_TOKEN"});if(!keys.length)throw new Error("没有识别到可导入的配置项");applyImportValues(values);if(importResult){importResult.className="inline-status ok";importResult.textContent="已填入 "+keys.length+" 个配置项，请检查后保存"}}catch(err){if(importResult){importResult.className="inline-status err";importResult.textContent=err.message||String(err)}}})}
        if(submitImport&&importText){submitImport.addEventListener("click",async function(){if(!window.confirm("导入会覆盖当前 /config/app.env 并重启服务，继续？"))return;submitImport.disabled=true;if(importResult){importResult.className="inline-status";importResult.textContent="正在导入..."}try{var response=await fetch("${importUrl}",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({config:importText.value}).toString()});var data=await response.json().catch(function(){return{}});if(!response.ok||!data.ok)throw new Error(data.error||"导入失败");if(importResult){importResult.className="inline-status ok";importResult.textContent="已导入 "+(data.imported||0)+" 个配置项，服务即将重启"}setTimeout(function(){window.location.href=data.next||"${authPath("/setup/status", "")}"},1200)}catch(err){if(importResult){importResult.className="inline-status err";importResult.textContent=err.message||String(err)}}finally{submitImport.disabled=false}})}
        var testButton=document.getElementById("testDb");var result=document.getElementById("dbTestResult");
        if(testButton&&result){testButton.addEventListener("click",async function(){var form=document.getElementById("setupForm");result.className="inline-status";result.textContent="正在测试...";testButton.disabled=true;try{var response=await fetch("${testUrl}",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(new FormData(form)).toString()});var data=await response.json().catch(function(){return{}});if(!response.ok||!data.ok)throw new Error(data.error||"连接失败");result.className="inline-status ok";result.textContent="连接成功，用时 "+(data.latency_ms||0)+"ms"}catch(err){result.className="inline-status err";result.textContent=err.message||String(err)}finally{testButton.disabled=false}})}
        </script>`;
    }

    function successPage({ values, auth = {}, configFile = DEFAULT_CONFIG_FILE, restarting = true } = {}) {
        const token = values.PO18_SETUP_TOKEN || auth.token || "";
        const shareUrl = values.PO18_SHARE_API_URL || "http://服务器IP:3200";
        const body = `<main><div class="success-wrap"><section class="success-card">
          <h1 class="success-title">配置已保存</h1>
          <p class="lead">${restarting ? `服务将在 <span id="countdown" class="countdown">${Math.ceil(RESTART_DELAY_MS / 1000)}</span> 秒后退出并等待 Docker 重启。` : "配置已写入磁盘。"}</p>
          <div class="status-grid">
            <div class="status-box"><strong>配置文件</strong><span>${htmlEscape(configFile)}</span></div>
            <div class="status-box ok"><strong>面板 Token</strong><span>新 Token 已写入当前浏览器 Cookie，下面的链接也已自动使用新 Token。</span></div>
            <div class="status-box"><strong>后台地址</strong><span>http://服务器IP:3100</span></div>
            <div class="status-box"><strong>阅读器地址</strong><span>${htmlEscape(shareUrl)}</span></div>
            <div class="status-box"><strong>Bot 状态</strong><span>${values.TELEGRAM_BOT_TOKEN ? "已配置 Token，重启后自动启动" : "未填写 Telegram Token，重启后不启动 Bot"}</span></div>
          </div>
          <div class="button-row"><a class="primary-button" href="${authPath("/setup/status", token)}">查看状态</a><a class="ghost-button" href="${authPath("/backup", token)}">下载安全配置</a><a class="ghost-button" href="${authPath("/setup", token)}">返回配置</a></div>
        </section></div></main>${restarting ? `<script>var seconds=${Math.ceil(RESTART_DELAY_MS / 1000)};var node=document.getElementById("countdown");setInterval(function(){seconds=Math.max(0,seconds-1);if(node)node.textContent=String(seconds)},1000)</script>` : ""}`;
        return pageShell({ chip: "配置已保存", body, auth: { ...auth, token } });
    }

    function statusBox(result) {
        const cls = result.skipped ? "skip" : result.ok ? "ok" : result.required === false ? "optional-fail" : "fail";
        const detail = result.detail || result.error || `status=${result.status || "n/a"} latency=${result.latency_ms || 0}ms`;
        const label = result.skipped ? "SKIP" : result.ok ? "OK" : result.required === false ? "OPTIONAL FAIL" : "FAIL";
        return `<div class="status-box ${cls}"><strong>${htmlEscape(result.name)} · ${label}</strong><span>${htmlEscape(detail)}</span></div>`;
    }

    async function statusPage({ configFile = DEFAULT_CONFIG_FILE, auth = {} } = {}) {
        const results = await collectStatus(configFile);
        const token = auth.token || "";
        const diagnosticsText = JSON.stringify(await collectDiagnostics(configFile, results), null, 2);
        const body = `<main><div class="layout"><aside class="summary"><h1>运行状态</h1><p class="lead">检测 server-pg、阅读器、Bot 和数据库连接。</p><div class="path">${htmlEscape(configFile)}</div>${nav(token)}</aside>
          <section class="panel"><div class="section"><div class="section-head"><p class="section-title">服务状态</p><p class="section-desc">Bot 未配置 Token 时会被跳过，不影响整体部署。</p></div><div class="status-grid">${results.map(statusBox).join("")}</div>
          <form method="post" action="${authPath("/setup/restart", token)}" class="button-row"><button type="submit">手动重启服务</button><a class="ghost-button" href="${authPath("/setup/logs", token)}">查看日志</a><a class="ghost-button" href="${authPath("/setup/diagnostics.json", token)}">诊断 JSON</a></form></div>
          <div class="section"><div class="section-head"><p class="section-title">脱敏诊断信息</p><p class="section-desc">用于排查部署问题；Token、密码和数据库密码已脱敏。</p></div><button id="copyDiagnostics" class="ghost-button" type="button">复制诊断信息</button><span id="copyDiagnosticsStatus" class="inline-status"></span><textarea id="diagnosticsText" class="diagbox" readonly>${htmlEscape(diagnosticsText)}</textarea></div>
          </section></div></main><script>
          var copyButton=document.getElementById("copyDiagnostics");
          var copyStatus=document.getElementById("copyDiagnosticsStatus");
          if(copyButton){copyButton.addEventListener("click",async function(){var text=document.getElementById("diagnosticsText").value;try{await navigator.clipboard.writeText(text);copyStatus.className="inline-status ok";copyStatus.textContent="已复制"}catch(err){copyStatus.className="inline-status err";copyStatus.textContent="复制失败，请手动选择文本"}})}
          </script>`;
        return pageShell({ chip: results.every((item) => item.ok || item.required === false) ? "状态正常" : "需要检查", body, auth });
    }

    function logFilterLinks(token, active) {
        const labels = {
            all: "全部",
            error: "错误",
            database: "数据库",
            bot: "Bot",
            reader: "阅读器",
            server: "后端",
            setup: "启动/面板"
        };
        return `<div class="filter-row">${Object.entries(labels)
            .map(
                ([key, label]) =>
                    `<a class="${key === active ? "active" : ""}" href="${authPath("/setup/logs", token, { filter: key })}">${label}</a>`
            )
            .join("")}</div>`;
    }

    function logsPage({ auth = {}, filter = "all" } = {}) {
        const token = auth.token || "";
        const logFile = process.env.PO18_RUNTIME_LOG_FILE || DEFAULT_RUNTIME_LOG_FILE;
        const active = ["all", "error", "database", "bot", "reader", "server", "setup"].includes(String(filter || "").toLowerCase())
            ? String(filter).toLowerCase()
            : "all";
        const body = `<main><div class="layout"><aside class="summary"><h1>运行日志</h1><p class="lead">显示容器内最近运行日志。完整日志仍建议使用 <code>docker logs po18-app</code>。</p><div class="path">${htmlEscape(logFile)}</div>${nav(token)}</aside>
          <section class="panel"><div class="section">${logFilterLinks(token, active)}<pre class="logbox">${htmlEscape(filterLogText(readLogTail(logFile), active))}</pre></div></section></div></main>`;
        return pageShell({ chip: active === "all" ? "最近日志" : `日志过滤：${active}`, body, auth });
    }

    async function adminPanelPage({ auth = {}, available = false } = {}) {
        if (!available) {
            const token = auth.token || "";
            const body = `<main><div class="layout"><aside class="summary"><h1>后台面板</h1><p class="lead">后台面板会在保存配置并由 Docker 重启进入正常应用模式后启用。</p>${nav(token)}</aside>
              <section class="panel"><div class="section"><div class="section-head"><p class="section-title">等待应用服务启动</p><p class="section-desc">当前进程只负责初始化配置，没有加载书库后台 API。请先保存 PostgreSQL 和管理员配置，容器重启后再从这里进入后台。</p></div><div class="button-row"><a class="primary-button" href="${authPath("/setup", token)}">返回配置</a><a class="ghost-button" href="${authPath("/setup/status", token)}">查看状态</a></div></div></section></div></main>`;
            return pageShell({ chip: "等待后台启动", body, auth });
        }
        const file = path.join(__dirname, "..", "public", "index.html");
        const stat = await fs.stat(file);
        if (adminIndexCache.file !== file || adminIndexCache.mtimeMs !== stat.mtimeMs) {
            adminIndexCache = {
                file,
                mtimeMs: stat.mtimeMs,
                html: await fs.readFile(file, "utf8")
            };
        }
        return {
            html: adminIndexCache.html,
            headers: auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
        };
    }

    return {
        adminPanelPage,
        formPage,
        gatePage,
        logsPage,
        statusPage,
        successPage
    };
}

module.exports = { createControlPanelPages };
