# Show when an at-limit token resets (#2976)

The token usage screen's at-limit row gave no date. The server now sends a login's last-read windows
(`lastLimits`) while its current ones are stale; the row lists each window's reset time that is still
ahead, labelled as last read. Both windows are listed because the probe cannot say which one blocked.
