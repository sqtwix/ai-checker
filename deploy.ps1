$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function New-HexSecret([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}
function Read-EnvFile([string]$Path) {
    $values = @{}
    $lineNumber = 0
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $lineNumber++
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) { continue }
        if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { throw "Invalid .env line $lineNumber" }
        if ($values.ContainsKey($Matches[1])) { throw "Duplicate .env key: $($Matches[1])" }
        $values[$Matches[1]] = $Matches[2]
    }
    return $values
}

$template = Join-Path $PSScriptRoot ".env.example"
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) { Copy-Item $template $envPath }
$values = Read-EnvFile $envPath
$templateValues = Read-EnvFile $template
foreach ($key in $templateValues.Keys) {
    if (-not $values.ContainsKey($key)) { $values[$key] = $templateValues[$key] }
}
$runtimeDbPassword = ""
$runtimeJwtSecret = ""
try {
    $apiContainer = (& docker ps -a --filter "label=com.docker.compose.project=ai-checker" --filter "label=com.docker.compose.service=api-core" --format '{{.ID}}' | Select-Object -First 1)
    if ($apiContainer) {
        $runtimeEnv = (& docker inspect --format '{{json .Config.Env}}' $apiContainer | ConvertFrom-Json)
        $runtimeConnection = ($runtimeEnv | Where-Object { $_.StartsWith("ConnectionStrings__DefaultConnection=") } | Select-Object -First 1) -replace '^[^=]+=', ''
        $runtimeJwtSecret = (($runtimeEnv | Where-Object { $_.StartsWith("JwtSettings__Secret=") } | Select-Object -First 1) -replace '^[^=]+=', '')
        if ($runtimeConnection -match '(?:^|;)Password=([^;]+)') { $runtimeDbPassword = $Matches[1] }
    }
} catch { }
if (-not $values.DB_PASSWORD -or $values.DB_PASSWORD.StartsWith("replace-")) { $values.DB_PASSWORD = $(if ($runtimeDbPassword) { $runtimeDbPassword } else { New-HexSecret 32 }) }
if (-not $values.JWT_SECRET -or $values.JWT_SECRET.StartsWith("replace-") -or $values.JWT_SECRET.Length -lt 32) { $values.JWT_SECRET = $(if ($runtimeJwtSecret.Length -ge 32) { $runtimeJwtSecret } else { New-HexSecret 48 }) }

$lines = New-Object Collections.Generic.List[string]
foreach ($line in [IO.File]::ReadAllLines($template)) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=') { $lines.Add("$($Matches[1])=$($values[$Matches[1])") } else { $lines.Add($line) }
}
[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
$values = Read-EnvFile $envPath

function Require-Port([string]$Name) {
    $parsed = 0
    if (-not [int]::TryParse($values[$Name], [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 65535) { throw "$Name must be 1..65535" }
    return $parsed
}
function Require-Number([string]$Name, [int]$Minimum, [int]$Maximum) {
    $parsed = 0
    if (-not [int]::TryParse($values[$Name], [ref]$parsed) -or $parsed -lt $Minimum -or $parsed -gt $Maximum) { throw "$Name must be $Minimum..$Maximum" }
    return $parsed
}
if ($values.DB_PASSWORD.Length -lt 24) { throw "DB_PASSWORD must contain at least 24 characters" }
if ($values.JWT_SECRET.Length -lt 32) { throw "JWT_SECRET must contain at least 32 characters" }
$frontendPort = Require-Port FRONTEND_PORT
$apiPort = Require-Port API_PORT
$aiPort = Require-Port AI_DRIVER_PORT
$publishedPorts = @($frontendPort, $apiPort, $aiPort)
if (($publishedPorts | Select-Object -Unique).Count -ne 3) { throw "Published ports must be different" }
Require-Number JWT_EXPIRY_MINUTES 5 10080 | Out-Null
$maxRequest = Require-Number MAX_REQUEST_SIZE_MB 1 1024
$maxFile = Require-Number MAX_FILE_SIZE_MB 1 1024
if ($maxFile -gt $maxRequest) { throw "MAX_FILE_SIZE_MB cannot exceed MAX_REQUEST_SIZE_MB" }
Require-Number MAX_RESPONSE_FILE_COUNT 1 1000 | Out-Null
Require-Number ANALYSIS_QUEUE_CAPACITY 1 10000 | Out-Null
Require-Number ANALYSIS_MAX_ATTEMPTS 1 10 | Out-Null
Require-Number AI_PROVIDER_TIMEOUT_SECONDS 30 900 | Out-Null
Require-Number AI_PIPELINE_TIMEOUT_SECONDS 60 3600 | Out-Null
Require-Number AI_MAX_OUTPUT_TOKENS 128 4096 | Out-Null
if ([int]$values.AI_PIPELINE_TIMEOUT_SECONDS -le [int]$values.AI_PROVIDER_TIMEOUT_SECONDS) { throw "AI_PIPELINE_TIMEOUT_SECONDS must exceed AI_PROVIDER_TIMEOUT_SECONDS" }
if ($values.ALLOW_PROGRAMMATIC_FALLBACK.ToLowerInvariant() -notin @("true", "false")) { throw "ALLOW_PROGRAMMATIC_FALLBACK must be true or false" }

$localEnabled = $values.ENABLE_LOCAL_LLM.ToLowerInvariant()
if ($localEnabled -notin @("true", "false")) { throw "ENABLE_LOCAL_LLM must be true or false" }
$localMode = $values.LOCAL_LLM_MODE.ToLowerInvariant()
if ($localMode -notin @("managed", "external")) { throw "LOCAL_LLM_MODE must be managed or external" }

if ($localEnabled -eq "true" -and $localMode -eq "managed") {
    $file = $values.LOCAL_LLM_MODEL_FILE
    if ([IO.Path]::GetFileName($file) -ne $file -or [IO.Path]::GetExtension($file).ToLowerInvariant() -ne ".gguf") { throw "LOCAL_LLM_MODEL_FILE must be a .gguf basename" }
    if ($values.LOCAL_LLM_MODEL_SHA256 -notmatch '^[0-9A-Fa-f]{64}$') { throw "LOCAL_LLM_MODEL_SHA256 is required in managed mode" }
    $modelsDirectory = $values.LOCAL_LLM_MODELS_DIR
    if ([string]::IsNullOrWhiteSpace($modelsDirectory)) { throw "LOCAL_LLM_MODELS_DIR cannot be empty" }
    if (-not [IO.Path]::IsPathRooted($modelsDirectory)) { $modelsDirectory = Join-Path $PSScriptRoot $modelsDirectory }
    $modelPath = Join-Path $modelsDirectory $file
    New-Item -ItemType Directory -Force (Split-Path $modelPath) | Out-Null
    if (-not (Test-Path $modelPath)) {
        if (-not $values.LOCAL_LLM_MODEL_URL.StartsWith("https://")) { throw "Provide the GGUF file or an HTTPS URL" }
        $part = "$modelPath.part"
        try {
            Invoke-WebRequest $values.LOCAL_LLM_MODEL_URL -OutFile $part
            if ((Get-FileHash $part -Algorithm SHA256).Hash -ne $values.LOCAL_LLM_MODEL_SHA256) { throw "Downloaded model checksum mismatch" }
            Move-Item $part $modelPath -Force
        }
        finally { Remove-Item $part -Force -ErrorAction SilentlyContinue }
    }
    if ((Get-FileHash $modelPath -Algorithm SHA256).Hash -ne $values.LOCAL_LLM_MODEL_SHA256) { throw "Local model checksum mismatch" }
} elseif ($localEnabled -eq "true") {
    $uri = [Uri]$values.LOCAL_LLM_BASE_URL
    if ($uri.Scheme -notin @("http", "https") -or $uri.Host -in @("localhost", "127.0.0.1", "::1")) { throw "Use a reachable external HTTP(S) endpoint; use host.docker.internal for host runtime" }
    if (-not $values.LOCAL_LLM_MODEL) { throw "LOCAL_LLM_MODEL is required" }
}
foreach ($model in ($values.ENABLED_MODELS -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })) {
    switch ($model) {
        "deepseek" { if (-not $values.DEEPSEEK_API_KEY) { throw "deepseek is enabled but DEEPSEEK_API_KEY is empty" } }
        "gigachat" { if (-not $values.SBERGPT_API_KEY) { throw "gigachat is enabled but SBERGPT_API_KEY is empty" } }
        "local_llm" { if ($localEnabled -ne "true") { throw "local_llm is enabled but ENABLE_LOCAL_LLM is false" } }
        default { throw "Unsupported model in ENABLED_MODELS: $model" }
    }
}

docker info | Out-Null
docker compose version | Out-Null
$profile = @()
if ($localEnabled -eq "true" -and $localMode -eq "managed") { $profile = @("--profile", "local-ai") }
function Invoke-Compose { & docker compose --env-file .env @profile @args; if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed" } }

Invoke-Compose config --quiet
if ($localEnabled -eq "false" -or $localMode -eq "external") {
    & docker compose --env-file .env --profile local-ai rm -sf local-llm | Out-Null
}
Invoke-Compose build
Invoke-Compose up --no-build -d --remove-orphans

$services = @("postgres", "ai-driver", "api-core", "frontend")
if ($profile.Count) { $services += "local-llm" }
$startupMinutes = if ($localEnabled -eq "true" -and $localMode -eq "managed") { 15 } else { 5 }
$deadline = (Get-Date).AddMinutes($startupMinutes)
foreach ($service in $services) {
    do {
        $id = (docker compose --env-file .env @profile ps -q $service).Trim()
        $state = if ($id) { (docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id).Trim() } else { "missing" }
        if ($state -in @("unhealthy", "exited", "dead")) { throw "$service entered $state" }
        if ($state -ne "healthy") { Start-Sleep -Seconds 2 }
    } until ($state -eq "healthy" -or (Get-Date) -gt $deadline)
    if ($state -ne "healthy") { throw "Timed out waiting for $service" }
    Write-Host "$service`: healthy"
}
if ($localEnabled -eq "true") {
    Invoke-Compose exec -T ai-driver python -c "from backend.model_availability import verify_local_inference; raise SystemExit(0 if verify_local_inference() else 1)"
}
function Remove-SmokeUsers {
    Invoke-Compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DELETE FROM users WHERE email LIKE \$\$smoke-%@example.test\$\$;"' | Out-Null
}
$smokeArgs = @("--base-url", "http://frontend")
if (-not $values.ENABLED_MODELS) { $smokeArgs += "--expect-no-ai" }
Remove-SmokeUsers
Get-Content -Raw (Join-Path $PSScriptRoot "scripts/smoke_stack.py") |
    & docker compose --env-file .env @profile exec -T ai-driver python - @smokeArgs
$smokeExitCode = $LASTEXITCODE
Remove-SmokeUsers
if ($smokeExitCode -ne 0) { throw "Stack smoke test failed" }
Write-Host "Deployment complete: http://localhost:$frontendPort"
