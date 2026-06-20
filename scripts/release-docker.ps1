param(
    [string]$Image = "wenmoux/reader:v1.0",
    [int]$SetupPort = 13100,
    [int]$ReaderPort = 13200,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$name = "po18-release-test-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)

docker build --target app -t $Image .

try {
    docker run -d --rm --name $name -p "${SetupPort}:3100" -p "${ReaderPort}:3200" $Image | Out-Null
    Start-Sleep -Seconds 4
    $ready = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$SetupPort/health/ready" -TimeoutSec 10
    if ($ready.StatusCode -ne 200) {
        throw "setup health returned $($ready.StatusCode)"
    }
    $logsText = ""
    for ($i = 0; $i -lt 12; $i++) {
        $logsText = docker logs $name 2>&1 | Out-String
        if ($logsText -match "setup token") {
            break
        }
        Start-Sleep -Seconds 1
    }
    if ($logsText -notmatch "setup token") {
        Write-Warning "setup token was not found in captured logs; health check still passed"
    }
}
finally {
    docker rm -f $name 2>$null | Out-Null
}

if (-not $NoPush) {
    docker push $Image
    docker buildx imagetools inspect $Image
}
