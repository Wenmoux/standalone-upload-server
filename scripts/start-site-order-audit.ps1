# [INPUT]: 依赖 PO18 Cookie 文件、目标书号、审计输出路径与 Node.js 站点目录审计脚本
# [OUTPUT]: 提供 Windows 下安全传参并启动只读章节顺序站点审计的命令入口
# [POS]: scripts 的 PowerShell 适配层，只负责本地参数编排，不实现审计算法
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

param(
    [string]$CookieFile = ".\po18-catalog-cookie.local.txt",
    [string]$Output = ".\chapter-order-site-audit.json",
    [string]$Progress = ".\chapter-order-site-audit.jsonl",
    [string]$OutLog = ".\chapter-order-site-audit.out.log",
    [string]$ErrLog = ".\chapter-order-site-audit.err.log",
    [string]$Platforms = "",
    [string]$BookIds = "",
    [int]$Limit = 0,
    [int]$MaxPages = 80,
    [int]$Retries = 3,
    [int]$TimeoutMs = 30000,
    [int]$DelayMs = 600,
    [double]$MinMatchRatio = 0.95
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$nodeScript = Join-Path $PSScriptRoot "audit-chapter-order-against-site.js"

$arguments = @(
    "`"$nodeScript`"",
    "--output", "`"$Output`"",
    "--progress", "`"$Progress`"",
    "--max-pages", "$MaxPages",
    "--retries", "$Retries",
    "--timeout-ms", "$TimeoutMs",
    "--delay-ms", "$DelayMs",
    "--min-match-ratio", "$MinMatchRatio"
)

if ($CookieFile -and (Test-Path -LiteralPath $CookieFile)) {
    $arguments += @("--cookie-file", "`"$CookieFile`"")
}
if ($Platforms.Trim()) {
    $arguments += @("--platforms", "`"$Platforms`"")
}
if ($BookIds.Trim()) {
    $arguments += @("--book-ids", "`"$BookIds`"")
}
if ($Limit -gt 0) {
    $arguments += @("--limit", "$Limit")
}

$process = Start-Process `
    -FilePath "node" `
    -ArgumentList $arguments `
    -WorkingDirectory $root `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden `
    -PassThru

$pidPath = Join-Path $root "chapter-order-site-audit.pid"
Set-Content -LiteralPath $pidPath -Value $process.Id

Write-Host "已后台启动网站目录对比。PID=$($process.Id)"
Write-Host "报告：$Output"
Write-Host "进度：$Progress"
Write-Host "日志：$OutLog / $ErrLog"
