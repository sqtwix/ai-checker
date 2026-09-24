param(
    [int]$TimeoutSeconds = 3600,
    [string]$Benchmark = "doc/benchmark_python.csv",
    [string]$Response = "doc/responses_python.csv",
    [string]$ExpectedShape = "-"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = New-Object Text.UTF8Encoding($false)
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
if ($TimeoutSeconds -lt 30 -or $TimeoutSeconds -gt 3600) { throw "TimeoutSeconds must be 30..3600" }
foreach ($relativePath in @($Benchmark, $Response, $ExpectedShape)) {
    if ($relativePath -eq "-") { continue }
    $resolved = [IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))
    if (-not $resolved.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Test files must exist inside the project: $relativePath"
    }
}

$database = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $projectRoot ".env"))) {
    if ($line -match '^(DB_USER|DB_NAME)=(.+)$') { $database[$Matches[1]] = $Matches[2] }
}
if (-not $database.DB_USER -or -not $database.DB_NAME) { throw "DB_USER and DB_NAME must be configured" }

# Each run owns exactly this random email prefix; cleanup never targets other users.
$runPrefix = "smoke-qwen-$([Guid]::NewGuid().ToString('N'))"
$probe = @'
import sys
import uuid

sys.path.insert(0, "/workspace/scripts")
import analysis_e2e

run_prefix, timeout, benchmark, response, shape = sys.argv[1:6]

def register(base, label):
    status, data = analysis_e2e.request_json(
        f"{base}/api/v1/auth/register",
        method="POST",
        payload={
            "username": label,
            "email": f"{run_prefix}-{uuid.uuid4().hex}@example.test",
            "password": "local-model-smoke-test-password",
        },
    )
    assert status == 200, (status, data)
    return data["token"]

analysis_e2e.register = register
sys.argv = [
    "analysis_e2e.py",
    "--base-url", "http://frontend:8080",
    "--benchmark", "/workspace/" + benchmark.replace("\\", "/"),
    "--response", "/workspace/" + response.replace("\\", "/"),
    "--model", "local_llm",
    "--timeout", timeout,
    "--require-verified",
]
if shape != "-":
    sys.argv += ["--expected-shape", "/workspace/" + shape.replace("\\", "/")]
analysis_e2e.main()
'@

try {
    $probe | & docker compose --env-file .env run --rm -T --no-deps `
        --volume "${projectRoot}:/workspace:ro" ai-driver python - $runPrefix $TimeoutSeconds $Benchmark $Response $ExpectedShape
    if ($LASTEXITCODE -ne 0) { throw "Local model end-to-end smoke failed" }
}
finally {
    "DELETE FROM users WHERE email LIKE '$runPrefix-%@example.test';" |
        & docker compose --env-file .env exec -T postgres psql `
            -U $database.DB_USER -d $database.DB_NAME -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw "Could not clean up test users with prefix $runPrefix" }
}

Write-Host "Local model end-to-end smoke passed; temporary users and reports removed."
