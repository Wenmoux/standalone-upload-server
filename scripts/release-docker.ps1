param(
    [string]$Image = "wenmoux/reader:v2.0",
    [int]$SetupPort = 13100,
    [int]$ReaderPort = 13200,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$name = "po18-release-test-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
$previousImageTag = $env:PO18_IMAGE_TAG
$previousRelease = $env:PO18_RELEASE
$previousSourceDateEpoch = $env:SOURCE_DATE_EPOCH
$immutableImage = $Image

try {
    $env:PO18_IMAGE_TAG = $Image
    $env:PO18_RELEASE = "1"
    if (-not $env:SOURCE_DATE_EPOCH) {
        $env:SOURCE_DATE_EPOCH = (& git show -s --format=%ct HEAD).Trim()
    }
    node scripts/docker-build.js
    if ($LASTEXITCODE -ne 0) { throw "Docker build failed with exit code $LASTEXITCODE" }
    $buildMetadata = Get-Content -LiteralPath ".docker-build.json" -Raw | ConvertFrom-Json
    $immutableImage = $buildMetadata.immutableTag
}
finally {
    $env:PO18_IMAGE_TAG = $previousImageTag
    $env:PO18_RELEASE = $previousRelease
    $env:SOURCE_DATE_EPOCH = $previousSourceDateEpoch
}

try {
    docker run -d --rm --name $name -p "${SetupPort}:3100" -p "${ReaderPort}:3200" $immutableImage | Out-Null
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
    $env:PO18_IMAGE_TAG = $Image
    try {
        node scripts/docker-push.js
        if ($LASTEXITCODE -ne 0) { throw "Docker push failed with exit code $LASTEXITCODE" }
        node scripts/docker-release-manifest.js
        if ($LASTEXITCODE -ne 0) { throw "Digest resolution failed with exit code $LASTEXITCODE" }
        $releaseManifest = Get-Content -LiteralPath "release-manifest.json" -Raw | ConvertFrom-Json
        docker pull $releaseManifest.digest_reference
        if ($LASTEXITCODE -ne 0) { throw "Digest pull failed with exit code $LASTEXITCODE" }
        $previousTestImage = $env:PO18_TEST_APP_IMAGE
        $previousExpectedDigest = $env:PO18_EXPECTED_IMAGE_DIGEST
        try {
            $env:PO18_TEST_APP_IMAGE = $releaseManifest.digest_reference
            $env:PO18_EXPECTED_IMAGE_DIGEST = $releaseManifest.digest
            node scripts/docker-smoke.js
            if ($LASTEXITCODE -ne 0) { throw "Digest smoke failed with exit code $LASTEXITCODE" }
        }
        finally {
            $env:PO18_TEST_APP_IMAGE = $previousTestImage
            $env:PO18_EXPECTED_IMAGE_DIGEST = $previousExpectedDigest
        }
    }
    finally {
        $env:PO18_IMAGE_TAG = $previousImageTag
    }
    docker buildx imagetools inspect $releaseManifest.digest_reference
}
