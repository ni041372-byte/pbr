
$port = 3000
$timeoutSeconds = 60
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "Waiting for port $port to open..."

while ($sw.Elapsed.TotalSeconds -lt $timeoutSeconds) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("localhost", $port)
        $client.Close()
        Write-Host "Port $port is open."
        exit 0
    } catch {
        # Port not yet open, wait and retry
        Start-Sleep -Seconds 2
    }
}

Write-Host "Timeout reached. Port $port did not open within $timeoutSeconds seconds."
exit 1
