# Keeps Windows from going to sleep while the Goonpilot server (node) is running. Changes no power settings:
# the "stay awake" request disappears as soon as this script ends, and it ends when node stops.
Add-Type -Namespace K -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[void][K.P]::SetThreadExecutionState([uint32]2147483649)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
Start-Sleep -Seconds 20                             # give the server time to start
while (Get-Process -Name node -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 10; [void][K.P]::SetThreadExecutionState([uint32]2147483649) }
