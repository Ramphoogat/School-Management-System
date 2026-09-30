/** A student below this attendance percent, over the window, with at least MIN_DAYS marked, counts as low. */
export const ATTENDANCE_THRESHOLD = 75
export const ATTENDANCE_WINDOW_DAYS = 30
export const ATTENDANCE_MIN_DAYS = 3
/** After a low-attendance alert, the same student is not alerted again for this long. */
export const ATTENDANCE_ALERT_COOLDOWN_DAYS = 7
