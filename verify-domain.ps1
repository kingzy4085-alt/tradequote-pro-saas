$authPath = @("$env:APPDATA\com.vercel.cli\Data\auth.json", "$HOME\.vercel\auth.json") | Where-Object { Test-Path $_ } | Select-Object -First 1
$headers = @{ Authorization = "Bearer $((Get-Content $authPath -Raw | ConvertFrom-Json).token)" }
ipconfig /flushdns | Out-Null
Resolve-DnsName tradequotepro.com -Type NS,A -Server 1.1.1.1 -ErrorAction SilentlyContinue | Format-Table Name,Type,NameHost,IPAddress -AutoSize
Resolve-DnsName _vercel.tradequotepro.com -Type TXT -Server 1.1.1.1 -ErrorAction SilentlyContinue | Format-Table Name,Type,Strings -AutoSize
foreach ($domain in @("tradequotepro.com", "www.tradequotepro.com")) {
    try { Invoke-RestMethod -Method Post -Uri "https://api.vercel.com/v9/projects/tradequote-pro/domains/$domain/verify" -Headers $headers -ContentType "application/json" -Body "{}" | Select-Object name, verified }
    catch { Write-Warning "$domain -> $($_.ErrorDetails.Message)" }
}
Invoke-RestMethod -Uri "https://tradequotepro.com/api/health"
