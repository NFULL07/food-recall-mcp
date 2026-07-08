# Upload food-recall-mcp to GitHub (Windows PowerShell)
# Usage (run in this folder):
#   powershell -ExecutionPolicy Bypass -File .\deploy-to-github.ps1

$ErrorActionPreference = "Stop"
$RepoName = "food-recall-mcp"
$Visibility = "public"   # competition submission. use "private" to keep it private

Set-Location -Path $PSScriptRoot

Write-Host "== 1. clean broken .git =="
if (Test-Path ".git") {
  Remove-Item -Recurse -Force ".git"
  Write-Host "removed existing .git"
}

Write-Host "== 2. git init and commit =="
git init -q
git add -A

$staged = git diff --cached --name-only
if ($staged -contains ".env") {
  Write-Host "ABORT: .env would be committed. Check .gitignore." -ForegroundColor Red
  exit 1
}
Write-Host "files to commit:"
$staged | ForEach-Object { Write-Host "  $_" }
Write-Host ".env is excluded (safe)" -ForegroundColor Green

git commit -q -m "Initial commit: food recall check MCP server"

Write-Host "== 3. create GitHub repo and push =="
$hasGh = $null -ne (Get-Command gh -ErrorAction SilentlyContinue)
if ($hasGh) {
  gh repo create $RepoName --$Visibility --source=. --remote=origin --push
  Write-Host "DONE. Open the repo in your browser to verify." -ForegroundColor Green
} else {
  Write-Host "GitHub CLI (gh) not found. Choose one:" -ForegroundColor Yellow
  Write-Host "  A) Install gh from https://cli.github.com then run this script again"
  Write-Host "  B) Create an empty repo named $RepoName on github.com, then run:"
  Write-Host "     git remote add origin https://github.com/YOUR_ID/$RepoName.git"
  Write-Host "     git branch -M main"
  Write-Host "     git push -u origin main"
}
